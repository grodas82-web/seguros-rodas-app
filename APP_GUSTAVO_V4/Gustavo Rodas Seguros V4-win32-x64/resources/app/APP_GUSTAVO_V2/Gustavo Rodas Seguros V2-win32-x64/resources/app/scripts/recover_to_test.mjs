import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

// Configuración
const GEMINI_API_KEY = process.env.VITE_GEMINI_API_KEY || "";
const FIREBASE_API_KEY = ""; // Use env
const PROJECT_ID = "finanzastg";
const COLLECTION = "testInvoices"; // REDIRIGIDO A PRUEBAS

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

async function getFirestoreDocuments() {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${COLLECTION}?key=${FIREBASE_API_KEY}&pageSize=5000`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.error) {
        console.error("Firestore Error:", data.error.message);
        return [];
    }
    return data.documents || [];
}

async function analyzePDF(filePath) {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
    const data = fs.readFileSync(filePath);
    const base64Data = data.toString('base64');

    const prompt = `
    Analiza esta factura PDF y extrae los siguientes datos en formato JSON puro:
    {
      "company": "Nombre de la empresa RECEPTORA de la factura (la compañía de seguros). Ignora el nombre del emisor.",
      "cuit": "CUIT de la empresa RECEPTORA (sin guiones)",
      "type": "Factura C" o "Nota de Crédito C",
      "pointOfSale": "Número de punto de venta (pad con ceros hasta 5 dígitos)",
      "number": "Número de comprobante (pad con ceros hasta 8 dígitos)",
      "amount": número decimal del total de la factura,
      "date": "YYYY-MM-DD",
      "period": "Descripción del periodo o concepto",
      "currency": "ARS"
    }
    IMPORTANTE: El usuario es el EMISOR (CUIT 23294824979). Necesitamos los datos del RECEPTOR.
    No incluyas markdown, solo el JSON.
    `;

    const result = await model.generateContent([
        {
            inlineData: {
                data: base64Data,
                mimeType: "application/pdf",
            },
        },
        prompt,
    ]);

    const text = result.response.text();
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    return {
        ...parsed,
        pointOfSale: parsed.pointOfSale?.toString().padStart(5, '0'),
        number: parsed.number?.toString().padStart(8, '0')
    };
}

async function uploadToFirestore(data, filePath) {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${COLLECTION}?key=${FIREBASE_API_KEY}`;
    const body = {
        fields: {
            company: { stringValue: data.company || "" },
            cuit: { stringValue: data.cuit || "" },
            type: { stringValue: data.type || "Factura C" },
            pointOfSale: { stringValue: data.pointOfSale || "" },
            number: { stringValue: data.number || "" },
            amount: { doubleValue: Number(data.amount) || 0 },
            date: { stringValue: data.date || "" },
            period: { stringValue: data.period || "" },
            batchSource: { stringValue: "Mass Test Recovery Automation" },
            originalPath: { stringValue: filePath },
            timestamp: { timestampValue: new Date().toISOString() }
        }
    };
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    return response.ok;
}

async function main() {
    console.log(`--- INICIO DE INGESTA MASIVA A ${COLLECTION} ---`);

    // 1. Cargar CSV
    const csvPath = path.join(process.cwd(), 'scripts', 'all_found_invoices.csv');
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const records = parse(csvContent, { columns: true, skip_empty_lines: true });

    const uniqueFiles = new Map();
    records.forEach(r => {
        if (!uniqueFiles.has(r.Name)) uniqueFiles.set(r.Name, r.FullName);
    });

    console.log(`Archivos únicos encontrados: ${uniqueFiles.size}`);

    // loop infinito hasta completar o error
    while (true) {
        // 2. Obtener lo que ya está en Firestore
        const existingDocs = await getFirestoreDocuments();
        const existingSet = new Set(existingDocs.map(doc => {
            const f = doc.fields;
            return `${f.pointOfSale?.stringValue}|${f.number?.stringValue}`;
        }));

        console.log(`Documentos en ${COLLECTION}: ${existingSet.size}`);

        // 3. Filtrar los que faltan
        const toProcess = [];
        uniqueFiles.forEach((fullPath, name) => {
            const parts = name.split('_');
            if (parts.length >= 4) {
                const pos = parts[2].padStart(5, '0');
                const num = parts[3].replace('.pdf', '').split(' ')[0].padStart(8, '0');
                if (!existingSet.has(`${pos}|${num}`)) {
                    toProcess.push({ fullPath, name });
                }
            }
        });

        if (toProcess.length === 0) {
            console.log("¡FELICIDADES! No quedan más archivos por procesar.");
            break;
        }

        console.log(`Faltan procesar: ${toProcess.length} archivos.`);

        // 4. Procesar un lote de 20
        const BATCH_SIZE = 20;
        const currentBatch = toProcess.slice(0, BATCH_SIZE);

        console.log(`\nProcesando lote de ${currentBatch.length} archivos...`);

        for (const file of currentBatch) {
            try {
                process.stdout.write(`Extrayendo ${file.name}... `);
                const data = await analyzePDF(file.fullPath);
                const ok = await uploadToFirestore(data, file.fullPath);
                if (ok) console.log(`✅ Ingerido: ${data.company} (#${data.number})`);
                else console.log(`❌ Error al subir.`);
            } catch (e) {
                console.log(`❌ Error: ${e.message}`);
            }
        }

        console.log("Lote completado. Esperando 5 segundos para el siguiente lote...");
        await new Promise(r => setTimeout(r, 5000));
    }
}

main();
