import {
    collection, query, where, getDocs,
    addDoc, updateDoc, doc, serverTimestamp, writeBatch
} from 'firebase/firestore';

/**
 * Normaliza un nombre a una clave canónica:
 * - Uppercase, sin acentos, solo letras/números/espacios
 * - Tokens ordenados alfabéticamente
 * "Juan Pérez" = "PEREZ JUAN" = "Pérez, Juan"
 */
export function normalizeNameKey(name) {
    if (!name) return '';
    return String(name)
        .toUpperCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean)
        .sort()
        .join(' ');
}

export function normalizeDni(dni) {
    if (!dni) return '';
    return String(dni).replace(/[^0-9]/g, '');
}

/**
 * Busca o crea un cliente en la colección 'clients'.
 * Prioridad: DNI → nameKey → crear nuevo.
 * Retorna el clientId (Firestore doc ID).
 */
export async function resolveClientId(db, clientName, dni) {
    const nameKey = normalizeNameKey(clientName);
    const cleanDni = normalizeDni(dni);

    // 1. Buscar por DNI (más confiable que el nombre)
    if (cleanDni && cleanDni.length >= 7) {
        const snap = await getDocs(query(collection(db, 'clients'), where('dni', '==', cleanDni)));
        if (!snap.empty) {
            const existing = snap.docs[0];
            // Actualizar nameKey si cambió
            if (nameKey && existing.data().nameKey !== nameKey) {
                await updateDoc(doc(db, 'clients', existing.id), {
                    nameKey,
                    clientName: (clientName || '').trim().toUpperCase(),
                    updatedAt: serverTimestamp()
                });
            }
            return existing.id;
        }
    }

    // 2. Buscar por nameKey normalizado
    if (nameKey) {
        const snap = await getDocs(query(collection(db, 'clients'), where('nameKey', '==', nameKey)));
        if (!snap.empty) {
            const existing = snap.docs[0];
            // Si ahora tenemos DNI y el cliente no lo tenía, agregarlo
            if (cleanDni && cleanDni.length >= 7 && !existing.data().dni) {
                await updateDoc(doc(db, 'clients', existing.id), {
                    dni: cleanDni,
                    updatedAt: serverTimestamp()
                });
            }
            return existing.id;
        }
    }

    // 3. Crear nuevo cliente
    const newDoc = await addDoc(collection(db, 'clients'), {
        clientName: (clientName || '').trim().toUpperCase(),
        nameKey,
        dni: cleanDni || '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    });

    return newDoc.id;
}

/**
 * Migración: asigna clientId a todas las pólizas existentes que no lo tengan.
 * Procesa en batches de 400 ops para respetar límite de Firestore (500/batch).
 * Retorna { processed, skipped, clientsCreated }
 */
export async function assignClientIdsToAll(db, onProgress) {
    const snap = await getDocs(collection(db, 'policies'));
    const total = snap.docs.length;
    let processed = 0;
    let skipped = 0;

    // Cache local para no hacer N queries por el mismo cliente
    const nameKeyCache = {}; // nameKey → clientId
    const dniCache = {};     // dni     → clientId

    let batch = writeBatch(db);
    let batchOps = 0;

    const flushBatch = async () => {
        if (batchOps > 0) {
            await batch.commit();
            batch = writeBatch(db);
            batchOps = 0;
        }
    };

    for (const docSnap of snap.docs) {
        const data = docSnap.data();

        // Ya tiene clientId, saltar
        if (data.clientId) {
            skipped++;
            continue;
        }

        const nameKey = normalizeNameKey(data.clientName);
        const cleanDni = normalizeDni(data.dni);

        let clientId = null;

        // Revisar cache primero
        if (cleanDni && dniCache[cleanDni]) {
            clientId = dniCache[cleanDni];
        } else if (nameKey && nameKeyCache[nameKey]) {
            clientId = nameKeyCache[nameKey];
        }

        // Si no está en cache, buscar/crear en Firestore
        if (!clientId) {
            clientId = await resolveClientId(db, data.clientName, data.dni);
        }

        // Actualizar caches
        if (cleanDni && cleanDni.length >= 7) dniCache[cleanDni] = clientId;
        if (nameKey) nameKeyCache[nameKey] = clientId;

        batch.update(docSnap.ref, { clientId });
        batchOps++;
        processed++;

        if (batchOps >= 400) await flushBatch();

        if (onProgress) onProgress(Math.round(((processed + skipped) / total) * 100), processed + skipped, total);
    }

    await flushBatch();

    return { processed, skipped, total };
}
