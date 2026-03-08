import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, updateDoc, doc } from "firebase/firestore";

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

async function scanForBadTypes() {
    console.log("🔍 Scanning for records with non-string names...");
    const [invSnap, testSnap, compSnap] = await Promise.all([
        getDocs(collection(db, 'invoices')),
        getDocs(collection(db, 'testInvoices')),
        getDocs(collection(db, 'companies'))
    ]);

    const all = [
        ...invSnap.docs.map(d => ({ id: d.id, data: d.data(), coll: 'invoices', nameField: 'company' })),
        ...testSnap.docs.map(d => ({ id: d.id, data: d.data(), coll: 'testInvoices', nameField: 'company' })),
        ...compSnap.docs.map(d => ({ id: d.id, data: d.data(), coll: 'companies', nameField: 'name' }))
    ];

    let corruptCount = 0;
    for (const item of all) {
        const val = item.data[item.nameField];
        if (val !== undefined && val !== null && typeof val !== 'string') {
            console.log(`🚨 [${item.coll}/${item.id}]: BAD TYPE in ${item.nameField}: ${typeof val} (Value: ${JSON.stringify(val)})`);
            corruptCount++;

            const updates = { _typeFixed: true };
            updates[item.nameField] = val.toString();
            await updateDoc(doc(db, item.coll, item.id), updates);
            console.log(`   ✅ Corrected to string.`);
        }
    }

    console.log(`✨ Scan complete. Found ${corruptCount} bad type records.`);
}

scanForBadTypes();
