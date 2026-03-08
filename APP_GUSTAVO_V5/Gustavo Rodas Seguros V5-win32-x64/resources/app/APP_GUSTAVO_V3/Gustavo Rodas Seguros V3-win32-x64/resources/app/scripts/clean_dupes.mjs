import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, deleteDoc, doc } from "firebase/firestore";

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

// Normalización agresiva
function normalize(str) {
    if (!str) return '';
    return str.toString()
        .toLowerCase()
        // Transliterar caracteres comunes de OCR (como Alpha griego -> a)
        .replace(/[\u0391\u03b1]/g, 'a')
        .replace(/[\u039f\u03bf]/g, 'o')
        .replace(/[\u0395\u03b5]/g, 'e')
        .replace(/[\u0399\u03b9]/g, 'i')
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Quitar acentos
        .replace(/[^a-z0-9]/g, '') // Quitar todo lo no alfanumérico
        .trim();
}

async function cleanDupes() {
    console.log("Leyendo registros de Producción y Prueba...");
    const [invSnap, testSnap] = await Promise.all([
        getDocs(collection(db, 'invoices')),
        getDocs(collection(db, 'testInvoices'))
    ]);

    const invoices = invSnap.docs.map(d => ({ id: d.id, ...d.data(), coll: 'invoices' }));
    const testInvoices = testSnap.docs.map(d => ({ id: d.id, ...d.data(), coll: 'testInvoices' }));

    const all = [...invoices, ...testInvoices];
    console.log(`Total registros encontrados: ${all.length}`);

    const uniqueMap = new Map();
    const toDelete = [];

    all.forEach(inv => {
        const pos = (inv.pointOfSale || '').toString().padStart(5, '0');
        const num = (inv.number || '').toString().padStart(8, '0');
        const amt = Number(inv.amount || 0).toFixed(2);
        const date = (inv.date || '').toString();

        const key = `${pos}-${num}-${amt}-${date}`;

        if (uniqueMap.has(key)) {
            // DUPLICADO ENCONTRADO
            const first = uniqueMap.get(key);
            // Si el nuevo es prod ('invoices') y el existente es test, borramos el de test y nos quedamos con prod
            if (inv.coll === 'invoices' && first.coll === 'testInvoices') {
                toDelete.push({ id: first.id, coll: first.coll });
                uniqueMap.set(key, inv);
                console.log(`Reemplazando Test por Prod: ${key}`);
            } else {
                // De lo contrario, simplemente borramos el nuevo
                toDelete.push({ id: inv.id, coll: inv.coll });
            }
        } else {
            uniqueMap.set(key, inv);
        }
    });

    console.log(`\nRegistros Únicos Finales: ${uniqueMap.size}`);
    console.log(`Total para borrar: ${toDelete.length}`);

    if (toDelete.length > 0) {
        console.log("Iniciando purga masiva...");
        // Procesar en chunks para no saturar
        for (let i = 0; i < toDelete.length; i++) {
            const item = toDelete[i];
            await deleteDoc(doc(db, item.coll, item.id));
            if (i % 100 === 0) console.log(`Progreso: ${i}/${toDelete.length}`);
        }
        console.log("Purga completada con éxito.");
    } else {
        console.log("No se encontraron duplicados.");
    }
}

cleanDupes();
