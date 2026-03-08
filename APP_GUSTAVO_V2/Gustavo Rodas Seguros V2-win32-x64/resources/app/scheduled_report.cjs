const { jsPDF } = require('jspdf');
const autoTable = require('jspdf-autotable').default || require('jspdf-autotable');
const nodemailer = require('nodemailer');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query } = require('firebase/firestore');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

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
    console.log("📅 [Robot] Iniciando generación de reporte completo (Vencimientos + Pendientes + Sin Archivo)...");
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
            console.log("ℹ️ [Robot] No hay notificaciones pendientes (0 venciendo, 0 pendientes, 0 sin archivo). No se envía correo.");
            process.exit(0);
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
            // Check page break
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

        // --- Enviar Email ---
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
            subject: `🚨 Reporte Automático: Notificaciones Pendientes [${totalItems} Items]`,
            text: `Hola Gustavo,\n\nEste es un reporte automático enviado por el Robot en la nube.\n\nResumen:\n- Vencimientos (7 días): ${expiring.length}\n- Empresas pendientes de facturación: ${pendingCompanies.length}\n- Pólizas sin PDF adjunto: ${missingFiles.length}\n\nSe adjunta el reporte detallado en PDF.\n\nSaludos,\nRobot de Seguros.`,
            attachments: [{
                filename: `notificaciones_${new Date().toISOString().split('T')[0]}.pdf`,
                content: pdfBuffer
            }]
        });

        console.log("✅ [Robot] Reporte completo enviado con éxito.");
        process.exit(0);
    } catch (error) {
        console.error("❌ [Robot] Error en reporte completo:", error);
        process.exit(1);
    }
}

sendExpiringPoliciesReport();
