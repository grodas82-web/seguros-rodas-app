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

// Reproducing AppContext parseDate logic
function parseDate(input) {
    if (!input) return new Date(0);
    const dateValue = (typeof input === 'object' && !(input instanceof Date))
        ? (input.date || input.timestamp)
        : input;
    if (!dateValue) return new Date(0);
    if (dateValue instanceof Date) return dateValue;
    if (dateValue?.seconds) return new Date(dateValue.seconds * 1000);
    const dStr = dateValue.toString().trim();
    if (!dStr) return new Date(0);
    let dObj = null;
    if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(dStr)) {
        const [d, m, y] = dStr.split(' ')[0].split('/').map(Number);
        dObj = new Date(y, m - 1, d);
    } else if (/^\d{4}-\d{2}-\d{2}/.test(dStr)) {
        const [y, m, d] = dStr.split('T')[0].split('-').map(Number);
        dObj = new Date(y, m - 1, d);
    } else {
        dObj = new Date(dStr);
    }
    return dObj;
}

async function findCorruptDates() {
    console.log("🔍 Scanning for records with invalid dates...");
    const [invSnap, testSnap] = await Promise.all([
        getDocs(collection(db, 'invoices')),
        getDocs(collection(db, 'testInvoices'))
    ]);

    const all = [
        ...invSnap.docs.map(d => ({ id: d.id, data: d.data(), coll: 'invoices' })),
        ...testSnap.docs.map(d => ({ id: d.id, data: d.data(), coll: 'testInvoices' }))
    ];

    let corruptCount = 0;
    for (const item of all) {
        const d = parseDate(item.data);
        if (isNaN(d.getTime())) {
            console.log(`🚨 [${item.coll}/${item.id}]: INVALID DATE FOUND: "${item.data.date || item.data.timestamp}"`);
            corruptCount++;

            // Auto-fix: Set to current Date if it's corrupt to avoid crash
            await updateDoc(doc(db, item.coll, item.id), {
                timestamp: new Date(),
                _dateFixed: true
            });
            console.log(`   ✅ Auto-fixed with current timestamp.`);
        }
    }

    console.log(`✨ Scan complete. Found ${corruptCount} corrupt date records.`);
}

findCorruptDates();
