import { db } from '../src/firebase/config.js';
import { collection, getDocs } from 'firebase/firestore';

const normalizeRisk = (risk) => {
    if (!risk) return 'Otro';
    const r = risk.toLowerCase().trim();
    
    if (r.includes('art')) return 'ART';
    if (r.includes('vida')) return 'Vida';
    if (r.includes('caucion') || r.includes('caución')) return 'Caución';
    if (r.includes('accidente')) return 'Accidentes Personales';
    if (r.includes('consorcio')) return 'Integral de Consorcio';
    if (r.includes('comercio')) return 'Integral de Comercio';
    if (r.includes('hogar') || r.includes('combinado familiar')) return 'Combinado Familiar';
    
    if (r.includes('auto') || r.includes('motos')) {
        if (r.includes('motos')) return 'Motos';
        return 'Autos';
    }
    
    if (r === 'rc' || r.includes('responsabilidad civil') || r.includes('r.c.') || r.startsWith('rc ') || r.endsWith(' rc') || r.includes(' rc ')) {
        return 'RC';
    }
    
    return 'Otro';
};

async function debugRisks() {
    const snapshot = await getDocs(collection(db, 'policies'));
    console.log("Total policies:", snapshot.size);
    
    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.isCancelled) return;
        const norm = normalizeRisk(data.riskType);
        if (norm === 'RC' || norm === 'Otro') {
            console.log(`ID: ${doc.id} | Raw: "${data.riskType}" | Normalized: "${norm}" | Client: ${data.clientName}`);
        }
    });
    process.exit(0);
}

debugRisks();
