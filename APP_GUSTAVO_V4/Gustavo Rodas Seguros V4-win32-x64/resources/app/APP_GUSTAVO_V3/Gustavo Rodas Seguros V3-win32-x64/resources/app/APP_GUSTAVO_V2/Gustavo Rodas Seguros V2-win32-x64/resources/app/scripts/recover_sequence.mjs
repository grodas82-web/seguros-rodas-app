import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

// Configuración
const GEMINI_API_KEY = process.env.VITE_GEMINI_API_KEY || "";
const FIREBASE_API_KEY = ""; // Use env
const PROJECT_ID = "finanzastg";

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

async function getProductionInvoices() {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/invoices?key=${FIREBASE_API_KEY}&pageSize=1000`;
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
    IMPORTANTE: El usuario es el EMISOR. Necesitamos los datos del RECEPTOR.
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

async function uploadToProduction(data, path) {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/invoices?key=${FIREBASE_API_KEY}`;
    const body = {
        fields: {
            company: { stringValue: data.company || "" },
            cuit: { stringValue: data.cuit || "" },
            type: { stringValue: data.type || "Factura C" },
            pointOfSale: { stringValue: data.pointOfSale || "" },
            number: { stringValue: data.number || "" },
            amount: { doubleValue: data.amount || 0 },
            date: { stringValue: data.date || "" },
            period: { stringValue: data.period || "" },
            batchSource: { stringValue: "Sequence Recovery Workflow" },
            originalPath: { stringValue: path },
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
    console.log("Reading CSV...");
    const csvContent = fs.readFileSync(path.join(process.cwd(), 'scripts', 'all_found_invoices.csv'), 'utf-8');
    const records = parse(csvContent, { columns: true, skip_empty_lines: true });

    console.log(`Found ${records.length} records in CSV.`);

    // Deduplicar por nombre de archivo para evitar procesar el mismo archivo en distintas carpetas
    const uniqueFiles = new Map();
    records.forEach(r => {
        if (!uniqueFiles.has(r.Name)) {
            uniqueFiles.set(r.Name, r.FullName);
        }
    });

    console.log(`${uniqueFiles.size} unique filenames identified.`);

    const production = await getProductionInvoices();
    console.log(`Current production database has ${production.length} records.`);

    const prodSet = new Set(production.map(doc => {
        const f = doc.fields;
        const pos = f.pointOfSale?.stringValue?.padStart(5, '0');
        const num = f.number?.stringValue?.padStart(8, '0');
        return `${pos}|${num}`;
    }));

    const toProcess = [];
    uniqueFiles.forEach((fullPath, name) => {
        // Extraer POS y Numero del nombre del archivo si es posible: 23294824979_XXX_YYYYY_ZZZZZZZZ.pdf
        const parts = name.split('_');
        if (parts.length >= 4) {
            const pos = parts[2].padStart(5, '0');
            const num = parts[3].replace('.pdf', '').split(' ')[0].padStart(8, '0');
            if (!prodSet.has(`${pos}|${num}`)) {
                toProcess.push({ fullPath, pos, num, name });
            }
        } else {
            toProcess.push({ fullPath, name }); // Si no sigue el patrón, procesar igual para ver qué es
        }
    });

    console.log(`${toProcess.length} files are missing from production.`);

    // Ordenar por numero para procesar los mas antiguos primero (objetivo 00000001)
    toProcess.sort((a, b) => (a.num || '99999999').localeCompare(b.num || '99999999'));

    // Procesar un lote pequeño para no saturar
    const BATCH_SIZE = 20;
    const batch = toProcess.slice(0, BATCH_SIZE);

    console.log(`\nStarting ingestion of first ${batch.length} files...`);

    for (const file of batch) {
        try {
            console.log(`Processing ${file.name}...`);
            const data = await analyzePDF(file.fullPath);
            const ok = await uploadToProduction(data, file.fullPath);
            if (ok) console.log(`  ✅ Ingested: ${data.company} (#${data.number})`);
            else console.log(`  ❌ Error uploading.`);
        } catch (e) {
            console.error(`  ❌ Error: ${e.message}`);
        }
    }

    // GAP ANALYSIS
    console.log("\n--- SEQUENCE GAP ANALYSIS ---");
    const updatedProd = await getProductionInvoices();
    const sequenceMap = {}; // POS -> Array of numbers

    updatedProd.forEach(doc => {
        const f = doc.fields;
        const pos = f.pointOfSale?.stringValue || "00001";
        const num = parseInt(f.number?.stringValue || "0");
        if (!sequenceMap[pos]) sequenceMap[pos] = [];
        sequenceMap[pos].push(num);
    });

    for (const pos in sequenceMap) {
        const nums = sequenceMap[pos].sort((a, b) => a - b);
        if (nums.length === 0) continue;

        const min = nums[0];
        const max = nums[nums.length - 1];
        const gaps = [];

        for (let i = 1; i < max; i++) {
            if (!nums.includes(i)) {
                gaps.push(i.toString().padStart(8, '0'));
            }
        }

        console.log(`POS ${pos}: Sequence 00000001 to ${max.toString().padStart(8, '0')}`);
        if (gaps.length > 0) {
            console.log(`  GAPS DETECTED (${gaps.length}): ${gaps.slice(0, 10).join(', ')}${gaps.length > 10 ? '...' : ''}`);
        } else {
            console.log("  NO GAPS! Complete sequence found.");
        }
    }

    console.log("\nWorkflow finished for this batch.");
}

main();
