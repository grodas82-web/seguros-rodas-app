import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc, writeBatch, deleteDoc } from 'firebase/firestore';

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

// Nueva lógica de normalización (Sync con AppContext)
function normalizeName(name) {
    if (!name) return '';
    let n = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    n = n.toLowerCase()
        .replace(/s\.a\.|sa|compia|compañía|cia\.| \/|seg\.|argentina|nacion|asoc\.|mutual|asociacin|asociacion|riesgos|trabajo/gi, '')
        .replace(/[^a-z0-9]/g, '')
        .trim();
    return n;
}

async function finalCleanup() {
    console.log('🚀 Iniciando limpieza final...');

    // 1. Eliminar duplicado exacto de Natalia Sol
    // ID a borrar: M64UNvyyQDH7cfZB5D6M (vimos que es idéntico a Bh0bJ9uYJ3d803pMG24b)
    try {
        await deleteDoc(doc(db, 'invoices', 'M64UNvyyQDH7cfZB5D6M'));
        console.log('🗑️ Duplicado Natalia Sol eliminado.');
    } catch (e) {
        console.log('⚠️ No se pudo borrar el duplicado (tal vez ya no existe).');
    }

    // 2. Actualizar normalización en TODAS las facturas y empresas
    const invSnap = await getDocs(collection(db, 'invoices'));
    const compSnap = await getDocs(collection(db, 'companies'));

    const batch = writeBatch(db);
    let count = 0;

    invSnap.forEach(d => {
        const data = d.data();
        const newNorm = normalizeName(data.company);
        if (data._normalizedName !== newNorm) {
            batch.update(doc(db, 'invoices', d.id), { _normalizedName: newNorm });
            count++;
        }
    });

    compSnap.forEach(d => {
        const data = d.data();
        const newNorm = normalizeName(data.name);
        if (data._normalizedName !== newNorm) {
            batch.update(doc(db, 'companies', d.id), { _normalizedName: newNorm });
            count++;
        }
    });

    if (count > 0) {
        await batch.commit();
        console.log(`✅ Normalización actualizada en ${count} registros.`);
    } else {
        console.log('✅ Todo normalizado correctamente.');
    }
}

finalCleanup();
