import { GoogleGenerativeAI } from "@google/generative-ai";


const STATIC_POOL = [...new Set([
    import.meta.env.VITE_GEMINI_API_KEY_1,
    import.meta.env.VITE_GEMINI_API_KEY_2,
    import.meta.env.VITE_GEMINI_API_KEY_3,
    import.meta.env.VITE_GEMINI_API_KEY_4,
    import.meta.env.VITE_GEMINI_API_KEY_5,
    import.meta.env.VITE_GEMINI_API_KEY_6
].filter(k => k && k.trim() && !k.includes("Pega_Aqui")))];

const AI_ENGINE_VERSION = "V21.1 DASHBOARD_REDESIGN";
const LAST_UPDATED = "2026-03-13"; // Balanced layout implemented
const PRODUCT_NAME = "V21.1 GOLD";
const API_KEYS = [...STATIC_POOL];

console.log(`🧊 [GEMINI POOL] Configurado con ${API_KEYS.length} llaves (estático). (${AI_ENGINE_VERSION} - ENGINE AUTO)`);

const KEY_COOLDOWNS = new Map();
let keysInitialized = false;

// Función para sincronizar llaves reales desde el Sistema (v19.7 - God Mode)
const initializeDynamicKeys = async () => {
    if (keysInitialized) return;
    try {
        if (window.electron && window.electron.getEnvKeys) {
            console.log("📡 [GEMINI BRIDGE] Sincronizando llaves dinámicas...");
            const liveKeys = await window.electron.getEnvKeys();
            const pool = [...new Set([
                liveKeys.VITE_GEMINI_API_KEY_1,
                liveKeys.VITE_GEMINI_API_KEY_2,
                liveKeys.VITE_GEMINI_API_KEY_3,
                liveKeys.VITE_GEMINI_API_KEY_4,
                liveKeys.VITE_GEMINI_API_KEY_5,
                liveKeys.VITE_GEMINI_API_KEY_6
            ].filter(k => k && k.trim() && k.length > 20))];
            
            if (pool.length > 0) {
                API_KEYS.length = 0;
                API_KEYS.push(...pool);
                console.log(`✅ [GEMINI BRIDGE] Pool actualizado con ${API_KEYS.length} llaves reales.`);
            } else {
                console.error("❌ [GEMINI BRIDGE] NO SE ENCONTRARON LLAVES EN EL .ENV");
            }
        }
    } catch (e) {
        console.warn("⚠️ [GEMINI BRIDGE] Fallo en sincronización:", e.message);
    }
    keysInitialized = true;
};

let currentKeyIndex = 0;
const getNextKey = () => {
    currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
    return API_KEYS[currentKeyIndex];
};
const getCurrentKey = () => API_KEYS[currentKeyIndex] || "";
const getCurrentIndex = () => currentKeyIndex;

// Verifica si una llave está en "enfriamiento" (v19.6)
const isKeyAvailable = (key) => {
    const cooldown = KEY_COOLDOWNS.get(key);
    if (!cooldown) return true;
    if (Date.now() > cooldown) {
        KEY_COOLDOWNS.delete(key);
        return true;
    }
    return false;
};

const markKeyCooldown = (key) => {
    console.warn(`⏳ Marcando llave (...${key.slice(-4)}) en enfriamiento por 60s`);
    KEY_COOLDOWNS.set(key, Date.now() + 60000);
};

