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

const now = new Date("2026-03-07T21:20:00-03:00");

const isAutoExpired = (p) => {
    if (!p.endDate || p.isCancelled) return false;
    const risk = (p.riskType || '').toLowerCase();
    if (!risk.includes('accidente')) return false;
    const end = new Date(p.endDate);
    return end < now;
};

async function testFilter() {
    const snap = await getDocs(collection(db, 'policies'));
    console.log(`Total policies found: ${snap.size}`);

    const searchTerm = "gil";
    const filterStatus = "Active";
    const filterRisk = "All";
    const filterCompany = "All";

    snap.forEach(doc => {
        const p = doc.data();
        const clientName = p.clientName || '';

        if (!clientName.toUpperCase().includes("GIL") && !clientName.toUpperCase().includes("OLIVARES")) return;

        console.log(`\n--- TESTING POLICY: ${clientName} (${doc.id}) ---`);

        const terms = searchTerm.toLowerCase().split(' ').filter(t => t.length > 0);
        const searchBlob = `
            ${(p.clientName || '').toLowerCase()} 
            ${(p.dni || '')} 
            ${(p.policyNumber || '')} 
            ${(p.company || '').toLowerCase()} 
            ${(p.riskType || '').toLowerCase()}
        `.toLowerCase();

        const matchesSearch = terms.every(term => searchBlob.includes(term));
        console.log(`Matches search ("${searchTerm}"): ${matchesSearch}`);

        const expired = isAutoExpired(p);
        const cancelled = !!p.isCancelled;
        let matchesStatus = true;
        if (filterStatus === 'Active') {
            matchesStatus = !cancelled && !expired;
        }
        console.log(`Matches status ("${filterStatus}"): ${matchesStatus} (Cancelled: ${cancelled}, Expired: ${expired})`);

        const matchesAll = matchesSearch && matchesStatus;
        console.log(`FINAL RESULT: ${matchesAll ? "SHOWN" : "HIDDEN"}`);
    });
    process.exit(0);
}

testFilter();
