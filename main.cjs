const electronAPI = require('electron');
console.log('--- DEBUG INITIALIZATION ---');
console.log('process.versions.electron:', process.versions ? process.versions.electron : 'undefined');
console.log('typeof electronAPI:', typeof electronAPI);
console.log('electronAPI keys:', Object.keys(electronAPI || {}));
const { app, BrowserWindow, dialog, ipcMain } = electronAPI;
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
const AfipHandler = require('./afipHandler.cjs');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Logs de error - Inicialización diferida
let logPath;
function setupLogging() {
    logPath = path.join(app.getPath('userData'), 'crash.log');
    process.on('uncaughtException', (error) => {
        const msg = `[${new Date().toISOString()}] CRASH: ${error.stack}\n`;
        if (logPath) fs.appendFileSync(logPath, msg);
        console.error(msg);
    });
}

// --- Configuración Firebase (Main Process) ---
const firebaseConfig = {
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.VITE_FIREBASE_APP_ID
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// Log de inicio exitoso del motor
function logStartup() {
    if (!logPath) return;
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] APP_STARTING: Motor iniciado con exito.\n`);
    if (Object.values(firebaseConfig).some(v => !v)) {
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] WARNING: Faltan variables de entorno en Firebase config.\n`);
    }
}

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
            if (u.includes('EXPERTA')) return '__CANON_EXPERTA';
            if (u.includes('GALENO')) return '__CANON_GALENO';
            if (u.includes('OMINT')) return '__CANON_OMINT';
            if (u.includes('BERKLEY')) return '__CANON_BERKLEY';
            if (u.includes('NOBLE')) return '__CANON_NOBLE';
            return null;
        };

        const normalizeName = (name) => {
            if (!name) return '';
            let n = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            return n.toLowerCase()
                .replace(/s\.a\.|sa|compia|compañía|cia\.| \/|seg\.|argentina|nacion|asoc\.|mutual|asociacin|asociacion|riesgos|trabajo|art|seguros|servicios/gi, '')
                .replace(/\s+/g, '')
                .replace(/[^a-z0-9]/g, '')
                .trim();
        };

        // --- Obtener Datos ---
        const [policiesSnap, invoicesSnap, companiesSnap, iibbSnap] = await Promise.all([
            getDocs(query(collection(db, 'policies'))),
            getDocs(query(collection(db, 'invoices'))),
            getDocs(query(collection(db, 'companies'))),
            getDocs(query(collection(db, 'iibb_retenciones')))
        ]);

        const policies  = policiesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const invoices  = invoicesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const companies = companiesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const iibbRets  = iibbSnap.docs.map(d => d.data());

        // --- Lógica IIBB: retenciones pendientes ---
        const iibbTotal = iibbRets.reduce((s, r) => s + (Number(r.monto) || 0), 0);
        const iibbByComp = {};
        iibbRets.forEach(r => {
            const k = r.compania || 'SIN COMPAÑÍA';
            iibbByComp[k] = (iibbByComp[k] || 0) + (Number(r.monto) || 0);
        });
        const iibbRows = Object.entries(iibbByComp)
            .sort((a, b) => b[1] - a[1])
            .map(([comp, monto]) => [comp, `$ ${monto.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`]);

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
        const missingFiles = policies.filter(p => p.status !== 'Anulada' && !p.fileUrl && !p.fileBase64 && !(p.attachments && p.attachments.length > 0) && !isAutoExpired(p));

        const totalItems = expiring.length + pendingCompanies.length + missingFiles.length + iibbRets.length;
        if (totalItems === 0) {
            console.log("ℹ️ [Reporte] No hay notificaciones pendientes. No se envía correo.");
            return;
        }

        // --- Generar PDF Profesional (Sincronizado con Dashboard) ---
        const doc = new jsPDF();
        const pageW = doc.internal.pageSize.width;
        const indigo = [79, 70, 229];
        const amber = [245, 158, 11];
        const roseColor = [244, 63, 94];
        const slate700 = [51, 65, 85];
        const slate400 = [148, 163, 184];
        const dateStr = now.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const timeStr = now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

        // HEADER
        doc.setFillColor(indigo[0], indigo[1], indigo[2]);
        doc.rect(0, 0, pageW, 35, 'F');
        doc.setFontSize(20);
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.text('GESTION DE ALERTAS CRITICAS', 20, 16);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text('Gustavo Rodas Seguros - Reporte Automatico', 20, 24);
        doc.setFontSize(8);
        doc.setTextColor(200, 200, 255);
        doc.text('Generado: ' + dateStr + ' ' + timeStr, 20, 31);

        // KPI Summary bar (4 cards)
        const emerald = [16, 185, 129];
        let currentY = 45;
        const summaryW = (pageW - 55) / 4;
        const drawSummaryCard = (x, label, value, color) => {
            doc.setFillColor(241, 245, 249);
            doc.roundedRect(x, currentY, summaryW, 18, 2, 2, 'F');
            doc.setFillColor(color[0], color[1], color[2]);
            doc.roundedRect(x, currentY, 3, 18, 1, 1, 'F');
            doc.setFontSize(7);
            doc.setTextColor(slate400[0], slate400[1], slate400[2]);
            doc.setFont('helvetica', 'normal');
            doc.text(label.toUpperCase(), x + 8, currentY + 7);
            doc.setFontSize(12);
            doc.setTextColor(slate700[0], slate700[1], slate700[2]);
            doc.setFont('helvetica', 'bold');
            doc.text(value, x + 8, currentY + 15);
        };
        drawSummaryCard(15,                        'Vencimientos',     expiring.length.toString(),        indigo);
        drawSummaryCard(15 + (summaryW + 5),       'Pend. Facturac.',  pendingCompanies.length.toString(), amber);
        drawSummaryCard(15 + (summaryW + 5) * 2,   'Sin PDF',          missingFiles.length.toString(),     roseColor);
        drawSummaryCard(15 + (summaryW + 5) * 3,   'IIBB Pendiente',   iibbRets.length.toString() + ' ret.', emerald);
        currentY += 28;

        // 1. Vencimientos a 7 dias
        if (expiring.length > 0) {
            doc.setFontSize(12);
            doc.setTextColor(indigo[0], indigo[1], indigo[2]);
            doc.setFont('helvetica', 'bold');
            doc.text('Vencimientos (Proximos 7 dias) - ' + expiring.length, 15, currentY);
            autoTable(doc, {
                startY: currentY + 4,
                head: [['Cliente', 'Poliza', 'Compania', 'Ramo', 'Vencimiento']],
                body: expiring.map(p => [p.clientName || 'S/N', p.policyNumber || 'S/N', p.company || 'S/C', p.riskType || 'Otro', p.endDate]),
                theme: 'grid',
                headStyles: { fillColor: indigo, fontSize: 8, fontStyle: 'bold' },
                bodyStyles: { fontSize: 8 },
                margin: { left: 15, right: 15, bottom: 25 }
            });
            currentY = doc.lastAutoTable.finalY + 12;
        }

        // 2. Companias Pendientes de Facturacion
        if (pendingCompanies.length > 0) {
            if (currentY + 40 > 270) { doc.addPage(); currentY = 30; }
            doc.setFontSize(12);
            doc.setTextColor(amber[0], amber[1], amber[2]);
            doc.setFont('helvetica', 'bold');
            doc.text('Companias Pendientes de Facturacion - ' + pendingCompanies.length, 15, currentY);
            autoTable(doc, {
                startY: currentY + 4,
                head: [['Nombre de Compania', 'CUIT']],
                body: pendingCompanies.map(c => [c.name, c.cuit || '-']),
                theme: 'grid',
                headStyles: { fillColor: amber, fontSize: 8, fontStyle: 'bold' },
                bodyStyles: { fontSize: 8 },
                margin: { left: 15, right: 15, bottom: 25 }
            });
            currentY = doc.lastAutoTable.finalY + 12;
        }

        // 3. Polizas sin Archivo PDF
        if (missingFiles.length > 0) {
            if (currentY + 40 > 270) { doc.addPage(); currentY = 30; }
            doc.setFontSize(12);
            doc.setTextColor(roseColor[0], roseColor[1], roseColor[2]);
            doc.setFont('helvetica', 'bold');
            doc.text('Polizas Sin PDF Adjunto - ' + missingFiles.length, 15, currentY);
            autoTable(doc, {
                startY: currentY + 4,
                head: [['Cliente', 'Poliza', 'Compania', 'Vigencia']],
                body: missingFiles.map(p => [p.clientName || 'S/N', p.policyNumber || '-', p.company || '-', p.endDate || '-']),
                theme: 'grid',
                headStyles: { fillColor: roseColor, fontSize: 8, fontStyle: 'bold' },
                bodyStyles: { fontSize: 8 },
                margin: { left: 15, right: 15, bottom: 25 }
            });
        }

        // 4. IIBB Retenciones Pendientes
        if (iibbRows.length > 0) {
            if (currentY + 40 > 270) { doc.addPage(); currentY = 30; }
            doc.setFontSize(12);
            doc.setTextColor(emerald[0], emerald[1], emerald[2]);
            doc.setFont('helvetica', 'bold');
            doc.text(`Retenciones IIBB Pendientes - ${iibbRets.length} cert. / $ ${iibbTotal.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`, 15, currentY);
            autoTable(doc, {
                startY: currentY + 4,
                head: [['Compañía', 'Monto Retenido']],
                body: iibbRows,
                theme: 'grid',
                headStyles: { fillColor: emerald, fontSize: 8, fontStyle: 'bold' },
                bodyStyles: { fontSize: 8 },
                margin: { left: 15, right: 15, bottom: 25 }
            });
            currentY = doc.lastAutoTable.finalY + 12;
        }

        // FOOTER on all pages
        const totalPages = doc.internal.getNumberOfPages();
        for (let pg = 1; pg <= totalPages; pg++) {
            doc.setPage(pg);
            doc.setDrawColor(indigo[0], indigo[1], indigo[2]);
            doc.setLineWidth(0.5);
            doc.line(15, 282, pageW - 15, 282);
            doc.setFontSize(7);
            doc.setTextColor(slate400[0], slate400[1], slate400[2]);
            doc.setFont('helvetica', 'normal');
            doc.text('Pagina ' + pg + ' de ' + totalPages, 15, 288);
            doc.text('Confidencial - Uso interno', pageW / 2, 288, { align: 'center' });
            doc.text('J&L Brokers', pageW - 15, 288, { align: 'right' });
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
            subject: `🚨 Gestión de Alertas Críticas [${totalItems} items] - ${dateStr}`,
            text: `Hola Gustavo,\n\nReporte automático del sistema.\n\nRESUMEN:\n- Vencimientos próximos 7 días: ${expiring.length}\n- Compañías pendientes de facturación: ${pendingCompanies.length}\n- Pólizas sin PDF adjunto: ${missingFiles.length}\n- Retenciones IIBB pendientes: ${iibbRets.length} certificados / $ ${iibbTotal.toLocaleString('es-AR', { minimumFractionDigits: 2 })}\n\nSe adjunta el reporte detallado en PDF.\n\nSaludos,\nSistema Automático Gustavo Rodas Seguros`,
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

function getIsDev() {
    if (app.isPackaged) return false;
    if (process.env.ELECTRON_FORCE_PROD === 'true') return false;
    // Si existe el build de producción, usarlo directamente
    const distIndex = path.join(__dirname, 'dist', 'index.html');
    if (fs.existsSync(distIndex)) return false;
    return true;
}

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

            // Notificación registrada internamente — el reporte completo se envía por cron (lunes/viernes)
            markAsSent(trackingId);
            res.json({ success: true, trackingId, message: 'Registrado. El reporte completo se envía por el cron programado.' });
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

    // Manejo de 404 JSON (Para evitar el error "Unexpected token <")
    bridgeApp.use((req, res) => {
        res.status(404).json({ success: false, error: `Ruta no encontrada en Bridge Interno: ${req.url}` });
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

    if (getIsDev()) {
        win.loadURL('http://localhost:5173');
    } else {
        const indexPath = path.join(__dirname, 'dist', 'index.html');
        if (!fs.existsSync(indexPath)) {
            if (logPath) fs.appendFileSync(logPath, `[${new Date().toISOString()}] ERROR: No se encontro index.html en ${indexPath}\n`);
        }
        win.loadFile(indexPath);
    }

    // win.webContents.openDevTools();

    // Capturar logs de la consola del renderer y guardarlos en crash.log
    win.webContents.on('console-message', (event, level, message, line, sourceId) => {
        const levels = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
        const logMsg = `[${new Date().toISOString()}] [RENDERER ${levels[level] || level}] ${message} (${sourceId}:${line})\n`;
        if (logPath) fs.appendFileSync(logPath, logMsg);
    });

    // Permitir abrir DevTools con Ctrl+Shift+I incluso en producción para diagnóstico
    win.webContents.on('before-input-event', (event, input) => {
        if (input.control && input.shift && input.key.toLowerCase() === 'i') {
            win.webContents.openDevTools();
            event.preventDefault();
        }
    });

    // Detectar si la carga falla
    win.webContents.on('did-fail-load', () => {
        if (!getIsDev()) {
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
    setupLogging();
    logStartup();
    
    // Handler para obtener llaves de forma DINAMICA (v19.1)
    ipcMain.handle('get-env-keys', () => {
        // Obtenemos llaves limpias del .env sin fallbacks a llaves muertas (V19.6)
        return {
            VITE_GEMINI_API_KEY_1: process.env.VITE_GEMINI_API_KEY_1,
            VITE_GEMINI_API_KEY_2: process.env.VITE_GEMINI_API_KEY_2,
            VITE_GEMINI_API_KEY_3: process.env.VITE_GEMINI_API_KEY_3,
            VITE_GEMINI_API_KEY_4: process.env.VITE_GEMINI_API_KEY_4,
            VITE_GEMINI_API_KEY_5: process.env.VITE_GEMINI_API_KEY_5,
            VITE_GEMINI_API_KEY_6: process.env.VITE_GEMINI_API_KEY_6,
            VITE_CLAUDE_API_KEY: process.env.VITE_CLAUDE_API_KEY
        };
    });

    bridgeServer = startInternalBridge();
    createWindow();

    // --- AFIP IPC Handlers (v20.0 con robustez) ---
    try {
        console.log("⚙️ Registrando handlers de AFIP...");
        const afipHandler = new AfipHandler({
            cuit: '23294824979',
            production: true,
            userData: app.getPath('userData')
        });

        ipcMain.handle('afip:get-status', async () => {
            return await afipHandler.getServerStatus();
        });

        ipcMain.handle('afip:get-last-voucher', async (event, { pos, type }) => {
            const typeMap = { 'Factura A': 1, 'Factura B': 6, 'Factura C': 11, 'Nota Crédito A': 3, 'Nota Crédito B': 8, 'Nota Crédito C': 13 };
            const typeId = typeMap[type] || 11;
            return await afipHandler.getLastVoucher(pos, typeId);
        });

        ipcMain.handle('afip:create-invoice', async (event, data) => {
            const typeMap = { 'Factura A': 1, 'Factura B': 6, 'Factura C': 11, 'Nota Crédito A': 3, 'Nota Crédito B': 8, 'Nota Crédito C': 13 };
            data.typeId = typeMap[data.type] || 11;
            return await afipHandler.createInvoice(data);
        });
        console.log("✅ Handlers de AFIP registrados satisfactoriamente.");
    } catch (error) {
        console.error("❌ Error critical inicializando handlers AFIP:", error);
        // Registramos handlers vacíos que retornan el error para evitar el mensaje de "No handler registered"
        const failResponse = { success: false, error: "Error de inicialización de AFIP: " + error.message };
        ipcMain.handle('afip:get-status', async () => failResponse);
        ipcMain.handle('afip:get-last-voucher', async () => failResponse);
        ipcMain.handle('afip:create-invoice', async () => failResponse);
    }

    ipcMain.handle('afip:generate-pdf', async (event, inv) => {
        console.log("📄 [Main] Generando PDF para factura:", inv.number);
        try {
            // ── Datos del emisor (fijos) ──────────────────────────────────────
            const EMISOR = {
                actividad:   'PRODUCTOR ASESOR DE SEGUROS',
                razonSocial: 'RODAS GUSTAVO RAUL',
                domicilio:   'Tinogasta 3227 Piso:1 Dpto:d - Ciudad de Buenos Aires',
                condIVA:     'Responsable Monotributo',
                cuit:        '23294824979',
                iibb:        '1270652-3',
                inicioAct:   '01/11/2013'
            };

            // ── Helpers de formato ────────────────────────────────────────────
            const fmtDate = (d) => {
                if (!d) return '';
                if (d.includes('-')) {
                    const [y, m, dd] = d.split('-');
                    return `${dd}/${m}/${y}`;
                }
                return d;
            };
            const fmtMoney = (v) => Number(v || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const pad = (v, n) => String(v || '0').padStart(n, '0');

            // ── Datos de la factura ───────────────────────────────────────────
            const tipoLetra  = (inv.type || 'Factura C').split(' ').pop();   // "C"
            const tipoCod    = tipoLetra === 'A' ? '001' : tipoLetra === 'B' ? '006' : '011';
            const tipoNombre = 'FACTURA';
            const pvStr      = pad(inv.pointOfSale || '4', 5);
            const nroStr     = pad(inv.number || '0', 8);
            const fechaEmis  = fmtDate(inv.date);
            const monto      = Number(inv.amount || 0);
            const montoStr   = fmtMoney(monto);
            const concepto   = inv.description || inv.concept || 'Servicios de intermediación de seguros';
            const receptor   = (inv.company || '').toUpperCase();
            const receptorCuit = inv.cuit || '';
            const receptorAddr = inv.address || '';
            const condVenta  = inv.condicionVenta || 'Cuenta Corriente';
            const condIVARec = inv.condIVA || inv.fiscalCondition || 'IVA Sujeto Exento';
            const servDesde  = fmtDate(inv.serviceFrom || inv.date);
            const servHasta  = fmtDate(inv.serviceTo   || inv.date);
            const vtoPago    = fmtDate(inv.paymentDue  || inv.date);
            const caeNum     = inv.cae || '';
            const caeVto     = fmtDate(inv.caeExpiration);

            // ── Función que dibuja UNA página ────────────────────────────────
            const drawPage = (doc, copyLabel) => {
                const pageW = doc.internal.pageSize.width;   // 210 mm (A4)
                const pageH = doc.internal.pageSize.height;  // 297 mm
                const m = 10;   // margen
                const mid = pageW / 2;

                // ── Título ORIGINAL / DUPLICADO / TRIPLICADO ─────────────────
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(14);
                doc.setTextColor(0);
                doc.text(copyLabel, pageW / 2, m + 6, { align: 'center' });

                // ── Caja principal del encabezado ────────────────────────────
                const hTop = m + 9;
                const hH   = 42;
                doc.setDrawColor(0);
                doc.setLineWidth(0.4);
                doc.rect(m, hTop, pageW - m * 2, hH);
                // divisor vertical central
                doc.line(mid, hTop, mid, hTop + hH);

                // -- Letra + código (caja cuadrada central) -------------------
                const boxSize = 14;
                const boxX = mid - boxSize / 2;
                const boxY = hTop - 1;
                doc.setFillColor(255, 255, 255);
                doc.rect(boxX, boxY, boxSize, boxSize, 'FD');
                doc.setFontSize(22);
                doc.setFont('helvetica', 'bold');
                doc.text(tipoLetra, mid, boxY + 10, { align: 'center' });
                doc.setFontSize(6);
                doc.setFont('helvetica', 'normal');
                doc.text(`COD. ${tipoCod}`, mid, boxY + 14, { align: 'center' });

                // -- Lado izquierdo: emisor -----------------------------------
                let lx = m + 3;
                doc.setFontSize(10);
                doc.setFont('helvetica', 'bold');
                doc.text(EMISOR.actividad, lx, hTop + 8);

                doc.setFontSize(8);
                doc.setFont('helvetica', 'bold');
                doc.text('Razón Social: ', lx, hTop + 16);
                doc.setFont('helvetica', 'normal');
                doc.text(EMISOR.razonSocial, lx + 22, hTop + 16);

                doc.setFont('helvetica', 'bold');
                doc.text('Domicilio Comercial: ', lx, hTop + 22);
                doc.setFont('helvetica', 'normal');
                const domLines = doc.splitTextToSize(EMISOR.domicilio, mid - m - 5);
                doc.text(domLines, lx + 30, hTop + 22);

                doc.setFont('helvetica', 'bold');
                doc.text('Condición frente al IVA: ', lx, hTop + 34);
                doc.setFont('helvetica', 'normal');
                doc.text(EMISOR.condIVA, lx + 36, hTop + 34);

                // -- Lado derecho: datos factura ------------------------------
                let rx = mid + 3;
                doc.setFontSize(18);
                doc.setFont('helvetica', 'bold');
                doc.text(tipoNombre, rx + 30, hTop + 12);

                doc.setFontSize(8);
                doc.setFont('helvetica', 'normal');
                doc.text(`Punto de Venta: ${pvStr}`, rx, hTop + 20);
                doc.text(`Comp. Nro: ${nroStr}`, rx + 45, hTop + 20);
                doc.setFont('helvetica', 'bold');
                doc.text('Fecha de Emisión: ', rx, hTop + 27);
                doc.setFont('helvetica', 'normal');
                doc.text(fechaEmis, rx + 27, hTop + 27);

                doc.text(`CUIT: ${EMISOR.cuit}`, rx, hTop + 34);
                doc.setFont('helvetica', 'bold');
                doc.text('Ingresos Brutos: ', rx, hTop + 38 );
                doc.setFont('helvetica', 'normal');
                doc.text(EMISOR.iibb, rx + 25, hTop + 38);
                doc.setFont('helvetica', 'bold');
                doc.text('Fecha de Inicio de Actividades: ', rx, hTop + 42);
                doc.setFont('helvetica', 'normal');
                doc.text(EMISOR.inicioAct, rx + 46, hTop + 42);

                // ── Fila: Período facturado ───────────────────────────────────
                const pY = hTop + hH;
                const pH = 10;
                doc.setDrawColor(0);
                doc.rect(m, pY, pageW - m * 2, pH);
                doc.setFontSize(8);
                doc.setFont('helvetica', 'bold');
                doc.text('Período Facturado Desde:', m + 3, pY + 6);
                doc.setFont('helvetica', 'normal');
                doc.text(servDesde, m + 42, pY + 6);
                doc.setFont('helvetica', 'bold');
                doc.text('Hasta:', m + 62, pY + 6);
                doc.setFont('helvetica', 'normal');
                doc.text(servHasta, m + 74, pY + 6);
                doc.setFont('helvetica', 'bold');
                doc.text('Fecha de Vto. para el pago:', m + 110, pY + 6);
                doc.setFont('helvetica', 'normal');
                doc.text(vtoPago, m + 152, pY + 6);

                // ── Caja: Receptor ────────────────────────────────────────────
                const rY = pY + pH;
                const rH = 22;
                doc.setDrawColor(0);
                doc.rect(m, rY, pageW - m * 2, rH);
                doc.line(mid, rY, mid, rY + rH);

                doc.setFontSize(8);
                doc.setFont('helvetica', 'bold');
                doc.text('CUIT: ', m + 3, rY + 6);
                doc.setFont('helvetica', 'normal');
                doc.text(receptorCuit, m + 10, rY + 6);

                doc.setFont('helvetica', 'bold');
                doc.text('Condición frente al IVA:', m + 3, rY + 12);
                doc.setFont('helvetica', 'normal');
                doc.text(condIVARec, m + 35, rY + 12);

                doc.setFont('helvetica', 'bold');
                doc.text('Condición de venta:', m + 3, rY + 18);
                doc.setFont('helvetica', 'normal');
                doc.text(condVenta, m + 31, rY + 18);

                // Lado derecho receptor
                doc.setFont('helvetica', 'bold');
                doc.text('Apellido y Nombre / Razón Social: ', mid + 3, rY + 6);
                doc.setFont('helvetica', 'normal');
                const recLines = doc.splitTextToSize(receptor, mid - m - 5);
                doc.text(recLines, mid + 3, rY + 10);

                doc.setFont('helvetica', 'bold');
                doc.text('Domicilio: ', mid + 3, rY + 18);
                doc.setFont('helvetica', 'normal');
                const addrLines = doc.splitTextToSize(receptorAddr, mid - m - 18);
                doc.text(addrLines, mid + 17, rY + 18);

                // ── Tabla de ítems ────────────────────────────────────────────
                const tableY = rY + rH;
                autoTable(doc, {
                    startY: tableY,
                    head: [['Código', 'Producto / Servicio', 'Cantidad', 'U. Medida', 'Precio Unit.', '% Bonif', 'Imp. Bonif.', 'Subtotal']],
                    body: [[
                        '',
                        concepto,
                        '1,00',
                        'otras unidades',
                        montoStr,
                        '0,00',
                        '0,00',
                        montoStr
                    ]],
                    theme: 'grid',
                    headStyles: { fillColor: [220, 220, 220], textColor: 0, fontStyle: 'bold', fontSize: 7 },
                    styles: { fontSize: 7, cellPadding: 1.5 },
                    columnStyles: {
                        0: { cellWidth: 12 },
                        1: { cellWidth: 65 },
                        2: { cellWidth: 16, halign: 'right' },
                        3: { cellWidth: 22 },
                        4: { cellWidth: 22, halign: 'right' },
                        5: { cellWidth: 14, halign: 'right' },
                        6: { cellWidth: 18, halign: 'right' },
                        7: { cellWidth: 18, halign: 'right' }
                    },
                    margin: { left: m, right: m }
                });

                // ── Totales ───────────────────────────────────────────────────
                const totY = doc.lastAutoTable.finalY + 2;
                const totH = 24;
                doc.setDrawColor(0);
                doc.rect(m, totY, pageW - m * 2, totH);
                const totX = pageW - m - 3;
                doc.setFontSize(8.5);
                doc.setFont('helvetica', 'normal');
                doc.text('Subtotal: $', totX - 20, totY + 8, { align: 'right' });
                doc.setFont('helvetica', 'bold');
                doc.text(montoStr, totX, totY + 8, { align: 'right' });

                doc.setFont('helvetica', 'normal');
                doc.text('Importe Otros Tributos: $', totX - 20, totY + 15, { align: 'right' });
                doc.setFont('helvetica', 'bold');
                doc.text('0,00', totX, totY + 15, { align: 'right' });

                doc.setFont('helvetica', 'bold');
                doc.setFontSize(9);
                doc.text('Importe Total: $', totX - 20, totY + 22, { align: 'right' });
                doc.text(montoStr, totX, totY + 22, { align: 'right' });

                // ── Leyenda actividad ─────────────────────────────────────────
                const legY = totY + totH + 6;
                doc.setDrawColor(180);
                doc.rect(m, legY, pageW - m * 2, 10);
                doc.setFontSize(8);
                doc.setFont('helvetica', 'italic');
                doc.text('"Productor Asesor de Seguros"', pageW / 2, legY + 6.5, { align: 'center' });

                // ── Pie: CAE ──────────────────────────────────────────────────
                const footY = pageH - 28;
                doc.setDrawColor(180);
                doc.line(m, footY, pageW - m, footY);

                // Pág. X/1
                doc.setFontSize(7.5);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(0);
                doc.text('Pág. 1/1', pageW / 2, footY + 5, { align: 'center' });

                // CAE info (derecha)
                doc.setFont('helvetica', 'bold');
                doc.text(`CAE N°: ${caeNum}`, pageW - m, footY + 5, { align: 'right' });
                doc.text(`Fecha de Vto. de CAE: ${caeVto}`, pageW - m, footY + 10, { align: 'right' });

                // Comprobante Autorizado
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(8);
                doc.text('Comprobante Autorizado', m + 18, footY + 10);
                doc.setFont('helvetica', 'italic');
                doc.setFontSize(6.5);
                doc.text('Esta Agencia no se responsabiliza por los datos ingresados en el detalle de la operación', m + 18, footY + 15);
            };

            // ── Generar las 3 copias ──────────────────────────────────────────
            const doc = new jsPDF({ format: 'a4', unit: 'mm' });
            const copies = ['ORIGINAL', 'DUPLICADO', 'TRIPLICADO'];
            copies.forEach((label, i) => {
                if (i > 0) doc.addPage();
                drawPage(doc, label);
            });

            const pdfBuffer = Buffer.from(doc.output('arraybuffer'));

            const { filePath } = await dialog.showSaveDialog({
                title: 'Guardar Factura PDF',
                defaultPath: `${EMISOR.cuit}_${tipoCod}_${pvStr}_${nroStr}.pdf`,
                filters: [{ name: 'Documentos PDF', extensions: ['pdf'] }]
            });

            if (filePath) {
                fs.writeFileSync(filePath, pdfBuffer);
                console.log(`✅ PDF guardado: ${filePath}`);
                return { success: true, filePath };
            }
            return { success: false, cancelled: true };
        } catch (error) {
            console.error("❌ Error generando PDF:", error);
            return { success: false, error: error.message };
        }
    });

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
