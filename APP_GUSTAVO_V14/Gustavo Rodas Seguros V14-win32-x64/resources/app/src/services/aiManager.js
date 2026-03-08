import { GoogleGenerativeAI } from "@google/generative-ai";
import Anthropic from "@anthropic-ai/sdk";

// === POOL DE API KEYS GEMINI (failover automático) ===
const API_KEYS = [
    import.meta.env.VITE_GEMINI_API_KEY
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

const PROMPT_INVOICE = (companyHints = "") => `
Eres un experto en lectura visual de FACTURAS AFIP(Argentina).
Ignora todo el ruido.EXTRAE ÚNICAMENTE ESTOS DATOS basándote en la disposición visual exacta:

1. RECEPTOR DE LA FACTURA(Ubicado en la mitad superior, donde están los datos a quién se factura):
- "cuit": Busca "CUIT: " seguido de 11 números en el recuadro del cliente. (Ej: 30500036911)
    - "company": Busca "Apellido y Nombre / Razón Social:" justo al lado o arriba de ese CUIT.Esta es la Compañía de Seguros. (Ej: COMPAÑIA DE SEGUROS LA MERCANTIL ANDINA S.A.)
        (PISTAS VÁLIDAS: ${companyHints})
     CRÍTICO PROHIBIDO: Jamás uses 'DIEGO GERMAN TRABALON', 'RODAS GUSTAVO RAUL' ni el CUIT '23294824979'.Ellos son los EMISORES(están en la esquina superior izquierda), no los receptores.

2. DATOS DE FACTURA(Esquina superior derecha):
- "type": La letra gigante en el recuadro negro, ej: "Factura C".
   - "pointOfSale": Al lado de "Punto de Venta:", ej: "00003".
   - "number": Al lado de "Comp. Nro:", ej: "00001315".
   - "date": Al lado de "Fecha de Emisión:", formato YYYY - MM - DD.

3. DETALLE DE IMPORTES(En la tabla inferior):
- "period": El texto completo bajo la columna "Producto / Servicio".Ej: "COMISIONES FEBRERO 2026".
   - "amount": El importe total facturado(bajo la columna "Subtotal" o "Importe Total").Solo el número decimal, usando punto.Ej: 855680.25(NO pongas coma, quita signos de pesos y puntos de miles).

JSON ESPERADO FORMATO EXACTO:
{
    "cuit": "30500036911",
        "company": "Compañía de Seguros S.A.",
            "type": "Factura C",
                "pointOfSale": "00003",
                    "number": "00000000",
                        "date": "YYYY-MM-DD",
                            "period": "COMISIONES FEBRERO 2026",
                                "amount": 855680.25,
                                    "currency": "ARS"
}
`;

const PROMPT_POLICY = (hints = "") => `
Analiza esta Póliza de Seguros y extrae los siguientes datos en formato JSON puro:
{
    "clientName": "Nombre completo del Asegurado / Tomador",
        "dni": "DNI o CUIT del asegurado",
            "policyNumber": "Número de póliza completo",
                "company": "Nombre de la Compañía de Seguros",
                    "riskType": "Ramo del seguro (Autos, Motos, Combinado Familiar, Integral de Comercio, RC, Vida, etc)",
                        "startDate": "Fecha de inicio de vigencia (YYYY-MM-DD)",
                            "endDate": "Fecha de fin de vigencia (YYYY-MM-DD)",
                                "prima": número decimal de la prima total(neto),
                                    "premio": número decimal del premio total(final con impuestos),
                                        "insuredSum": número decimal de la suma asegurada principal,
                                            "currency": "ARS" o "USD",
                                                "riskDetails": {
        "vehicle": {
            "brand": "Marca del vehículo",
                "model": "Modelo del vehículo",
                    "year": "Año/Modelo",
                        "plate": "Patente / Dominio",
                            "chassis": "Número de Chasis",
                                "engine": "Número de Motor",
                                    "coverage": "Nombre de la cobertura (ej: Terceros Completo, Todo Riesgo)",
                                        "deductible": número decimal de la franquicia(si aplica)
        },
        "coverages": [
            { "description": "Descripción de la cobertura (ej: Incendio Edificio)", "amount": número decimal }
        ]
    }
}
${hints ? `PISTAS PARA ESTA COMPAÑÍA:\n${hints}\n` : ""}
IMPORTANTE:
- Si es un Automotor / Moto, completa el objeto 'vehicle'.
- Si es otro ramo, completa el array 'coverages' con las sumas aseguradas por ítem.
No incluyas markdown, solo el JSON.
`;

// Helper para Claude (Primary) - CONFIGURACION MANUAL URGENTE
async function _callClaude(prompt, fileBase64) {
    const claudeKey = (import.meta.env?.VITE_CLAUDE_API_KEY || process.env?.VITE_CLAUDE_API_KEY || "").trim();
    if (!claudeKey) throw new Error("No hay API Key de Claude configurada");

    const base64Data = fileBase64.includes(',') ? fileBase64.split(",")[1] : fileBase64;

    const models = ["claude-3-5-sonnet-20241022", "claude-3-5-sonnet-latest"];
    let lastError = null;

    for (const model of models) {
        try {
            console.log(`📡[PROBANDO CLAUDE] Intentando Modelo: ${model}`);
            const response = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": claudeKey,
                    "anthropic-version": "2023-06-01",
                    "anthropic-dangerous-direct-browser-access": "true"
                },
                body: JSON.stringify({
                    model: model,
                    max_tokens: 1024,
                    messages: [
                        {
                            role: "user",
                            content: [
                                {
                                    type: "document",
                                    source: {
                                        type: "base64",
                                        media_type: "application/pdf",
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
                })
            });

            if (response.status !== 200) {
                const errorBody = await response.json();
                console.error(`❌ [ANTHROPIC ERROR - ${model}]:`, errorBody);
                lastError = new Error(`Claude Error(${response.status}): ${JSON.stringify(errorBody)}`);
                continue; // Probar siguiente modelo
            }

            const data = await response.json();
            const text = data.content[0].text;
            console.log("📝 [CLAUDE RAW]:", text);

            // Extracción ROBUSTA de JSON
            const jsonText = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1) || text;
            const parsedData = JSON.parse(jsonText.replace(/```json|```/g, "").trim());

            return {
                data: parsedData,
                usageMetadata: {
                    promptTokens: data.usage.input_tokens || 0,
                    candidateTokens: data.usage.output_tokens || 0,
                    totalTokens: data.usage.input_tokens + data.usage.output_tokens,
                    modelUsed: model,
                    engine: 'Claude'
                }
            };
        } catch (err) {
            lastError = err;
            console.warn(`⚠️ Error con modelo ${model}: ${err.message}`);
        }
    }
    throw lastError;
}

// Helper para llamadas a Gemini con Failover (Fallback)
async function _callGemini(prompt, fileBase64) {
    const mimeType = fileBase64.includes(';') ? (fileBase64.split(';')[0].split(':')[1] || 'application/pdf') : 'application/pdf';
    const inlineData = {
        data: fileBase64.includes(',') ? fileBase64.split(",")[1] : fileBase64,
        mimeType: mimeType,
    };

    let lastError = null;

    const MODELS = [
        "gemini-2.0-flash",
        "gemini-1.5-flash",
        "gemini-flash-latest"
    ];

    for (let attempt = 0; attempt < API_KEYS.length; attempt++) {
        const apiKey = getCurrentKey();
        if (!apiKey) {
            getNextKey();
            continue;
        }

        for (const modelName of MODELS) {
            try {
                console.log(`🔑 Gemini: Intentando Key #${currentKeyIndex + 1} | Modelo: ${modelName} `);
                const genAI = new GoogleGenerativeAI(apiKey);
                const model = genAI.getGenerativeModel({ model: modelName });

                const result = await model.generateContent([prompt, { inlineData }]);
                const response = await result.response;
                const text = response.text();
                console.log("📝 [GEMINI RAW]:", text);

                // Extracción ROBUSTA de JSON
                const jsonText = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1) || text;
                const parsedData = JSON.parse(jsonText.replace(/```json|```/g, "").trim());

                const um = response.usageMetadata || {};
                return {
                    data: parsedData,
                    usageMetadata: {
                        promptTokens: um.promptTokenCount || 0,
                        candidateTokens: um.candidatesTokenCount || 0,
                        totalTokens: um.totalTokenCount || 0,
                        modelUsed: modelName,
                        engine: 'Gemini'
                    }
                };
            } catch (error) {
                lastError = error;
                if (error?.message?.includes('429') || error?.status === 429 || error?.message?.includes('quota')) {
                    console.warn(`⚠️ Cuota agostada en Key #${currentKeyIndex + 1} para modelo ${modelName}. Probando siguiente modelo...`);
                    continue; // Intentar con el siguiente modelo de la misma clave
                }
                if (error?.message?.includes('404') || error?.message?.includes('not found')) {
                    continue;
                }
                break;
            }
        }
        getNextKey();
    }
    throw lastError || new Error("Gemini falló en todos los intentos");
}

// Master Helper que orquesta el Dual-Engine
async function _callAI(prompt, fileBase64) {
    try {
        const result = await _callClaude(prompt, fileBase64);
        console.log("✅ Claude (Primario) OK");
        return result;
    } catch (claudeError) {
        console.warn(`⚠️ Claude falló: ${claudeError.message}. Iniciando Fallback Gemini...`);
        try {
            return await _callGemini(prompt, fileBase64);
        } catch (geminiError) {
            console.error("❌ Falló el procesamiento total (Claude + Gemini)");
            throw new Error(`Error en IA: Claude(${claudeError.message}) | Gemini(${geminiError.message})`);
        }
    }
}

export const analyzeInvoice = async (fileBase64, companyHints = "") => {
    return _callAI(PROMPT_INVOICE(companyHints), fileBase64);
};

export const analyzePolicy = async (fileBase64, hints = "") => {
    return _callAI(PROMPT_POLICY(hints), fileBase64);
};

export const analyzeCSV = async (textData) => {
    const prompt = `Analiza este texto extraído de un archivo de pólizas y retorna un ARRAY JSON puro:
[{ "clientName": string, "dni": string, "policyNumber": string, "company": string, "riskType": string, "endDate": "YYYY-MM-DD" }]
TEXTO: ${textData} `;

    // Para CSV usamos Gemini directamente por su ventana de contexto y manejo de texto largo
    const apiKey = getCurrentKey();
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const jsonStr = text.replace(/```json | ```/g, "").trim();
    return { data: JSON.parse(jsonStr), engine: 'Gemini' };
};

const PROMPT_SMART_CLASSIFIER = `
ACTÚA COMO UN EXPERTO EN DOCUMENTACIÓN DE SEGUROS Y FINANZAS.
Analiza TODO el documento y clasifícalo. (Atención: los valores de Prima y Premio pueden estar en la página 12 o al final del documento).

REGLAS DE EXTRACCIÓN PARA EXPERTA SEGUROS (Y PÓLIZAS EN GENERAL):
- Cliente (OBLIGATORIO): Buscar junto a "ASEGURADO", "Tomador" o similar (ej: OLIVARES LAUTARO). Si no lo encuentras, usa el texto "CLIENTE DESCONOCIDO".
- DNI (OBLIGATORIO): Debajo de "N° DOC./N° DE CUIT" o similar (ej: 32.421.862 o CUIT). Si no lo encuentras, usa el texto "00000000".
- Póliza (OBLIGATORIO): En columna "POLIZA N°" o "Póliza". Si no lo encuentras, usa el texto "SIN_NUMERO".
- Compañía (OBLIGATORIO): Identifica la aseguradora por su nombre o logo. ¡Si dice EXPERTA SEGUROS, usa exactamente "EXPERTA SEGUROS"!
- Vigencia: Extraer de "VIGENCIA desde las ... hasta las ...". Formato YYYY-MM-DD.
- Vehículo: Extraer Chasis, Motor, Marca, Patente, Año de "OBJETO DEL SEGURO Y RIESGOS ASEGURADOS" (O seccion equivalente). ¡Debes llenar TODOS los campos de vehicle!
- Prima y Premio: Buscar los totales en las páginas finales o donde aplique.
- riskType: DEBE SER ESTRICTAMENTE "Autos" si es un seguro de automotores (sin importar si dice Automotor o Vehículos).

REGLAS DE EXTRACCIÓN PARA FACTURAS/LIQUIDACIONES (AFIP STRICT):
- cuit: Busca "CUIT: " seguido de 11 números en el recuadro "Apellido y Nombre / Razón Social" en la MITAD del documento. (Jamás el de arriba).
- company: La Razón Social junto a ese CUIT en la mitad del documento. (PROHIBIDO usar 'DIEGO GERMAN TRABALON', 'RODAS GUSTAVO RAUL' o el CUIT '23294824979').
- type: Letra grande arriba (ej: "Factura C").
- pointOfSale: Al lado de "Punto de Venta:" (ej: "00003").
- number: "Comp. Nro:" (ej: "00001315").
- date: "Fecha de Emisión:" (YYYY-MM-DD).
- period: El texto bajo "Producto / Servicio" en la tabla inferior (ej: "COMISIONES FEBRERO 2026").
- amount: El número de la columna "Subtotal" (Decimal con punto).

1. Identifica si es una "POLIZA" o una "FACTURA/LIQUIDACION".
2. Retorna un JSON puro con esta estructura EXACTA (SIN comentarios dentro del JSON):
{
    "documentType": "POLIZA" o "FACTURA",
    "confidence": 95,
    "extractedData": {
        "clientName": "string",
        "dni": "string",
        "policyNumber": "string",
        "company": "string",
        "riskType": "string",
        "prima": 0,
        "premio": 0,
        "insuredSum": 0,
        "startDate": "YYYY-MM-DD",
        "endDate": "YYYY-MM-DD",
        "riskDetails": {
            "vehicle": {
                "brand": "string",
                "model": "string",
                "plate": "string",
                "chassis": "string",
                "engine": "string",
                "year": "string",
                "coverage": "string",
                "deductible": 0
            },
            "coverages": [
                { "description": "string", "amount": 0 }
            ]
        },
        "number": "string",
        "type": "string",
        "date": "YYYY-MM-DD",
        "cuit": "string",
        "period": "string",
        "amount": 0,
        "pointOfSale": "string"
    }
}
RETORNA ÚNICAMENTE JSON VÁLIDO.
`;


export const smartAnalyzeFile = async (fileBase64, companyNames = []) => {
    const hints = companyNames.length > 0 ? companyNames.join(", ") : "";
    return _callAI(PROMPT_SMART_CLASSIFIER + (hints ? `\nPISTAS DE COMPAÑÍAS CONOCIDAS: ${hints} ` : ""), fileBase64);
};
