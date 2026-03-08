import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: "C:\\Users\\Admin\\OneDrive\\Escritorio\\Proyecto Facturacion 2026\\Facturacion-2026-App\\.env" });

const anthropic = new Anthropic({
    apiKey: process.env.VITE_CLAUDE_API_KEY,
});

async function testClaude() {
    console.log("Testing Claude API...");
    console.log("Key found:", !!process.env.VITE_CLAUDE_API_KEY);

    const models = [
        "claude-4-6-sonnet-latest",
        "claude-4-6-sonnet-20260205",
        "claude-4-5-sonnet-20250916",
        "claude-4-5-haiku-20251022",
        "claude-3-5-sonnet-20241022"
    ];

    for (const model of models) {
        try {
            console.log(`\n--- Testing model: ${model} ---`);
            const response = await anthropic.messages.create({
                model: model,
                max_tokens: 10,
                messages: [{ role: "user", content: "Hello" }],
            });
            console.log(`✅ Success with ${model}:`, response.content[0].text);

            // If success, test PDF support if it's Sonnet 3.5
            if (model.includes("sonnet-3-5") || model.includes("sonnet-latest")) {
                try {
                    console.log(`Testing PDF beta with ${model}...`);
                    await anthropic.messages.create({
                        model: model,
                        max_tokens: 10,
                        messages: [{
                            role: "user",
                            content: [
                                { type: "text", text: "What is this?" },
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
                    console.log("✅ PDF Beta works!");
                } catch (pdfErr) {
                    console.log(`❌ PDF Beta failed: ${pdfErr.message}`);
                }
            }
        } catch (err) {
            console.log(`❌ Fail with ${model}: ${err.message}`);
            if (err.status === 404) console.log("   (Error 404: Model not found or not available to this key)");
            if (err.status === 401) console.log("   (Error 401: Invalid API key)");
            if (err.status === 403) console.log("   (Error 403: Forbidden - check permissions/billing)");
        }
    }
}

testClaude();
