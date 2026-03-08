import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config({ path: ".env" });

const API_KEYS = [
    process.env.VITE_GEMINI_API_KEY,
    process.env.VITE_GEMINI_API_KEY_2,
    process.env.VITE_GEMINI_API_KEY_3,
    process.env.VITE_GEMINI_API_KEY_4,
].filter(Boolean);

const MODELS = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-pro-latest",
    "gemini-1.5-flash-latest",
    "gemini-1.5-flash"
];

async function testKeys() {
    console.log(`Testing ${API_KEYS.length} keys...`);

    for (let i = 0; i < API_KEYS.length; i++) {
        const apiKey = API_KEYS[i];
        console.log(`\n--- Key #${i + 1} (${apiKey.substring(0, 10)}...) ---`);
        const genAI = new GoogleGenerativeAI(apiKey);

        for (const modelName of MODELS) {
            try {
                const model = genAI.getGenerativeModel({ model: modelName });
                // We'll just generate a tiny prompt to check if the model is alive AND has quota
                const result = await model.generateContent("test");
                console.log(`✅ [${modelName}] - SUCCESS`);
            } catch (err) {
                console.log(`❌ [${modelName}] - FAIL: ${err.message.split('\\n')[0].substring(0, 100)}`);
            }
        }
    }
}

testKeys();
