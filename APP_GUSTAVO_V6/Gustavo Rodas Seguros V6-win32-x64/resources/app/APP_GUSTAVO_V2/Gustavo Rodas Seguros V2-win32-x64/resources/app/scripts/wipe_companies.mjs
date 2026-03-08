import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, deleteDoc, doc, writeBatch } from "firebase/firestore";

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

async function wipeCompanies() {
    console.log("🚀 Iniciando borrado total de compañías...");
    const querySnapshot = await getDocs(collection(db, "companies"));
    const total = querySnapshot.size;

    if (total === 0) {
        console.log("✅ No hay compañías para borrar.");
        return;
    }

    const batch = writeBatch(db);
    querySnapshot.forEach((d) => {
        batch.delete(doc(db, "companies", d.id));
    });

    await batch.commit();
    console.log(`✅ Éxito: Se eliminaron ${total} compañías.`);
}

wipeCompanies();
