import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, writeBatch, doc } from "firebase/firestore";

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

async function fastCleanDupes() {
    console.log("🚀 Starting Fast Batch Deduplication...");

    const [invSnap, testSnap] = await Promise.all([
        getDocs(collection(db, 'invoices')),
        getDocs(collection(db, 'testInvoices'))
    ]);

    const invoices = invSnap.docs.map(d => ({ id: d.id, ...d.data(), coll: 'invoices' }));
    const testInvoices = testSnap.docs.map(d => ({ id: d.id, ...d.data(), coll: 'testInvoices' }));

    const all = [...invoices, ...testInvoices];
    console.log(`Total found: ${all.length}`);

    const uniqueMap = new Map();
    const toDelete = [];

    all.forEach(inv => {
        const pos = (inv.pointOfSale || '').toString().padStart(5, '0');
        const num = (inv.number || '').toString().padStart(8, '0');
        const amt = Number(inv.amount || 0).toFixed(2);
        const date = (inv.date || '').toString();
        const key = `${pos}-${num}-${amt}-${date}`;

        if (uniqueMap.has(key)) {
            const first = uniqueMap.get(key);
            if (inv.coll === 'invoices' && first.coll === 'testInvoices') {
                toDelete.push({ id: first.id, coll: first.coll });
                uniqueMap.set(key, inv);
            } else {
                toDelete.push({ id: inv.id, coll: inv.coll });
            }
        } else {
            uniqueMap.set(key, inv);
        }
    });

    console.log(`Total to delete: ${toDelete.length}`);

    if (toDelete.length === 0) {
        console.log("No duplicates found.");
        return;
    }

    // Process in batches of 500 (Firestore limit)
    const BATCH_SIZE = 500;
    for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        const currentBatch = toDelete.slice(i, i + BATCH_SIZE);

        currentBatch.forEach(item => {
            batch.delete(doc(db, item.coll, item.id));
        });

        await batch.commit();
        console.log(`✅ Batch commit: ${i + currentBatch.length}/${toDelete.length}`);
    }

    console.log("✨ Final Cleanup Finished.");
}

fastCleanDupes();
