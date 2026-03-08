import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, updateDoc } from "firebase/firestore";

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

async function cleanup() {
    const snap = await getDocs(collection(db, 'policies'));
    let cleaned = 0;
    let kept = 0;
    let total = 0;

    for (const docSnap of snap.docs) {
        const d = docSnap.data();
        total++;

        if (d.attachments && d.attachments.length > 0) {
            const validAttachments = d.attachments.filter(a => a && (a.url || a.base64));
            const invalidCount = d.attachments.length - validAttachments.length;

            if (invalidCount > 0) {
                // Has broken attachments — clean them
                await updateDoc(doc(db, 'policies', docSnap.id), {
                    attachments: validAttachments
                });
                cleaned++;
                console.log(`CLEANED: ${d.clientName} (${docSnap.id}) — removed ${invalidCount} broken attachment(s), kept ${validAttachments.length}`);
            } else {
                kept++;
            }
        }
    }

    console.log(`\n=== CLEANUP COMPLETE ===`);
    console.log(`Total policies: ${total}`);
    console.log(`Cleaned (broken attachments removed): ${cleaned}`);
    console.log(`Already valid: ${kept}`);

    process.exit(0);
}

cleanup().catch(e => { console.error(e); process.exit(1); });
