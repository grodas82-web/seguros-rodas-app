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
    console.log("📅 [Reporte] Iniciando generación de reporte de vencimientos...");
    try {
        const today = new Date();
        const next7Days = new Date();
        next7Days.setDate(today.getDate() + 7);

        const policiesRef = collection(db, 'policies');
        const q = query(policiesRef); // Traemos todas para filtrar por fecha localmente o por rango si el formato es compatible
        const snapshot = await getDocs(q);

        const expiring = [];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (!data.endDate) return;

            const endDate = new Date(data.endDate);
            if (endDate >= today && endDate <= next7Days && (!data.status || data.status !== 'Anulada')) {
                expiring.push({
                    client: data.clientName || 'Sin Nombre',
                    policy: data.policyNumber || 'S/N',
                    company: data.company || 'S/C',
                    endDate: data.endDate,
                    risk: data.riskType || 'Otro'
                });
            }
        });

        if (expiring.length === 0) {
            console.log("ℹ️ [Reporte] No hay pólizas venciendo en los próximos 7 días.");
            return;
        }

        // Generar PDF
        const doc = new jsPDF();
        doc.setFontSize(18);
        doc.text("Reporte de Vencimientos Próximos (7 días)", 14, 20);
        doc.setFontSize(10);
        doc.text(`Generado: ${new Date().toLocaleString()}`, 14, 30);

        const tableData = expiring.map(p => [p.client, p.policy, p.company, p.risk, p.endDate]);
        autoTable(doc, {
            startY: 40,
            head: [['Cliente', 'Póliza', 'Compañía', 'Ramo', 'Vencimiento']],
            body: tableData,
            theme: 'grid',
            headStyles: { fillStyle: [79, 70, 229] } // Color Indigo similar a la app
        });

        const pdfBuffer = Buffer.from(doc.output('arraybuffer'));

        // Configurar Transporte de Email
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
            from: '"Sistema Gustavo Rodas Seguros" <grodas@jylbrokers.com.ar>',
            to: "grodas@jylbrokers.com.ar",
            subject: `🚨 Reporte: Pólizas venciendo en 7 días (${new Date().toLocaleDateString()})`,
            text: `Hola Gustavo,\n\nSe adjunta el reporte de las ${expiring.length} pólizas que vencen en los próximos 7 días.\n\nSaludos,\nSistema Automático.`,
            attachments: [
                {
                    filename: `vencimientos_${new Date().toISOString().split('T')[0]}.pdf`,
                    content: pdfBuffer
                }
            ]
        };

        await transporter.sendMail(mailOptions);
        console.log("✅ [Reporte] Email enviado con éxito a grodas@jylbrokers.com.ar");
    } catch (error) {
        console.error("❌ [Reporte] Error enviando reporte:", error);
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
