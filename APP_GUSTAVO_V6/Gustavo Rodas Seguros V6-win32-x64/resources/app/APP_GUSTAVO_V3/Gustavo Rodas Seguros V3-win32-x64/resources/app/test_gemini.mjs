import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });

async function run() {
    const apiKey = process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
        console.error("VITE_GEMINI_API_KEY not found in .env");
        process.exit(1);
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    try {
        console.log("Listing models...");
        // In the latest SDK, listModels might be different. 
        // Let's try to just check if 'gemini-1.5-flash' works by getting it.
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        console.log("Successfully initialized gemini-1.5-flash");

        // Let's try to get info about it
        // Note: listModels is often part of the generativeLanguage client, not the simple SDK
        // But we can try a simple generation to verify
        console.log("Testing generation with gemini-1.5-flash...");
        const result = await model.generateContent("Hola");
        console.log("Generation success!");
    } catch (error) {
        console.error("Error with gemini-1.5-flash:", error.message);
        if (error.stack) console.error(error.stack);
    }

    try {
        console.log("\nTesting gemini-1.5-flash-latest...");
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
        await model.generateContent("Hola");
        console.log("gemini-1.5-flash-latest success!");
    } catch (error) {
        console.error("Error with gemini-1.5-flash-latest:", error.message);
    }
}

run();
