import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, updateDoc, doc, writeBatch } from "firebase/firestore";

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

const normalizeName = (name) => {
    if (!name) return '';
    return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/seguros|seguro|s\.a\.|sa|compia|compañía|cia\.|\/|seg\.|argentina|nacion|asoc\.|mutual|asociacin|asociacion|art|riesgos|trabajo/gi, '')
        .replace(/[^a-z0-9]/g, '')
        .trim();
};

const parseDate = (dStr) => {
    if (!dStr) return null;
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
    return isNaN(dObj.getTime()) ? null : dObj;
};

async function repairInvoices() {
    console.log("🛠️ Reparando consistencia de facturas...");
    const invSnap = await getDocs(collection(db, 'invoices'));
    const batch = writeBatch(db);
    let count = 0;

    invSnap.forEach(d => {
        const data = d.data();
        const norm = normalizeName(data.company);
        const dateObj = parseDate(data.date);

        let needsUpdate = false;
        const updates = {};

        if (data._normalizedName !== norm) {
            updates._normalizedName = norm;
            needsUpdate = true;
        }

        // Si el timestamp no coincide con la fecha de la factura, lo corregimos para que sea la fecha real
        if (dateObj) {
            const ts = dateObj.getTime();
            if (data._timestamp !== ts) {
                updates._timestamp = ts;
                needsUpdate = true;
            }
        }

        if (needsUpdate) {
            batch.update(doc(db, 'invoices', d.id), updates);
            count++;
        }
    });

    if (count > 0) {
        await batch.commit();
        console.log(`✅ Se repararon ${count} facturas.`);
    } else {
        console.log("✅ Todas las facturas están consistentes.");
    }
}

repairInvoices();
