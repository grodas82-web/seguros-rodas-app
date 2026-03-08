// scripts/count_by_year.mjs
const FIREBASE_API_KEY = "AIzaSyBHR2EoNpjGIanQpMxWB7wXW9gAMmNuXvM";
const PROJECT_ID = "finanzastg";

async function countByYear() {
    console.log("📊 Analizando distribución anual de facturas...");
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/invoices?key=${FIREBASE_API_KEY}&pageSize=4000`;

    try {
        const res = await fetch(url);
        const data = await res.json();
        const docs = data.documents || [];

        const counts = {};
        docs.forEach(d => {
            const f = d.fields;
            const dateStr = f.date?.stringValue || "";
            let year = "Desconocido";
            let month = "??";

            if (dateStr.includes("-")) {
                const parts = dateStr.split("-");
                year = parts[0];
                month = parts[1];
            } else if (dateStr.includes("/")) {
                const parts = dateStr.split("/");
                year = parts[2].split(" ")[0];
                month = parts[1].padStart(2, '0');
            }

            const key = `${year}-${month}`;
            counts[key] = (counts[key] || 0) + 1;
        });

        console.log("Resultados por Mes:");
        const sortedKeys = Object.keys(counts).sort();
        const tableData = sortedKeys.map(k => ({ Month: k, Count: counts[k] }));
        console.table(tableData);
    } catch (e) {
        console.error(e.message);
    }
}

countByYear();
