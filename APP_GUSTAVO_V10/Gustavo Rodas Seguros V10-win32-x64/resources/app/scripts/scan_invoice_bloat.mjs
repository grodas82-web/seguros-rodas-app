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

async function deepScanInvoices() {
    console.log("🔍 Deep scanning all invoices for bloat...");
    const [invSnap, testSnap] = await Promise.all([
        getDocs(collection(db, 'invoices')),
        getDocs(collection(db, 'testInvoices'))
    ]);

    const all = [
        ...invSnap.docs.map(d => ({ id: d.id, data: d.data(), coll: 'invoices' })),
        ...testSnap.docs.map(d => ({ id: d.id, data: d.data(), coll: 'testInvoices' }))
    ];

    let bigDocs = [];
    for (const item of all) {
        const s = JSON.stringify(item.data);
        if (s.length > 50 * 1024) { // 50KB+
            bigDocs.push({ id: item.id, coll: item.coll, size: (s.length / 1024).toFixed(2) + " KB" });
        }
    }

    if (bigDocs.length > 0) {
        console.log(`🚨 Found ${bigDocs.length} oversized invoices:`);
        bigDocs.forEach(d => console.log(`   - ${d.coll}/${d.id}: ${d.size}`));
    } else {
        console.log("✅ No oversized invoices found (all under 50KB).");
    }
}

deepScanInvoices();
