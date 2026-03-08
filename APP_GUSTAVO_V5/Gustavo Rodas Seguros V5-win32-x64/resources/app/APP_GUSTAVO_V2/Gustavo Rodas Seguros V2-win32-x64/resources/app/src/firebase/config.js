import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// TODO: REMPLACAR CON TUS CREDENCIALES DE FIREBASE
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyBHR2EoNpjGIanQpMxWB7wXW9gAMmNuXvM", // Fallback for public web, but better to hide
    authDomain: "finanzastg.firebaseapp.com",
    projectId: "finanzastg",
    storageBucket: "finanzastg.firebasestorage.app",
    messagingSenderId: "980629069726",
    appId: "1:980629069726:web:0810594773af27c552c08f"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
