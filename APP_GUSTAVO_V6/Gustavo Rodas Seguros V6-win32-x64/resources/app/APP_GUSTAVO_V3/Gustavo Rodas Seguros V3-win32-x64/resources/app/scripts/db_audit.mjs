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

async function runAudit() {
    console.log("Fetching all records...");
    const [invSnap, testSnap] = await Promise.all([
        getDocs(collection(db, 'invoices')),
        getDocs(collection(db, 'testInvoices'))
    ]);

    const invoices = invSnap.docs.map(d => ({ id: d.id, ...d.data(), source: 'prod' }));
    const testInvoices = testSnap.docs.map(d => ({ id: d.id, ...d.data(), source: 'test' }));

    const all = [...invoices, ...testInvoices];
    console.log(`\n--- DATABASE TOTALS ---`);
    console.log(`Invoices (Prod): ${invoices.length}`);
    console.log(`Test Invoices: ${testInvoices.length}`);
    console.log(`Total Records: ${all.length}`);

    // Deduplication key
    const uniqueMap = new Map();
    all.forEach(inv => {
        const pos = (inv.pointOfSale || '').toString().padStart(5, '0');
        const num = (inv.number || '').toString().padStart(8, '0');
        const amt = Number(inv.amount || 0).toFixed(2);
        const date = (inv.date || '').toString();
        const key = `${pos}-${num}-${amt}-${date}`;

        if (!uniqueMap.has(key)) {
            uniqueMap.set(key, inv);
        }
    });

    console.log(`Total Unique Invoices: ${uniqueMap.size}`);
    console.log(`Total Redundant/Duplicate: ${all.length - uniqueMap.size}`);

    if (uniqueMap.size > 1302) {
        console.log(`\nWARNING: You have ${uniqueMap.size - 1302} extra unique records beyond the target 1302.`);
    } else if (uniqueMap.size < 1302) {
        console.log(`\nINFO: You are missing ${1302 - uniqueMap.size} records to reach 1302.`);
    }

    const feb2026 = Array.from(uniqueMap.values()).filter(inv => {
        const dStr = inv.date?.toString() || '';
        return dStr.includes('2026-02') || dStr.includes('/02/2026');
    });

    console.log(`\nFEBRUARY 2026 (Unique):`);
    console.log(`Count: ${feb2026.length}`);
}

runAudit();
