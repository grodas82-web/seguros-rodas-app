import { initializeApp } from "firebase/app";
import { getFirestore, collection, query, orderBy, limit, getDocs } from "firebase/firestore";

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

async function checkExperta() {
    try {
        const qPolicies = query(collection(db, 'policies'), orderBy('timestamp', 'desc'), limit(5));
        const pSnap = await getDocs(qPolicies);
        console.log("--- RECENT POLICIES ---");
        pSnap.forEach(doc => {
            const data = doc.data();
            console.log(`ID: ${doc.id} | Company: ${data.company} | Client: ${data.clientName} | Risk: ${data.riskType} | Prima: ${data.prima} | Date: ${data.timestamp?.toDate ? data.timestamp.toDate() : data.timestamp}`);
            if (data.company && data.company.toUpperCase().includes('EXPERTA')) {
                console.log(JSON.stringify(data, null, 2));
            }
        });
        process.exit(0);
    } catch (e) {
        console.error("Error fetching", e);
        process.exit(1);
    }
}
checkExperta();
