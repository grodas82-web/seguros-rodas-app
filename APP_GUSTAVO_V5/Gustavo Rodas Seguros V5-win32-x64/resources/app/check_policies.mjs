import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";

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

async function check() {
    const snap = await getDocs(collection(db, 'policies'));
    let total = 0;
    let withAttachments = 0;
    let withValidAttachments = 0;
    let withLegacyFile = 0;
    let withNoFile = 0;
    let sampleData = [];

    snap.forEach(doc => {
        const d = doc.data();
        total++;

        const hasAttachments = d.attachments && d.attachments.length > 0;
        const hasLegacy = d.fileUrl || d.fileBase64 || d.fileName;

        if (hasAttachments) {
            withAttachments++;
            const validOnes = d.attachments.filter(a => a && (a.url || a.base64));
            if (validOnes.length > 0) withValidAttachments++;
        }

        if (hasLegacy) withLegacyFile++;

        if (!hasAttachments && !hasLegacy) withNoFile++;

        if (sampleData.length < 5 && (hasAttachments || hasLegacy)) {
            sampleData.push({
                id: doc.id,
                clientName: d.clientName,
                attachmentsCount: d.attachments?.length || 0,
                attachmentsSample: d.attachments?.map(a => ({
                    hasUrl: !!a?.url,
                    urlPrefix: a?.url?.substring(0, 50),
                    hasBase64: !!a?.base64,
                    base64Len: a?.base64?.length || 0,
                    name: a?.name
                })),
                fileUrl: d.fileUrl ? d.fileUrl.substring(0, 50) : null,
                fileBase64Len: d.fileBase64?.length || 0,
                fileName: d.fileName
            });
        }
    });

    console.log('\n=== POLICY DATA DIAGNOSTIC ===');
    console.log(`Total policies: ${total}`);
    console.log(`With attachments array: ${withAttachments}`);
    console.log(`With VALID attachments (url or base64): ${withValidAttachments}`);
    console.log(`With legacy fileUrl/fileBase64: ${withLegacyFile}`);
    console.log(`With NO file data at all: ${withNoFile}`);
    console.log('\n=== SAMPLE DATA (first 5 with files) ===');
    console.log(JSON.stringify(sampleData, null, 2));

    process.exit(0);
}

check().catch(e => { console.error(e); process.exit(1); });
