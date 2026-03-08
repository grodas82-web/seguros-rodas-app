// check_data_status.mjs
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

async function checkData() {
    console.log("Checking data in Firebase project: finanzastg...");
    try {
        const pols = await getDocs(collection(db, 'policies'));
        const invs = await getDocs(collection(db, 'invoices'));
        const comps = await getDocs(collection(db, 'companies'));

        console.log(`- Policies: ${pols.size}`);
        console.log(`- Invoices: ${invs.size}`);
        console.log(`- Companies: ${comps.size}`);

        if (pols.size > 0) {
            console.log("\nSample policy clients:");
            pols.docs.slice(0, 5).forEach(doc => {
                console.log(`  - ${doc.data().clientName || 'N/A'}`);
            });
        }
    } catch (err) {
        console.error("Error checking data:", err);
    }
}

checkData();
