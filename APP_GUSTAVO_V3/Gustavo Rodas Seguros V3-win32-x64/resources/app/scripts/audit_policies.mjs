import { db } from '../src/firebase/config.js';
import { collection, getDocs } from 'firebase/firestore';

async function auditPolicies() {
    console.log("Analizando Duplicados en Pólizas...");
    const snapshot = await getDocs(collection(db, 'policies'));
    const stats = {
        total: 0,
        byNumber: {}
    };

    snapshot.forEach(doc => {
        const data = doc.data();
        const num = data.policyNumber?.toString().trim() || 'SIN_NUMERO';
        stats.total++;
        if (!stats.byNumber[num]) stats.byNumber[num] = [];
        stats.byNumber[num].push({ id: doc.id, ...data });
    });

    const duplicates = Object.entries(stats.byNumber).filter(([num, docs]) => docs.length > 1);

    console.log(`\n--- AUDITORÍA DE PÓLIZAS ---`);
    console.log(`Total Pólizas: ${stats.total}`);
    console.log(`Números Únicos: ${Object.keys(stats.byNumber).length}`);
    console.log(`Grupos Duplicados: ${duplicates.length}`);

    if (duplicates.length > 0) {
        console.log("\nEjemplos de Duplicados:");
        duplicates.slice(0, 5).forEach(([num, docs]) => {
            console.log(`Póliza ${num}: ${docs.length} ocurrencias`);
            docs.forEach(d => console.log(`  - ID: ${d.id}, Cliente: ${d.clientName}`));
        });
    }

    process.exit(0);
}

auditPolicies().catch(console.error);
