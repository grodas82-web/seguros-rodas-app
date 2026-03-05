import { GoogleGenerativeAI } from "@google/generative-ai";
import Anthropic from "@anthropic-ai/sdk";

// === POOL DE API KEYS GEMINI (failover automático) ===
const API_KEYS = [
    import.meta.env.VITE_GEMINI_API_KEY,
    import.meta.env.VITE_GEMINI_API_KEY_2,
    import.meta.env.VITE_GEMINI_API_KEY_3,
    import.meta.env.VITE_GEMINI_API_KEY_4,
].filter(k => k && k.trim()); // Filtrar keys vacías/undefined

let currentKeyIndex = 0;

const getNextKey = () => {
    currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
    return API_KEYS[currentKeyIndex];
};

const getCurrentKey = () => API_KEYS[currentKeyIndex] || "";

// Exponer para el widget de Gemini en Dashboard
export const getActiveKeyInfo = () => ({
    totalKeys: API_KEYS.length,
    activeIndex: currentKeyIndex + 1,
    keyPreview: getCurrentKey().slice(-6),
});

const PROMPT_INVOICE = `
Analiza esta factura PDF y extrae los siguientes datos en formato JSON puro:
{
  "company": "Nombre de la empresa RECEPTORA de la factura (la compañía de seguros, ej: Zurich, Rivadavia, etc). Ignora el nombre del emisor.",
  "cuit": "CUIT de la empresa RECEPTORA (sin guiones). IMPORTANTE: El CUIT 23294824979 corresponde al EMISOR (el usuario), NO LO USES. Busca el CUIT del RECEPTOR.",
  "type": "Factura C",
  "pointOfSale": "Número de punto de venta (pad con ceros hasta 5 dígitos)",
  "number": "Número de comprobante (pad con ceros hasta 8 dígitos)",
  "amount": número decimal del total de la factura,
  "date": "YYYY-MM-DD",
  "period": "Descripción del periodo o concepto (ej: 'COMISIONES ENERO 2026' o similar)",
  "currency": "ARS"
}
IMPORTANTE: 
- El EMISOR es 'DIEGO GERMAN TRABALON' con CUIT 23294824979. IGNORALOS.
- Necesitamos los datos del RECEPTOR (el cliente) como 'company' y 'cuit'.
- Busca en el concepto o descripción para el campo 'period'.
No incluyas markdown, solo el JSON.
`;

const PROMPT_POLICY = `
Analiza esta Póliza de Seguros y extrae los siguientes datos en formato JSON puro:
{
  "clientName": "Nombre completo del Asegurado / Tomador",
  "policyNumber": "Número de póliza completo",
  "company": "Nombre de la Compañía de Seguros",
  "riskType": "Ramo del seguro (Automotor, Hogar, Vida, etc)",
  "startDate": "Fecha de inicio de vigencia (YYYY-MM-DD)",
  "endDate": "Fecha de fin de vigencia (YYYY-MM-DD)",
  "premium": número decimal de la prima total (opcional)
}
No incluyas markdown, solo el JSON.
`;

// Helper para Claude (Primary)
async function _callClaude(prompt, fileBase64) {
    const claudeKey = process.env.VITE_CLAUDE_API_KEY || import.meta.env.VITE_CLAUDE_API_KEY;
    if (!claudeKey) {
        throw new Error("No hay API Key de Claude configurada");
    }

    const anthropic = new Anthropic({
        apiKey: claudeKey,
        dangerouslyAllowBrowser: true // Necesario si se llama directamente desde el frontend
    });

    const hasPrefix = fileBase64.includes(',');
    const mimeType = hasPrefix ? (fileBase64.split(';')[0].split(':')[1] || 'application/pdf') : 'application/pdf';
    const base64Data = hasPrefix ? fileBase64.split(",")[1] : fileBase64;

    if (!base64Data || base64Data.length < 10) {
        throw new Error("El archivo está vacío o el formato base64 es inválido.");
    }

    console.log(`🤖 Claude: Intentando procesar documento (${mimeType}) con claude-3-5-sonnet-latest...`);

    // Claude 3.5 Sonnet (Latest version with PDF support)
    const response = await anthropic.messages.create({
        model: "claude-3-5-sonnet-latest",
        max_tokens: 1024,
        system: "Eres un asistente experto en extracción de datos. Debes devolver estrictamente formato JSON puro, sin texto adicional alrededor.",
        messages: [
            {
                role: "user",
                content: [
                    {
                        type: "document",
                        source: {
                            type: "base64",
                            media_type: mimeType,
                            data: base64Data
                        }
                    },
                    {
                        type: "text",
                        text: prompt
                    }
                ]
            }
        ]
    }, {
        headers: {
            "anthropic-beta": "pdfs-2024-09-25"
        }
    });

    const text = response.content[0].text;
    const jsonStr = text.replace(/```json|```/g, "").trim();
    const parsedData = JSON.parse(jsonStr);

    const usageMetadata = {
        promptTokens: response.usage.input_tokens || 0,
        candidateTokens: response.usage.output_tokens || 0,
        totalTokens: (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0),
        keyIndex: 'ClaudeAPI',
        modelUsed: response.model,
        engine: 'Claude'
    };

    return { data: parsedData, usageMetadata };
}

