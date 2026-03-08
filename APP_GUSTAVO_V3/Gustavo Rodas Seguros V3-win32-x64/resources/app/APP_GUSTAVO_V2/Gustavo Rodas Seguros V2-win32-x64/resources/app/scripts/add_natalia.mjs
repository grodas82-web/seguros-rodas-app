
import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, getDocs, query, where } from "firebase/firestore";

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

async function addNatalia() {
    console.log("🚀 Iniciando alta de Natalia Tegaldi...");
    try {
        const q = query(collection(db, "companies"), where("name", "==", "TEGALDI NATALIA SOL"));
        const snap = await getDocs(q);

        if (!snap.empty) {
            console.log("⚠️ La compañía ya existe.");
            return;
        }

        const newCompany = {
            name: "TEGALDI NATALIA SOL",
            cuit: "27316747162",
            ivaType: "Responsable Inscripto",
            isLoaded: false // El Dashboard calculará esto dinámicamente
        };

        const docRef = await addDoc(collection(db, "companies"), newCompany);
        console.log("✅ Natalia Tegaldi agregada con ID:", docRef.id);
    } catch (error) {
        console.error("🔥 Error:", error.message);
    }
}

addNatalia();
