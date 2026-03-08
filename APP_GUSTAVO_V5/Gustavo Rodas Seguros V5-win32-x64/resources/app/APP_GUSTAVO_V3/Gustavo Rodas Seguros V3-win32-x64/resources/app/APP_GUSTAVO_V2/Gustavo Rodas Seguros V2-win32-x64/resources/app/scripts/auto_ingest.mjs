import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from 'fs';
import path from 'path';

// Configuración
const GEMINI_API_KEY = "AIzaSyBp0iVrbsCBXs6OaaEDGitydW1GUxhJA9o";
const FIREBASE_API_KEY = "AIzaSyBHR2EoNpjGIanQpMxWB7wXW9gAMmNuXvM";
const PROJECT_ID = "finanzastg";

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Directorios
const DOWNLOAD_DIR = path.join(process.env.USERPROFILE, 'Downloads');
const APP_DIR = path.join(process.cwd(), 'Facturas en APP');

// Crear carpeta de destino si no existe
if (!fs.existsSync(APP_DIR)) {
    fs.mkdirSync(APP_DIR, { recursive: true });
}

async function checkProductionDuplicate(invoice) {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/invoices?key=${FIREBASE_API_KEY}&pageSize=1000`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (!data.documents) return false;

        const amt2 = Number(invoice.amount || 0).toFixed(2);
        const date2 = (invoice.date || '').toString().split('T')[0];
        const pos2 = (invoice.pointOfSale || '').toString().padStart(5, '0');
        const num2 = (invoice.number || '').toString().padStart(8, '0');

        return data.documents.some(doc => {
            const fields = doc.fields;
            const dbAmt = Number(fields.amount?.doubleValue || fields.amount?.integerValue || 0).toFixed(2);
            const dbDate = (fields.date?.stringValue || '').split('T')[0];
            const dbPos = (fields.pointOfSale?.stringValue || '').toString().padStart(5, '0');
            const dbNum = (fields.number?.stringValue || '').toString().padStart(8, '0');

            return dbAmt === amt2 && dbDate === date2 && dbPos === pos2 && dbNum === num2;
        });
    } catch (e) {
        console.error("Error comprobando duplicados:", e.message);
        return false;
    }
}

async function analyzePDF(filePath) {
    const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
    const data = fs.readFileSync(filePath);
    const base64Data = data.toString('base64');

    const prompt = `
    Analiza esta factura PDF y extrae los siguientes datos en formato JSON puro:
    {
      "company": "Nombre de la empresa RECEPTORA de la factura (la compañía de seguros, ej: Zurich, Rivadavia, etc). Ignora el nombre del emisor.",
      "cuit": "CUIT de la empresa RECEPTORA (sin guiones)",
      "type": "Factura C",
      "pointOfSale": "Número de punto de venta (pad con ceros hasta 5 dígitos)",
      "number": "Número de comprobante (pad con ceros hasta 8 dígitos)",
      "amount": número decimal del total de la factura,
      "date": "YYYY-MM-DD",
      "period": "Descripción del periodo o concepto (ej: 'COMISIONES ENERO 2026' o similar)",
      "currency": "ARS"
    }
    IMPORTANTE: El usuario es el EMISOR. Necesitamos los datos del RECEPTOR como 'company'.
    Busca en el concepto o descripción para el campo 'period'.
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

    // Formateo estandarizado
    return {
        ...parsed,
        pointOfSale: parsed.pointOfSale?.toString().padStart(5, '0'),
        number: parsed.number?.toString().padStart(8, '0')
    };
}

async function uploadToProduction(data, fileName) {
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
            status: { stringValue: "Workflow Automatizado" },
            fileName: { stringValue: fileName },
            timestamp: { timestampValue: new Date().toISOString() }
        }
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        throw new Error(`Firestore Error: ${await response.text()}`);
    }
}

async function moveFile(oldPath, fileName) {
    const newPath = path.join(APP_DIR, fileName);

    // Comprobar si ya existe en destino
    if (fs.existsSync(newPath)) {
        console.log(`⚠️ El archivo ya existe en 'Facturas en APP': ${fileName}. Se eliminará de Descargas.`);
        try {
            fs.unlinkSync(oldPath);
        } catch (e) {
            console.error(`Error eliminando ${oldPath}: ${e.message}`);
        }
    } else {
        try {
            fs.renameSync(oldPath, newPath);
            console.log(`📂 Archivo movido a 'Facturas en APP': ${fileName}`);
        } catch (e) {
            console.error(`Error moviendo ${fileName}: ${e.message}`);
        }
    }
}

async function main() {
    console.log(`🚀 Iniciando Workflow Optimizado: Monitoreo de Descargas.`);

    // Solo escaneamos la raíz de Descargas (no recursivo por eficiencia diaria)
    const files = fs.readdirSync(DOWNLOAD_DIR)
        .filter(f => f.startsWith('23294824979_') && f.endsWith('.pdf'))
        .map(f => ({ path: path.join(DOWNLOAD_DIR, f), name: f }));

    if (files.length === 0) {
        console.log("📭 No se encontraron facturas nuevas en Descargas.");
        console.log("✨ Proceso finalizado.");
        return;
    }

    console.log(`🔎 Encontradas ${files.length} facturas potenciales en Descargas.`);

    for (const fileObj of files) {
        try {
            console.log(`\n📄 Procesando: ${fileObj.name}...`);

            // 1. Verificar si ya existe en la carpeta final
            const targetPath = path.join(APP_DIR, fileObj.name);
            if (fs.existsSync(targetPath)) {
                console.log(`⏭️ Ignorando: El archivo ya está en 'Facturas en APP'.`);
                await moveFile(fileObj.path, fileObj.name);
                continue;
            }

            // 2. Analizar con Gemini
            const result = await analyzePDF(fileObj.path);

            // 3. Comprobar Duplicados en la Base de Datos (Producción)
            const isDuplicate = await checkProductionDuplicate(result);
            if (isDuplicate) {
                console.log(`⏭️ Ignorando: Factura ${result.company} ${result.pointOfSale}-${result.number} ya existe en Producción.`);
                await moveFile(fileObj.path, fileObj.name);
                continue;
            }

            // 4. Subir a la colección de Producción directamente
            await uploadToProduction(result, fileObj.name);
            console.log(`✅ Datos subidos al Historial Definitivo.`);

            // 5. Trasladar archivo a la base de datos local definitiva
            await moveFile(fileObj.path, fileObj.name);

        } catch (error) {
            console.error(`❌ Error en ${fileObj.name}:`, error.message);
        }
    }
    console.log("\n✨ Proceso de ingesta diaria finalizado.");
}

main();
