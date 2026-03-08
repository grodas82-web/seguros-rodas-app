import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import os from 'os';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

// El bridge está en /scripts, el .env está en la raíz
dotenv.config({ path: path.join(process.cwd(), '..', '.env') });

const app = express();
const port = 3002;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

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

// === Endpoint: Escanear Descargas ===
app.get('/api/scan-downloads', async (req, res) => {
    try {
        const downloadsPath = path.join(os.homedir(), 'OneDrive', 'Documents', 'Archivos Descargados');
        if (!fs.existsSync(downloadsPath)) return res.json({ success: true, files: [] });

        const files = fs.readdirSync(downloadsPath);
        const fifteenDaysAgo = new Date();
        fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);

        const targetFiles = files.filter(f => {
            if (!(f.startsWith('23294824979_') && f.endsWith('.pdf'))) return false;
            const stats = fs.statSync(path.join(downloadsPath, f));
            return stats.mtime >= fifteenDaysAgo;
        }).slice(0, 5);

        const fileData = targetFiles.map(filename => {
            const filePath = path.join(downloadsPath, filename);
            const stats = fs.statSync(filePath);
            const base64 = fs.readFileSync(filePath).toString('base64');
            return { name: filename, size: stats.size, base64: base64, lastModified: stats.mtime };
        });

        res.json({ success: true, files: fileData });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// === Endpoint: Enviar Notificación (Allianz Test) ===
app.post('/api/send-notification', async (req, res) => {
    console.log("📧 Petición de notificación recibida...");
    try {
        const { trackingId, company, grossAmount, iibbRate, to } = req.body;

        const sentRecords = getSentNotifications();
        if (sentRecords[trackingId]) {
            return res.json({
                success: false,
                duplicate: true,
                message: `⛔ Notificación con ID "${trackingId}" ya fue enviada previamente.`,
                sentAt: sentRecords[trackingId].sentAt
            });
        }

        const iibbAmount = grossAmount * (iibbRate || 0.045);
        const netAmount = grossAmount - iibbAmount;

        const transporter = nodemailer.createTransport({
            host: "mail.jylbrokers.com.ar",
            port: 465,
            secure: true,
            auth: {
                user: "grodas@jylbrokers.com.ar",
                pass: process.env.SMTP_PASS
            },
            tls: { rejectUnauthorized: false }
        });

        await transporter.sendMail({
            from: '"Sistema Gustavo Rodas Seguros" <grodas@jylbrokers.com.ar>',
            to: to || "grodas@jylbrokers.com.ar",
            subject: `[TEST DE SISTEMA] - Gestión Realizada - ${company} - Marzo 2026`,
            text: `Hola Gustavo, esta es una prueba de tu nuevo sistema automatizado.\n\nEstado: ÉXITO.\n\nCompañía: ${company}.\n\nComisión Neta: $${netAmount.toLocaleString('es-AR')}.\n\nID de Seguimiento: ${trackingId}`
        });

        markAsSent(trackingId);
        res.json({ success: true, trackingId, details: { company, netAmount } });
    } catch (error) {
        console.error("❌ Error SMTP:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// === Fallback 404 (Siempre JSON) ===
app.use((req, res) => {
    res.status(404).json({ success: false, error: `Ruta no encontrada: ${req.url}` });
});

app.listen(port, () => {
    console.log(`🚀 Bridge v2 operando en http://localhost:${port}`);
    console.log(`📧 SMTP: ${process.env.SMTP_PASS ? '✅ OK' : '❌ Sin Password en .env'}`);
}).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.log(`⚠️ Puerto ${port} ocupado. Probablemente la App Principal ya lo está usando.`);
    } else {
        console.error("❌ Error:", err.message);
    }
});
