import { GoogleGenerativeAI } from "@google/generative-ai";

const GEMINI_API_KEY = "AIzaSyBp0iVrbsCBXs6OaaEDGitydW1GUxhJA9o";
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

async function listModels() {
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();
        console.log("Available Models:", JSON.stringify(data.models?.map(m => m.name), null, 2));
    } catch (e) {
        console.error("Error listing models:", e.message);
    }
}

listModels();
