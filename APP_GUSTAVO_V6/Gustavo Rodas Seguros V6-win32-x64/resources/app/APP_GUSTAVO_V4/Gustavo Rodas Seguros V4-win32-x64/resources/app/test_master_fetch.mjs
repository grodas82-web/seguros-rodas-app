import dotenv from "dotenv";
import fetch from "node-fetch"; // Assuming node-fetch is available or using global fetch in Node 18+
dotenv.config({ path: "C:\\Users\\Admin\\OneDrive\\Escritorio\\Proyecto Facturacion 2026\\Facturacion-2026-App\\.env" });

async function testClaudeFetch() {
    const claudeKey = process.env.VITE_CLAUDE_API_KEY;
    const model = "claude-3-5-sonnet-20241022";
    console.log(`--- Testing Claude Fetch with model ${model} ---`);

    try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": claudeKey,
                "anthropic-version": "2023-06-01",
                "anthropic-dangerous-direct-browser-access": "true",
                "anthropic-beta": "pdf-2024-10-22"
            },
            body: JSON.stringify({
                model: model,
                max_tokens: 10,
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "document",
                                source: {
                                    type: "base64",
                                    media_type: "application/pdf",
                                    data: "JVBERi0xLjUKJfbk/N8KMSAwIG9iago8PAoVIFR5cGUgL0NhdGFsb2cKICAvUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwKICAvVHlwZSAvUGFnZXMKICAvS2lkcyBbMyAwIFJdCiAgL0NvdW50IDEKPj4KZW5kb2JqCjMgMCBvYmoKPDwKICAvVHlwZSAvUGFnZQogIC9QYXJlbnQgMiAwIFIKICAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXQogIC9SZXNvdXJjZXMgPDw+PgogIC9Db250ZW50cyA0IDAgUgo+PgplbmRvYmoKNCAwIG9iago8PAogIC9MZW5ndGggMTUKPj4Kc3RyZWFtCkJUCi9GMSAxMiBUZgplbmRzdHJlYW0KZW5kb2JqCnRyYWlsZXIKPDwKICAvUm9vdCAxIDAgUgogIC9TaXplIDUKPj4KJSVFT0YK"
                                }
                            },
                            { type: "text", text: "Hola" }
                        ]
                    }
                ]
            })
        });

        const data = await response.json();
        if (response.status === 200) {
            console.log("✅ CLAUDE FETCH SUCCESS!");
            console.log("Response:", data.content[0].text);
        } else {
            console.error(`❌ CLAUDE FETCH FAILED (${response.status}):`, JSON.stringify(data, null, 2));
        }
    } catch (err) {
        console.error("❌ CLAUDE FETCH CRITICAL ERROR:", err.message);
    }
}

async function testGemini() {
    console.log("\n--- Testing Gemini Failover Logic Simulation ---");
    // Simulation logic for Gemini failover would go here, 
    // but we can at least test if the first key is valid.
    const geminiKey = process.env.VITE_GEMINI_API_KEY;
    console.log("Gemini Key found:", !!geminiKey);
    // ... basic fetch to gemini ...
}

async function run() {
    await testClaudeFetch();
    await testGemini();
}

run();
