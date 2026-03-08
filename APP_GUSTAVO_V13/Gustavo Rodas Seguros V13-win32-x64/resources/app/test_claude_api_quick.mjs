import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: "C:\\Users\\Admin\\OneDrive\\Escritorio\\Proyecto Facturacion 2026\\Facturacion-2026-App\\.env" });

const anthropic = new Anthropic({
    apiKey: process.env.VITE_CLAUDE_API_KEY,
});

async function testClaude() {
    console.log("Testing Claude API (Quick Test)...");
    const model = "claude-3-5-sonnet-20241022";

    try {
        console.log(`Testing PDF support for ${model} with header pdf-2024-10-22...`);
        const response = await anthropic.messages.create({
            model: model,
            max_tokens: 10,
            messages: [{
                role: "user",
                content: [
                    { type: "text", text: "Hola" },
                    {
                        type: "document",
                        source: {
                            type: "base64",
                            media_type: "application/pdf",
                            data: "JVBERi0xLjUKJfbk/N8KMSAwIG9iago8PAoVIFR5cGUgL0NhdGFsb2cKICAvUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwKICAvVHlwZSAvUGFnZXMKICAvS2lkcyBbMyAwIFJdCiAgL0NvdW50IDEKPj4KZW5kb2JqCjMgMCBvYmoKPDwKICAvVHlwZSAvUGFnZQogIC9QYXJlbnQgMiAwIFIKICAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXQogIC9SZXNvdXJjZXMgPDw+PgogIC9Db250ZW50cyA0IDAgUgo+PgplbmRvYmoKNCAwIG9iago8PAogIC9MZW5ndGggMTUKPj4Kc3RyZWFtCkJUCi9GMSAxMiBUZgplbmRzdHJlYW0KZW5kb2JqCnRyYWlsZXIKPDwKICAvUm9vdCAxIDAgUgogIC9TaXplIDUKPj4KJSVFT0YK"
                        }
                    }
                ]
            }],
        }, {
            headers: { "anthropic-beta": "pdf-2024-10-22" }
        });
        console.log("✅ SUCCESS! Claude PDF works!");
        console.log("Response:", response.content[0].text);
    } catch (err) {
        console.log(`❌ Fail with ${model}: ${err.message}`);
    }
}

testClaude();
