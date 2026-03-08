import { db } from '../src/firebase/config.js';
import { collection, getDocs } from 'firebase/firestore';

const normalizeRisk = (risk) => {
    if (!risk) return 'Otro';
    const r = risk.toLowerCase().trim();
    if (r.includes('auto') || r.includes('motos')) {
        if (r.includes('motos')) return 'Motos';
        return 'Autos';
    }
    if (r.includes('hogar') || r.includes('combinado familiar')) return 'Combinado Familiar';
    if (r.includes('vida')) return 'Vida';
    if (r.includes('caucion') || r.includes('caución')) return 'Caución';
    if (r.includes('comercio')) return 'Integral de Comercio';
    if (r.includes('consorcio')) return 'Integral de Consorcio';
    if (r.includes('art')) return 'ART';
    if (r.includes('accidente')) return 'Accidentes Personales';
    if (r === 'rc' || r.startsWith('rc ') || r.includes('responsabilidad civil')) return 'RC';
    return 'Otro';
};

async function verifyNormalization() {
    console.log("Verificando Normalización de Ramos...");
    const snapshot = await getDocs(collection(db, 'policies'));
    const counts = {};

    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.isCancelled) return;
        const normalized = normalizeRisk(data.riskType);
        counts[normalized] = (counts[normalized] || 0) + 1;
    });

    console.log("\n--- CONTEO NORMALIZADO ---");
    Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([ramo, count]) => {
        console.log(`${ramo}: ${count} pólizas`);
    });

    const others = [];
    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.isCancelled) return;
        if (normalizeRisk(data.riskType) === 'Otro') {
            others.push({ id: doc.id, risk: data.riskType, client: data.clientName });
        }
    });

    if (others.length > 0) {
        console.log("\n--- DETALLE DE 'OTRO' ---");
        others.forEach(o => console.log(`Raw: "${o.risk}" | Client: ${o.client}`));
    }

    process.exit(0);
}

verifyNormalization().catch(console.error);
