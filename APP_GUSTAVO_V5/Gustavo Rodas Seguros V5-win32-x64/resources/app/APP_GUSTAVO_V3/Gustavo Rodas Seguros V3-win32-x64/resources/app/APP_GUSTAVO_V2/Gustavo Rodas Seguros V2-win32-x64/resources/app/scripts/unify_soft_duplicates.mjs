import { db } from '../src/firebase/config.js';
import { collection, getDocs, writeBatch, doc } from 'firebase/firestore';

async function unifySoft() {
    console.log("🚀 Iniciando Unificación Soft...");
    const snapshot = await getDocs(collection(db, 'policies'));
    const groups = {};

    snapshot.forEach(docSnap => {
        const data = docSnap.data();
        const dni = data.dni?.toString().trim();
        const risk = data.riskType?.toString().trim();
        const start = data.startDate || '';
        const end = data.endDate || '';

        if (dni && risk && start && end) {
            const key = `${dni}_${risk}_${start}_${end}`.toLowerCase();
            if (!groups[key]) groups[key] = [];
            groups[key].push({ id: docSnap.id, ref: docSnap.ref, data });
        }
    });

    let batch = writeBatch(db);
    let opCount = 0;
    let unifiedCount = 0;
    let deletedCount = 0;

    for (const [key, docs] of Object.entries(groups)) {
        if (docs.length > 1) {
            console.log(`\nUnificando grupo: ${key}`);

            // Prioridad: 1. Tiene Archivo, 2. Tiene Premio, 3. Más nuevo
            const master = docs.sort((a, b) => {
                if (a.data.fileUrl && !b.data.fileUrl) return -1;
                if (!a.data.fileUrl && b.data.fileUrl) return 1;
                if (a.data.premio && !b.data.premio) return -1;
                if (!a.data.premio && b.data.premio) return 1;
                return (b.data.createdAt?.toMillis() || 0) - (a.data.createdAt?.toMillis() || 0);
            })[0];

            console.log(`  MANTENER: ${master.id} (Póliza: ${master.data.policyNumber})`);
            const consolidatedData = { ...master.data };

            for (const d of docs) {
                if (d.id === master.id) continue;
                console.log(`  ELIMINAR: ${d.id} (Póliza: ${d.data.policyNumber})`);

                // Rescatar datos
                if (!consolidatedData.fileUrl && d.data.fileUrl) consolidatedData.fileUrl = d.data.fileUrl;
                if (!consolidatedData.fileBase64 && d.data.fileBase64) consolidatedData.fileBase64 = d.data.fileBase64;
                if (!consolidatedData.insuredSum && d.data.insuredSum) consolidatedData.insuredSum = d.data.insuredSum;
                if (!consolidatedData.address && d.data.address) consolidatedData.address = d.data.address;

                batch.delete(d.ref);
                opCount++;
                deletedCount++;
            }

            batch.update(master.ref, consolidatedData);
            opCount++;
            unifiedCount++;

            if (opCount >= 400) {
                await batch.commit();
                batch = writeBatch(db);
                opCount = 0;
            }
        }
    }

    if (opCount > 0) await batch.commit();

    console.log(`\n✅ Proceso completado:`);
    console.log(`- Grupos unificados: ${unifiedCount}`);
    console.log(`- Documentos eliminados: ${deletedCount}`);
    process.exit(0);
}

unifySoft().catch(err => {
    console.error("❌ Error:", err);
    process.exit(1);
});
