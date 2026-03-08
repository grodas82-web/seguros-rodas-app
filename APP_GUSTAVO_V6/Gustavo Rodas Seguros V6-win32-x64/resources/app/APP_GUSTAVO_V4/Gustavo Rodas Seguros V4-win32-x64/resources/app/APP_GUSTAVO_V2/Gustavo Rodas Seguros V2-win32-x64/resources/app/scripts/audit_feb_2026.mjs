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
    const [invSnap, testSnap] = await Promise.all([
        getDocs(collection(db, 'invoices')),
        getDocs(collection(db, 'testInvoices'))
    ]);

    const invoices = invSnap.docs.map(d => ({ id: d.id, ...d.data(), source: 'prod' }));
    const testInvoices = testSnap.docs.map(d => ({ id: d.id, ...d.data(), source: 'test' }));
    const all = [...invoices, ...testInvoices];

    const feb2026 = all.filter(inv => {
        const dStr = inv.date?.toString() || '';
        return dStr.includes('2026-02') || dStr.includes('/02/2026') || (inv.timestamp && new Date(inv.timestamp.seconds * 1000).toISOString().includes('2026-02'));
    });

    console.log(`\n--- FEBRUARY 2026 INVOICES ---`);
    console.log(`Total Found: ${feb2026.length}`);

    const companiesSet = new Set();
    feb2026.forEach(inv => {
        console.log(`- [${inv.source}] ${inv.company} (FC #${inv.number}) - Date: ${inv.date} - TS: ${inv.timestamp ? new Date(inv.timestamp.seconds * 1000).toISOString() : 'N/A'}`);
        companiesSet.add(inv.company);
    });

    console.log(`\nCompanies with invoices in Feb 2026:`);
    Array.from(companiesSet).sort().forEach(c => console.log(`  * ${c}`));
}

runAudit();
