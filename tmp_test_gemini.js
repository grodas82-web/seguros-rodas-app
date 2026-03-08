import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cargar .env desde el directorio del proyecto
dotenv.config({ path: "c:/Users/Admin/OneDrive/Escritorio/Proyecto Facturacion 2026/Facturacion-2026-App/.env" });

const apiKey = process.env.VITE_GEMINI_API_KEY;

if (!apiKey) {
    console.error("❌ Error: VITE_GEMINI_API_KEY no encontrada en el .env");
    process.exit(1);
}

async function testGemini() {
    console.log("🚀 Iniciando prueba de Gemini API...");
    console.log(`🔑 Key detectada: ${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`);

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        const prompt = "Responde 'OK: Gemini funcionando' si recibes este mensaje.";
        console.log(`📡 Enviando prompt: "${prompt}"`);

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        console.log("-----------------------------------------");
        console.log(`✅ RESPUESTA RECIBIDA: ${text}`);
        console.log("-----------------------------------------");

        if (response.usageMetadata) {
            console.log("📊 Metadatos de uso:");
            console.log(`   - Tokens de entrada: ${response.usageMetadata.promptTokenCount}`);
            console.log(`   - Tokens de salida: ${response.usageMetadata.candidatesTokenCount}`);
            console.log(`   - Tokens totales: ${response.usageMetadata.totalTokenCount}`);
        }

    } catch (error) {
        console.error("❌ ERROR AL LLAMAR A GEMINI:");
        console.error(error);

        if (error.status === 429) {
            console.error("⚠️ Error 429: Cuota excedida.");
        } else if (error.status === 403) {
            console.error("⚠️ Error 403: API Key inválida o sin permisos.");
        }
    }
}

testGemini();
