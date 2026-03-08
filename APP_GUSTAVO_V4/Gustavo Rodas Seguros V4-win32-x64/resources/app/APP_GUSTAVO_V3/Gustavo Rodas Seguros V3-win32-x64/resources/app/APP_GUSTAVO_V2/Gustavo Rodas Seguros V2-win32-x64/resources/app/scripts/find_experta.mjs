import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, query } from "firebase/firestore";

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

async function findExperta() {
    try {
        console.log("Fetching invoices and policies to find EXPERTA...");

        // Check invoices
        let q = query(collection(db, "invoices"));
        let snapshot = await getDocs(q);

        const results = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            results.push({ collection: 'invoices', id: doc.id, ...data });
        });

        // Check policies
        q = query(collection(db, "policies"));
        snapshot = await getDocs(q);

        snapshot.forEach(doc => {
            const data = doc.data();
            results.push({ collection: 'policies', id: doc.id, ...data });
        });

        results.sort((a, b) => {
            const ta = a.timestamp?.seconds || a.createdAt?.seconds || Date.parse(a.dateAdded) / 1000 || 0;
            const tb = b.timestamp?.seconds || b.createdAt?.seconds || Date.parse(b.dateAdded) / 1000 || 0;
            return tb - ta;
        });

        console.log(`Found ${results.length} total records:`);
        results.slice(0, 10).forEach(p => {
            console.log(`\n--- [${p.collection}] ID: ${p.id} ---`);
            console.log(`Date: ${p.date || p.billingPeriod || 'N/A'}`);
            console.log(`Amount: ${p.amount || p.premium || 'N/A'}`);
            console.log(`Raw Period Text: ${p.period || p.rawDate || 'N/A'}`);
            console.log(`Company: ${p.company || p.clientName || 'N/A'}`);
            console.log(`Normalized Name: ${p._normalizedName || 'N/A'}`);
            const t = p.timestamp?.seconds || p.createdAt?.seconds;
            if (t) {
                console.log(`Timestamp: ${new Date(t * 1000).toISOString()}`);
            } else if (p.dateAdded) {
                console.log(`DateAdded: ${p.dateAdded}`);
            } else {
                console.log(`NO TIMESTAMP DATA FOUND`);
            }
        });

        process.exit(0);
    } catch (e) {
        console.error("Error", e);
        process.exit(1);
    }
}

findExperta();