// Exponer para el widget de Gemini en Dashboard
export const getActiveKeyInfo = () => ({
    totalKeys: API_KEYS.length,
    activeIndex: currentKeyIndex + 1,
    keyPreview: getCurrentKey().slice(-6),
    keysAvailable: API_KEYS.filter(isKeyAvailable).length
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
ACTÚA COMO UN LIQUIDADOR DE SEGUROS EXPERTO.
Analiza esta Póliza de Seguros y extrae los datos en formato JSON puro.
${hints ? `PISTAS DE LA COMPAÑÍA:\n${hints}\n` : ""}

REGLAS POR COMPAÑÍA:
- BARBUSS: Si identificas "BARBUSS" o el CUIT 30715786644, normaliza la compañía como "BARBUSS RISK SA". Para Barbuss, busca la tabla horizontal con los títulos: "SUMA ASEGURADA", "PRIMA", "RECARGO FINANCIERO", "I.V.A.", "IMP. Y SELLADOS" y "PREMIO TOTAL". Toma los valores de la fila inferior.
- FEDERACION PATRONAL: Cuadro "Detalle de la póliza".
- GALICIA SEGUROS: Pág 1 debajo del logo.
- ZURICH: Pág 1 logo y domicilio Cerrito 1010.

FORMATO DECIMAL: De "67.842,97" a 67842.97. (Quita puntos de miles, usa punto para decimal). NUNCA devuelvas 0.

JSON ESPERADO:
{
    "clientName": "...",
    "dni": "...",
    "address": "...",
    "policyNumber": "...",
    "company": "BARBUSS RISK SA", 
    "riskType": "Autos" | "Motos" | "Otros",
    "startDate": "YYYY-MM-DD",
    "endDate": "YYYY-MM-DD",
    "prima": 0,
    "premio": 0,
    "insuredSum": 0,
    "currency": "ARS",
    "riskDetails": {
        "vehicle": { "brand": "...", "model": "...", "plate": "...", "year": "..." }
    }
}
RETORNA SOLO JSON.
`;

const PROMPT_MAPPED_POLICY = (mappedText) => {
    let comp = "FEDERACION PATRONAL";
    if(mappedText.includes("EXPERTA")) comp = "EXPERTA";
    if(mappedText.includes("GALICIA")) comp = "GALICIA SEGUROS";
    if(mappedText.includes("BARBUSS")) comp = "BARBUSS";

    return `
Analiza estos fragmentos de texto EXTRAÍDOS POR COORDENADAS de una Póliza de ${comp} y reconstruye el objeto JSON.
Los datos vienen de áreas específicas del documento (Heat Mapping).

REGLAS GENERALES DE EXTRACCIÓN:
1. CLIENTE: El nombre real (ej: JUAN CRUZ MARDARAZ) está EXACTAMENTE UNA LÍNEA ABAJO del encabezado "ASEGURADO O TOMADOR".
2. DNI: Captura los dígitos al lado de "DNI" en el bloque del asegurado.
3. TABLA DE COSTOS:
   - Toma el valor debajo de "SUMA ASEGURADA" para insuredSum.
   - Toma el valor debajo de "PRIMA" para prima.
   - Toma el valor debajo de "PREMIO TOTAL" para premio.
4. DECIMALES: De "67.842,97" a 67842.97 obligatoriamente. NUNCA devuelvas 0 si hay un valor presente.
5. COMPAÑÍA: Identifica la compañía real (ej: BARBUSS RISK SA, ZURICH, FEDERACION).
6. EXCLUSIÓN: El nombre "RODAS GUSTAVO RAUL" es el productor. Si aparece como cliente, deja clientName vacío.

TEXTO MAREADO:
${mappedText}

JSON ESPERADO:
{
    "clientName": "...",
    "dni": "...",
    "policyNumber": "...",
    "company": "...",
    "riskType": "Autos",
    "startDate": "YYYY-MM-DD",
    "endDate": "YYYY-MM-DD",
    "prima": 0,
    "premio": 0,
    "insuredSum": 0,
    "riskDetails": { "vehicle": { "brand": "...", "model": "...", "plate": "...", "year": "..." } }
}
RETORNA ÚNICAMENTE JSON.
`;
};

// Prompt para análisis visual (Scanned Heat Mapping)
const PROMPT_VISUAL_MAPPED = (comp = "FEDERACION PATRONAL") => `
Analiza estas IMÁGENES de una Póliza de ${comp}.
Extrae la información con PRECISIÓN ABSOLUTA.

REGLAS CRÍTICAS DE IDENTIDAD:
1. ASEGURADO: Busca específicamente el texto "ASEGURADO O TOMADOR". El nombre real está en la línea SIGUIENTE.
2. POLIZA: Recuadro "PÓLIZA N°" (ej: 1035513).
3. COSTOS: Busca la tabla con títulos "SUMA ASEGURADA", "PRIMA" y "PREMIO TOTAL".
   - REGLA DECIMAL: Si ves "67.842,97", devuelve 67842.97. NUNCA devuelvas 0.
4. VEHÍCULO: Busca Marca, Modelo, Patente en la sección "DESCRIPCIÓN DEL VEHÍCULO ASEGURADO".
5. COMPAÑÍA: Identifica la aseguradora real.

JSON REQUERIDO:
{
    "clientName": "...",
    "dni": "...",
    "policyNumber": "...",
    "riskType": "Autos" | "Motos" | "AP",
    "company": "...",
    "startDate": "YYYY-MM-DD",
    "endDate": "YYYY-MM-DD",
    "prima": 0,
    "premio": 0,
    "insuredSum": 0,
    "riskDetails": { "vehicle": { "brand": "...", "model": "...", "plate": "...", "year": "..." } }
}
RETORNA SOLO JSON.
`;

/**
 * Clasificación ultra-rápida de imagen (para detectar logo/empresa)
 */
export async function classifyImage(base64Image) {
    await initializeDynamicKeys();
    const prompt = "Analiza el encabezado de esta póliza (Logo/Texto). Responde estrictamente con este formato JSON: { \"company\": \"FEDERACION\" | \"EXPERTA\" | \"GALICIA\" | \"BARBUSS\" | \"ZURICH\" | \"OTRA\" }. Identifica la aseguradora.";
    try {
        const result = await _callGemini(prompt, base64Image);
        const company = (result.data?.company || "").toUpperCase();
        console.log("📷 [CLASSIFY RESULT]:", company);
        return company;
    } catch (e) {
        console.error("❌ Error en classifyImage:", e);
        return "ERROR";
    }
}

/**
 * Análisis de múltiples fragmentos visuales (Heat Map Scanned)
 */
export async function analyzeVisualMappedPolicy(imageSnippets, companyType = "FEDERACION") {
    await initializeDynamicKeys();
    let fullComp = "FEDERACION PATRONAL";
    if (companyType === "GALICIA_SEGUROS") fullComp = "GALICIA SEGUROS";
    if (companyType.startsWith("EXPERTA")) fullComp = "EXPERTA";
    if (companyType === "BARBUSS") fullComp = "BARBUSS";

    const prompt = PROMPT_VISUAL_MAPPED(fullComp);
    console.log(`🚀 [VISUAL ENGINE] Procesando con el nuevo motor de rotación v5...`);
    
    // Usamos _callGemini pero pasando imágenes en el prompt o similar
    // Para simplificar y unificar, convertimos snippets a un pseudo-archivo o los pasamos uno a uno?
    // Mejor aún: _callGemini ahora soporta multimodal. Pero aquí tenemos MÚLTIPLES imágenes.
    
    // Adaptación para Múltiples Imágenes usando el pool robusto:
    try {
        const result = await _callGeminiMultimodal(prompt, imageSnippets);
        return {
            ...result,
            usageMetadata: { ...result.usageMetadata, engine: 'Gemini-Visual' }
        };
    } catch (e) {
        console.error("❌ Fallo total en Visual Mapped:", e.message);
        throw e;
    }
}

// Nueva versión de call robusta para múltiples archivos (v5)
async function _callGeminiMultimodal(prompt, imagesMap) {
    if (_isWeb()) return _callGeminiProxy(prompt, null, imagesMap);
    await initializeDynamicKeys();
    const contents = [prompt];
    for (const [key, b64] of Object.entries(imagesMap)) {
        contents.push({
            inlineData: {
                data: b64.includes(',') ? b64.split(',')[1] : b64,
                mimeType: 'image/jpeg'
            }
        });
    }

    let attemptsTotal = 0;
    const maxGlobalAttempts = API_KEYS.length * 2;
    let lastError = null;

    while (attemptsTotal < maxGlobalAttempts) {
        const apiKey = getCurrentKey();
        const keyLabel = `Key#${getCurrentIndex() + 1}(...${apiKey.slice(-4)})`;
        let keyFailed = false;

        for (const modelName of GEMINI_MODELS) {
            try {
                attemptsTotal++;
                console.log(`📡 [VISUAL] Intento ${attemptsTotal} | ${keyLabel} | Modelo: ${modelName}`);
                const genAI = new GoogleGenerativeAI(apiKey);
                const model = genAI.getGenerativeModel({ model: modelName });

                const result = await model.generateContent(contents);
                const response = await result.response;
                const text = response.text();
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                
                return {
                    data: JSON.parse(jsonMatch ? jsonMatch[0] : "{}"),
                    usageMetadata: { 
                        modelUsed: modelName, 
                        totalTokens: response.usageMetadata?.totalTokenCount || 1000,
                        promptTokens: response.usageMetadata?.promptTokenCount || 800,
                        candidateTokens: response.usageMetadata?.candidatesTokenCount || 200,
                        engine: 'Gemini-Visual'
                    }
                };
            } catch (error) {
                lastError = error;
                const isQuota = error?.status === 429 || error.message.includes('quota');
                if (isQuota) {
                    console.warn(`⏳ [VISUAL QUOTA] ${modelName} en ${keyLabel} saturado. Probando siguiente modelo...`);
                    continue; 
                }
                const isModelUnavailable = error.status === 404 || error.message.includes('not found');
                if (isModelUnavailable) {
                    console.warn(`🛑 [VISUAL MODEL] ${modelName} no disponible. Probando siguiente...`);
                    continue;
                }
                console.error(`⚠️ Error crítico en ${keyLabel}: ${error.message}`);
                keyFailed = true;
                break; 
            }
        }
        getNextKey();
        await new Promise(r => setTimeout(r, 1000));
    }
    throw lastError || new Error("Saturación visual.");
}



