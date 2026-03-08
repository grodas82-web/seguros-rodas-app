const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const { jsPDF } = require('jspdf');
const autoTable = require('jspdf-autotable').default || require('jspdf-autotable');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query, where, Timestamp } = require('firebase/firestore');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// --- Configuración Firebase (Main Process) ---
const firebaseConfig = {
    apiKey: process.env.VITE_GEMINI_API_KEY,
    authDomain: "finanzastg.firebaseapp.com",
    projectId: "finanzastg",
    storageBucket: "finanzastg.firebasestorage.app",
    messagingSenderId: "980629069726",
    appId: "1:980629069726:web:0810594773af27c552c08f"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// === Registro de IDs enviados (anti-duplicado) ===
const sentNotificationsFile = path.join(os.tmpdir(), 'sent_notifications.json');
const getSentNotifications = () => {
    try {
        if (fs.existsSync(sentNotificationsFile)) {
            return JSON.parse(fs.readFileSync(sentNotificationsFile, 'utf8'));
        }
    } catch (e) { /* ignore */ }
    return {};
};
const markAsSent = (id) => {
    const sent = getSentNotifications();
    sent[id] = { sentAt: new Date().toISOString(), count: (sent[id]?.count || 0) + 1 };
    fs.writeFileSync(sentNotificationsFile, JSON.stringify(sent, null, 2));
};

// --- Lógica de Reporte por Email ---
async function sendExpiringPoliciesReport() {
    console.log("📅 [Reporte] Iniciando generación de reporte completo (Vencimientos + Pendientes + Sin Archivo)...");
    try {
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        const next7Days = new Date();
        next7Days.setDate(now.getDate() + 7);

        // --- Utilidades ---
        const isAutoExpired = (p) => {
            if (!p.endDate || p.status === 'Anulada') return false;
            const risk = (p.riskType || '').toLowerCase();
            if (!risk.includes('accidente')) return false;

            const start = p.startDate ? new Date(p.startDate) : null;
            const end = new Date(p.endDate);

            if (start) {
                const diffTime = end - start;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (diffDays > 32) return false;
            }
            return end < now;
        };

        const getCanonKey = (name) => {
            if (!name) return null;
            const u = name.toUpperCase().trim();
            if (u.includes('ACS COMERCIAL') || u.includes('GALICIA') || u.includes('1276')) return '__CANON_GALICIA';
            if (u.includes('MERCANTIL ANDINA') || u.includes('MERCANTIL')) return '__CANON_MERCANTIL';
            if (u.includes('FEDERA')) return '__CANON_FEDERACION';
            if (u.includes('ALLIANZ')) return '__CANON_ALLIANZ';
            if ((u.includes('SWISS MEDICAL') && u.includes('ART')) || u.includes('SWISS MEDICAL ART')) return '__CANON_SWISS_MEDICAL_ART';
            if (u.includes('SMG') || (u.includes('COMPANIA ARGENTINA') && u.includes('SEGUROS')) || (u.includes('SWISS MEDICAL') && !u.includes('ART'))) return '__CANON_SMG';
            if (u.includes('MERIDIONAL')) return '__CANON_MERIDIONAL';
            if (u.includes('ZURICH')) return '__CANON_ZURICH';
            if (u.includes('RIVADAVIA')) return '__CANON_RIVADAVIA';
            if (u.includes('SANCOR')) return '__CANON_SANCOR';
            if (u.includes('SAN CRISTOBAL') || u.includes('SAN CRIST\u00d3BAL')) return '__CANON_SANCRISTOBAL';
            if (u.includes('PROVINCIA')) return '__CANON_PROVINCIA';
            if (u.includes('MAPFRE')) return '__CANON_MAPFRE';
            if (u.includes('HAMBURGO')) return '__CANON_HAMBURGO';
            if (u.includes('INTEGRITY')) return '__CANON_INTEGRITY';
            if (u.includes('TRIUNFO')) return '__CANON_TRIUNFO';
            return null;
        };

        const normalizeName = (name) => {
            if (!name) return '';
            let n = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            return n.toLowerCase()
                .replace(/s\.a\.|sa|compia|compañía|cia\.| \/|seg\.|argentina|nacion|asoc\.|mutual|asociacin|asociacion|riesgos|trabajo/gi, '')
                .replace(/[^a-z0-9]/g, '')
                .trim();
        };

        // --- Obtener Datos ---
        const [policiesSnap, invoicesSnap, companiesSnap] = await Promise.all([
            getDocs(query(collection(db, 'policies'))),
            getDocs(query(collection(db, 'invoices'))),
            getDocs(query(collection(db, 'companies')))
        ]);

        const policies = policiesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const invoices = invoicesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const companies = companiesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        // --- Lógica 1: Vencimientos a 7 días ---
        const expiring = policies.filter(p => {
            if (!p.endDate || p.status === 'Anulada' || isAutoExpired(p)) return false;
            const end = new Date(p.endDate);
            const diffTime = end - now;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            return diffDays >= 0 && diffDays <= 7;
        }).sort((a, b) => new Date(a.endDate) - new Date(b.endDate));

        // --- Lógica 2: Compañías Pendientes ---
        const companiesWithInvoices = new Set();
        invoices.forEach(inv => {
            let invDateObj = null;
            if (inv.timestamp?.toDate) invDateObj = inv.timestamp.toDate();
            else if (inv.timestamp) invDateObj = new Date(inv.timestamp);
            else if (inv.date) invDateObj = new Date(inv.date);

            if (!invDateObj) invDateObj = new Date(0);

            if (invDateObj.getMonth() === currentMonth && invDateObj.getFullYear() === currentYear) {
                companiesWithInvoices.add(normalizeName(inv.company));
                const canon = getCanonKey(inv.company);
                if (canon) companiesWithInvoices.add(canon);
            }
        });

        const pendingCompanies = companies.filter(comp => {
            const normName = normalizeName(comp.name);
            if (companiesWithInvoices.has(normName)) return false;
            const canon = getCanonKey(comp.name);
            if (canon && companiesWithInvoices.has(canon)) return false;
            return true;
        });

        // --- Lógica 3: Pólizas sin Adjuntos ---
        const missingFiles = policies.filter(p => !p.status === 'Anulada' && !p.fileUrl && !p.fileBase64 && !(p.attachments && p.attachments.length > 0) && !isAutoExpired(p));

        const totalItems = expiring.length + pendingCompanies.length + missingFiles.length;
        if (totalItems === 0) {
            console.log("ℹ️ [Reporte] No hay notificaciones pendientes (0 venciendo, 0 pendientes, 0 sin archivo). No se envía correo.");
            return;
        }

        // --- Generar PDF ---
        const doc = new jsPDF();
        let currentY = 20;

        doc.setFontSize(18);
        doc.text("Reporte de Notificaciones Pendientes", 14, currentY);
        currentY += 10;
        doc.setFontSize(10);
        doc.text(`Generado: ${new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}`, 14, currentY);
        currentY += 15;

        // Vencimientos a 7 días
        if (expiring.length > 0) {
            doc.setFontSize(14);
            doc.text(`Vencimientos (Próximos 7 días) - ${expiring.length}`, 14, currentY);
            currentY += 5;
            autoTable(doc, {
                startY: currentY,
                head: [['Cliente', 'Póliza', 'Compañía', 'Ramo', 'Vencimiento']],
                body: expiring.map(p => [p.clientName || 'S/N', p.policyNumber || 'S/N', p.company || 'S/C', p.riskType || 'Otro', p.endDate]),
                theme: 'grid',
                headStyles: { fillStyle: [79, 70, 229] } // Indigo
            });
            currentY = doc.lastAutoTable.finalY + 15;
        }

        // Compañías Pendientes
        if (pendingCompanies.length > 0) {
            if (currentY + 20 > doc.internal.pageSize.height) {
                doc.addPage();
                currentY = 20;
            }
            doc.setFontSize(14);
            doc.text(`Compañías Pendientes de Facturación - ${pendingCompanies.length}`, 14, currentY);
            currentY += 5;
            autoTable(doc, {
                startY: currentY,
                head: [['Nombre de Compañía', 'CUIT']],
                body: pendingCompanies.map(c => [c.name, c.cuit || '-']),
                theme: 'grid',
                headStyles: { fillStyle: [245, 158, 11] } // Amber
            });
            currentY = doc.lastAutoTable.finalY + 15;
        }

        // Pólizas sin Archivo
        if (missingFiles.length > 0) {
            if (currentY + 20 > doc.internal.pageSize.height) {
                doc.addPage();
                currentY = 20;
            }
            doc.setFontSize(14);
            doc.text(`Pólizas Sin PDF Adjunto - ${missingFiles.length}`, 14, currentY);
            currentY += 5;
            autoTable(doc, {
                startY: currentY,
                head: [['Cliente', 'Póliza', 'Compañía', 'Vigencia']],
                body: missingFiles.map(p => [p.clientName || 'S/N', p.policyNumber || '-', p.company || '-', p.endDate || '-']),
                theme: 'grid',
                headStyles: { fillStyle: [239, 68, 68] } // Red
            });
            currentY = doc.lastAutoTable.finalY + 15;
        }

        const pdfBuffer = Buffer.from(doc.output('arraybuffer'));

        // --- Configurar Transporte de Email ---
        const transporter = nodemailer.createTransport({
            host: "mail.jylbrokers.com.ar",
            port: 465, // Cambiamos de 993 a 465 (más estándar para SMTP SSL)
            secure: true,
            auth: {
                user: "grodas@jylbrokers.com.ar",
                pass: process.env.SMTP_PASS
            },
            tls: {
                rejectUnauthorized: false // Para servidores con certificados auto-firmados o issues de red
            }
        });

        const mailOptions = {
            from: '"Sistema Automático Gustavo Rodas" <grodas@jylbrokers.com.ar>',
            to: "grodas@jylbrokers.com.ar",
            subject: `🚨 Reporte: Notificaciones Pendientes [${totalItems} Items]`,
            text: `Hola Gustavo,\n\nEste es un reporte automático.\n\nResumen:\n- Vencimientos (7 días): ${expiring.length}\n- Empresas pendientes: ${pendingCompanies.length}\n- Pólizas sin PDF: ${missingFiles.length}\n\nSe adjunta el reporte detallado en PDF.\n\nSaludos,\nSistema Automático.`,
            attachments: [
                {
                    filename: `notificaciones_${new Date().toISOString().split('T')[0]}.pdf`,
                    content: pdfBuffer
                }
            ]
        };

        await transporter.sendMail(mailOptions);
        console.log("✅ [Reporte] Email completo enviado con éxito a grodas@jylbrokers.com.ar");
    } catch (error) {
        console.error("❌ [Reporte] Error enviando reporte completo:", error);
    }
}

const isDev = !app.isPackaged;

// --- Configuración del Bridge Interno ---
function startInternalBridge() {
    const bridgeApp = express();
    const port = 3002;

    bridgeApp.use(cors());
    bridgeApp.use(express.json());

    bridgeApp.get('/api/scan-downloads', async (req, res) => {
        console.log("📥 [Bridge Interno] Petición de escaneo recibida...");
        try {
            const downloadsPath = path.join(os.homedir(), 'OneDrive', 'Documents', 'Archivos Descargados');
            if (!fs.existsSync(downloadsPath)) {
                return res.json({ success: true, files: [] });
            }

            const files = fs.readdirSync(downloadsPath);
            const fifteenDaysAgo = new Date();
            fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);

            const targetFiles = files.filter(f => {
                if (!f.toLowerCase().endsWith('.pdf')) return false;
                try {
                    const filePath = path.join(downloadsPath, f);
                    const stats = fs.statSync(filePath);
                    if (stats.mtime < fifteenDaysAgo) return false;

                    // SOLO archivos de comisiones (CUIT exacto)
                    return f.startsWith('23294824979_');
                } catch (e) { return false; }
            }).slice(0, 10);

            const fileData = targetFiles.map(filename => {
                const filePath = path.join(downloadsPath, filename);
                const stats = fs.statSync(filePath);
                const base64 = fs.readFileSync(filePath).toString('base64');
                return {
                    name: filename,
                    size: stats.size,
                    base64: base64,
                    lastModified: stats.mtime
                };
            });

            console.log(`🔎 [Bridge Interno] Escaneo completado: ${targetFiles.length} facturas.`);
            res.json({ success: true, files: fileData });
        } catch (error) {
            console.error("❌ [Bridge Interno] Error:", error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Enviar Notificación (Misma lógica que bridge.mjs)
    bridgeApp.post('/api/send-notification', async (req, res) => {
        console.log("📧 [Bridge Interno] Petición de envío de notificación...");
        try {
            const {
                trackingId = 'TEST-0001',
                company = 'Allianz',
                grossAmount = 100000,
                iibbRate = 0.045,
                month = 'Marzo 2026',
                to = 'grodas@jylbrokers.com.ar'
            } = req.body || {};

            const sentRecords = getSentNotifications();
            if (sentRecords[trackingId]) {
                return res.json({
                    success: false,
                    duplicate: true,
                    message: `⛔ Notificación con ID "${trackingId}" ya enviada previamente.`,
                    sentAt: sentRecords[trackingId].sentAt
                });
            }

            const iibbAmount = grossAmount * iibbRate;
            const netAmount = grossAmount - iibbAmount;

            const subject = `[TEST DE SISTEMA] - Gestión Realizada - ${company} - ${month}`;
            const body = `Hola Gustavo, esta es una prueba de tu nuevo sistema automatizado.\n\n` +
                `Estado: ÉXITO.\n\n` +
                `Compañía: ${company}.\n\n` +
                `Comisión Neta: $${netAmount.toLocaleString('es-AR')}.\n\n` +
                `ID de Seguimiento: ${trackingId}`;

            const transporter = nodemailer.createTransport({
                host: "mail.jylbrokers.com.ar",
                port: 465,
                secure: true,
                auth: { user: "grodas@jylbrokers.com.ar", pass: process.env.SMTP_PASS },
                tls: { rejectUnauthorized: false }
            });

            await transporter.sendMail({
                from: '"Sistema Gustavo Rodas Seguros" <grodas@jylbrokers.com.ar>',
                to: to,
                subject: subject,
                text: body
            });

            markAsSent(trackingId);
            res.json({ success: true, trackingId, details: { company, netAmount } });
        } catch (error) {
            console.error("❌ [Bridge Interno] Error enviando notification:", error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Estado del sistema (Misma lógica que bridge.mjs)
    bridgeApp.get('/api/notification-status', (req, res) => {
        const sent = getSentNotifications();
        res.json({
            success: true,
            totalSent: Object.keys(sent).length,
            records: sent,
            smtpConfigured: !!process.env.SMTP_PASS
        });
    });

    // Manejo de 404 JSON (Para evitar el error "Unexpected token <")
    bridgeApp.use((req, res) => {
        res.status(404).json({ success: false, error: `Ruta no encontrada en Bridge Interno: ${req.url}` });
    });

    // Nuevo: Endpoint para probar el reporte manualmente
    bridgeApp.get('/api/test-report', async (req, res) => {
        console.log("📧 [Bridge] Petición de reporte manual recibida...");
        try {
            await sendExpiringPoliciesReport();
            res.json({ success: true, message: "Reporte enviado (revisá consola para errores de SMTP)" });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Programación Cron: Lunes y Viernes a las 11:59 AM
    // Formato: minuto hora dia-mes mes dia-semana
    cron.schedule('59 11 * * 1,5', () => {
        console.log("⏰ [Cron] Ejecutando reporte programado (Lunes/Viernes 11:59 AM)");
        sendExpiringPoliciesReport();
    }, {
        scheduled: true,
        timezone: "America/Argentina/Buenos_Aires"
    });

    const server = bridgeApp.listen(port, () => {
        console.log(`🚀 Bridge Interno corriendo en http://localhost:${port}`);
    }).on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`⚠️ Puerto ${port} ocupado. El Bridge ya podría estar corriendo externamente.`);
        } else {
            console.error("❌ Error al iniciar Bridge Interno:", err);
        }
    });

    return server;
}

let bridgeServer = null;
// ----------------------------------------

function createWindow() {
    const win = new BrowserWindow({
        width: 1280,
        height: 800,
        backgroundColor: '#020203',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.cjs')
        },
        title: 'Gustavo Rodas Seguros',
        autoHideMenuBar: true
    });

    if (isDev) {
        win.loadURL('http://localhost:5173');
    } else {
        win.loadFile(path.join(__dirname, 'dist', 'index.html'));
    }

    // Permitir abrir DevTools con Ctrl+Shift+I incluso en producción para diagnóstico
    win.webContents.on('before-input-event', (event, input) => {
        if (input.control && input.shift && input.key.toLowerCase() === 'i') {
            win.webContents.openDevTools();
            event.preventDefault();
        }
    });

    // Detectar si la carga falla
    win.webContents.on('did-fail-load', () => {
        if (!isDev) {
            console.error('Fallo al cargar el archivo de producción.');
        } else {
            win.innerHTML = `<div style="background:white; color:black; padding:20px;">
                <h2>Error de Conexión</h2>
                <p>No se pudo conectar con el servidor de desarrollo (Vite).</p>
                <p>Asegúrate de ejecutar <b>npm run dev</b> antes de abrir la app.</p>
            </div>`;
        }
    });
}

app.whenReady().then(() => {
    bridgeServer = startInternalBridge();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (bridgeServer) bridgeServer.close();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
