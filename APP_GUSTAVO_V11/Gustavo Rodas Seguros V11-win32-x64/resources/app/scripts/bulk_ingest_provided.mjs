// scripts/bulk_ingest_provided.mjs
const FIREBASE_API_KEY = "AIzaSyBHR2EoNpjGIanQpMxWB7wXW9gAMmNuXvM";
const PROJECT_ID = "finanzastg";
import fs from 'fs';
import path from 'path';

async function run() {
    console.log("🚀 Iniciando ingesta masiva de datos...");

    // 1. Cargar compañías para mapeo CUIT -> Empresa
    const compUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/companies?key=${FIREBASE_API_KEY}&pageSize=1000`;
    const compRes = await fetch(compUrl);
    const compData = await compRes.json();
    const cuitToName = {};
    (compData.documents || []).forEach(d => {
        const name = d.fields.name.stringValue;
        const cuit = (d.fields.cuit?.stringValue || '').replace(/-/g, '');
        if (cuit) cuitToName[cuit] = name;
    });

    // 2. Cargar facturas para deduplicación
    console.log("📥 Descargando facturas existentes...");
    const invUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/invoices?key=${FIREBASE_API_KEY}&pageSize=10000`;
    const invRes = await fetch(invUrl);
    const invData = await invRes.json();
    const existingKeys = new Set((invData.documents || []).map(d => {
        const f = d.fields;
        const pos = (f.pointOfSale?.stringValue || '').padStart(5, '0');
        const num = (f.number?.stringValue || '').padStart(8, '0');
        const amt = Number(f.amount?.doubleValue || f.amount?.integerValue || 0).toFixed(2);
        const date = (f.date?.stringValue || '').split('T')[0];
        return `${pos}-${num}-${amt}-${date}`;
    }));

    // 3. Procesar archivo
    const dataPath = path.join(process.cwd(), 'scripts', 'provided_data.txt');
    if (!fs.existsSync(dataPath)) return console.error("Falta archivo de datos.");

    const lines = fs.readFileSync(dataPath, 'utf8').split('\n').filter(l => l.trim());
    let added = 0, skipped = 0;

    for (const line of lines) {
        const p = line.split('\t').map(x => x.trim());
        if (p.length < 7) continue;

        const [d, m, y] = p[0].split('/').map(Number);
        const isoDate = `${y}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
        const [posRaw, numRaw] = p[2].split('-');
        const pos = posRaw.padStart(5, '0'), num = numRaw.padStart(8, '0');
        const cuit = p[4].replace(/-/g, '');
        const amount = Number(p[6]);

        const key = `${pos}-${num}-${amount.toFixed(2)}-${isoDate}`;
        if (existingKeys.has(key)) { skipped++; continue; }

        const name = cuitToName[cuit] || `Empresa CUIT ${cuit}`;
        const doc = {
            fields: {
                company: { stringValue: name },
                cuit: { stringValue: cuit },
                date: { stringValue: isoDate },
                amount: { doubleValue: amount },
                pointOfSale: { stringValue: pos },
                number: { stringValue: num },
                type: { stringValue: p[1] },
                status: { stringValue: "CARGADA POR EL USUARIO" },
                timestamp: { timestampValue: new Date().toISOString() }
            }
        };

        const res = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/invoices?key=${FIREBASE_API_KEY}`, {
            method: 'POST',
            body: JSON.stringify(doc)
        });
        if (res.ok) {
            added++;
            existingKeys.add(key);
            console.log(`✅ ${name} - ${isoDate}`);
        }
    }
    console.log(`\nFinalizado: ${added} cargadas, ${skipped} duplicadas.`);
}
run();
