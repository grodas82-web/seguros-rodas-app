const { jsPDF } = require('jspdf');
const autoTable = require('jspdf-autotable').default || require('jspdf-autotable');
const nodemailer = require('nodemailer');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query } = require('firebase/firestore');
require('dotenv').config();

// --- Configuración Firebase ---
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

async function sendExpiringPoliciesReport() {
    console.log("📅 [Robot] Iniciando generación de reporte de vencimientos...");
    try {
        const today = new Date();
        const next7Days = new Date();
        next7Days.setDate(today.getDate() + 7);

        const policiesRef = collection(db, 'policies');
        const q = query(policiesRef);
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
            console.log("ℹ️ [Robot] No hay pólizas venciendo en los próximos 7 días.");
            return;
        }

        // Generar PDF
        const doc = new jsPDF();
        doc.setFontSize(18);
        doc.text("Reporte de Vencimientos Próximos (7 días)", 14, 20);
        doc.setFontSize(10);
        doc.text(`Generado: ${new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}`, 14, 30);

        const tableData = expiring.map(p => [p.client, p.policy, p.company, p.risk, p.endDate]);
        autoTable(doc, {
            startY: 40,
            head: [['Cliente', 'Póliza', 'Compañía', 'Ramo', 'Vencimiento']],
            body: tableData,
            theme: 'grid',
            headStyles: { fillStyle: [79, 70, 229] }
        });

        const pdfBuffer = Buffer.from(doc.output('arraybuffer'));

        // Enviar Email
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
            from: '"Robot Gustavo Rodas Seguros" <grodas@jylbrokers.com.ar>',
            to: "grodas@jylbrokers.com.ar",
            subject: `🚨 Reporte Automático: Pólizas venciendo en 7 días`,
            text: `Hola Gustavo,\n\nEste es un reporte automático enviado por el Robot en la nube.\nSe adjunta el listado de las ${expiring.length} pólizas que vencen en los próximos 7 días.\n\nSaludos,\nRobot de Seguros.`,
            attachments: [{
                filename: `vencimientos_${new Date().toISOString().split('T')[0]}.pdf`,
                content: pdfBuffer
            }]
        });

        console.log("✅ [Robot] Reporte enviado con éxito.");
        process.exit(0);
    } catch (error) {
        console.error("❌ [Robot] Error:", error);
        process.exit(1);
    }
}

sendExpiringPoliciesReport();
