import { db } from '../src/firebase/config.js';
import { collection, getDocs } from 'firebase/firestore';

async function auditLES() {
    console.log("Buscando 'LES MESSIANOS' con fechas...");
    const snapshot = await getDocs(collection(db, 'policies'));

    snapshot.forEach(doc => {
        const data = doc.data();
        const name = data.clientName || '';
        if (name.toUpperCase().includes('MESSI')) {
            console.log(`- ID: ${doc.id}`);
            console.log(`  Cliente: ${data.clientName}`);
            console.log(`  DNI: ${data.dni}`);
            console.log(`  Póliza: ${data.policyNumber}`);
            console.log(`  Fechas: [${data.startDate}] -> [${data.endDate}]`);
            console.log(`  Compañía: ${data.company}`);
            console.log(`  Ramo: ${data.riskType}`);
            console.log(`-----------------------------`);
        }
    });

    process.exit(0);
}

auditLES().catch(console.error);
