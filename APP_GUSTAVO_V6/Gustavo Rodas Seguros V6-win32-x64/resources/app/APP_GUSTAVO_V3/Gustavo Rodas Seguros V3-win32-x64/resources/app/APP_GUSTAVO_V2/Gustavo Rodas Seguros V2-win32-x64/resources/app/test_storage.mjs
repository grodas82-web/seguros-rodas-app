import { initializeApp } from "firebase/app";
import { getStorage, ref, uploadString, getDownloadURL } from "firebase/storage";

const firebaseConfig = {
    apiKey: "AIzaSyBHR2EoNpjGIanQpMxWB7wXW9gAMmNuXvM",
    authDomain: "finanzastg.firebaseapp.com",
    projectId: "finanzastg",
    storageBucket: "finanzastg.firebasestorage.app",
    messagingSenderId: "980629069726",
    appId: "1:980629069726:web:0810594773af27c552c08f"
};

const app = initializeApp(firebaseConfig);
const storage = getStorage(app);

async function testMultipleBuckets() {
    // Try different bucket configurations
    const buckets = [
        { name: "Default", storage: getStorage(app) },
        { name: "gs://finanzastg.appspot.com", storage: getStorage(app, "gs://finanzastg.appspot.com") },
        { name: "gs://finanzastg.firebasestorage.app", storage: getStorage(app, "gs://finanzastg.firebasestorage.app") },
    ];

    for (const bucket of buckets) {
        console.log(`\nTesting bucket: ${bucket.name}...`);
        try {
            const storageRef = ref(bucket.storage, `test/test_${Date.now()}.txt`);
            const result = await uploadString(storageRef, 'test content ' + Date.now());
            const url = await getDownloadURL(result.ref);
            console.log(`✅ SUCCESS! URL: ${url.substring(0, 80)}`);
        } catch (err) {
            console.log(`❌ FAILED: ${err.code} - ${err.message.substring(0, 100)}`);
            if (err.customData?.serverResponse) {
                console.log(`   Server: ${err.customData.serverResponse.substring(0, 200)}`);
            }
        }
    }
    process.exit(0);
}

testMultipleBuckets();
