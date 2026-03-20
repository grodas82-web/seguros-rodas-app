// Vercel Serverless Function — Proxy seguro para Gemini AI
// Las API keys viven aquí (server-side) y NUNCA se exponen al cliente.

import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-flash-latest'];

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { prompt, pdfBase64, imagesMap } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    // Keys server-side (sin prefijo VITE_ → nunca llegan al bundle del cliente)
    const keys = [
        process.env.GEMINI_API_KEY_1,
        process.env.GEMINI_API_KEY_2,
        process.env.GEMINI_API_KEY_3,
        process.env.GEMINI_API_KEY_4,
        process.env.GEMINI_API_KEY_5,
        process.env.GEMINI_API_KEY_6,
    ].filter(k => k && k.trim() && k.length > 20);

    if (!keys.length) {
        return res.status(500).json({ error: 'No hay API keys configuradas en el servidor. Configurá GEMINI_API_KEY_1…6 en Vercel → Settings → Environment Variables.' });
    }

    let lastError = null;

    for (let ki = 0; ki < keys.length; ki++) {
        const apiKey = keys[ki];

        for (const modelName of GEMINI_MODELS) {
            try {
                const genAI = new GoogleGenerativeAI(apiKey);
                const model = genAI.getGenerativeModel({ model: modelName }, { apiVersion: 'v1beta' });

                let content;

                if (imagesMap && Object.keys(imagesMap).length > 0) {
                    // Modo multimodal (varias imágenes)
                    content = [prompt];
                    for (const b64 of Object.values(imagesMap)) {
                        content.push({
                            inlineData: {
                                data: b64.includes(',') ? b64.split(',')[1] : b64,
                                mimeType: 'image/jpeg',
                            },
                        });
                    }
                } else if (pdfBase64) {
                    // Modo PDF
                    const mimeType = pdfBase64.includes(';')
                        ? (pdfBase64.split(';')[0].split(':')[1] || 'application/pdf')
                        : 'application/pdf';
                    content = [
                        prompt,
                        {
                            inlineData: {
                                data: pdfBase64.includes(',') ? pdfBase64.split(',')[1] : pdfBase64,
                                mimeType,
                            },
                        },
                    ];
                } else {
                    content = [prompt];
                }

                const result  = await model.generateContent(content);
                const response = await result.response;
                const text     = response.text();
                const jsonMatch = text.match(/\{[\s\S]*\}/);

                return res.status(200).json({
                    data: jsonMatch ? JSON.parse(jsonMatch[0]) : { raw: text },
                    usageMetadata: {
                        modelUsed:       modelName,
                        totalTokens:     response.usageMetadata?.totalTokenCount     || 0,
                        promptTokens:    response.usageMetadata?.promptTokenCount    || 0,
                        candidateTokens: response.usageMetadata?.candidatesTokenCount || 0,
                        engine: 'Gemini-Proxy',
                    },
                });
            } catch (error) {
                lastError = error;
                const isQuota = error?.status === 429 || error?.message?.includes('quota');
                if (isQuota) break; // pasar a la siguiente key
                // otro error: probar siguiente modelo
            }
        }
    }

    return res.status(500).json({ error: lastError?.message || 'Error en Gemini API' });
}