// Model priority list (Auto-failover) - VERIFIED MODELS ONLY (v19.5)
const GEMINI_MODELS = [
    "gemini-2.5-flash",
    "gemini-flash-latest"
];

// Detecta si estamos en browser web (no Electron)
const _isWeb = () => typeof window !== 'undefined' && !window?.electron?.getEnvKeys;

// Proxy seguro: llama a /api/gemini en Vercel (keys ocultas server-side)
async function _callGeminiProxy(prompt, pdfBase64, imagesMap) {
    const body = { prompt };
    if (pdfBase64)  body.pdfBase64  = pdfBase64;
    if (imagesMap)  body.imagesMap  = imagesMap;

    const resp = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
        throw new Error(err.error || `Proxy error ${resp.status}`);
    }
    return resp.json();
}

// Helper para llamadas a Gemini con Rotación Automática, Multi-Modelo y Reintento (v5)
async function _callGemini(prompt, fileBase64) {
    // En web usamos el proxy para no exponer las API keys en el cliente
    if (_isWeb()) return _callGeminiProxy(prompt, fileBase64, null);

    await initializeDynamicKeys();

    let inlineData = null;
    if (fileBase64) {
        const mimeType = fileBase64.includes(';') ? (fileBase64.split(';')[0].split(':')[1] || 'application/pdf') : 'application/pdf';
        inlineData = {
            data: fileBase64.includes(",") ? fileBase64.split(",")[1] : fileBase64,
            mimeType: mimeType,
        };
    }

    let finalPrompt = prompt;
    if (prompt.includes("Póliza") || prompt.includes("Asegurado")) {
        finalPrompt = prompt
            .replace(/RODAS GUSTAVO RAUL/gi, "[PRODUCTOR_REDACTED]")
            .replace(/23294824979/g, "[CUIT_REDACTED]")
            .replace(/DIEGO GERMAN TRABALON/gi, "[PRODUCTOR_REDACTED]")
            .replace(/23-29482497-9/g, "[CUIT_REDACTED]");
    }

    let lastError = null;
    let attemptsTotal = 0;
    const POOL_SIZE = API_KEYS.length;
    const MAX_CYCLES = 5; // Intentamos 5 vueltas completas al pool (v19.7)
    const maxGlobalAttempts = POOL_SIZE * MAX_CYCLES;

    console.log(`🚀 [GOD MODE] Iniciando motor con ${POOL_SIZE} llaves.`);

    while (attemptsTotal < maxGlobalAttempts) {
        const apiKey = getCurrentKey();
        const cycle = Math.floor(attemptsTotal / POOL_SIZE) + 1;
        const keyInCycle = (attemptsTotal % POOL_SIZE) + 1;
        const keyLabel = `Ciclo ${cycle}/5 | Llave ${keyInCycle}/${POOL_SIZE} (...${apiKey.slice(-4)})`;
        
        for (const modelName of GEMINI_MODELS) {
            try {
                attemptsTotal++;
                console.log(`📡 [GEMINI] ${keyLabel} | ${modelName}`);
                
                const genAI = new GoogleGenerativeAI(apiKey);
                const model = genAI.getGenerativeModel({ model: modelName }, { apiVersion: 'v1beta' });

                const content = inlineData ? [finalPrompt, { inlineData }] : [finalPrompt];
                const result = await model.generateContent(content);
                const response = await result.response;
                const text = response.text();

                const jsonMatch = text.match(/\{[\s\S]*\}/);
                const parsedData = JSON.parse(jsonMatch ? jsonMatch[0] : "{}");

                return {
                    data: jsonMatch ? parsedData : { raw: text },
                    usageMetadata: {
                        modelUsed: modelName,
                        promptTokens: response.usageMetadata?.promptTokenCount || 0,
                        candidateTokens: response.usageMetadata?.candidatesTokenCount || 0,
                        totalTokens: response.usageMetadata?.totalTokenCount || 0,
                        engine: 'Gemini God-Mode'
                    }
                };
            } catch (error) {
                lastError = error;
                const isQuota = error?.status === 429 || error?.message?.includes('429') || error?.message?.includes('quota');
                
                if (isQuota) {
                    console.warn(`⏳ [GOD MODE] Quota en ${modelName}. Saltando a siguiente llave...`);
                    break; // Salimos del for de modelos para probar OTRA LLAVE inmediatamente
                }
                
                if (error?.status === 404 || error?.message?.includes('not found')) {
                    console.warn(`🛑 [GOD MODE] ${modelName} no disponible. Probando siguiente modelo...`);
                    continue; // Siguiente modelo en la MISMA llave
                }

                console.error(`❌ [GOD MODE] Error crítico: ${error.message}`);
                break; // Siguiente llave
            }
        }

        // Rotar a la siguiente llave
        getNextKey();
        
        // Si completamos un ciclo, aplicamos delay progresivo
        if (attemptsTotal % POOL_SIZE === 0) {
            const delay = cycle * 1000;
            console.warn(`🔄 [GOD MODE] Ciclo ${cycle} completado sin éxito. Esperando ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
        }
    }

    // Fallback Final con diagnóstico exhaustivo
    console.error("💀 [GOD MODE] FALLO TOTAL. Todas las llaves están saturadas.");
    const isActuallyQuota = lastError?.status === 429 || lastError?.message?.includes('429');
    if (isActuallyQuota) {
        throw new Error("Límite Crítico: Google ha bloqueado tus 6 llaves por saturación absoluta. Por favor, ESPERA 90 SEGUNDOS reales y vuelve a intentar.");
    }
    throw lastError || new Error("Error fatal en el motor God-Mode.");
}

// Master Helper que unificado para Gemini (Motor Único)
async function _callAI(prompt, fileBase64, isTextOnly = false) {
    try {
        console.log("🚀 [DUAL-ENGINE -> SINGLE] Procesando con Gemini...");
        const result = await _callGemini(prompt, isTextOnly ? null : fileBase64);
        console.log("✅ Gemini OK");
        return result;
    } catch (geminiError) {
        console.error(`❌ Error en Procesamiento AI (Gemini): ${geminiError.message}`);
        throw new Error(`Error en Procesamiento AI: ${geminiError.message}`);
    }
}

export const analyzeInvoice = async (fileBase64, companyHints = "") => {
    return _callAI(PROMPT_INVOICE(companyHints), fileBase64);
};

export const analyzePolicy = async (fileBase64, hints = "") => {
    return _callAI(PROMPT_POLICY(hints), fileBase64);
};

// Nueva función para procesamiento optimizado por coordenadas con Reducción Forzada
export const analyzeMappedPolicy = async (mappedText) => {
    // Reducción Forzada: Eliminamos los datos del productor de forma determinista 
    // para que la IA ni siquiera los vea.
    const cleanText = mappedText
        .replace(/RODAS GUSTAVO RAUL/gi, "[PRODUCTOR_REDACTED]")
        .replace(/23294824979/g, "[CUIT_REDACTED]")
        .replace(/DIEGO GERMAN TRABALON/gi, "[PRODUCTOR_REDACTED]")
        .replace(/23-29482497-9/g, "[CUIT_REDACTED]");

    console.log("🛡️ [REDACTION] Texto filtrado para evitar confusión con Productor.");
    return _callAI(PROMPT_MAPPED_POLICY(cleanText), null, true); // true indica que es solo texto, no PDF
};

export const analyzeCSV = async (textData) => {
    await initializeDynamicKeys();
    const prompt = `Analiza este texto extraído de un archivo de pólizas y retorna un ARRAY JSON puro:
[{ "clientName": string, "dni": string, "policyNumber": string, "company": string, "riskType": string, "endDate": "YYYY-MM-DD" }]
TEXTO: ${textData} `;

    let lastError = null;

    for (let i = 0; i < API_KEYS.length; i++) {
        const apiKey = getCurrentKey();
        if (!apiKey) {
            getNextKey();
            continue;
        }

        try {
            console.log(`📡 [GEMINI CSV] Intento ${i + 1}/${API_KEYS.length} | Key: ...${apiKey.slice(-6)}`);
            const genAI = new GoogleGenerativeAI(apiKey);
            const modelName = "gemini-2.5-flash";
            const model = genAI.getGenerativeModel({ model: modelName }, { apiVersion: 'v1beta' });
            
            const result = await model.generateContent(prompt);
            const text = result.response.text();
            const jsonStr = text.replace(/```json|```/g, "").trim();
            
            
            return { 
                data: JSON.parse(jsonStr), 
                usageMetadata: {
                    engine: 'Gemini-CSV',
                    modelUsed: modelName,
                    promptTokens: result.response.usageMetadata?.promptTokenCount || 0,
                    candidateTokens: result.response.usageMetadata?.candidatesTokenCount || 0,
                    totalTokens: result.response.usageMetadata?.totalTokenCount || 0
                }
            };
        } catch (e) {
            lastError = e;
            const status = e.status || (e.message?.includes('429') ? 429 : 503);
            console.warn(`⚠️ [GEMINI CSV ERROR] Falló llave ...${apiKey.slice(-6)}. Rotando... Error: ${e.message}`);
            getNextKey();
            if (status === 429 || status === 503 || e.message?.includes('quota')) {
                await new Promise(r => setTimeout(r, 1500));
            }
        }
    }

    console.error("❌ TODAS las API Keys de Gemini han fallado en CSV.");
    const finalStatus = lastError?.status || (lastError?.message?.includes('429') ? 429 : 503);
    const err = new Error(lastError?.message || "Servicio Saturado en CSV. Intente en 1 minuto.");
    err.status = finalStatus;
    throw err;
};

const PROMPT_SMART_CLASSIFIER = `
ACTÚA COMO UN EXPERTO GLOBAL EN SEGUROS (AFIP, FEDPAT, EXPERTA, GALICIA, BARBUSS, ZURICH).
Analiza TODO el documento y clasifícalo.

REGLAS MAESTRAS DE PÓLIZAS:
1. ASEGURADO (CRÍTICO): Localiza "ASEGURADO O TOMADOR". El nombre completo del cliente está en la LÍNEA SIGUIENTE de texto. Ignora al productor.
2. DNI: Texto "DNI" seguido de números en el mismo bloque.
3. COSTOS: Busca la tabla horizontal inferior que dice "SUMA ASEGURADA", "PRIMA", ..., "PREMIO TOTAL". Los valores son los números de la fila de abajo.
   - REGLA DECIMAL: "67.842,97" -> 67842.97.
4. VEHÍCULO: Debajo de "DESCRIPCIÓN DEL VEHÍCULO ASEGURADO" extrae Marca, Modelo, Patente y Año.
5. COMPAÑÍA: Identifica la aseguradora real (Zurich, Barbuss Risk SA, etc).
6. PÓLIZA: Recuadro "PÓLIZA N°" arriba.

REGLAS MAESTRAS DE FACTURAS/LIQUIDACIONES:
- cuit: Busca el CUIT de la Razón Social EMISORA en la mitad del documento (donde están los datos del cliente/receptor).
- company: Razón social del receptor del pago.
- amount: Importe total de la operación (Decimal).
- period: Identifica mes y año (ej: "LIQUIDACION 05/2026").

JSON ESTRUCTURA (ESTRICTO):
{
    "documentType": "POLIZA" | "FACTURA",
    "confidence": 99,
    "extractedData": {
        "clientName": "...",
        "dni": "...",
        "address": "...",
        "policyNumber": "...",
        "company": "...",
        "riskType": "Autos" | "Motos" | "ART" | "Vida" | "Otros",
        "prima": 0,
        "premio": 0,
        "insuredSum": 0,
        "startDate": "YYYY-MM-DD",
        "endDate": "YYYY-MM-DD",
        "riskDetails": {
            "vehicle": {
                "brand": "...", "model": "...", "plate": "...", "year": "...", 
                "chassis": "...", "engine": "...", "coverage": "..."
            },
            "alicuota": 0,
            "coverages": []
        },
        "number": "...", "type": "...", "date": "YYYY-MM-DD", "cuit": "...", "period": "...", "amount": 0, "pointOfSale": "..."
    }
}
RETORNA ÚNICAMENTE JSON PURO.
`;


export const smartAnalyzeFile = async (fileBase64, companyNames = []) => {
    await initializeDynamicKeys();
    const hints = companyNames.length > 0 ? companyNames.join(", ") : "";
    let finalPrompt = PROMPT_SMART_CLASSIFIER + (hints ? `\nPISTAS DE COMPAÑÍAS CONOCIDAS: ${hints} ` : "");
    
    // Aplicamos Reducción Forzada también aquí por seguridad
    finalPrompt = finalPrompt
        .replace(/RODAS GUSTAVO RAUL/gi, "[PRODUCTOR_REDACTED]")
        .replace(/23294824979/g, "[CUIT_REDACTED]");

    return _callAI(finalPrompt, fileBase64);
};

// --- OPTIMIZACIÓN v21.3 (TEXT-ONLY FLOW) ---

const PROMPT_POLICY_TEXT_ONLY = `
ACTÚA COMO UN LIQUIDADOR DE SEGUROS EXPERTO.
Analiza este texto extraído directamente de una póliza y extrae los datos en formato JSON.
El texto puede estar algo desordenado por la extracción OCR/Coordenadas, usa tu inteligencia para rearmar la estructura.

REGLAS DE IDENTIDAD:
1. CLIENTE: Busca el nombre completo (ej: JUAN PEREZ). Ignora al productor (RODAS GUSTAVO).
2. DNI: Busca el número de documento.
3. COMPAÑÍA: Identifica la aseguradora (ej: ZURICH, FEDERACION, ALLIANZ, MERCANTIL ANDINA).
4. VEHÍCULO: Extrae Marca, Modelo, Patente y Año si están disponibles.
5. COSTOS: Busca Prima y Premio Total. Formato decimal (67.842,97 -> 67842.97).
6. MONEDA: Si el texto menciona "U$S", "USD", "Dólares" o "Dólares Estadounidenses", usa "USD". Si menciona "$" o "pesos", usa "ARS".
7. RAMO: Identifica el tipo de seguro. Si ves "CONSORCIO" usa "Integral de Consorcio". Si ves "COMERCIO" e "INTEGRAL" usa "Integral de Comercio". Si ves "ACCIDENTE" usa "Accidentes Personales". Si ves "CAUCION" usa "Caución". Si ves "HOGAR" o "COMBINADO FAMILIAR" usa "Combinado Familiar".

TEXTO EXTRAÍDO:
{{EXTRACTED_TEXT}}

JSON ESPERADO:
{
    "clientName": "...",
    "dni": "...",
    "policyNumber": "...",
    "company": "...",
    "riskType": "Autos" | "Motos" | "Vida" | "Accidentes Personales" | "Caución" | "Integral de Consorcio" | "Integral de Comercio" | "Combinado Familiar" | "Otros",
    "startDate": "YYYY-MM-DD",
    "endDate": "YYYY-MM-DD",
    "prima": 0,
    "premio": 0,
    "insuredSum": 0,
    "currency": "ARS",
    "riskDetails": { "vehicle": { "brand": "...", "model": "...", "plate": "...", "year": "..." } }
}
RETORNA SOLO JSON.
`;

export const analyzePolicyTextOnly = async (extractedText) => {
    const cleanText = extractedText
        .replace(/RODAS GUSTAVO RAUL/gi, "[PRODUCTOR_REDACTED]")
        .replace(/23294824979/g, "[CUIT_REDACTED]");

    const finalPrompt = PROMPT_POLICY_TEXT_ONLY.replace("{{EXTRACTED_TEXT}}", cleanText);
    return _callAI(finalPrompt, null, true);
};

// --- SMG SEGUROS — ACCIDENTES PERSONALES COLECTIVO ---

const PROMPT_SMG_AP = (extractedText) => `
ACTÚA COMO LIQUIDADOR EXPERTO EN PÓLIZAS DE ACCIDENTES PERSONALES COLECTIVAS (SMG / SWISS MEDICAL SEGUROS).
Analiza el texto extraído de las páginas clave de la póliza y reconstruye la estructura de datos.

REGLAS DE EXTRACCIÓN:
1. TOMADOR (clientName): El nombre completo del contratante. Aparece antes del primer "Item:". Puede ser una persona o empresa.
2. DNI del tomador: Busca el número de 8 dígitos en el bloque del tomador.
3. PÓLIZA (policyNumber): Número después de "Póliza-Endoso:" o "Póliza:" (ej: 960911-0).
4. VIGENCIA: Dos fechas dd/mm/yyyy = startDate y endDate.
5. ASEGURADOS (insuredPersons): Array con TODOS los ítems numerados "Item: N Descripción:".
   - name: nombre completo de la persona (ej: "FACUNDO JULIAN VUELTA")
   - dni: número de DNI de 7 u 8 dígitos del asegurado
   - nacimiento: fecha de nacimiento en formato DD/MM/YYYY
   - usaMoto: true si "USO DE MOTO: SI", false si "NO"
   - amount: suma asegurada de esa persona (tomar el mayor valor, ej: 8640000)
6. PREMIO (premio): Valor de "Premio Total" o "PREMIO".
7. PRIMA (prima): Valor de "Prima Tarifa" o "Prima".
8. SUMA TOTAL (insuredSum): Suma asegurada total de la póliza (todos los asegurados).
9. COMPAÑÍA: Siempre "SMG SEGUROS".
10. RAMO: Siempre "Accidentes Personales".

FORMATO DECIMAL: "8.640.000,00" → 8640000. "139.485,76" → 139485.76. NUNCA devuelvas 0 si hay valor.
EXCLUSIÓN: "[PRODUCTOR_REDACTED]" es el productor, no el tomador. Si aparece como clientName, dejarlo vacío.

TEXTO EXTRAÍDO:
${extractedText.replace(/RODAS GUSTAVO RAUL/gi, "[PRODUCTOR_REDACTED]").replace(/23294824979/g, "[CUIT_REDACTED]")}

JSON ESPERADO:
{
  "clientName": "...",
  "dni": "...",
  "address": "...",
  "policyNumber": "...",
  "company": "SMG SEGUROS",
  "riskType": "Accidentes Personales",
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "prima": 0,
  "premio": 0,
  "insuredSum": 0,
  "currency": "ARS",
  "riskDetails": {
    "insuredPersons": [
      { "name": "...", "dni": "...", "nacimiento": "DD/MM/YYYY", "usaMoto": false, "amount": 0 }
    ]
  }
}
RETORNA SOLO JSON PURO.
`;

export const analyzeSMGPolicy = async (extractedText) => {
    const finalPrompt = PROMPT_SMG_AP(extractedText);
    return _callAI(finalPrompt, null, true);
};

// --- SMG SEGUROS — CAUCIÓN ---

const PROMPT_SMG_CAUCION = (extractedText) => `
ACTÚA COMO LIQUIDADOR EXPERTO EN PÓLIZAS DE SEGURO DE CAUCIÓN (SMG / SWISS MEDICAL SEGUROS).
Analiza el texto extraído de la póliza de caución y extrae los datos del TOMADOR (el cliente que contrató la garantía).

REGLAS DE EXTRACCIÓN:
1. CLIENTE (clientName): El nombre que figura como "el Tomador" — NO el Asegurado/beneficiario (ej: ENACOM es el asegurado, NO el cliente).
2. CUIT (dni): El C.U.I.T. del Tomador (con guiones, ej: 30-57143756-9).
3. DOMICILIO (address): Domicilio del Tomador.
4. PÓLIZA (policyNumber): Número de póliza (ej: 708780-26).
5. COMPAÑÍA: Siempre "SMG SEGUROS".
6. RAMO: Siempre "Caución".
7. SUMA ASEGURADA (insuredSum): El monto garantizado. Busca "$" seguido de un importe, o el campo "SUMA ASEGURADA". (ej: $ 500,000.00 → 500000).
8. PRIMA (prima): Valor de "Prima" en la liquidación/factura.
9. PREMIO (premio): Valor de "PREMIO" total en la factura.
10. VIGENCIA DESDE (startDate): Fecha de inicio de vigencia (Vigencia desde / desde las 00:00 hs. del).
11. VIGENCIA HASTA (endDate): Si es indefinida ("hasta extinción..."), usar la fecha de vencimiento de la factura o de la cuota de pago.
12. FORMATO DECIMAL: "500.000,00" → 500000. "18.000,00" → 18000. NUNCA devuelvas 0 si hay valor en el texto.
13. EXCLUSIÓN: "[PRODUCTOR_REDACTED]" es el productor, no el cliente. El Asegurado/beneficiario (ej: ENACOM) tampoco es el cliente.

TEXTO EXTRAÍDO:
${extractedText.replace(/RODAS GUSTAVO RAUL/gi, "[PRODUCTOR_REDACTED]").replace(/23294824979/g, "[CUIT_REDACTED]")}

JSON ESPERADO:
{
  "clientName": "...",
  "dni": "...",
  "address": "...",
  "policyNumber": "...",
  "company": "SMG SEGUROS",
  "riskType": "Caución",
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "prima": 0,
  "premio": 0,
  "insuredSum": 0,
  "currency": "ARS"
}
RETORNA SOLO JSON PURO.
`;

export const analyzeSMGCaucionPolicy = async (extractedText) => {
    const finalPrompt = PROMPT_SMG_CAUCION(extractedText);
    return _callAI(finalPrompt, null, true);
};

// --- MERCANTIL ANDINA — INTEGRAL DE CONSORCIO / INTEGRAL DE COMERCIO ---

const PROMPT_MERCANTIL_INTEGRAL = (extractedText) => `
ACTÚA COMO LIQUIDADOR EXPERTO EN PÓLIZAS DE SEGUROS PATRIMONIALES ARGENTINAS.
Analiza el texto de esta póliza de COMPAÑIA DE SEGUROS LA MERCANTIL ANDINA S.A. y extrae todos los datos.

REGLAS DE EXTRACCIÓN:
1. CLIENTE (clientName): El nombre del Asegurado/Tomador. NO es el productor ni el beneficiario.
2. DNI/CUIT (dni): CUIT o DNI del asegurado (sin guiones, solo números).
3. PÓLIZA (policyNumber): Número de póliza completo (ej: 010-P-00001234).
4. RAMO (riskType): "Integral de Consorcio" si el texto menciona CONSORCIO, o "Integral de Comercio" si menciona COMERCIO.
5. COMPAÑÍA: Siempre "MERCANTIL ANDINA".
6. VIGENCIA: startDate y endDate en formato YYYY-MM-DD.
7. MONEDA (currency): CRÍTICO — Las pólizas de Integral de Consorcio/Comercio de Mercantil Andina están pactadas en DÓLARES ESTADOUNIDENSES. Si el texto menciona "U$S", "USD", "Dólares" o muestra sumas grandes como "13.000.000", usa "USD". Solo usa "ARS" si el texto EXPLÍCITAMENTE dice "pesos" o muestra el símbolo "$" sin "U".
8. PRIMA (prima): Valor numérico de prima de la liquidación final de la póliza.
9. PREMIO (premio): Valor numérico de premio total de la liquidación final.

CRÍTICO — COBERTURAS DEL SUPLEMENTO ADICIONAL:
La carátula principal de la póliza dice "Según se detalla en suplemento adicional 01" para las sumas aseguradas.
Las coberturas reales y sus montos están en las páginas tituladas "SUPLEMENTO ADICIONAL" o "CONDICIONES PARTICULARES DEL SUPLEMENTO".
Busca CADA sección numerada en ese suplemento. Los tipos de cobertura típicos son:
  04 INCENDIO — ítems: Edificio, Contenido General Partes Comunes, RC Linderos
  07 CRISTALES — ítems: Piezas partes comunes
  08 ROBO — ítems: Contenido general, Cámaras/porteros, Matafuegos
  09 RC COMPRENSIVA — ítem único con la suma de Responsabilidad Civil
  99 DAÑOS POR AGUA — ítems: Edificio y contenido

Para cada ítem de cada sección, genera UNA entrada en el array "coverages" con:
  - "description": "<código sección> — <descripción del ítem>" (ej: "04 INCENDIO — Edificio")
  - "amount": valor numérico de la suma asegurada (sin moneda)

El campo "insuredSum" debe ser el valor numérico del ítem MÁS GRANDE (generalmente INCENDIO — Edificio).
El campo "riskDetails.cotizacion" es el tipo de cambio USD/ARS de la carátula (ej: 1415.0000).

FORMATO DECIMAL ARGENTINO: "13.000.000" → 13000000. "264.806" → 264806. "8.000" → 8000. NUNCA devuelvas 0 si hay valor presente.
EXCLUSIÓN: "[PRODUCTOR_REDACTED]" es el productor, no el asegurado. Si aparece como clientName, dejar vacío.

TEXTO EXTRAÍDO:
${extractedText.replace(/RODAS GUSTAVO RAUL/gi, "[PRODUCTOR_REDACTED]").replace(/23294824979/g, "[CUIT_REDACTED]")}

JSON ESPERADO:
{
  "clientName": "...",
  "dni": "...",
  "address": "...",
  "policyNumber": "...",
  "company": "MERCANTIL ANDINA",
  "riskType": "Integral de Consorcio",
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "prima": 0,
  "premio": 0,
  "insuredSum": 13000000,
  "currency": "USD",
  "riskDetails": {
    "cotizacion": 1415,
    "coverages": [
      { "description": "04 INCENDIO — Edificio", "amount": 13000000 },
      { "description": "04 INCENDIO — Contenido General Partes Comunes", "amount": 8000 },
      { "description": "04 INCENDIO — RC Linderos", "amount": 20000 },
      { "description": "07 CRISTALES — Piezas partes comunes", "amount": 2000 },
      { "description": "08 ROBO — Contenido general", "amount": 2100 },
      { "description": "09 RC COMPRENSIVA", "amount": 264806 },
      { "description": "99 DAÑOS POR AGUA — Edificio y contenido", "amount": 3600 }
    ]
  }
}
RETORNA SOLO JSON PURO.
`;

export const analyzeMercantilIntegralPolicy = async (extractedText) => {
    const finalPrompt = PROMPT_MERCANTIL_INTEGRAL(extractedText);
    return _callAI(finalPrompt, null, true);
};

// ─────────────────────────────────────────────
// IIBB - Certificados de Retención
// ─────────────────────────────────────────────

const PROMPT_IIBB_CERTIFICADO = `Sos un experto contable argentino especializado en certificados de retención de IIBB (Ingresos Brutos) para importar en SIFERE WEB.
Analizá TODAS las páginas de este documento y devolvé un JSON con el array de retenciones de IIBB.

═══════════════════════════════════════
QUÉ INCLUIR Y QUÉ EXCLUIR
═══════════════════════════════════════
INCLUIR (son IIBB):
- "I B Cap.Fed.", "I B Bs.As.", "Ret. IIBB Capital Federal", "INGRESOS BRUTOS"
- Filas con Ubicación: CAPITAL FEDERAL, BUENOS AIRES

EXCLUIR (NO son IIBB):
- "Ret. OSSEG", "OSSEG CCP", "Retención ANSSAL", "Retención Obra Social de Seguro", "Servicios Sociales"

═══════════════════════════════════════
REGLAS POR COMPAÑÍA
═══════════════════════════════════════

MERCANTIL ANDINA (formato resumen mensual):
- Tiene tabla con filas individuales. Cada fila "I B Cap.Fed. CCP" es un registro. Cada fila "I B Bs.As. CCP" es otro registro.
- "fecha" = columna "Fecha de Pago" de esa fila (formato DD.MM.AAAA → convertir a DD/MM/AAAA)
- "certificado" = columna "Nº Certif." de esa fila (ej: 0000935341 → "935341", sin ceros iniciales)
- "monto" = columna "Importe Retenido" de esa fila individual. NUNCA uses "Total I B Cap.Fed." ni "Total General".
- CUIT del agente: 30500036911

ALLIANZ (formato por comprobante quincenal):
- Número de "Comprobante" está en el encabezado. Es el mismo para todas las filas.
- La tabla tiene filas por Ubicación: BUENOS AIRES → jurisdicción 902, CAPITAL FEDERAL → jurisdicción 901.
- Cada fila es un registro SEPARADO con el mismo número de Comprobante.
- "fecha" = fecha del encabezado del documento (ej: "Buenos Aires, 15 de Febrero de 2025" → "15/02/2025")
- "monto" = columna "Imp. Retenido" de esa fila
- CUIT del agente: 30500037217

ZURICH (formato por página, cada página = un certificado):
- Cada página tiene un "Nº de certificado" y una "Clase de documento" diferente.
- SOLO incluir páginas donde la Clase de documento sea "Ret. IIBB Capital Federal" o "Ret. IIBB Bs.As." — excluir "Retención ANSSAL", "Retención Obra Social de Seguro".
- "certificado" = el "Nº de certificado" de esa página (ej: 000100293053)
- "fecha" = campo "Fecha" del encabezado (formato DD.MM.AAAA → convertir a DD/MM/AAAA)
- "monto" = columna "Retenido" del total de esa página
- "jurisdiccion" = "901" si dice "Capital Federal" o "CAPITAL", "902" si dice "Buenos Aires" o "Bs.As."
- CUIT del agente: 30500049770

AMCA / ASOCIACION MUTUAL DE CONDUCTORES DE AUTOMOTORES:
- Un solo certificado por PDF.
- "certificado" = campo "N° certificado" (puede tener punto como separador de miles: "59.157" → "59157")
- "fecha" = campo "Lugar y fecha" (ej: "Buenos Aires, 03/03/2026" → "03/03/2026")
- "monto" = campo "Importe retenido en $"
- "jurisdiccion" = "902" si la localidad dice "Provincia de Buenos Aires", "901" si dice "Capital Federal" o "CABA"
- CUIT del agente: 30605659981

EXPERTA ART (formato por página, cada página IIBB = un certificado):
- La página 1 es "Orden de Pago" (resumen) — NO es un certificado, ignorar.
- Las páginas con "CONSTANCIA DE RETENCION - IMPUESTO A LOS INGRESOS BRUTOS" SÍ son IIBB — incluir.
- Las páginas con "CERTIFICADO DE RETENCION SERVICIOS SOCIALES" NO son IIBB — excluir.
- "certificado" = campo "Número" de esa página (ej: 142397, 212632)
- "fecha" = campo "Fecha" de esa página (DD/MM/AAAA)
- "monto" = monto de retención de esa página (formato argentino: "3.414,84" → 3414.84)
- "jurisdiccion" = "902" si dice "Provincia B BUENOS AIRES" o "B BUENOS AIRES", "901" si dice "Provincia C CIUDAD AUT. DE BS.AS" o "C CIUDAD AUT."
- CUIT del agente: 30687156168

SWISS MEDICAL ART S.A. / SMG ART (formato multi-página, una retención por página IIBB):
- Emisor: "SWISS MEDICAL ART S.A." — CUIT del agente: 33686262869
- "compania" para estos registros: SIEMPRE "SMG ART" (nunca "SMG SEGUROS" ni "SWISS MEDICAL ART")
- Cada página tiene un tipo identificado en el encabezado derecho: "Osseg Productores", "IIBB Prod Pcia Bs As", "IIBB Prod Capital Federal".
- INCLUIR SOLO páginas con tipo "IIBB Prod Pcia Bs As" o "IIBB Prod Capital Federal".
- EXCLUIR páginas con tipo "Osseg Productores" — NO son IIBB.
- "certificado" = campo "Nº de certificado" de esa página (ej: "0001-00178198" → eliminar guiones → "000100178198")
- "fecha" = campo "Fecha:" del encabezado derecho (formato DD.MM.AAAA → convertir a DD/MM/AAAA)
- "monto" = columna "Retenido" del total de esa página (ej: "505.27 ARS" → 505.27)
- "jurisdiccion" = "902" si el tipo dice "Pcia Bs As" o "Buenos Aires", "901" si dice "Capital Federal"
- ATENCIÓN: SMG Cia Argentina de Seguros S.A. (CUIT 30500031960, también llamada "SMG SEGUROS") es una empresa DISTINTA — emite SOLO retenciones OSSEG, NO IIBB. Si el PDF es de esa empresa, devolver array vacío.

FEDERACION PATRONAL (formato por página, cada página = una jurisdicción):
- Cada página tiene en el encabezado "COMPROBANTE DE RETENCION IMPUESTO SOBRE LOS INGRESOS BRUTOS JURISDICCION [nombre]"
- "jurisdiccion" = "901" si el encabezado dice "CIUDAD AUTONOMA DE BUENOS AIRES", "902" si dice "BUENOS AIRES" (sin "CIUDAD AUTONOMA")
- "certificado" = campo "Número Comprobante" de esa página (ej: 0001-2025-214999 → solo dígitos: "20252149990001" — o bien extraer los dígitos relevantes: "214999")
- "fecha" = campo "Lugar y Fecha" (ej: "La Plata, 10 de Marzo de 2025" → "10/03/2025")
- "monto" = monto de retención de esa página (formato americano con coma: "2,106.98" → 2106.98)
- CUIT del agente: 33707366589

═══════════════════════════════════════
CAMPOS DE CADA REGISTRO
═══════════════════════════════════════
- "compania": nombre corto (ej: "MERCANTIL ANDINA", "ALLIANZ", "ZURICH", "AMCA", "EXPERTA ART", "FEDERACION PATRONAL", "SMG ART")
- "cuit": 11 dígitos sin guiones del agente de retención (la compañía emisora)
- "fecha": DD/MM/AAAA
- "certificado": solo dígitos, sin guiones, sin ceros a la izquierda ni puntos separadores
- "jurisdiccion": "901" o "902"
- "monto": número decimal con punto (ej: 1175.85), sin $ ni separadores de miles

DEVOLVÉ SOLO este JSON puro, sin markdown, sin texto adicional:
{
  "retenciones": [
    {"compania":"MERCANTIL ANDINA","cuit":"30500036911","fecha":"06/03/2025","certificado":"935341","jurisdiccion":"901","monto":1175.85}
  ]
}`;

export const analyzeIIBBCertificate = async (pdfBase64) => {
    const result = await _callGemini(PROMPT_IIBB_CERTIFICADO, pdfBase64);
    // _callGemini envuelve la respuesta en { data: parsedJSON, usageMetadata: {...} }
    // Hay que extraer result.data para llegar al JSON real de Gemini
    const data = result?.data ?? result;
    if (data && Array.isArray(data.retenciones)) return data.retenciones;
    // Fallback: buscar cualquier valor que sea un array
    const arr = Object.values(data || {}).find(v => Array.isArray(v));
    if (arr) return arr;
    // Último recurso: si devolvió un objeto individual, lo envolvemos en array
    if (data && data.cuit) return [data];
    return [];
};
