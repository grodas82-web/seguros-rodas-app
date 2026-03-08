import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc, writeBatch } from 'firebase/firestore';

const firebaseConfig = {
    apiKey: 'AIzaSyBHR2EoNpjGIanQpMxWB7wXW9gAMmNuXvM',
    authDomain: 'finanzastg.firebaseapp.com',
    projectId: 'finanzastg',
    storageBucket: 'finanzastg.firebasestorage.app',
    messagingSenderId: '980629069726',
    appId: '1:980629069726:web:0810594773af27c552c08f'
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const parseDate = (dStr) => {
    if (!dStr) return null;
    let dObj = null;
    if (typeof dStr !== 'string') return null;

    if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(dStr)) {
        const [d, m, y] = dStr.split(' ')[0].split('/').map(Number);
        dObj = new Date(y, m - 1, d);
    } else if (/^\d{4}-\d{2}-\d{2}/.test(dStr)) {
        const [y, m, d] = dStr.split('T')[0].split('-').map(Number);
        dObj = new Date(y, m - 1, d);
    } else {
        dObj = new Date(dStr);
    }
    return isNaN(dObj.getTime()) ? null : dObj;
};

async function auditAndFix() {
    const snap = await getDocs(collection(db, 'invoices'));
    console.log(`Total invoices: ${snap.size}`);

    const batch = writeBatch(db);
    let count = 0;

    const febCompanies = new Map();

    snap.forEach(d => {
        const data = d.data();
        const dateObj = parseDate(data.date);

        if (dateObj) {
            const correctTs = dateObj.getTime();
            // Si el timestamp guardado está mal (ej: un año adelantado) o no existe
            if (data._timestamp !== correctTs) {
                console.log(`🔧 Fix TS for ${data.company}: ${data.date} | ${data._timestamp} -> ${correctTs}`);
                batch.update(doc(db, 'invoices', d.id), { _timestamp: correctTs });
                count++;
            }

            // Auditoría para el usuario (Solo Feb 2026)
            if (dateObj.getMonth() === 1 && dateObj.getFullYear() === 2026) {
                const name = data.company || 'UNKNOWN';
                if (!febCompanies.has(name)) febCompanies.set(name, []);
                febCompanies.get(name).push({ id: d.id, date: data.date, amount: data.amount });
            }
        }
    });

    if (count > 0) {
        await batch.commit();
        console.log(`✅ Fixed ${count} timestamps.`);
    } else {
        console.log('✅ No timestamp errors found.');
    }

    console.log('\n--- FEBRERO 2026 INVOICES ---');
    for (const [name, invs] of febCompanies.entries()) {
        if (invs.length > 1 || name.includes('TEGALDI') || name.includes('EXPERTA')) {
            console.log(`${name}: ${invs.length} facturas`);
            invs.forEach(i => console.log(`  - ${i.date}: $${i.amount} (ID: ${i.id})`));
        }
    }
}

auditAndFix();
