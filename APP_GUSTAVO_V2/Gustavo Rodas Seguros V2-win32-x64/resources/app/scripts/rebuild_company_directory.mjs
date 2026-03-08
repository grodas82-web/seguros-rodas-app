import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, setDoc, doc, writeBatch } from "firebase/firestore";

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

// Helper para normalizar nombres (igual al de AppContext)
const normalizeName = (name) => {
    if (!name) return '';
    return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/seguros|seguro|s\.a\.|sa|compia|compañía|cia\.|\/|seg\.|argentina|nacion|asoc\.|mutual|asociacin|asociacion|art|riesgos|trabajo/gi, '')
        .replace(/[^a-z0-9]/g, '')
        .trim();
};

async function rebuildDirectory() {
    console.log("🔍 Analizando historial para reconstruir directorio...");

    // 1. Obtener todas las facturas de producción
    const invSnap = await getDocs(collection(db, 'invoices'));
    const invoices = invSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const companiesMap = new Map();

    invoices.forEach(inv => {
        const dStr = inv.date?.toString() || '';
        const isFeb2026 = dStr.includes('2026-02') || dStr.includes('/02/2026');
        const isJan2026 = dStr.includes('2026-01') || dStr.includes('/01/2026');

        if (isFeb2026 || isJan2026) {
            const norm = normalizeName(inv.company);
            if (!norm) return;

            // Guardamos la mejor versión del nombre (la más larga usualmente tiene menos recortes)
            // y el CUIT más reciente (si no es el del emisor)
            const current = companiesMap.get(norm) || { name: inv.company, cuit: '' };

            if (inv.company.length >= current.name.length) {
                current.name = inv.company;
            }

            if (inv.cuit && inv.cuit !== '23294824979') {
                current.cuit = inv.cuit;
            }

            companiesMap.set(norm, current);
        }
    });

    console.log(`📊 Encontradas ${companiesMap.size} compañías únicas en Jan/Feb 2026.`);

    // 2. Limpiar directorio actual (BORRADO TOTAL PARA EVITAR DUPLICADOS)
    const oldSnap = await getDocs(collection(db, "companies"));
    if (oldSnap.size > 0) {
        console.log(`🗑️ Borrando ${oldSnap.size} registros existentes...`);
        const wipeBatch = writeBatch(db);
        oldSnap.forEach(d => wipeBatch.delete(doc(db, "companies", d.id)));
        await wipeBatch.commit();
    }

    // 3. Cargar nuevas
    const batch = writeBatch(db);
    let count = 0;

    companiesMap.forEach((data, norm) => {
        const newRef = doc(collection(db, "companies"));
        batch.set(newRef, {
            name: data.name.toUpperCase().trim(),
            cuit: data.cuit || 'PENDIENTE',
            ivaType: 'Responsable Inscripto',
            _normalizedName: norm,
            isLoaded: false // El estado real se calcula en el front
        });
        count++;
    });

    if (count > 0) {
        await batch.commit();
        console.log(`✅ Directorio reconstruido con ${count} empresas.`);
    } else {
        console.log("⚠️ No se encontraron facturas en Jan/Feb 2026 para crear el directorio.");
    }
}

rebuildDirectory();
