// scripts/final_migration.mjs
// Mueve facturas de testInvoices a invoices (evitando duplicados) y luego limpia de testInvoices.

const FIREBASE_API_KEY = "AIzaSyBHR2EoNpjGIanQpMxWB7wXW9gAMmNuXvM";
const PROJECT_ID = "finanzastg";

async function runMigration() {
    console.log("🚀 Iniciando MIGRACIÓN DEFINITIVA...");

    try {
        // 1. Obtener facturas de Producción (para evitar duplicados)
        console.log("📥 Consultando producción para verificar duplicados...");
        const prodRes = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/invoices?key=${FIREBASE_API_KEY}&pageSize=4000`);
        const prodData = await prodRes.json();
        const prodDocs = prodData.documents || [];

        const prodSet = new Set(prodDocs.map(d => {
            const f = d.fields;
            const amt = Number(f.amount?.doubleValue || f.amount?.integerValue || 0).toFixed(2);
            const pos = (f.pointOfSale?.stringValue || "").toString().padStart(5, '0');
            const num = (f.number?.stringValue || "").toString().padStart(8, '0');
            const date = (f.date?.stringValue || "").split('T')[0];
            return `${pos}-${num}-${amt}-${date}`;
        }));

        // 2. Obtener facturas de Prueba
        console.log("📥 Consultando historial de pruebas...");
        const testRes = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/testInvoices?key=${FIREBASE_API_KEY}&pageSize=4000`);
        const testData = await testRes.json();
        const testDocs = testData.documents || [];

        if (testDocs.length === 0) {
            console.log("✅ No hay facturas en pruebas para migrar.");
            return;
        }

        console.log(`📦 Encontradas ${testDocs.length} facturas en pruebas.`);

        let moved = 0;
        let skipped = 0;
        let errors = 0;

        for (const docObj of testDocs) {
            const fields = docObj.fields;
            const id = docObj.name.split('/').pop();

            // Datos para el check
            const amt = Number(fields.amount?.doubleValue || fields.amount?.integerValue || 0).toFixed(2);
            const pos = (fields.pointOfSale?.stringValue || "").toString().padStart(5, '0');
            const num = (fields.number?.stringValue || "").toString().padStart(8, '0');
            const date = (fields.date?.stringValue || "").split('T')[0];
            const key = `${pos}-${num}-${amt}-${date}`;

            if (prodSet.has(key)) {
                console.log(`⚠️ Duplicado omitido: ${key} (${id})`);
                skipped++;
            } else {
                // Mover a producción
                console.log(`➡️ Migrando: ${key}...`);
                const uploadUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/invoices?key=${FIREBASE_API_KEY}`;

                // Conservar campos originales pero añadir marca de migración
                const newFields = { ...fields };
                newFields.migrationDate = { stringValue: new Date().toISOString() };
                newFields.timestamp = { timestampValue: new Date().toISOString() };

                const upRes = await fetch(uploadUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fields: newFields })
                });

                if (upRes.ok) {
                    moved++;
                } else {
                    console.error(`❌ Error migrando ${id}:`, await upRes.text());
                    errors++;
                    continue; // No borrar si hubo error
                }
            }

            // Borrar de pruebas
            const deleteUrl = `https://firestore.googleapis.com/v1/${docObj.name}?key=${FIREBASE_API_KEY}`;
            const delRes = await fetch(deleteUrl, { method: 'DELETE' });
            if (!delRes.ok) {
                console.error(`❌ Error borrando de pruebas ${id}`);
            }
        }

        console.log("\n✨ RESULTADO FINAL:");
        console.log(`✅ Migradas con éxito: ${moved}`);
        console.log(`⚠️ Duplicados omitidos: ${skipped}`);
        console.log(`❌ Errores: ${errors}`);
        console.log("🚀 El Historial de Pruebas ha sido limpiado.");

    } catch (e) {
        console.error("💥 Error fatal:", e.message);
    }
}

runMigration();
