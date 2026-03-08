import { initializeApp } from "firebase/app";
import { getFirestore, collection, query, where, getDocs } from "firebase/firestore";

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

async function findOlivares() {
    console.log("Searching for Olivares...");
    const snap = await getDocs(collection(db, 'policies'));
    let found = [];
    snap.forEach(doc => {
        const data = doc.data();
        if (data.clientName && data.clientName.toUpperCase().includes("OLIVARES")) {
            found.push({ id: doc.id, ...data });
        }
    });

    if (found.length === 0) {
        console.log("No policy found for Olivares.");
    } else {
        console.log(`Found ${found.length} policies for Olivares:`);
        found.forEach(f => {
            console.log(`- ID: ${f.id}, Name: ${f.clientName}, Policy: ${f.policyNumber}, Company: ${f.company}`);
        });
    }
    process.exit(0);
}

findOlivares().catch(e => {
    console.error(e);
    process.exit(1);
});
