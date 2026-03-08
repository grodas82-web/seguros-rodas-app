import { initializeApp } from "firebase/app";
import { getFirestore, collection, query, orderBy, onSnapshot, getDocs } from "firebase/firestore";

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

async function testAppQuery() {
    console.log("🚀 Testing exact app query: orderBy('timestamp', 'desc')...");
    const qInv = query(collection(db, 'invoices'), orderBy('timestamp', 'desc'));

    try {
        const snap = await getDocs(qInv);
        console.log(`✅ Success! Found ${snap.docs.length} invoices.`);
        if (snap.docs.length > 0) {
            console.log(`   Latest: ${snap.docs[0].id} (Timestamp: ${JSON.stringify(snap.docs[0].data().timestamp)})`);
        }
    } catch (err) {
        console.error("❌ ERROR in query:", err.message);
        if (err.message.includes("requires an index")) {
            console.log("🚨 INDEX MISSING! This could be it.");
        }
    }

    process.exit(0);
}

testAppQuery();
