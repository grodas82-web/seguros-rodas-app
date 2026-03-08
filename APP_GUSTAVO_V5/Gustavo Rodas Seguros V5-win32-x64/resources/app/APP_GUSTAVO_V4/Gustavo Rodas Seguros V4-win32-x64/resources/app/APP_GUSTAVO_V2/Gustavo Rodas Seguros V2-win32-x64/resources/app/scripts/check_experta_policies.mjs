import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

const firebaseConfig = {
    apiKey: process.env.VITE_FIREBASE_API_KEY || "AIzaSyB-fake-for-node-script-please-use-real",
    authDomain: "facturacion-2026.firebaseapp.com",
    projectId: "facturacion-2026",
    storageBucket: "facturacion-2026.firebasestorage.app",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abcdef"
};

// Instead of hardcoding keys, let's just initialize the app using default credentials or load from .env
import * as dotenv from 'dotenv';
import { readFileSync } from 'fs';
dotenv.config({ path: '../.env' }); // Assuming we run from scripts/

const app = initializeApp({
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.VITE_FIREBASE_APP_ID
});

const db = getFirestore(app);

async function checkExperta() {
    console.log("Fetching policies...");
    const snap = await getDocs(collection(db, 'policies'));
    const policies = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    const expertaPolicies = policies.filter(p =>
        (p.company || '').toUpperCase().includes('EXPERTA')
    );

    console.log(`Found ${expertaPolicies.length} Experta policies.`);

    for (const p of expertaPolicies) {
        console.log(`- ID: ${p.id} | Cli: ${p.clientName} | Num: ${p.policyNumber} | Comp: ${p.company} | Risk: ${p.riskType} | End: ${p.endDate} | Prima: ${p.prima} | Cancelled: ${p.isCancelled}`);
    }
}

checkExperta().catch(console.error);