// Helper para llamadas a Gemini con Failover (Fallback)
async function _callGemini(prompt, fileBase64) {
    const mimeType = fileBase64.split(';')[0].split(':')[1] || 'application/pdf';
    const inlineData = {
        data: fileBase64.split(",")[1],
        mimeType: mimeType,
    };

    let lastError = null;

    const MODELS = [
        "gemini-2.5-flash",
        "gemini-2.0-flash",
        "gemini-1.5-pro-latest",
        "gemini-1.5-flash-latest"
    ];

    for (let attempt = 0; attempt < API_KEYS.length; attempt++) {
        const apiKey = getCurrentKey();
        if (!apiKey) {
            currentKeyIndex = (currentKeyIndex + 1) % Math.max(API_KEYS.length, 1);
            continue;
        }

        for (const modelName of MODELS) {
            try {
                console.log(`🔑 Gemini: Intentando con Key #${currentKeyIndex + 1} | Modelo: ${modelName}`);
                const genAI = new GoogleGenerativeAI(apiKey);
                const model = genAI.getGenerativeModel({ model: modelName });

                const result = await model.generateContent([prompt, { inlineData }]);
                const response = await result.response;
                const text = response.text();
                const jsonStr = text.replace(/```json|```/g, "").trim();
                const parsedData = JSON.parse(jsonStr);

                // Extract token usage
                const um = response.usageMetadata || {};
                const usageMetadata = {
                    promptTokens: um.promptTokenCount || 0,
                    candidateTokens: um.candidatesTokenCount || 0,
                    totalTokens: um.totalTokenCount || 0,
                    keyIndex: currentKeyIndex + 1,
                    modelUsed: modelName,
                    engine: 'Gemini'
                };

                return { data: parsedData, usageMetadata };
            } catch (error) {
                lastError = error;
                const is429 = error?.message?.includes('429') || error?.status === 429 || error?.message?.includes('RESOURCE_EXHAUSTED') || error?.message?.includes('quota');

                // Si es un error de cuota (429), la llave entera está agotada. Pasamos directo a la SIGUIENTE LLAVE.
                if (is429) {
                    console.warn(`⚠️ Cuota/Límite agotado en Key #${currentKeyIndex + 1}. Descartando llave y cambiando a la siguiente...`);
                    break;
                }

                // Si es un modelo no soportado (404/not found), intentamos con el SIGUIENTE MODELO en la misma llave.
                if (error?.message?.includes('not found') || error?.message?.includes('model') || error?.status === 404 || error?.message?.includes('404')) {
                    console.warn(`⚠️ Modelo ${modelName} no existe o no está soportado en Key #${currentKeyIndex + 1}. Intentando modelo alternativo...`);
                    continue;
                }

                // Error grave o desconocido
                console.warn(`❌ Error crítico en Key #${currentKeyIndex + 1}: ${error?.message}. Cambiando de llave...`);
                break;
            }
        }

        // Pasamos a la siguiente llave para el próximo intento del bucle
        getNextKey();
    }
    throw lastError || new Error("Error en comunicación con Gemini (Todas las keys y modelos fallaron)");
}


// Master Helper que orquesta el Dual-Engine
async function _callAI(prompt, fileBase64) {
    // Intento 1: Claude (Principal)
    try {
        const result = await _callClaude(prompt, fileBase64);
        console.log("✅ Claude procesó el documento exitosamente.");
        return result;
    } catch (claudeError) {
        console.warn(`⚠️ Falló IA Principal (Claude). Iniciando Fallback a Gemini. Razón: ${claudeError.message}`);

        // Intento 2: Gemini (Respaldo)
        try {
            const fallbackResult = await _callGemini(prompt, fileBase64);
            console.log("✅ Gemini (Fallback) procesó el documento exitosamente.");
            return fallbackResult;
        } catch (geminiError) {
            console.error("❌ Ambos motores de IA (Claude y Gemini) fallaron.");
            throw new Error(`[IA Falló] Claude error: ${claudeError.message}. Gemini error: ${geminiError.message}`);
        }
    }
}

export const analyzeInvoice = async (fileBase64) => {
    return _callAI(PROMPT_INVOICE, fileBase64);
};

export const analyzePolicy = async (fileBase64) => {
    return _callAI(PROMPT_POLICY, fileBase64);
};
