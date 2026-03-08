import { db } from '../src/firebase/config.js';
import { collection, getDocs } from 'firebase/firestore';

async function advancedAudit() {
    console.log("Analizando duplicados potenciales (Mismo DNI + Mismo Riesgo)...");
    const snapshot = await getDocs(collection(db, 'policies'));
    const groups = {};

    snapshot.forEach(doc => {
        const data = doc.data();
        const dni = data.dni?.toString().trim() || 'SIN_DNI';
        const risk = data.riskType?.toString().trim() || 'SIN_RIESGO';

        const key = `${dni}_${risk}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push({ id: doc.id, ...data });
    });

    const potentialDupes = Object.entries(groups).filter(([key, docs]) => docs.length > 1);

    console.log(`\n--- AUDITORÍA AVANZADA ---`);
    console.log(`Grupos potenciales: ${potentialDupes.length}`);

    potentialDupes.forEach(([key, docs]) => {
        console.log(`\nGrupo ${key}:`);
        docs.forEach(d => {
            console.log(`  - [${d.id}] Póliza: ${d.policyNumber}, Compañía: ${d.company}, Inicio: ${d.startDate}, Vto: ${d.endDate}`);
        });
    });

    process.exit(0);
}

advancedAudit().catch(console.error);
