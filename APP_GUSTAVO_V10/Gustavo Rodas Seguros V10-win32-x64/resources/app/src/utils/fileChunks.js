/**
 * Chunked File Storage for Firestore
 * Splits large files into ~800KB chunks stored in subcollections
 * This bypasses Firestore's 1MB document size limit
 */
import { db } from '../firebase/config';
import { collection, doc, getDocs, writeBatch, query, orderBy } from 'firebase/firestore';

const CHUNK_SIZE = 800000; // ~800KB por chunk

/**
 * Save a file as chunks in Firestore subcollection
 * @param {string} policyId - The policy document ID
 * @param {string} base64Data - Raw base64 data (without data: prefix)
 * @param {string} fileName - Original file name
 * @param {string} fileType - MIME type
 * @returns {object} Metadata about the saved chunks
 */
export const saveFileChunks = async (policyId, base64Data, fileName, fileType) => {
    const totalChunks = Math.ceil(base64Data.length / CHUNK_SIZE);

    // Firestore writeBatch has a limit of 500 operations
    // For very large files, we need multiple batches
    const batchSize = 450; // Leave room for deletes

    // First, delete old chunks
    const oldChunksSnap = await getDocs(collection(db, 'policies', policyId, 'fileChunks'));
    if (!oldChunksSnap.empty) {
        const deleteBatch = writeBatch(db);
        oldChunksSnap.forEach(d => deleteBatch.delete(d.ref));
        await deleteBatch.commit();
    }

    // Write new chunks in batches
    for (let batchStart = 0; batchStart < totalChunks; batchStart += batchSize) {
        const batch = writeBatch(db);
        const batchEnd = Math.min(batchStart + batchSize, totalChunks);

        for (let i = batchStart; i < batchEnd; i++) {
            const chunk = base64Data.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
            const chunkRef = doc(db, 'policies', policyId, 'fileChunks', `chunk_${String(i).padStart(4, '0')}`);
            batch.set(chunkRef, { data: chunk, index: i });
        }

        await batch.commit();
    }

    console.log(`Saved ${totalChunks} chunks for policy ${policyId} (${(base64Data.length / 1024).toFixed(0)}KB)`);
    return { totalChunks, fileName, fileType, size: base64Data.length };
};

/**
 * Load a file from Firestore chunks
 * @param {string} policyId - The policy document ID
 * @returns {string|null} Complete base64 data or null
 */
export const loadFileChunks = async (policyId) => {
    try {
        const chunksSnap = await getDocs(
            query(collection(db, 'policies', policyId, 'fileChunks'), orderBy('index'))
        );
        if (chunksSnap.empty) return null;

        let base64 = '';
        chunksSnap.forEach(d => { base64 += d.data().data; });
        return base64;
    } catch (err) {
        console.error('Error loading file chunks:', err);
        return null;
    }
};

/**
 * Delete all file chunks for a policy
 * @param {string} policyId - The policy document ID
 */
export const deleteFileChunks = async (policyId) => {
    try {
        const chunksSnap = await getDocs(collection(db, 'policies', policyId, 'fileChunks'));
        if (chunksSnap.empty) return;
        const batch = writeBatch(db);
        chunksSnap.forEach(d => batch.delete(d.ref));
        await batch.commit();
    } catch (err) {
        console.error('Error deleting file chunks:', err);
    }
};

/**
 * Check if a policy has chunked file data
 * @param {object} attachment - The attachment object
 * @returns {boolean}
 */
export const isChunkedAttachment = (att) => {
    return att && att.chunked === true;
};
