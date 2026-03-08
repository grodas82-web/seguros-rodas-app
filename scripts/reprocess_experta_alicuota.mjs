
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, updateDoc, query, orderBy } from "firebase/firestore";
import * as dotenv from "dotenv";

dotenv.config();

const firebaseConfig = {
    apiKey: "AIzaSyBHR2EoNpjGIanQpMxWB7wXW9gAMmNuXvM",
    authDomain: "finanzastg.firebaseapp.com",
    projectId: "finanzastg",
    storageBucket: "finanzastg.firebasestorage.app",
    messagingSenderId: "980629069726",
    appId: "1:980629069726:web:0810594773af27c552c08f"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const GEMINI_KEY = process.env.VITE_GEMINI_API_KEY || "AIzaSyCDdmIOhvvacFc46o8Ahj23byQtwmq7zS8";

const PROMPT_POLICY = `
ACTÚA COMO UN EXPERTO EN DOCUMENTACIÓN DE SEGUROS.
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
    "prima": 0,
    "premio": 0,
    "insuredSum": 0,
    "currency": "ARS",
    "riskDetails": {
        "alicuota": 0
    }
}
REGLAS:
- Direccion: Busca "Domicilio" y concatena con Localidad y Provincia.
- Alícuota (Solo ART): Busca "Cuota Variable" o "Alícuota". Extrae el número (ej: 5.57).
Retorna ÚNICAMENTE JSON.
`;

async function analyzeWithGemini(fileBase64) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;
    const payload = {
        contents: [{
            parts: [
                { text: PROMPT_POLICY },
                {
                    inlineData: {
                        mimeType: "application/pdf",
                        data: fileBase64.replace(/^data:application\/pdf;base64,/, "")
                    }
                }
            ]
        }],
        generationConfig: {
            responseMimeType: "application/json"
        }
    };

    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Gemini API Error: ${res.status} - ${err}`);
    }

    const data = await res.json();
    return JSON.parse(data.candidates[0].content.parts[0].text);
}

async function start() {
    const targets = ["MARTELLI TOWN", "DISTRIBUIDORA TBM"];
    const snap = await getDocs(collection(db, "policies"));

    for (const d of snap.docs) {
        const data = d.data();
        if (targets.some(t => (data.clientName || "").toUpperCase().includes(t))) {
            console.log(`\nProcessing: ${data.clientName}`);

            const chunksSnap = await getDocs(query(collection(db, "policies", d.id, "fileChunks"), orderBy("index")));
            if (chunksSnap.empty) continue;
            let base64 = "";
            chunksSnap.forEach(chunk => { base64 += chunk.data().data; });

            try {
                const extracted = await analyzeWithGemini(base64);
                console.log("Extracted:", extracted.riskDetails?.alicuota, extracted.address);

                const updates = {};
                if (extracted.address) updates.address = extracted.address;
                if (extracted.riskDetails?.alicuota) {
                    updates.riskDetails = { ...(data.riskDetails || {}), alicuota: extracted.riskDetails.alicuota };
                }

                if (Object.keys(updates).length > 0) {
                    await updateDoc(doc(db, "policies", d.id), updates);
                    console.log("✅ Updated.");
                }
            } catch (err) {
                console.error(`Error: ${err.message}`);
            }
        }
    }
}

start().catch(console.error);
