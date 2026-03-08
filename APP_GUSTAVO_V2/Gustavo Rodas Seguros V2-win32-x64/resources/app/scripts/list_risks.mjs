import { db } from '../src/firebase/config.js';
import { collection, getDocs } from 'firebase/firestore';

async function listRiskTypes() {
    console.log("Listando Ramos Únicos en Pólizas...");
    const snapshot = await getDocs(collection(db, 'policies'));
    const risks = new Set();
    const examples = {};

    snapshot.forEach(doc => {
        const data = doc.data();
        const risk = data.riskType;
        risks.add(risk);
        if (!examples[risk]) examples[risk] = data.clientName;
    });

    console.log("\n--- RAMOS ENCONTRADOS ---");
    risks.forEach(r => {
        console.log(`- "${r}" (Ejemplo: ${examples[r]})`);
    });

    process.exit(0);
}

listRiskTypes().catch(console.error);
