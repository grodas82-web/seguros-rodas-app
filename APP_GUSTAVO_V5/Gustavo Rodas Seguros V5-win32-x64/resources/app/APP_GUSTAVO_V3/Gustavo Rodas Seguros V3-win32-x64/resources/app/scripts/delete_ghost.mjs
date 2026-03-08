import { initializeApp } from "firebase/app";
import { getFirestore, doc, deleteDoc } from "firebase/firestore";

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

async function deleteGhostPolicy() {
    try {
        console.log("Deleting ghost policy Vmh1jQ32awfiUqa9snII from policies collection...");
        await deleteDoc(doc(db, "policies", "Vmh1jQ32awfiUqa9snII"));
        console.log("Successfully deleted!");
        process.exit(0);
    } catch (e) {
        console.error("Error", e);
        process.exit(1);
    }
}

deleteGhostPolicy();
