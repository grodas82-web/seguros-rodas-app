import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

async function listModels() {
    const apiKey = (process.env.VITE_GEMINI_API_KEY || "").trim();
    if (!apiKey) {
        console.error("❌ No se encontró VITE_GEMINI_API_KEY en .env");
        return;
    }

    console.log(`Usando API Key: ${apiKey.substring(0, 10)}...`);
    const genAI = new GoogleGenerativeAI(apiKey);

    try {
        console.log("--- Modelos Disponibles (v1) ---");
        // Intentamos listar modelos para ver qué nombres son válidos
        // Nota: listModels suele ser v1beta en algunas versiones del SDK
        const result = await genAI.getGenerativeModel({ model: "gemini-1.5-flash" }).listModels();
        // Nota: genAI.listModels() suele ser lo directo en versiones nuevas
    } catch (e) {
        // En algunas versiones es directo
        try {
            const result = await genAI.listModels();
            console.log(JSON.stringify(result, null, 2));
        } catch (e2) {
            console.error("Error listando modelos:", e2.message);
        }
    }

    // Prueba de generación básica
    console.log("\n--- Prueba de Generación (gemini-1.5-flash) ---");
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const res = await model.generateContent("test");
        console.log("✅ Éxito con gemini-1.5-flash");
    } catch (e) {
        console.log("❌ Falló gemini-1.5-flash:", e.message);
    }
}

listModels();
