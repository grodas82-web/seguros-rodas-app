import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, updateDoc, doc } from "firebase/firestore";
import fs from 'fs';
import path from 'path';

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

async function optimizePolicies() {
    console.log("🚀 Starting Policy Optimization...");

    const snap = await getDocs(collection(db, 'policies'));
    console.log(`Found ${snap.docs.length} policies.`);

    const backup = [];
    let optimizedCount = 0;

    for (const d of snap.docs) {
        const data = d.data();
        const docId = d.id;

        let hasBloat = false;
        const cleanedAttachments = [];

        if (data.attachments && Array.isArray(data.attachments)) {
            data.attachments.forEach(att => {
                if (att.base64 && att.base64.length > 50000) { // 50KB+
                    console.log(`📦 Found bloat in ${docId} (${att.name}): ${(att.base64.length / 1024).toFixed(2)} KB`);
                    backup.push({
                        docId,
                        client: data.clientName,
                        fileName: att.name,
                        base64: att.base64
                    });

                    const { base64, ...rest } = att;
                    cleanedAttachments.push({ ...rest, _removedBase64: true });
                    hasBloat = true;
                } else {
                    cleanedAttachments.push(att);
                }
            });
        }

        // Legacy fields check
        const updates = {};
        if (hasBloat) {
            updates.attachments = cleanedAttachments;
        }

        if (data.fileBase64 && data.fileBase64.length > 50000) {
            console.log(`📦 Found legacy bloat in ${docId}`);
            backup.push({
                docId,
                client: data.clientName,
                fileName: data.fileName || 'legacy_file.pdf',
                base64: data.fileBase64,
                isLegacyField: true
            });
            updates.fileBase64 = null;
            updates._legacyBloatRemoved = true;
            hasBloat = true;
        }

        if (hasBloat) {
            updates._optimizedAt = new Date().toISOString();
            await updateDoc(doc(db, 'policies', docId), updates);
            optimizedCount++;
        }
    }

    if (backup.length > 0) {
        const backupPath = 'scripts/policy_attachments_backup.json';
        fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
        console.log(`\n✅ Backup saved to: ${backupPath}`);
    }

    console.log(`✨ Optimization finished. ${optimizedCount} policies cleaned.`);
}

optimizePolicies();
