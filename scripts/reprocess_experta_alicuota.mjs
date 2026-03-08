
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, updateDoc, query, orderBy, where } from "firebase/firestore";
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as dotenv from "dotenv";

dotenv.config();

const firebaseConfig = {
    apiKey: process.env.VITE_FIREBASE_API_KEY || "AIzaSyBHR2EoNpjGIanQpMxWB7wXW9gAMmNuXvM",
    authDomain: "finanzastg.firebaseapp.com",
    projectId: "finanzastg",
    storageBucket: "finanzastg.firebasestorage.app",
    messagingSenderId: "980629069726",
    appId: "1:980629069726:web:0810594773af27c552c08f"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const genAI = new GoogleGenerativeAI(process.env.VITE_GEMINI_API_KEY);

const PROMPT_POLICY = `
Analiza esta Póliza de Seguros y extrae los siguientes datos en formato JSON puro:
{
    "clientName": "Nombre completo del Asegurado / Tomador",
    "dni": "DNI o CUIT del asegurado",
    "address": "Dirección completa (Domicilio, Localidad, Provincia)",
    "policyNumber": "Número de póliza completo",
    "company": "Nombre de la Compañía de Seguros",
    "riskType": "Ramo del seguro (Autos, Motos, Combinado Familiar, Integral de Comercio, RC, Vida, ART, etc)",
    "startDate": "Fecha de inicio de vigencia (YYYY-MM-DD)",
    "endDate": "Fecha de fin de vigencia (YYYY-MM-DD)",
    "prima": número decimal de la prima total (neto),
    "premio": número decimal del premio total (final con impuestos),
    "insuredSum": número decimal de la suma asegurada principal,
    "currency": "ARS" o "USD",
    "riskDetails": {
        "vehicle": {
            "brand": "Marca del vehículo",
            "model": "Modelo del vehículo",
            "year": "Año/Modelo",
            "plate": "Patente / Dominio",
            "chassis": "Número de Chasis",
            "engine": "Número de Motor",
            "coverage": "Nombre de la cobertura (ej: Terceros Completo, Todo Riesgo)",
            "deductible": número decimal de la franquicia (si aplica)
        },
        "alicuota": número decimal de la alícuota/cuota variable (solo para ART, ej: 5.57),
        "coverages": [
            { "description": "Descripción de la cobertura (ej: Incendio Edificio)", "amount": número decimal }
        ]
    }
}

REGLAS ESPECÍFICAS:
- Direccion: Busca "Domicilio:", "Dirección de Cobro" o sección "Datos de contacto". Concatena Domicilio, Localidad y Provincia.
- ART (Experta y otros): Busca "Cuota Variable:" o "Alícuota:". Extrae el valor numérico (ej: si dice 5,57% retorna 5.57).
- Si es un Automotor / Moto, completa el objeto 'vehicle'.
- Si es otro ramo, completa el array 'coverages' con las sumas aseguradas por ítem.
No incluyas markdown, solo el JSON.
`;

async function loadFileChunks(policyId) {
    const chunksSnap = await getDocs(
        query(collection(db, "policies", policyId, "fileChunks"), orderBy("index"))
    );
    if (chunksSnap.empty) return null;
    let base64 = "";
    chunksSnap.forEach(d => { base64 += d.data().data; });
    return base64;
}

async function analyzePolicy(fileBase64) {
    const MODELS = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"];
    let lastError = null;

    for (const modelName of MODELS) {
        try {
            console.log(`Trying model: ${modelName}...`);
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent([
                PROMPT_POLICY,
                {
                    inlineData: {
                        data: fileBase64.replace(/^data:application\/pdf;base64,/, ""),
                        mimeType: "application/pdf"
                    }
                }
            ]);
            const response = await result.response;
            let text = response.text().replace(/```json/g, "").replace(/```/g, "").trim();
            return JSON.parse(text);
        } catch (err) {
            console.warn(`Failed with ${modelName}:`, err.message);
            lastError = err;
        }
    }
    throw lastError;
}

async function start() {
    const targets = ["MARTELLI TOWN", "DISTRIBUIDORA TBM"];
    const snap = await getDocs(collection(db, "policies"));

    for (const d of snap.docs) {
        const data = d.data();
        if (targets.some(t => (data.clientName || "").toUpperCase().includes(t))) {
            console.log(`\nProcessing: ${data.clientName} (ID: ${d.id})`);

            const base64 = await loadFileChunks(d.id).catch(err => {
                console.error(`Error loading chunks for ${d.id}:`, err);
                return null;
            });

            if (!base64) {
                console.warn(`No clusters found or error for ${d.id}`);
                continue;
            }

            try {
                console.log(`Analyzing ${base64.length} bytes with AI...`);
                const extracted = await analyzePolicy(base64);
                console.log("Extracted Data:", {
                    alicuota: extracted.riskDetails?.alicuota,
                    address: extracted.address
                });

                const updates = {};
                if (extracted.address) updates.address = extracted.address;
                if (extracted.riskDetails?.alicuota) {
                    updates.riskDetails = {
                        ...(data.riskDetails || {}),
                        alicuota: extracted.riskDetails.alicuota
                    };
                }

                if (Object.keys(updates).length > 0) {
                    await updateDoc(doc(db, "policies", d.id), updates);
                    console.log("✅ Successfully updated policy in Firestore.");
                } else {
                    console.warn("⚠️ No new data extracted.");
                }
            } catch (err) {
                console.error(`Error analyzing ${d.id}:`, err);
            }
        }
    }
}

start().catch(console.error);
