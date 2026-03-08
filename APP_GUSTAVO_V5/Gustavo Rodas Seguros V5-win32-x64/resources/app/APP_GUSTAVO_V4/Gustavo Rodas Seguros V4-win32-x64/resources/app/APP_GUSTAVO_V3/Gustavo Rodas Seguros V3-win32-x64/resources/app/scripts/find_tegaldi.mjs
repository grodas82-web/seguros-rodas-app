
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyBHR2EoNpjGIanQpMxWB7wXW9gAMmNuXvM",
    authDomain: "finanzastg.firebaseapp.com",
    projectId: "finanzastg",
    storageBucket: "finanzastg.firebasestorage.app",
    messagingSenderId: "980629069726",
    appId: "1:980629069726:web:0810594773af27c552c08f"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function findTegaldi() {
    console.log("🔍 Buscando facturas de Tegaldi en 'finanzastg'...");
    try {
        const q = collection(db, "invoices");
        const snap = await getDocs(q);
        const results = snap.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(inv => inv.company && inv.company.toLowerCase().includes("tegaldi"));

        if (results.length > 0) {
            console.log("✅ Encontradas:", results.map(r => ({ name: r.company, cuit: r.cuit })));
        } else {
            console.log("❌ No se encontraron facturas con 'Tegaldi' en el nombre.");
        }
    } catch (error) {
        console.error("🔥 Error:", error.message);
    }
}

findTegaldi();
