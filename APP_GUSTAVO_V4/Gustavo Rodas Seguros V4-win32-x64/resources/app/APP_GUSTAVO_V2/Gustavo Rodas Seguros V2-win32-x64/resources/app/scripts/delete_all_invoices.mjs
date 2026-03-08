// Usando fetch nativo de Node.js v24+

// Configuración
const FIREBASE_API_KEY = "AIzaSyBHR2EoNpjGIanQpMxWB7wXW9gAMmNuXvM";
const PROJECT_ID = "finanzastg";
const COLLECTION = "invoices";

async function deleteAllDocuments() {
    console.log(`🚀 Iniciando borrado completo de la colección: ${COLLECTION}...`);

    // 1. Obtener todos los documentos
    const listUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${COLLECTION}?key=${FIREBASE_API_KEY}&pageSize=500`;

    try {
        const response = await fetch(listUrl);
        const data = await response.json();

        if (!data.documents || data.documents.length === 0) {
            console.log("✅ No se encontraron documentos para borrar.");
            return;
        }

        console.log(`📦 Encontrados ${data.documents.length} documentos. Borrando...`);

        // 2. Borrar cada documento
        for (const doc of data.documents) {
            const docPath = doc.name; // El nombre ya contiene path completo
            const deleteUrl = `https://firestore.googleapis.com/v1/${docPath}?key=${FIREBASE_API_KEY}`;

            const delRes = await fetch(deleteUrl, { method: 'DELETE' });
            if (delRes.ok) {
                console.log(`🗑️ Borrado: ${docPath.split('/').pop()}`);
            } else {
                console.error(`❌ Error borrando ${docPath}:`, await delRes.text());
            }
        }

        console.log("✨ ¡Limpieza completada!");

    } catch (error) {
        console.error("💥 Error fatal durante la limpieza:", error.message);
    }
}

deleteAllDocuments();
