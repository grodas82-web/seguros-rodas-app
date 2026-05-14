import React, { createContext, useState, useEffect, useCallback, useMemo, useContext } from 'react';

// Detecta el subtipo de documento de póliza: "Nuevo Negocio", "Renovación" o "Endoso XX"
const detectPolicySubtype = (rawText) => {
    if (!rawText) return 'Nuevo Negocio';
    const t = rawText.toUpperCase();
    // Endoso: "ENDOSO N° 01", "ENDOSO 01", "ENDOSO NRO. 02", etc.
    const endosoMatch = t.match(/\bENDOSO\b[^0-9]{0,25}(\d{1,2})/);
    if (endosoMatch) {
        const num = parseInt(endosoMatch[1], 10);
        return `Endoso ${String(num).padStart(2, '0')}`;
    }
    // Renovación: evitar "FECHA DE RENOVACION" (solo un campo de fecha, no el tipo de doc)
    if (/\bRENOVACI[OÓ]N\b/.test(t) && !/FECHA\s+DE\s+RENOVACI/.test(t)) {
        return 'Renovación';
    }
    return 'Nuevo Negocio';
};
import { db, storage, auth } from '../firebase/config';
import { analyzeInvoice, analyzePolicy, analyzeCSV, smartAnalyzeFile, analyzeMappedPolicy, classifyImage, analyzeVisualMappedPolicy, analyzePolicyTextOnly, analyzeSMGPolicy, analyzeSMGCaucionPolicy, analyzeMercantilIntegralPolicy, analyzeMercantilIntegralCoverages, analyzeMercantilCoveragesFromText, analyzeMercantilAutoPolicy, analyzeCombinadoIntegralPolicy } from '../services/aiManager';
import * as pdfjsLib from 'pdfjs-dist';
if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
}
import { VisualProcessor } from '../services/visualProcessor';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc, updateDoc, writeBatch, serverTimestamp, getDocs, setDoc, where, arrayUnion } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { ref as dbRef, onValue, remove } from 'firebase/database';
import { rtdb } from '../firebase/config';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { saveFileChunks, loadFileChunks, deleteFileChunks } from '../utils/fileChunks';
import { resolveClientId, assignClientIdsToAll, normalizeNameKey, normalizeDni } from '../utils/clientResolver';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

const sanitizeFirestoreData = (obj) => {
    if (obj === undefined) return null;
    if (obj === null || typeof obj !== 'object') return obj;

    // Preserve Date and Firebase Timestamp / FieldValue instances
    if (obj instanceof Date || (obj && typeof obj.toDate === 'function') || obj.constructor?.name === 'FieldValue' || obj.constructor?.name === 'Timestamp' || obj._methodName) {
        return obj;
    }

    if (Array.isArray(obj)) return obj.map(sanitizeFirestoreData).filter(v => v !== undefined);

    const newObj = {};
    for (const [key, value] of Object.entries(obj)) {
        if (value !== undefined) {
            newObj[key] = sanitizeFirestoreData(value);
        }
    }
    return newObj;
};

const AppContext = createContext();

export const AppProvider = ({ children }) => {
    const [invoices, setInvoices] = useState([]);
    const [testInvoices, setTestInvoices] = useState([]);
    const [companies, setCompanies] = useState([]);
    const [loading, setLoading] = useState(true);
    const [policies, setPolicies] = useState([]);
    const [globalSearchTerm, setGlobalSearchTerm] = useState('');
    const [showOnlyMissingFiles, setShowOnlyMissingFiles] = useState(false);
    const [user, setUser] = useState(null);
    const [patterns, setPatterns] = useState({}); // { companyName: hints }
    const [theme, setTheme] = useState(() => {
        const saved = localStorage.getItem('theme');
        return saved || 'dark';
    });
    const [geminiUsageState, setGeminiUsageState] = useState(() => {
        const stored = localStorage.getItem('geminiUsage');
        return stored ? JSON.parse(stored) : null;
    });

    const [reminders, setReminders] = useState([]);
    const [siniestros, setSiniestros] = useState([]);
    const [mobileInbox, setMobileInbox] = useState([]);

    // --- SISTEMA DE GESTIÓN DE CUOTA GEMINI (Injection Prompt) ---
    const [quotaLock, setQuotaLock] = useState({
        isLocked: false,
        remainingSeconds: 0,
        nextWindow: null
    });

    useEffect(() => {
        let timer;
        if (quotaLock.isLocked && quotaLock.remainingSeconds > 0) {
            timer = setInterval(() => {
                setQuotaLock(prev => {
                    if (prev.remainingSeconds <= 1) {
                        return { isLocked: false, remainingSeconds: 0, nextWindow: null };
                    }
                    return { ...prev, remainingSeconds: prev.remainingSeconds - 1 };
                });
            }, 1000);
        }
        return () => clearInterval(timer);
    }, [quotaLock.isLocked, quotaLock.remainingSeconds]);

    const triggerQuotaLock = useCallback(() => {
        const now = new Date();
        const nextWindow = new Date(now.getTime() + 65000);
        window.proxima_ventana_carga = nextWindow;
        setQuotaLock({
            isLocked: true,
            remainingSeconds: 65,
            nextWindow: nextWindow
        });
        console.warn("🚫 Gemini Quota Lock Activated (65s)");
    }, []);

    const resetQuotaLock = useCallback(() => {
        setQuotaLock({
            isLocked: false,
            remainingSeconds: 0,
            nextWindow: null
        });
        window.proxima_ventana_carga = null;
        console.log("🔓 Quota Lock Reset Manualmente");
    }, []);
    // -----------------------------------------------------------

    const normalizeRisk = useCallback((risk) => {
        if (!risk) return 'Otro';
        const r = risk.toLowerCase().trim();

        // Priority branches (many contain 'rc' as part of the word)
        if (r.includes('art')) return 'ART';
        if (r.includes('vida')) return 'Vida';
        if (r.includes('caucion') || r.includes('caución')) return 'Caución';
        if (r.includes('accidente')) return 'Accidentes Personales';
        if (r.includes('consorcio')) return 'Integral de Consorcio';
        if (r.includes('comercio')) return 'Integral de Comercio';
        if (r.includes('hogar') || r.includes('combinado familiar')) return 'Combinado Familiar';

        if (r.includes('auto')) return 'Autos';
        if (r.includes('motos') || r.includes('moto')) return 'Motos';

        // RC identification (must be after Comercio/Consorcio)
        if (r === 'rc' || r.includes('responsabilidad civil') || r.includes('r.c.') || r.startsWith('rc ') || r.endsWith(' rc') || r.includes(' rc ')) {
            return 'RC';
        }

        return 'Otro';
    }, []);

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
    }, [theme]);

    const toggleTheme = useCallback(() => {
        setTheme(prev => prev === 'dark' ? 'light' : 'dark');
    }, []);

    const parseDate = React.useCallback((input) => {
        if (!input) return new Date(0);

        // Si el objeto tiene un campo de fecha (extraído por IA o sistema), intentamos varios nombres comunes
        let dateValue = null;
        if (typeof input === 'object' && !(input instanceof Date)) {
            dateValue = input.date || input.timestamp || input.createdAt || input.updatedAt || input.fecha || input.vigenciaDesde;
        } else {
            dateValue = input;
        }

        if (!dateValue) return new Date(0);
        if (dateValue instanceof Date) return dateValue;

        // Firestore Timestamp handling (seconds/nanoseconds)
        if (dateValue?.seconds) return new Date(dateValue.seconds * 1000);
        
        // Handle ISO strings or other string formats
        const dStr = dateValue.toString().trim();
        if (!dStr) return new Date(0);

        let dObj = null;
        if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(dStr)) {
            const [d, m, y] = dStr.split(' ')[0].split('/').map(Number);
            dObj = new Date(y, m - 1, d);
        } else if (/^\d{4}-\d{2}-\d{2}/.test(dStr)) {
            const [y, m, d] = dStr.split('T')[0].split('-').map(Number);
            dObj = new Date(y, m - 1, d);
        } else {
            dObj = new Date(dStr);
        }
        
        const finalTime = dObj.getTime();
        return (isNaN(finalTime) || finalTime === 0) ? new Date(0) : dObj;
    }, []);

    const normalizeName = React.useCallback((name) => {
        if (!name) return '';
        // 1. Quitar acentos para evitar duplicados como "ANÓNIMA" vs "ANONIMA"
        let n = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        // 2. Limpiamos términos genéricos pero CONSERVAMOS 'art' y 'seguro' para distinguir entidades
        n = n.toLowerCase()
            .replace(/s\.a\.|sa|compia|compañía|cia\.| \/|seg\.|argentina|nacion|asoc\.|mutual|asociacin|asociacion|riesgos|trabajo/gi, '')
            .replace(/[^a-z0-9]/g, '')
            .trim();

        return n;
    }, []);

    // Efecto 1: Solo escucha el estado de autenticación
    useEffect(() => {
        // Fail-safe global: si Firebase Auth no responde en 10s, desbloquear UI
        const authFailSafe = setTimeout(() => {
            console.warn("AppContext: Auth fail-safe triggered!");
            setLoading(false);
        }, 10000);

        const unsubAuth = onAuthStateChanged(auth, (firebaseUser) => {
            clearTimeout(authFailSafe);
            const isAdminBypass = localStorage.getItem('admin_bypass') === 'true';
            if (firebaseUser) {
                // Auth real de Firebase — limpiar bypass si existía
                localStorage.removeItem('admin_bypass');
                setLoading(true); // Mostrar splash mientras Firestore carga
                setUser(firebaseUser);
                // loading se desbloquea cuando Firestore carga (Effect 2)
            } else if (isAdminBypass) {
                // Sin auth real pero con bypass guardado
                setUser({ email: 'grodas@jylbrokers.com.ar', uid: 'admin_bypass', displayName: 'Gustavo Rodas' });
                setLoading(false);
            } else {
                setUser(null);
                setLoading(false);
            }
        });
        return () => {
            clearTimeout(authFailSafe);
            unsubAuth();
        };
    }, []);

    // Efecto 2: Listeners de Firestore — solo arrancan cuando hay usuario autenticado
    useEffect(() => {
        if (!user) return;

        console.warn("AppContext: Initializing listeners...");

        // FAIL-SAFE: If data doesn't load in 8 seconds, force loading = false
        const failSafeTimer = setTimeout(() => {
            setLoading(prev => {
                if (prev) {
                    console.warn("AppContext: Fail-safe triggered! Unblocking UI.");
                    return false;
                }
                return prev;
            });
        }, 8000);

        const qInv = collection(db, 'invoices');
        const qTest = collection(db, 'testInvoices');
        const qComp = query(collection(db, 'companies'), orderBy('name', 'asc'));
        const qPol = collection(db, 'policies');

        // Restaurar caché local si existe (para cuando Firebase no está disponible)
        const restoreLocalCache = () => {
            try {
                const cached = localStorage.getItem('gr_data_cache');
                if (cached) {
                    const { invoices: ci, companies: cc, policies: cp, ts } = JSON.parse(cached);
                    const ageHours = (Date.now() - ts) / 3600000;
                    if (ageHours < 72) { // Cache válido por 72 horas
                        if (ci?.length) setInvoices(ci);
                        if (cc?.length) setCompanies(cc);
                        if (cp?.length) setPolicies(cp);
                        console.warn(`AppContext: Restored from local cache (${ageHours.toFixed(1)}h old)`);
                    }
                }
            } catch (_) {}
        };
        restoreLocalCache();

        const unsubInv = onSnapshot(qInv, (snap) => {
            console.log("AppContext: Invoices received");
            const data = snap.docs.map(doc => {
                const inv = doc.data();
                return {
                    id: doc.id,
                    ...inv,
                    _timestamp: parseDate(inv).getTime(),
                    _normalizedName: normalizeName(inv.company)
                };
            });
            data.sort((a, b) => b._timestamp - a._timestamp);
            setInvoices(data);
            setLoading(false);
            clearTimeout(failSafeTimer);
        }, (err) => {
            console.error("AppContext: Error in invoices listener:", err);
            setLoading(false);
            clearTimeout(failSafeTimer);
        });

        const unsubTest = onSnapshot(qTest, (snap) => {
            const data = snap.docs.map(doc => {
                const inv = doc.data();
                return {
                    id: doc.id,
                    ...inv,
                    _timestamp: parseDate(inv).getTime(),
                    _normalizedName: normalizeName(inv.company)
                };
            });
            data.sort((a, b) => b._timestamp - a._timestamp);
            setTestInvoices(data);
        });

        const unsubComp = onSnapshot(qComp, (snap) => {
            setCompanies(snap.docs.map(doc => {
                const comp = doc.data();
                return { id: doc.id, ...comp, _normalizedName: normalizeName(comp.name) };
            }));
        }, (err) => console.error("AppContext: Error in companies listener:", err));

        const unsubPol = onSnapshot(qPol, (snap) => {
            const data = snap.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            data.sort((a, b) => {
                const timeA = parseDate(a).getTime();
                const timeB = parseDate(b).getTime();
                return timeB - timeA;
            });
            setPolicies(data);
        }, (err) => console.error("AppContext: Error in policies listener:", err));

        const unsubPatterns = onSnapshot(collection(db, 'extraction_patterns'), (snapshot) => {
            const pMap = {};
            snapshot.forEach(doc => {
                pMap[doc.id.toLowerCase()] = doc.data().hints || "";
            });
            setPatterns(pMap);
        });

        const unsubReminders = onSnapshot(
            query(collection(db, 'reminders'), orderBy('createdAt', 'desc')),
            (snap) => setReminders(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
            (err) => console.error("AppContext: Error in reminders listener:", err)
        );

        const unsubSiniestros = onSnapshot(
            query(collection(db, 'siniestros'), orderBy('createdAt', 'desc')),
            (snap) => setSiniestros(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
            (err) => console.error("AppContext: Error in siniestros listener:", err)
        );

        const mobileInboxRef = dbRef(rtdb, 'mobile_inbox');
        const unsubMobileInbox = onValue(mobileInboxRef, (snap) => {
            if (snap.exists()) {
                const items = Object.entries(snap.val()).map(([id, data]) => ({ id, ...data }));
                items.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
                setMobileInbox(items);
            } else {
                setMobileInbox([]);
            }
        }, (err) => console.error("AppContext: Error in mobile_inbox listener:", err));

        return () => {
            clearTimeout(failSafeTimer);
            unsubInv();
            unsubTest();
            unsubComp();
            unsubPol();
            unsubPatterns();
            unsubReminders();
            unsubSiniestros();
            unsubMobileInbox();
        };
    }, [user, parseDate, normalizeName]);

    // Efecto 3: Guardar caché local cuando llegan datos reales de Firestore
    useEffect(() => {
        if (!invoices.length || !companies.length || !policies.length) return;
        const timer = setTimeout(() => {
            try {
                localStorage.setItem('gr_data_cache', JSON.stringify({
                    invoices, companies, policies, ts: Date.now()
                }));
                console.log(`AppContext: Cache saved (${invoices.length} inv, ${companies.length} comp, ${policies.length} pol)`);
            } catch (_) {}
        }, 2000);
        return () => clearTimeout(timer);
    }, [invoices, companies, policies]);

    const login = async (email, password) => {
        // Siempre intentar auth real de Firebase primero
        try {
            return await signInWithEmailAndPassword(auth, email, password);
        } catch (err) {
            console.error("🔥 Firebase Auth error:", err.code, err.message);
            // [ADMIN BYPASS] Solo activar en errores de RED o CONFIG — NUNCA en errores de credenciales
            const isNetworkOrConfigError = [
                'auth/network-request-failed',
                'auth/invalid-api-key',
                'auth/app-deleted',
                'auth/app-not-authorized',
                'auth/internal-error',
            ].includes(err.code);
            if (isNetworkOrConfigError && email === 'grodas@jylbrokers.com.ar' && password === 'Milo110619') {
                console.warn("🔐 Admin Bypass Activated (Firebase sin conexión):", err.code);
                const fakeUser = { email, uid: 'admin_bypass', displayName: 'Gustavo Rodas' };
                setUser(fakeUser);
                localStorage.setItem('admin_bypass', 'true');
                return fakeUser;
            }
            throw err;
        }
    };
    const logout = async () => {
        localStorage.removeItem('admin_bypass');
        setUser(null);
        setInvoices([]);
        setCompanies([]);
        setPolicies([]);
        try { await signOut(auth); } catch (_) {}
    };

    const checkDuplicate = (newInvoice, targetList = invoices) => {
        return targetList.some(inv => {
            const amt1 = Number(inv.amount || 0).toFixed(2);
            const amt2 = Number(newInvoice.amount || 0).toFixed(2);
            const pos1 = (inv.pointOfSale || '').toString().padStart(5, '0');
            const pos2 = (newInvoice.pointOfSale || '').toString().padStart(5, '0');
            const num1 = (inv.number || '').toString().padStart(8, '0');
            const num2 = (newInvoice.number || '').toString().padStart(8, '0');
            const date1 = (inv.date || '').toString().split('T')[0];
            const date2 = (newInvoice.date || '').toString().split('T')[0];

            return amt1 === amt2 && pos1 === pos2 && num1 === num2 && date1 === date2;
        });
    };

    const uniqueInvoices = useMemo(() => {
        const uniqueInvoicesMap = new Map();
        const invoicesLength = invoices.length;

        for (let i = 0; i < invoicesLength; i++) {
            const inv = invoices[i];
            
            // Si el CUIT es del emisor y no hay nombre de compañía, es un residuo de extracción fallida o emisor personal
            // Pero lo procesamos igual para no "perder" data, Dashboard lo marcará como revisión
            if (inv.cuit === '23294824979' && !inv.company) {
                // Si ya tenemos facturas reales, podemos ignorar estas, pero por ahora seamos permisivos
            }

            // Clave de duplicados más robusta: POS-Número-Monto-Fecha
            // Si falta alguno, usamos el ID de Firebase para evitar colisiones catastróficas
            const pos = inv.pointOfSale || 'X';
            const num = inv.number || 'X';
            const amt = inv.amount || 0;
            const time = inv._timestamp || 0;
            
            // Si faltan datos clave, el key DEBE incluir el ID
            const isMalFormed = (pos === 'X' || num === 'X' || time === 0);
            const key = isMalFormed 
                ? `ERR-${inv.id}` 
                : `${pos}-${num}-${time}-${amt}`;

            const existing = uniqueInvoicesMap.get(key);

            // Regla de sobreescritura: si la nueva tiene CUIT real (no del emisor), gana
            if (!existing || (existing.cuit === '23294824979' && inv.cuit !== '23294824979')) {
                uniqueInvoicesMap.set(key, inv);
            }
        }
        
        const result = Array.from(uniqueInvoicesMap.values());
        console.log(`📊 Unificación: ${invoices.length} -> ${result.length} facturas únicas`);
        return result;
    }, [invoices]);

    const fixInboundInvoice = (inv) => {
        const USER_CUIT = '23294824979';
        const IGNORED_NAMES = ['DIEGO GERMAN TRABALON', 'RODAS GUSTAVO RAUL', 'GUSTAVO RODAS', 'TRABALON DIEGO', 'RODAS GUSTAVO'];
        const nameUpper = (inv.company || '').toUpperCase();

        // Detección agresiva: si el CUIT es el del usuario o el nombre coincide con el emisor
        const isUserCuit = inv.cuit === USER_CUIT || (inv.allCuitsFound && Array.isArray(inv.allCuitsFound) && inv.allCuitsFound.includes(USER_CUIT));
        const isUserName = IGNORED_NAMES.some(name => nameUpper.includes(name));

        const needsCorrection = isUserCuit || isUserName || !inv.company;

        if (needsCorrection) {
            console.log("🕵️ Detectada factura con datos de emisor. Intentando auto-corrección...");
            let targetName = '';

            // Search in ALL fields returned by AI
            const searchSource = `${nameUpper} ${(inv.period || '').toUpperCase()} ${(inv.receptorIdentificado || '').toUpperCase()}`;

            // Try to match from allCuitsFound if available
            if (inv.allCuitsFound && Array.isArray(inv.allCuitsFound)) {
                if (inv.allCuitsFound.includes('30500036911')) targetName = 'MERCANTIL ANDINA';
                else if (inv.allCuitsFound.includes('30500049770')) targetName = 'ZURICH';
                else if (inv.allCuitsFound.includes('30500014284')) targetName = 'RIVADAVIA';
                else if (inv.allCuitsFound.includes('33707366589')) targetName = 'FEDERACION PATRONAL';
                else if (inv.allCuitsFound.includes('30500043195')) targetName = 'SANCOR';
            }

            if (!targetName) {
                // Hardcoded mapping logic (Highest priority fallback)
                if (searchSource.includes('MERCANTIL') || searchSource.includes('ANDINA')) targetName = 'MERCANTIL ANDINA';
                else if (searchSource.includes('ZURICH')) targetName = 'ZURICH';
                else if (searchSource.includes('RIVADAVIA')) targetName = 'RIVADAVIA';
                else if (searchSource.includes('SANCOR')) targetName = 'SANCOR';
                else if (searchSource.includes('FEDERACION')) targetName = 'FEDERACION PATRONAL';
                else if (searchSource.includes('SWISS') || searchSource.includes('SMG') || searchSource.includes('MEDICAL')) targetName = 'SMG SEGUROS';
                else if (searchSource.includes('ALLIANZ')) targetName = 'ALLIANZ';
                else if (searchSource.includes('GALICIA')) targetName = 'GALICIA';
                else if (searchSource.includes('EXPERTA')) targetName = 'EXPERTA SEGUROS';
            }

            if (targetName) {
                const normTarget = normalizeName(targetName);
                const targetComp = companies.find(c => normalizeName(c.name) === normTarget);
                if (targetComp && targetComp.cuit && targetComp.cuit !== USER_CUIT) {
                    console.log(`✅ Auto-enlazado exitoso a: ${targetComp.name}`);
                    return { ...inv, company: targetComp.name, cuit: targetComp.cuit, _autoCorrected: true };
                }
            }

            // Si llegamos aquí sin solución, BLOQUEAMOS el nombre personal para el Dashboard
            return {
                ...inv,
                company: '⚠️ REVISIÓN MANUAL REQUERIDA',
                cuit: USER_CUIT,
                _isObserved: true
            };
        }
        return inv;
    };

    const addInvoice = async (invoice) => {
        const fixed = fixInboundInvoice(invoice);

        if (checkDuplicate(fixed)) {
            console.warn("Factura duplicada detectada");
            return false;
        }

        // Seguridad final para no ensuciar el dashboard con tu nombre
        if (fixed.company.includes('REVISIÓN MANUAL') || fixed.cuit === '23294824979') {
            console.warn("⚠️ Factura marcada para revisión (Datos de usuario detectados).");
        }

        await addDoc(collection(db, 'invoices'), {
            ...fixed,
            timestamp: serverTimestamp()
        });
        return true;
    };

    const addTestInvoice = async (invoice) => {
        if (checkDuplicate(invoice) || checkDuplicate(invoice, testInvoices)) {
            console.warn("Factura duplicada detectada en testInvoices o invoices");
            return false;
        }
        const fixed = fixInboundInvoice(invoice);
        await addDoc(collection(db, 'testInvoices'), {
            ...fixed,
            timestamp: serverTimestamp()
        });
        return true;
    };

    const moveAllTestToProd = async () => {
        const prodBatch = writeBatch(db);
        const testBatch = writeBatch(db);
        let movedCount = 0;
        let skippedCount = 0;

        for (const inv of testInvoices) {
            // Verificar duplicados en la lista de producción actual
            if (!checkDuplicate(inv, invoices)) {
                const newRef = doc(collection(db, 'invoices'));
                const { ...data } = inv;
                prodBatch.set(newRef, {
                    ...data,
                    timestamp: serverTimestamp(),
                    migrationDate: serverTimestamp()
                });
                movedCount++;
            } else {
                skippedCount++;
            }
            // Borrar de pruebas independientemente de si se movió o era duplicado
            testBatch.delete(doc(db, 'testInvoices', inv.id));
        }

        if (testInvoices.length > 0) {
            await prodBatch.commit();
            await testBatch.commit();
            alert(`Migración completada:\n✅ ${movedCount} nuevas facturas en historial.\n⚠️ ${skippedCount} duplicados omitidos.\n🗑️ Historial de pruebas vaciado.`);
        } else {
            alert('No hay facturas en pruebas para migrar.');
        }
    };

    const validateAndMoveInvoice = async (testInvoiceId) => {
        const testInvoice = testInvoices.find(inv => inv.id === testInvoiceId);
        if (!testInvoice) return;

        // Limpiar id de prueba para que Firestore genere uno nuevo en invoices
        const { ...invoiceData } = testInvoice;

        // 1. Añadir a invoices
        await addInvoice(invoiceData);

        // El usuario pidió que NO se borren de testInvoices para mantener el historial
        console.log("Factura validada y pasada a producción. Registro mantenido en prueba.");
    };

    const addCompany = async (company) => {
        await addDoc(collection(db, 'companies'), { ...company, isLoaded: false });
    };

    const updateCompany = async (id, data) => {
        await updateDoc(doc(db, 'companies', id), data);
    };

    const updateInvoice = async (id, data) => {
        await updateDoc(doc(db, 'invoices', id), data);
    };

    const updateTestInvoice = async (id, data) => {
        await updateDoc(doc(db, 'testInvoices', id), data);
    };

    const deleteInvoice = async (id) => {
        await deleteDoc(doc(db, 'invoices', id));
    };

    const deleteTestInvoice = async (id) => {
        await deleteDoc(doc(db, 'testInvoices', id));
    };

    const deleteCompany = async (id) => {
        await deleteDoc(doc(db, 'companies', id));
    };

    const repairInvoiceCuits = async () => {
        const batch = writeBatch(db);
        let count = 0;
        let checked = 0;

        const allInvoices = [
            ...invoices.map(i => ({ ...i, collection: 'invoices' })),
            ...testInvoices.map(i => ({ ...i, collection: 'testInvoices' }))
        ];

        allInvoices.forEach(inv => {
            if (inv.cuit === '23294824979') {
                checked++;
                const normTarget = normalizeName(inv.company);
                // Búsqueda más flexible
                const targetComp = companies.find(c => {
                    const normComp = normalizeName(c.name);
                    return normComp === normTarget || normTarget.includes(normComp) || normComp.includes(normTarget);
                });

                if (targetComp && targetComp.cuit && targetComp.cuit !== '23294824979') {
                    const docRef = doc(db, inv.collection, inv.id);
                    batch.update(docRef, { cuit: targetComp.cuit });
                    count++;
                }
            }
        });

        if (count > 0) {
            await batch.commit();
            alert(`✅ Éxito: Se repararon ${count} facturas de ${checked} analizadas.`);
            return count;
        } else {
            alert(`ℹ️ Info: No se encontraron coincidencias para reparar en las ${checked} facturas con CUIT emisor.`);
        }
        return 0;
    };

    const syncCompanyCuits = async () => {
        const batch = writeBatch(db);
        let count = 0;

        companies.forEach(company => {
            // Buscamos si hay facturas de esta empresa con un CUIT diferente al del emisor
            const validInvoice = invoices.find(inv =>
                inv.company.toLowerCase().trim() === company.name.toLowerCase().trim() &&
                inv.cuit &&
                inv.cuit !== '23294824979'
            );

            if (validInvoice && company.cuit !== validInvoice.cuit) {
                const docRef = doc(db, 'companies', company.id);
                batch.update(docRef, { cuit: validInvoice.cuit });
                count++;
            }
        });

        if (count > 0) {
            await batch.commit();
            console.log(`Sincronizados ${count} CUITs de empresas.`);
            return count;
        }
        return 0;
    };

    // --- Gemini Usage Counter (v2.0 con Tokens) ---
    const trackGeminiCall = (source, tokenMetrics = {}) => {
        try {
            const now = new Date();
            const todayKey = now.toISOString().split('T')[0];
            const monthKey = todayKey.substring(0, 7);
            const stored = JSON.parse(localStorage.getItem('geminiUsage') || '{}');
            stored.total = (stored.total || 0) + 1;
            stored.days = stored.days || {};
            stored.days[todayKey] = (stored.days[todayKey] || 0) + 1;
            stored.months = stored.months || {};
            stored.months[monthKey] = (stored.months[monthKey] || 0) + 1;
            stored.lastCall = now.toISOString();

            // Token tracking
            stored.tokens = stored.tokens || {};
            stored.tokens.days = stored.tokens.days || {};
            stored.tokens.months = stored.tokens.months || {};
            stored.tokens.engines = stored.tokens.engines || { Claude: { total: 0 }, Gemini: { total: 0 } };

            const engine = tokenMetrics.engine || 'Gemini';
            const pt = tokenMetrics.promptTokens || 0;
            const ct = tokenMetrics.candidateTokens || 0;
            const tt = tokenMetrics.totalTokens || (pt + ct);

            // Categorizar por Motor
            if (!stored.tokens.engines[engine]) stored.tokens.engines[engine] = { total: 0 };
            stored.tokens.engines[engine].total += tt;

            if (!stored.tokens.days[todayKey]) stored.tokens.days[todayKey] = { prompt: 0, candidate: 0, total: 0 };
            stored.tokens.days[todayKey].prompt += pt;
            stored.tokens.days[todayKey].candidate += ct;
            stored.tokens.days[todayKey].total += tt;

            if (!stored.tokens.months[monthKey]) stored.tokens.months[monthKey] = { prompt: 0, candidate: 0, total: 0 };
            stored.tokens.months[monthKey].prompt += pt;
            stored.tokens.months[monthKey].candidate += ct;
            stored.tokens.months[monthKey].total += tt;

            stored.tokens.totalAll = (stored.tokens.totalAll || 0) + tt;

            // Per-file log (últimos 100)
            stored.log = stored.log || [];
            stored.log.push({
                date: now.toISOString(),
                source,
                promptTokens: pt,
                candidateTokens: ct,
                totalTokens: tt,
                fileName: tokenMetrics.fileName || '',
                clientName: tokenMetrics.clientName || '',
                keyIndex: tokenMetrics.keyIndex || 1,
                modelUsed: tokenMetrics.modelUsed || 'unknown',
                engine: engine
            });
            if (stored.log.length > 100) stored.log = stored.log.slice(-100);

            localStorage.setItem('geminiUsage', JSON.stringify(stored));
            setGeminiUsageState(stored); // <-- Disparar actualización reactiva
            console.log(`📊 [TokenTracker] ${engine} | ${source} | Total: ${tt} (Prompt: ${pt}, Output: ${ct})`);
            if (engine === 'Claude') console.log("🧡 Claude Token Saved:", tt);
        } catch (e) { console.warn('Error guardando uso Gemini/Claude:', e); }
    };

    const getGeminiUsage = useCallback(() => {
        try {
            const now = new Date();
            const todayKey = now.toISOString().split('T')[0];
            const monthKey = todayKey.substring(0, 7);
            const stored = geminiUsageState || JSON.parse(localStorage.getItem('geminiUsage') || '{}');
            const todayTokens = stored.tokens?.days?.[todayKey] || { prompt: 0, candidate: 0, total: 0 };
            const monthTokens = stored.tokens?.months?.[monthKey] || { prompt: 0, candidate: 0, total: 0 };
            const todayCalls = (stored.days || {})[todayKey] || 0;
            const dailyLimit = 1500;
            // Gemini 1.5 Flash pricing: $0.075/1M input, $0.30/1M output
            const estimatedCost = (todayTokens.prompt * 0.000000075) + (todayTokens.candidate * 0.0000003);
            return {
                today: todayCalls,
                thisMonth: (stored.months || {})[monthKey] || 0,
                total: stored.total || 0,
                lastCall: stored.lastCall || null,
                dailyLimit,
                monthlyEstimate: 45000,
                tokensToday: todayTokens,
                tokensMonth: monthTokens,
                tokensTotal: stored.tokens?.totalAll || 0,
                tokensByEngine: stored.tokens?.engines || { Claude: { total: 0 }, Gemini: { total: 0 } },
                estimatedCostToday: estimatedCost,
                quotaPercent: Math.round((todayCalls / dailyLimit) * 100),
                nearLimit: todayCalls >= dailyLimit * 0.8,
                log: (stored.log || []).slice(-20)
            };
        } catch (e) { return { today: 0, thisMonth: 0, total: 0, lastCall: null, dailyLimit: 1500, monthlyEstimate: 45000, tokensToday: { prompt: 0, candidate: 0, total: 0 }, tokensMonth: { prompt: 0, candidate: 0, total: 0 }, tokensTotal: 0, estimatedCostToday: 0, quotaPercent: 0, nearLimit: false, log: [] }; }
    }, [geminiUsageState]);

    const callGeminiREST = async (base64Data, prompt, apiKey, model = "gemini-2.0-flash", version = "v1", systemInstruction = null) => {
        const url = `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent?key=${apiKey}`;
        const body = {
            contents: [
                {
                    parts: [
                        { text: prompt },
                        {
                            inlineData: {
                                mimeType: "application/pdf",
                                data: base64Data
                            }
                        }
                    ]
                }
            ],
            generationConfig: {
                responseMimeType: "application/json",
                temperature: 0
            }
        };
        if (systemInstruction) {
            body.systemInstruction = { parts: [{ text: systemInstruction }] };
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errJson = await response.json().catch(() => ({}));
            throw new Error(`[REST Error] ${response.status}: ${JSON.stringify(errJson)}`);
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error("La IA (REST) no retornó texto.");

        // Extract usage metadata
        const usage = data.usageMetadata || {};
        return {
            text,
            usageMetadata: {
                promptTokens: usage.promptTokenCount || 0,
                candidateTokens: usage.candidatesTokenCount || 0,
                totalTokens: usage.totalTokenCount || 0
            }
        };
    };

    const processInvoiceFile = async (file, preLoadedBase64 = null, onProgress = null) => {
        // Leer el PDF una sola vez
        let base64Data;
        if (preLoadedBase64) {
            base64Data = preLoadedBase64;
        } else {
            if (onProgress) onProgress('Leyendo PDF...', 10);
            const reader = new FileReader();
            base64Data = await new Promise((resolve, reject) => {
                reader.onload = () => resolve(reader.result.split(',')[1]);
                reader.onerror = () => reject(new Error("Error al leer PDF."));
                reader.readAsDataURL(file);
            });
        }

        let parsed;
        let usageMetadata = {};

        // 🚀 BULLETPROOF FALLBACK: Check filename before relying on AI 🚀
        const fileNameUpper = (file?.name || '').toUpperCase();
        if (fileNameUpper.includes('MERCANTIL') || fileNameUpper.includes('ANDINA')) {
            console.log("🛡️ Bulletproof Fallback activado (MERCANTIL ANDINA)");
            parsed = {
                company: 'MERCANTIL ANDINA',
                cuit: '30500036911',
                type: 'Factura C',
                pointOfSale: '00000',
                number: '00000000',
                amount: 0,
                date: new Date().toISOString().split('T')[0],
                period: 'FALLBACK'
            };
        }

        try {
            if (!parsed && onProgress) onProgress('Analizando con IA (Failover Activo)...', 30);
            const companyNames = companies.map(c => c.name);
            const aiResult = parsed ? null : await analyzeInvoice(base64Data, companyNames.join(", "));

            if (!parsed && (!aiResult || !aiResult.data)) throw new Error("La IA retornó una respuesta vacía.");

            if (!parsed) {
                parsed = aiResult.data;
                console.log("🔍 [PARSED IA]:", parsed);
                console.log("💡 [HINTS USED]:", companyNames.join(", "));
                usageMetadata = aiResult.usageMetadata || {};
            }

            if (parsed.error) {
                return { status: 'error', error: parsed.error };
            }

            // Validación de campos obligatorios
            const requiredFields = ['company', 'cuit', 'number', 'amount', 'date'];
            for (const field of requiredFields) {
                if (!parsed[field]) throw new Error(`Archivo no válido para conciliación: falta ${field}`);
            }

            const amount = parseFloat(parsed.amount) || 0;
            const IIBB_DEDUCTION = 0.045; // 4.5%
            const netAmount = amount * (1 - IIBB_DEDUCTION);

            // v2.0: Validación cruzada de CUIT contra tabla de Compañías
            const extractedCuit = (parsed.cuit || '').toString().replace(/[-\s]/g, '').trim();
            let cuitMatch = false;
            try {
                for (const comp of companies) {
                    const compCuit = (comp.cuit || '').toString().replace(/[-\s]/g, '').trim();
                    if (compCuit && compCuit === extractedCuit) {
                        cuitMatch = true;
                        break;
                    }
                }
            } catch (e) {
                console.warn('Error en validación CUIT:', e);
            }

            const invoiceStatus = cuitMatch ? 'Realizada' : 'Observado';

            const fixed = fixInboundInvoice({
                ...parsed,
                netAmount: parseFloat(netAmount.toFixed(2)),
                iibb: parseFloat((parsed.amount * IIBB_DEDUCTION).toFixed(2)),
                pointOfSale: parsed.pointOfSale?.toString().padStart(5, '0') || '00001',
                number: parsed.number?.toString().padStart(8, '0') || '00000000',
                date: parsed.date || new Date().toISOString().split('T')[0],
                status: invoiceStatus
            });

            if (checkDuplicate(fixed)) return { status: 'duplicate', data: fixed };

            // 1. Agregar la factura
            await addInvoice(fixed);

            // 2. Si CUIT coincide → actualizar compañía a "Realizada"
            if (cuitMatch) {
                try {
                    const companiesRef = collection(db, 'companies');
                    const q = query(companiesRef, where('cuit', '==', fixed.cuit));
                    const querySnapshot = await getDocs(q);

                    const batch = writeBatch(db);
                    querySnapshot.forEach((doc) => {
                        batch.update(doc.ref, {
                            status: 'Realizada',
                            lastSync: new Date().toISOString()
                        });
                    });
                    await batch.commit();
                } catch (updateError) {
                    console.warn("No se pudo actualizar el estado de la compañía:", updateError);
                }

                // 3. Marcar notificaciones como completadas
                try {
                    const noticesRef = collection(db, 'notifications');
                    const q = query(noticesRef, where('companyCuit', '==', fixed.cuit), where('status', '!=', 'completada'));
                    const querySnapshot = await getDocs(q);

                    const batch = writeBatch(db);
                    querySnapshot.forEach((doc) => {
                        batch.update(doc.ref, { status: 'completada', color: 'green' });
                    });
                    await batch.commit();
                } catch (noticeError) {
                    console.warn("No se pudieron actualizar las notificaciones:", noticeError);
                }
            } else {
                console.warn(`⚠️ CUIT ${extractedCuit} no encontrado en la tabla de Compañías. Estado: Observado.`);
            }

            trackGeminiCall('Upload Factura IA', { ...usageMetadata, fileName: file?.name || parsed.company || '' });
            console.log(`✅ IA Exitosa - ${fixed.company} [${invoiceStatus}]`);
            return { status: cuitMatch ? 'success' : 'observed', data: fixed, cuitMatch };

        } catch (err) {
            console.error("Error en processInvoiceFile (Gemini Helper):", err);
            return {
                status: 'error',
                error: `[IA Falló tras todos los intentos] Último error: ${err.message || "Desconocido"}.`
            };
        }
    };

    // Extrae texto de las páginas clave de un PDF (páginas 1-4 + última) para SMG AP
    const extractKeyPagesText = async (base64Data) => {
        try {
            const binary = atob(base64Data);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
            const total = pdf.numPages;
            const pagesToRead = [...new Set([1, 2, 3, 4, total])].filter(p => p <= total);
            let text = '';
            for (const p of pagesToRead) {
                const page = await pdf.getPage(p);
                const content = await page.getTextContent();
                text += content.items.map(i => i.str).join(' ') + '\n';
            }
            return text;
        } catch (e) {
            console.warn('extractKeyPagesText falló:', e.message);
            return '';
        }
    };

    const analyzePolicyWithAI = async (base64Data) => {
        const result = await analyzePolicy(base64Data);
        trackGeminiCall('Re-Analisis IA', result.usageMetadata || {});
        return result.data;
    };

    // --- NUEVA LÓGICA CENTRALIZADA DE SUBIDA IA ---

    /**
     * Procesa cualquier archivo mediante IA de forma genérica
     * @param {File} file - El archivo del input
     * @param {'policy'|'invoice'|'csv'} targetType - Qué se espera extraer
     */
    const processFileWithAI = async (file, targetType, onProgress) => {
        try {
            if (onProgress) onProgress('Leyendo archivo...', 10);

            const isText = targetType === 'csv';
            let fileContent;

            if (isText) {
                fileContent = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target.result);
                    reader.onerror = reject;
                    reader.readAsText(file);
                });
            } else {
                fileContent = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target.result.split(',')[1]);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });
            }

            if (onProgress) onProgress('Analizando con IA...', 40);

            let result;
            if (targetType === 'policy') {
                // Inteligencia J&L: Buscar patrones para esta carga
                const fileNameNorm = normalizeName(file.name || '');

                // Detección SMG / Caución o Accidentes Personales (mapa de calor — extrae solo páginas clave)
                const isSMGLike = fileNameNorm.includes('smg') || fileNameNorm.includes('swiss') ||
                    fileNameNorm.includes('accidente') || fileNameNorm.includes('acc personal') ||
                    fileNameNorm.includes('caucion') || fileNameNorm.includes('caución');
                if (isSMGLike) {
                    console.log('🔥 [SMG] Detectado — extrayendo páginas clave para clasificar...');
                    if (onProgress) onProgress('Extrayendo páginas clave SMG...', 25);
                    const keyText = await extractKeyPagesText(fileContent);
                    const isCaucion = keyText && (keyText.includes('CAUCION') || keyText.includes('CAUCIÓN') || keyText.includes('Caución'));
                    const isSMGContent = keyText && (keyText.includes('SMG') || keyText.includes('SWISS') || keyText.includes('Swiss'));
                    if (isCaucion && isSMGContent) {
                        if (onProgress) onProgress('Analizando póliza de caución SMG...', 50);
                        result = await analyzeSMGCaucionPolicy(keyText);
                        trackGeminiCall('SMG Caución Análisis', result.usageMetadata || {});
                    } else if (isSMGContent && keyText.includes('ACCIDENTES')) {
                        if (onProgress) onProgress('Analizando nómina de asegurados...', 50);
                        result = await analyzeSMGPolicy(keyText);
                        trackGeminiCall('SMG AP Análisis', result.usageMetadata || {});
                    } else {
                        result = await analyzePolicy(fileContent);
                    }
                } else {
                    let hints = "";
                    for (const [compKey, patternHints] of Object.entries(patterns)) {
                        if (fileNameNorm.includes(compKey)) {
                            hints = patternHints;
                            console.log(`🧠 Usando patrón de extracción para: ${compKey}`);
                            break;
                        }
                    }
                    result = await analyzePolicy(fileContent, hints);
                }
            } else if (targetType === 'invoice') {
                const companyNames = companies.map(c => c.name);
                result = await analyzeInvoice(fileContent, companyNames.join(", "));
            } else if (targetType === 'csv') result = await analyzeCSV(fileContent);

            if (onProgress) onProgress('Procesamiento completado', 100);

            // POST-PROCESSING: Validar DNI (igual que en handleUnifiedSmartUpload)
            if (result.data && result.data.dni !== undefined) {
                const dniRaw = String(result.data.dni || '').replace(/[^0-9]/g, '');
                const riskLower = (result.data.riskType || '').toLowerCase();
                const isCuitAllowed = riskLower.includes('caución') || riskLower.includes('caucion') || riskLower.includes('art');
                if (!isCuitAllowed && dniRaw.length !== 7 && dniRaw.length !== 8) {
                    result.data.dni = '';
                }
            }

            return {
                status: 'success',
                data: result.data,
                usage: result.usageMetadata,
                fileBase64: !isText ? fileContent : null,
                fileName: file.name,
                fileType: file.type
            };
        } catch (error) {
            console.error("Error en processFileWithAI:", error);
            return { status: 'error', error: error.message };
        }
    };

    /**
     * Guarda una póliza analizada con lógica de Smart Merge y Chunks
     */
    const savePolicyResult = async (policyData, fileInfo) => {
        const { fileBase64, fileName, fileType } = fileInfo;

        // Validaciones de seguridad anti-crasheos en Firestore
        const safePolicyNumber = policyData.policyNumber ? policyData.policyNumber.toString().trim() : `PENDING-${Date.now()}`;
        if (!policyData.clientName || policyData.clientName.trim() === '') policyData.clientName = 'CLIENTE SIN NOMBRE';
        if (!policyData.dni) policyData.dni = '00000000';
        if (!policyData.company) policyData.company = 'COMPAÑÍA DESCONOCIDA';

        policyData.policyNumber = safePolicyNumber;

        // Smart Merge Logic: buscar por número de póliza siempre que sea válido
        // (no PENDING-). Normaliza el número quitando '#' y espacios para evitar
        // falsos negativos cuando el PDF extrae '#260040629288' vs '260040629288'.
        const hasValidPolicyNumber = !safePolicyNumber.includes('PENDING-');
        const normalizePN = (pn) => (pn || '').toString().trim().replace(/^#+/, '').trim();
        const normalizedSafePN = normalizePN(safePolicyNumber);

        // Buscar primero en el estado local (ya cargado en memoria, más robusto que query exacta)
        const existingInState = hasValidPolicyNumber
            ? policies.find(p => normalizePN(p.policyNumber) === normalizedSafePN)
            : null;

        // Si no está en estado local, hacer query a Firestore con ambas variantes
        let snap = { empty: true };
        if (hasValidPolicyNumber && !existingInState) {
            const [snap1, snap2] = await Promise.all([
                getDocs(query(collection(db, 'policies'), where('policyNumber', '==', normalizedSafePN))),
                getDocs(query(collection(db, 'policies'), where('policyNumber', '==', '#' + normalizedSafePN)))
            ]);
            snap = !snap1.empty ? snap1 : snap2;
        }

        const safePolicyData = sanitizeFirestoreData(policyData);

        // Resolver clientId antes de guardar
        const clientId = await resolveClientId(db, policyData.clientName, policyData.dni);
        safePolicyData.clientId = clientId;

        const attachment = {
            chunked: true,
            name: fileName,
            type: fileType || 'application/pdf',
            timestamp: new Date().toISOString()
        };

        if (existingInState || !snap.empty) {
            const existingId = existingInState ? existingInState.id : snap.docs[0].id;
            const oldRaw = existingInState || snap.docs[0].data();

            // Smart Field Merge para endosos: prima/premio/vigencia siempre vienen del nuevo;
            // el resto se actualiza solo si el nuevo tiene un valor no vacío.
            const alwaysFromNew = new Set(['prima', 'premio', 'startDate', 'endDate', 'policySubtype', 'isRenewal', 'insuredSum']);
            const mergedData = { ...sanitizeFirestoreData(oldRaw) };

            for (const [key, val] of Object.entries(safePolicyData)) {
                if (key === 'riskDetails') continue; // lo manejamos aparte
                const isEmpty = val === null || val === undefined || val === '' || val === 0;
                if (alwaysFromNew.has(key) || !isEmpty) {
                    mergedData[key] = val;
                }
            }

            // Deep merge de riskDetails: preserva chasis/motor/coberturas antiguas si el nuevo no las tiene
            const oldRD = mergedData.riskDetails || {};
            const newRD = safePolicyData.riskDetails || {};
            const oldVeh = oldRD.vehicle || {};
            const newVeh = newRD.vehicle || {};
            const mergedVehicle = { ...oldVeh };
            for (const [k, v] of Object.entries(newVeh)) {
                if (v !== null && v !== undefined && v !== '') mergedVehicle[k] = v;
            }
            mergedData.riskDetails = {
                ...oldRD,
                ...newRD,
                vehicle: mergedVehicle
            };

            // Borrar chunks del archivo anterior y el documento anterior
            await deleteFileChunks(existingId);
            await deleteDoc(doc(db, 'policies', existingId));

            // Crear documento nuevo con datos mergeados
            const newDoc = await addDoc(collection(db, 'policies'), {
                ...mergedData,
                attachments: [attachment],
                createdAt: serverTimestamp(),
                timestamp: serverTimestamp(),
                updatedAt: serverTimestamp()
            });

            if (fileBase64) await saveFileChunks(newDoc.id, fileBase64, fileName, fileType);

            // Actualización optimista: reemplazar en estado local sin esperar onSnapshot.
            // Verifica que el onSnapshot no haya llegado primero para evitar duplicado visual.
            const newPolicyLocal = { id: newDoc.id, ...mergedData, attachments: [attachment], timestamp: new Date() };
            setPolicies(prev => {
                const withoutOld = prev.filter(p => p.id !== existingId);
                if (withoutOld.some(p => p.id === newDoc.id)) return withoutOld; // ya llegó por onSnapshot
                return [newPolicyLocal, ...withoutOld];
            });

            return { status: 'replaced', id: newDoc.id };
        } else {
            const newDoc = await addDoc(collection(db, 'policies'), {
                ...safePolicyData,
                attachments: [attachment],
                createdAt: serverTimestamp(),
                timestamp: serverTimestamp(),
                updatedAt: serverTimestamp()
            });

            if (fileBase64) await saveFileChunks(newDoc.id, fileBase64, fileName, fileType);

            // Actualización optimista: agregar al estado local sin esperar onSnapshot.
            // Verifica que el onSnapshot no haya llegado primero para evitar duplicado visual.
            const newPolicyLocal = { id: newDoc.id, ...safePolicyData, attachments: [attachment], timestamp: new Date() };
            setPolicies(prev => {
                if (prev.some(p => p.id === newDoc.id)) return prev; // ya llegó por onSnapshot
                return [newPolicyLocal, ...prev];
            });

            return { status: 'created', id: newDoc.id };
        }
    };

    const processCSVWithAI = async (textData, onProgress) => {
        try {
            if (onProgress) onProgress('Analizando CSV con IA...', 30);

            const apiKey = (GEMINI_API_KEY || "").trim();
            if (!apiKey || apiKey === "PONER_NUEVA_KEY_AQUI") {
                throw new Error("API Key de Gemini no configurada.");
            }
            const modelName = "gemini-2.0-flash";
            const genAI = new GoogleGenerativeAI(apiKey);
            const currentModel = genAI.getGenerativeModel({ model: modelName });

            const prompt = `ACTÚA COMO UN EXPERTO EN SEGUROS. Analiza este texto extraído de un EXCEL/CSV de pólizas.
            Extrae TODOS los registros que encuentres. 
            Retorna UN ARRAY DE OBJETOS JSON con este formato:
            [{ 
                "clientName": string, 
                "dni": string, 
                "riskType": "Auto" | "Hogar" | "ART" | "Vida" | "Otro", 
                "policyNumber": string, 
                "company": string (ej: SMG Seguros), 
                "prima": number, 
                "premio": number,
                "currency": "ARS" | "USD",
                "startDate": "YYYY-MM-DD",
                "endDate": "YYYY-MM-DD",
                "isRenewal": boolean,
                "insuredSum": number,
                "address": string
            }]
            
            TEXTO:
            ${textData}`;

            const result = await currentModel.generateContent(prompt);
            const text = result.response.text();
            const jsonMatch = text.match(/\[[\s\S]*\]/);
            const parsed = JSON.parse((jsonMatch ? jsonMatch[0] : text).replace(/```json|```/g, "").trim());

            if (result.usageMetadata) {
                trackGeminiCall('CSV/Excel IA', { ...result.usageMetadata, fileName: 'Planilla de Datos' });
            } else {
                trackGeminiCall('CSV/Excel IA');
            }
            
            if (onProgress) onProgress('Procesamiento completado', 100);
            return { status: 'success', data: result.data };

        } catch (error) {
            console.error("Error procesando CSV con IA:", error);
            return { status: 'error', error: error.message };
        }
    };

    /**
     * Lógica MAESTRA J&L: Clasificación automática y guardado inteligente
     */
    const handleUnifiedSmartUpload = async (file, onProgress) => {
        if (quotaLock.isLocked) {
            throw new Error(`Sistema en enfriamiento. Reintente en ${quotaLock.remainingSeconds} segundos.`);
        }
        try {
            if (onProgress) onProgress('Leyendo archivo...', 10);
            const reader = new FileReader();
            const base64Content = await new Promise((resolve, reject) => {
                reader.onload = (e) => resolve(e.target.result.split(',')[1]);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

            // 🚀 BULLETPROOF FALLBACK: Check filename before relying on AI MAESTRA 🚀
            const fileNameUpper = (file?.name || '').toUpperCase();
            let documentType = null;
            let extractedData = null;
            let mercantilCoveragesExtracted = false; // flag para pólizas Mercantil Integral/Combinado

            // Solo aplicar fallback de FACTURA si el nombre NO indica que es una póliza
            const isPolicyKeywordInName = fileNameUpper.includes('POLIZA') || fileNameUpper.includes('PÓLIZA')
                || fileNameUpper.includes('COMBINADO') || fileNameUpper.includes('FAMILIAR')
                || fileNameUpper.includes('CONSORCIO') || fileNameUpper.includes('COMERCIO')
                || fileNameUpper.includes('INTEGRAL') || fileNameUpper.includes('AUTOMOTOR')
                || fileNameUpper.includes('HOGAR') || fileNameUpper.includes('COBERTURA');

            if ((fileNameUpper.includes('MERCANTIL') || fileNameUpper.includes('ANDINA')) && !isPolicyKeywordInName) {
                console.log("🛡️ Bulletproof Fallback UI activado (MERCANTIL ANDINA FACTURA)");
                documentType = 'FACTURA';
                extractedData = {
                    company: 'MERCANTIL ANDINA',
                    cuit: '30500036911',
                    type: 'Factura C',
                    pointOfSale: '00000',
                    number: '00000000',
                    amount: 0,
                    date: new Date().toISOString().split('T')[0],
                    period: 'FALLBACK'
                };
            } else {
                if (onProgress) onProgress('Analizando documento...', 30);
                const companyNames = companies.map(c => c.name);

                // --- INTEGRACIÓN J&L: HEAT MAPPING ---
                let isMapped = false;
                let isScanned = false;
                let companyType = ''; // 'FEDERACION', 'EXPERTA_SEGUROS', 'EXPERTA_ART', 'BARBUSS'

                try {
                    // 1. Detección Federación
                    const fedData = await VisualProcessor.detectFederacion(base64Content, fileNameUpper);
                    if (fedData && fedData.type === 'FEDERACION') {
                        isMapped = true;
                        companyType = 'FEDERACION';
                        if (fedData.isScanned) isScanned = true;
                    }

                    // 2. Detección Experta (si no se mapeó aún)
                    if (!isMapped) {
                        const expData = await VisualProcessor.detectExperta(base64Content, fileNameUpper);
                        if (expData && expData.type) {
                            isMapped = true;
                            companyType = expData.type;
                            if (expData.isScanned) isScanned = true;
                        }
                    }

                    // 3. Detección Galicia (si no se mapeó aún)
                    if (!isMapped) {
                        const galData = await VisualProcessor.detectGalicia(base64Content, fileNameUpper);
                        if (galData && galData.type === 'GALICIA_SEGUROS') {
                            isMapped = true;
                            companyType = 'GALICIA_SEGUROS';
                            isScanned = true; // FORZADO: Siempre visual para Galicia por pedido del usuario
                        }
                    }
                } catch (visualError) {
                    console.warn(`⚠️ [VISUAL GUARD] Falló la detección visual temprana. Pasando a métodos basados en texto:`, visualError);
                }

                // --- [NUEVO] OPTIMIZACIÓN v21.3 - FLUJO HÍBRIDO (TEXT -> VISION) ---
                let localText = '';
                let isTextOptimized = false; // Flag para saltar el bloque de heat mapping visual

                try {
                    if (onProgress) onProgress('Buscando texto legible...', 30);
                    localText = await VisualProcessor.extractFullText(base64Content, 5);
                } catch (textExtractionError) {
                    console.warn(`⚠️ [TEXT GUARD] Fallo al extraer texto previo. Posible PDF encriptado o imagen pura.`, textExtractionError);
                }

                // Detección anticipada SMG Caución (antes del optimizer genérico)
                const fileNameUpperSMG = (file?.name || '').toUpperCase();
                const localTextUpper = (localText || '').toUpperCase();
                const isSMGCaucionDoc = (fileNameUpperSMG.includes('CAUCION') || fileNameUpperSMG.includes('CAUCIÓN') || localTextUpper.includes('CAUCION') || localTextUpper.includes('CAUCIÓN'))
                    && (fileNameUpperSMG.includes('SMG') || fileNameUpperSMG.includes('SWISS') || localTextUpper.includes('SMG') || localTextUpper.includes('SWISS MEDICAL'));

                if (!isMapped && isSMGCaucionDoc && localText && localText.length > 100) {
                    console.log('🔥 [SMG CAUCION] Detectado en Smart Upload — usando prompt especializado...');
                    if (onProgress) onProgress('Analizando póliza de caución SMG...', 45);
                    try {
                        const caucionResult = await analyzeSMGCaucionPolicy(localText);
                        documentType = 'POLIZA';
                        extractedData = caucionResult.data;
                        if (extractedData && (extractedData.clientName || extractedData.policyNumber)) {
                            trackGeminiCall('🔥 SMG CAUCION', { ...caucionResult.usageMetadata, fileName: file.name, clientName: extractedData.clientName });
                            isTextOptimized = true;
                        }
                    } catch (caucionErr) {
                        console.warn('⚠️ [SMG CAUCION] Error, continuando con flujo estándar:', caucionErr);
                    }
                }

                // Detección Mercantil Andina — Autos vs Integral
                const isMercantilAndina = localTextUpper.includes('MERCANTIL ANDINA') || localTextUpper.includes('LA MERCANTIL ANDINA');
                const isMercantilAutoSection = isMercantilAndina && localTextUpper.includes('AUTOMOTORES');
                const isMercantilIntegral = isMercantilAndina && !isMercantilAutoSection && (
                    localTextUpper.includes('CONSORCIO') || localTextUpper.includes('COMERCIO')
                    || localTextUpper.includes('SUPLEMENTO ADICIONAL')
                    || localTextUpper.includes('COMBINADO')
                    || localTextUpper.includes('FAMILIAR')
                    || (localTextUpper.includes('INCENDIO') && localTextUpper.includes('CRISTALES'))
                );
                // También detectar por nombre de archivo
                const fileNameUpperLocal = (file?.name || '').toUpperCase();
                const isMercantilAutoByName = (fileNameUpperLocal.includes('AUTO') || fileNameUpperLocal.includes('AUTOMOTOR'))
                    && (fileNameUpperLocal.includes('MERCANTIL') || fileNameUpperLocal.includes('ANDINA'));
                const isMercantilIntegralByName = !isMercantilAutoByName
                    && (fileNameUpperLocal.includes('CONSORCIO') || fileNameUpperLocal.includes('COMERCIO') || fileNameUpperLocal.includes('INTEGRAL') || fileNameUpperLocal.includes('COMBINADO') || fileNameUpperLocal.includes('FAMILIAR'))
                    && (fileNameUpperLocal.includes('MERCANTIL') || fileNameUpperLocal.includes('ANDINA'));

                // Path: Mercantil Andina AUTOS
                if (!isMapped && !isTextOptimized && (isMercantilAutoSection || isMercantilAutoByName) && localText && localText.length > 100) {
                    console.log('🚗 [MERCANTIL AUTO] Detectado — analizando póliza de autos Mercantil Andina...');
                    if (onProgress) onProgress('Analizando póliza de autos Mercantil Andina...', 45);
                    try {
                        const fullText = await VisualProcessor.extractFullText(base64Content, 4);
                        const textForAnalysis = (fullText && fullText.length > localText.length) ? fullText : localText;
                        const autoResult = await analyzeMercantilAutoPolicy(textForAnalysis);
                        documentType = 'POLIZA';
                        extractedData = autoResult.data;
                        if (extractedData) {
                            // Mercantil Auto nunca tiene DNI — limpieza determinista
                            extractedData.dni = '';
                            // Asegurar riskType correcto
                            extractedData.riskType = 'Autos';
                            trackGeminiCall('🚗 MERCANTIL AUTO', { ...autoResult.usageMetadata, fileName: file.name, clientName: extractedData.clientName });
                            isTextOptimized = true;
                        }
                    } catch (mercantilAutoErr) {
                        console.warn('⚠️ [MERCANTIL AUTO] Error, continuando con flujo estándar:', mercantilAutoErr);
                    }
                }

                // Path: Mercantil Andina INTEGRAL (Consorcio/Comercio/Combinado Familiar)
                if (!isMapped && !isTextOptimized && (isMercantilIntegral || isMercantilIntegralByName) && localText && localText.length > 100) {
                    console.log('🔥 [MERCANTIL INTEGRAL] Detectado — extrayendo datos de póliza Mercantil Andina...');
                    if (onProgress) onProgress('Analizando póliza Mercantil Andina...', 45);
                    try {
                        // Llamada 1 (texto): extrae clientName, policyNumber, prima, premio, etc.
                        const fullText = await VisualProcessor.extractFullText(base64Content, 6);
                        const textForAnalysis = (fullText && fullText.length > localText.length) ? fullText : localText;
                        const integralResult = await analyzeMercantilIntegralPolicy(textForAnalysis);
                        documentType = 'POLIZA';
                        extractedData = integralResult.data;
                        if (extractedData && (extractedData.clientName || extractedData.policyNumber)) {
                            trackGeminiCall('🔥 MERCANTIL INTEGRAL', { ...integralResult.usageMetadata, fileName: file.name, clientName: extractedData.clientName });
                            isTextOptimized = true;
                        }
                        // Llamada 2 (visual): extrae coberturas desde imágenes de páginas 2-5
                        // (el layout de columnas no se preserva en texto plano)
                        try {
                            if (onProgress) onProgress('Extrayendo coberturas (visual)...', 65);
                            const pagesImages = await VisualProcessor.renderPagesAsImages(base64Content, 2, 5);
                            const coveragesResult = await analyzeMercantilIntegralCoverages(pagesImages);
                            if (coveragesResult.data && Array.isArray(coveragesResult.data.coverages) && coveragesResult.data.coverages.length > 0) {
                                if (!extractedData) extractedData = {};
                                if (!extractedData.riskDetails) extractedData.riskDetails = {};
                                extractedData.riskDetails.coverages = coveragesResult.data.coverages;
                                if (coveragesResult.data.insuredSum) extractedData.insuredSum = coveragesResult.data.insuredSum;
                                mercantilCoveragesExtracted = true;
                                trackGeminiCall('🛡️ MERCANTIL COBERTURAS (visual)', { ...coveragesResult.usageMetadata, fileName: file.name });
                            } else {
                                console.warn('⚠️ [MERCANTIL COBERTURAS] Visual retornó vacío — intentando desde texto...');
                            }
                        } catch (covErr) {
                            console.warn('⚠️ [MERCANTIL COBERTURAS] Error visual:', covErr);
                        }
                        // Llamada 3 (texto fallback): si visual falló, intenta extraer coberturas del texto
                        if (!mercantilCoveragesExtracted && textForAnalysis && textForAnalysis.length > 200) {
                            try {
                                if (onProgress) onProgress('Extrayendo coberturas (texto fallback)...', 75);
                                const textCovResult = await analyzeMercantilCoveragesFromText(textForAnalysis);
                                if (textCovResult.data && Array.isArray(textCovResult.data.coverages) && textCovResult.data.coverages.length > 0) {
                                    if (!extractedData) extractedData = {};
                                    if (!extractedData.riskDetails) extractedData.riskDetails = {};
                                    extractedData.riskDetails.coverages = textCovResult.data.coverages;
                                    if (textCovResult.data.insuredSum) extractedData.insuredSum = textCovResult.data.insuredSum;
                                    mercantilCoveragesExtracted = true;
                                    trackGeminiCall('🛡️ MERCANTIL COBERTURAS (texto)', { ...textCovResult.usageMetadata, fileName: file.name });
                                }
                            } catch (textCovErr) {
                                console.warn('⚠️ [MERCANTIL COBERTURAS TEXTO] Error:', textCovErr);
                            }
                        }
                    } catch (mercantilErr) {
                        console.warn('⚠️ [MERCANTIL INTEGRAL] Error, continuando con flujo estándar:', mercantilErr);
                    }
                }

                // Path: Combinado Familiar / Integral de Consorcio — Compañías genéricas (no Mercantil Andina)
                const isCombinadoIntegralKeyword = (
                    localTextUpper.includes('COMBINADO FAMILIAR') || localTextUpper.includes('HOGAR MULTIRIESGO') ||
                    localTextUpper.includes('MULTIRIESGO HOGAR') || localTextUpper.includes('CONSORCIO') ||
                    localTextUpper.includes('INTEGRAL DE COMERCIO') || localTextUpper.includes('RIESGO PATRIMONIAL')
                );
                const isNotMercantil = !localTextUpper.includes('MERCANTIL ANDINA') && !localTextUpper.includes('LA MERCANTIL');
                const notYetProcessed = !isMapped && !isTextOptimized;
                if (notYetProcessed && isCombinadoIntegralKeyword && isNotMercantil && localText && localText.length > 200) {
                    console.log('🏠 [COMBINADO/INTEGRAL] Detectado (no Mercantil) — analizando con prompt especializado...');
                    if (onProgress) onProgress('Analizando póliza Combinado/Integral...', 45);
                    try {
                        const fullText = await VisualProcessor.extractFullText(base64Content, 6);
                        const textForCI = (fullText && fullText.length > localText.length) ? fullText : localText;
                        const ciResult = await analyzeCombinadoIntegralPolicy(textForCI);
                        documentType = 'POLIZA';
                        if (ciResult.data && (ciResult.data.clientName || ciResult.data.policyNumber)) {
                            extractedData = ciResult.data;
                            trackGeminiCall('🏠 COMBINADO/INTEGRAL', { ...ciResult.usageMetadata, fileName: file.name, clientName: extractedData.clientName });
                            isTextOptimized = true;
                        }
                    } catch (ciErr) {
                        console.warn('⚠️ [COMBINADO/INTEGRAL] Error, continuando con flujo estándar:', ciErr);
                    }
                }

                if (!isMapped && !isTextOptimized && localText && localText.length > 500) {
                    console.log(`⚡ [OPTIMIZER] Texto local detectado (${localText.length} chars). Usando motor de texto barato.`);
                    if (onProgress) onProgress('Procesando texto (Ahorro Tokens)...', 40);
                    try {
                        const textResult = await analyzePolicyTextOnly(localText);
                        documentType = 'POLIZA';
                        extractedData = textResult.data;

                        // Si logramos extraer datos mínimos, terminamos aquí
                        if (extractedData && (extractedData.clientName || extractedData.policyNumber)) {
                            trackGeminiCall('⚡ TEXTO (Local OCR)', { ...textResult.usageMetadata, fileName: file.name, clientName: extractedData.clientName });
                            isTextOptimized = true; // Usar flag propio para no disparar heat mapping
                        } else {
                            console.warn("⚠️ [OPTIMIZER] Texto insuficiente o datos inválidos. Pasando a Vision fallback.");
                        }

                        // Fallback: si el optimizer genérico corrió pero la empresa es Mercantil Andina
                        // y el riskType quedó genérico, re-procesar con prompt especializado
                        if (isTextOptimized && extractedData) {
                            const compUpper = (extractedData.company || '').toUpperCase();
                            const riskRaw = (extractedData.riskType || '').toLowerCase();
                            const isMercantilResult = compUpper.includes('MERCANTIL') || compUpper.includes('ANDINA');
                            const isGenericRisk = !riskRaw || riskRaw === 'otro' || riskRaw === 'otros' || riskRaw === 'other';
                            const textHasAuto = localTextUpper.includes('AUTOMOTORES');
                            const textHasIntegral = !textHasAuto && (
                                localTextUpper.includes('CONSORCIO') || localTextUpper.includes('COMERCIO')
                                || localTextUpper.includes('SUPLEMENTO ADICIONAL')
                                || (localTextUpper.includes('INCENDIO') && localTextUpper.includes('CRISTALES'))
                            );
                            if (isMercantilResult && isGenericRisk) {
                                if (textHasAuto) {
                                    console.log('🔄 [MERCANTIL AUTO FALLBACK] Re-analizando como póliza de autos...');
                                    try {
                                        const fullText = await VisualProcessor.extractFullText(base64Content, 4);
                                        const autoResult = await analyzeMercantilAutoPolicy(fullText || localText);
                                        if (autoResult.data && (autoResult.data.clientName || autoResult.data.policyNumber)) {
                                            extractedData = autoResult.data;
                                            trackGeminiCall('🔄 MERCANTIL AUTO (fallback)', { ...autoResult.usageMetadata, fileName: file.name });
                                        }
                                    } catch (fbErr) {
                                        console.warn('⚠️ [MERCANTIL AUTO FALLBACK] Error:', fbErr);
                                    }
                                } else if (textHasIntegral) {
                                    console.log('🔄 [MERCANTIL INTEGRAL FALLBACK] Re-analizando con prompt especializado...');
                                    try {
                                        const fullText = await VisualProcessor.extractFullText(base64Content, 6);
                                        const integralResult = await analyzeMercantilIntegralPolicy(fullText || localText);
                                        if (integralResult.data && (integralResult.data.clientName || integralResult.data.policyNumber)) {
                                            extractedData = integralResult.data;
                                            trackGeminiCall('🔄 MERCANTIL INTEGRAL (fallback)', { ...integralResult.usageMetadata, fileName: file.name });
                                        }
                                    } catch (fbErr) {
                                        console.warn('⚠️ [MERCANTIL INTEGRAL FALLBACK] Error:', fbErr);
                                    }
                                }
                            }
                        }
                    } catch (textErr) {
                        console.warn("⚠️ [OPTIMIZER] Error en motor de texto, intentando Vision:", textErr);
                    }
                }
                // --- FIN OPTIMIZACIÓN v21.3 ---

                try {
                    // 4. Detección Barbuss (si no se mapeó aún y el optimizer no terminó)
                    if (!isMapped && !isTextOptimized) {
                        const barData = await VisualProcessor.detectBarbuss(base64Content, fileNameUpper);
                        if (barData && barData.type === 'BARBUSS') {
                            isMapped = true;
                            companyType = 'BARBUSS';
                            if (barData.isScanned) isScanned = true;
                        }
                    }
                } catch (barbussErr) {
                    console.warn(`⚠️ [VISUAL GUARD] Falló detección de Barbuss:`, barbussErr);
                }

                if (isMapped && !isTextOptimized) {
                    try {
                        const isFed = companyType === 'FEDERACION';
                        const isExp = companyType.startsWith('EXPERTA');

                        if (isScanned) {
                            if (onProgress) onProgress(`Motor Visual: Fragmentos ${companyType}...`, 45);
                            let mappedImgData;
                            if (isFed) mappedImgData = await VisualProcessor.processFederacionScanned(base64Content);
                            else if (companyType === 'GALICIA_SEGUROS') mappedImgData = await VisualProcessor.processGaliciaScanned(base64Content);
                            else if (companyType === 'BARBUSS') mappedImgData = await VisualProcessor.processBarbussScanned(base64Content);
                            else mappedImgData = await VisualProcessor.processExpertaScanned(base64Content, companyType);

                            if (onProgress) onProgress('IA Visual: Reconstruyendo datos...', 65);
                            const aiResult = await analyzeVisualMappedPolicy(mappedImgData.imageSnippets, companyType);
                            documentType = 'POLIZA';
                            extractedData = aiResult.data;
                            trackGeminiCall(`🔥 VISUAL ${companyType}`, { ...aiResult.usageMetadata, fileName: file.name });
                        } else {
                            if (onProgress) onProgress(`Optimizando lectura: Heatmap ${companyType}...`, 40);
                            let mappedData;
                            if (isFed) mappedData = await VisualProcessor.processFederacion(base64Content);
                            else if (companyType === 'GALICIA_SEGUROS') mappedData = await VisualProcessor.processGalicia(base64Content);
                            else if (companyType === 'BARBUSS') mappedData = await VisualProcessor.processBarbuss(base64Content);
                            else mappedData = await VisualProcessor.processExperta(base64Content, companyType);

                            if (onProgress) onProgress('Extrayendo datos con IA optimizada...', 60);
                            const aiResult = await analyzeMappedPolicy(mappedData.snippet);
                            documentType = 'POLIZA';
                            extractedData = aiResult.data;
                            trackGeminiCall(`⚡ TEXTO ${companyType}`, { ...aiResult.usageMetadata, fileName: file.name });
                        }

                        // BLINDAJE FINAL: Si la IA devolvió el nombre del productor por error, lo limpiamos
                        if (extractedData && extractedData.clientName) {
                            const producerName = "RODAS GUSTAVO RAUL";
                            const producerCuit = "23294824979";
                            const producerCuitAlt = "23-29482497-9";
                            
                            const nameUpper = extractedData.clientName.toUpperCase();
                            if (nameUpper.includes(producerName) || nameUpper.includes(producerCuit) || nameUpper.includes(producerCuitAlt)) {
                                console.warn("🛡️ [GUARD] Se detectó nombre del productor en el campo de cliente. Limpiando...");
                                extractedData.clientName = ""; 
                            }
                        }

                        // Limpieza de montos (Puntos de miles argentinos pueden romper el parseFloat)
                        if (extractedData) {
                            ['prima', 'premio', 'insuredSum'].forEach(field => {
                                if (extractedData[field] !== undefined && extractedData[field] !== null) {
                                    let val = String(extractedData[field]).replace(/\.(?=\d{3})/g, ''); // Eliminar puntos de miles sólo si van seguidos de 3 dígitos
                                    val = val.replace(',', '.').replace(/[^0-9.]/g, '');
                                    extractedData[field] = parseFloat(val) || 0;
                                }
                            });
                        }
                    } catch (mapError) {
                        if (mapError.status === 429 || mapError.status === 503) {
                            triggerQuotaLock();
                            throw mapError;
                        }
                        console.warn("⚠️ Error en Heat Mapping, fallback estándar:", mapError);
                        const result = await smartAnalyzeFile(base64Content, companyNames);
                        documentType = result.data.documentType;
                        extractedData = result.data.extractedData || {};
                        if (result.usageMetadata) trackGeminiCall('Carga Unificada IA (Fallback)', { ...result.usageMetadata, fileName: file.name, clientName: extractedData?.clientName });
                        
                        // Blindaje de seguridad en fallback
                        if (extractedData && extractedData.clientName) {
                            const nameUpper = extractedData.clientName.toUpperCase();
                            if (nameUpper.includes("RODAS GUSTAVO RAUL") || nameUpper.includes("23294824979")) {
                                extractedData.clientName = "";
                            }
                        }
                    }
                } else if (!isTextOptimized) {
                    // Flujo ESTÁNDAR para el resto de las compañías
                    try {
                        const result = await smartAnalyzeFile(base64Content, companyNames);
                        console.log("📝 [SMART ANALYZE RESULT]:", result);

                        if (!result || !result.data) {
                            throw new Error("La IA no pudo procesar el documento correctamente.");
                        }

                        documentType = result.data.documentType;
                        extractedData = result.data.extractedData || {};

                        if (result.usageMetadata) {
                            trackGeminiCall('Carga Unificada IA', {
                                ...result.usageMetadata,
                                fileName: file.name,
                                clientName: extractedData?.clientName
                            });
                        }

                        // Blindaje de seguridad en flujo estándar
                        if (extractedData && extractedData.clientName) {
                            const nameUpper = extractedData.clientName.toUpperCase();
                            if (nameUpper.includes("RODAS GUSTAVO RAUL") || nameUpper.includes("23294824979")) {
                                extractedData.clientName = "";
                            }
                        }
                    } catch (standardError) {
                        if (standardError.status === 429 || standardError.status === 503) {
                            triggerQuotaLock();
                        }
                        throw standardError;
                    }
                }
                // --- FIN INTEGRACIÓN HEAT MAPPING ---

                // POST-PROCESSING: Validación determinista de DNI
                // El DNI argentino tiene exactamente 7 u 8 dígitos. Si la IA devolvió algo distinto, lo limpiamos.
                // Excepción: Caución/ART usan CUIT (11 dígitos) intencionalmente como "dni".
                if (extractedData && extractedData.dni !== undefined) {
                    const dniRaw = String(extractedData.dni || '').replace(/[^0-9]/g, '');
                    const riskLower = (extractedData.riskType || '').toLowerCase();
                    const isCuitAllowed = riskLower.includes('caución') || riskLower.includes('caucion') || riskLower.includes('art');
                    if (!isCuitAllowed && dniRaw.length !== 7 && dniRaw.length !== 8) {
                        console.warn(`🧹 [DNI GUARD] DNI "${extractedData.dni}" no tiene 7-8 dígitos (tiene ${dniRaw.length}). Limpiando.`);
                        extractedData.dni = '';
                    }
                }

                // Enriquecer con subtipo de póliza si la IA no lo detectó
                if (documentType === 'POLIZA' && extractedData && !extractedData.policySubtype) {
                    const detectedSubtype = detectPolicySubtype(localText);
                    extractedData.policySubtype = detectedSubtype;
                    // Mantener isRenewal sincronizado para compatibilidad con registros viejos
                    if (!('isRenewal' in extractedData)) {
                        extractedData.isRenewal = (detectedSubtype === 'Renovación');
                    }
                }

                if (documentType === 'POLIZA') {
                    if (onProgress) onProgress('Guardando Póliza...', 70);
                    await savePolicyResult(extractedData, {
                        fileBase64: base64Content,
                        fileName: file.name,
                        fileType: file.type
                    });

                    // Limpieza de notificaciones de este cliente
                    if (extractedData.clientName) {
                        try {
                            const noticesRef = collection(db, 'notifications');
                            const q = query(noticesRef, where('clientName', '==', extractedData.clientName), where('status', '!=', 'completada'));
                            const snap = await getDocs(q);
                            const batch = writeBatch(db);
                            snap.forEach(d => batch.update(d.ref, { status: 'completada', color: 'green' }));
                            await batch.commit();
                        } catch (e) {
                            console.warn("No se pudieron limpiar notificaciones:", e);
                        }
                    }
                } else if (documentType === 'FACTURA') {
                    if (onProgress) onProgress('Procesando Factura...', 60);

                    const gross = parseFloat(extractedData.amount) || 0;
                    const IIBB_DEDUCTION = 0.045;
                    const net = gross * (1 - IIBB_DEDUCTION);

                    const normalizedCuit = (extractedData.cuit || '').toString().replace(/[-\s]/g, '').trim();
                    const paddedPos = extractedData.pointOfSale?.toString().padStart(5, '0') || '00001';
                    const paddedNum = extractedData.number?.toString().padStart(8, '0') || '00000000';

                    const invoiceData = fixInboundInvoice({
                        ...extractedData,
                        cuit: normalizedCuit,
                        amount: gross,
                        netAmount: parseFloat(net.toFixed(2)),
                        iibb: parseFloat((gross * IIBB_DEDUCTION).toFixed(2)),
                        pointOfSale: paddedPos,
                        number: paddedNum,
                        status: 'Realizada',
                        date: extractedData.date || new Date().toISOString().split('T')[0]
                    });

                    // Duplicados en History (Usamos la función robusta centralizada)
                    if (checkDuplicate(invoiceData)) {
                        throw new Error(`La factura ${paddedPos}-${paddedNum} ya existe en el historial.`);
                    }

                    await addInvoice(invoiceData);

                    // Actualizar Compañía → "Facturado" (Check Verde)
                    let compMatch = companies.find(c => {
                        const cCuit = (c.cuit || '').toString().replace(/[^0-9]/g, '');
                        return cCuit && cCuit === normalizedCuit;
                    });

                    if (!compMatch && extractedData.company) {
                        const normName = normalizeName(extractedData.company);
                        compMatch = companies.find(c => normalizeName(c.name) === normName);
                    }

                    if (compMatch) {
                        await updateDoc(doc(db, 'companies', compMatch.id), {
                            status: 'Facturado',
                            lastInvoice: paddedNum,
                            updatedAt: serverTimestamp()
                        });

                        // Limpieza de notificaciones (Bell icon)
                        try {
                            const noticesRef = collection(db, 'notifications');
                            const q = query(noticesRef, where('companyName', '==', compMatch.name), where('status', '!=', 'completada'));
                            const snap = await getDocs(q);
                            const batch = writeBatch(db);
                            snap.forEach(d => batch.update(d.ref, { status: 'completada', color: 'green' }));
                            await batch.commit();
                        } catch (e) { console.warn("Notice clear error:", e); }

                        console.log(`✅ Empresa ${compMatch.name} marcada como Facturada.`);
                    } else {
                        console.warn(`⚠️ No se encontró empresa para CUIT ${normalizedCuit}.`);
                    }
                }
            }

            if (onProgress) onProgress('¡Carga completada con éxito!', 100);
            return { status: 'success', type: documentType, data: extractedData, coveragesExtracted: mercantilCoveragesExtracted };
        } catch (error) {
            console.error("Smart Upload Error:", error);
            throw error;
        }
    };

    const addPolicy = async (data) => {
        try {
            const { _pendingFileBase64, _pendingFileType, ...rest } = data;
            const safeData = sanitizeFirestoreData(rest);
            if (!safeData.clientId && (safeData.clientName || safeData.dni)) {
                safeData.clientId = await resolveClientId(db, safeData.clientName, safeData.dni);
            }
            const docRef = await addDoc(collection(db, 'policies'), {
                ...safeData,
                timestamp: data.timestamp || serverTimestamp()
            });

            if (_pendingFileBase64) {
                await saveFileChunks(docRef.id, _pendingFileBase64, rest.fileName || 'documento.pdf', _pendingFileType);
            }

            // Actualización optimista: reflejar inmediatamente en el estado local
            // (no esperar al onSnapshot para que la campana se actualice al instante)
            const newPolicyLocal = { id: docRef.id, ...safeData, timestamp: new Date() };
            setPolicies(prev => [newPolicyLocal, ...prev]);

            return { id: docRef.id, ...safeData };
        } catch (error) {
            console.error("Error adding policy:", error);
            throw error;
        }
    };

    const updatePolicy = async (id, data) => {
        try {
            const { id: _, _pendingFileBase64, _pendingFileType, ...cleanData } = data;
            const safeData = sanitizeFirestoreData(cleanData);
            // Si cambia nombre o DNI, recalcular clientId
            if ((cleanData.clientName || cleanData.dni) && !cleanData.clientId) {
                safeData.clientId = await resolveClientId(db, cleanData.clientName, cleanData.dni);
            }
            await updateDoc(doc(db, 'policies', id), safeData);

            // Actualización optimista: reflejar inmediatamente en el estado local
            // (no esperar al onSnapshot para que la campana se actualice al instante)
            setPolicies(prev => prev.map(p => p.id === id ? { ...p, ...cleanData } : p));

            if (_pendingFileBase64) {
                await saveFileChunks(id, _pendingFileBase64, cleanData.fileName || 'archivo.pdf', _pendingFileType || 'application/pdf');
            }
        } catch (error) {
            console.error("Error updating policy:", error);
            throw error;
        }
    };

    const deletePolicy = async (id) => {
        try {
            await deleteDoc(doc(db, 'policies', id));
            await deleteFileChunks(id);
            // Actualización optimista: eliminar inmediatamente del estado local
            setPolicies(prev => prev.filter(p => p.id !== id));
        } catch (error) {
            console.error("Error deleting policy:", error);
            throw error;
        }
    };

    const bulkDeletePolicies = async (ids) => {
        const batch = writeBatch(db);
        ids.forEach(id => {
            batch.delete(doc(db, 'policies', id));
        });
        await batch.commit();
    };

    const clearAllPolicies = async () => {
        const snapshot = await getDocs(collection(db, 'policies'));
        const batch = writeBatch(db);
        snapshot.forEach(d => batch.delete(d.ref));
        await batch.commit();
    };

    const unifyExistingPolicies = async () => {
        const snapshot = await getDocs(collection(db, 'policies'));
        const groups = {};

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const dni = data.dni?.toString().trim();
            const risk = data.riskType?.toString().trim();
            const start = data.startDate || '';
            const end = data.endDate || '';

            // Unificamos si: Mismo DNI + Mismo Riesgo + Mismas Fechas
            // (Si cambian fechas o número, es otra póliza/renovación)
            if (dni && risk && start && end) {
                const key = `${dni}_${risk}_${start}_${end}`.toLowerCase();
                if (!groups[key]) groups[key] = [];
                groups[key].push(docSnap);
            }
        });

        let currentBatch = writeBatch(db);
        let opCount = 0;
        let unifiedCount = 0;
        let deletedCount = 0;

        const commitBatch = async () => {
            if (opCount > 0) {
                await currentBatch.commit();
                currentBatch = writeBatch(db);
                opCount = 0;
            }
        };

        for (const [key, docs] of Object.entries(groups)) {
            if (docs.length > 1) {
                // Elegir el "Mejor" (Master): prioridad a quien tenga fileUrl, luego por fecha de creación
                const master = docs.sort((a, b) => {
                    const dataA = a.data();
                    const dataB = b.data();
                    // 1. Prioridad: Tiene Archivo
                    if (dataA.fileUrl && !dataB.fileUrl) return -1;
                    if (!dataA.fileUrl && dataB.fileUrl) return 1;
                    // 2. Prioridad: Tiene Premio (monto total)
                    if (dataA.premio && !dataB.premio) return -1;
                    if (!dataA.premio && dataB.premio) return 1;
                    // 3. Prioridad: Más nuevo
                    return (dataB.createdAt?.toMillis() || 0) - (dataA.createdAt?.toMillis() || 0);
                })[0];

                const consolidatedData = { ...master.data() };
                for (const d of docs) {
                    if (d.id === master.id) continue;
                    const data = d.data();
                    // Rescatar campos preciosos del duplicado si el master no los tiene
                    if (!consolidatedData.fileUrl && data.fileUrl) consolidatedData.fileUrl = data.fileUrl;
                    if (!consolidatedData.fileBase64 && data.fileBase64) consolidatedData.fileBase64 = data.fileBase64;
                    if (!consolidatedData.insuredSum && data.insuredSum) consolidatedData.insuredSum = data.insuredSum;
                    if (!consolidatedData.address && data.address) consolidatedData.address = data.address;

                    // Borrar el duplicado
                    currentBatch.delete(d.ref);
                    opCount++;
                    deletedCount++;
                    if (opCount >= 450) await commitBatch();
                }

                currentBatch.update(master.ref, {
                    ...consolidatedData,
                    unifiedAt: serverTimestamp()
                });
                opCount++;
                unifiedCount++;
                if (opCount >= 450) await commitBatch();
            }
        }

        await commitBatch();
        return { unifiedGroups: unifiedCount, totalDeleted: deletedCount };
    };

    const mergeClientsByName = async () => {
        try {
            const snapshot = await getDocs(collection(db, 'policies'));
            const groups = {};

            // Agrupar por nameKey normalizado (tokens ordenados) para capturar "JUAN PEREZ" = "PEREZ JUAN"
            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                if (!data.clientName) return;
                const nk = normalizeNameKey(data.clientName);
                if (!groups[nk]) groups[nk] = [];
                groups[nk].push({ id: docSnap.id, ref: docSnap.ref, data });
            });

            let currentBatch = writeBatch(db);
            let opCount = 0;
            let modifiedPolicies = 0;
            let mergedClients = 0;

            const commitBatch = async () => {
                if (opCount > 0) {
                    await currentBatch.commit();
                    currentBatch = writeBatch(db);
                    opCount = 0;
                }
            };

            for (const [nk, docsOfClient] of Object.entries(groups)) {
                if (docsOfClient.length <= 1) continue;

                const allDnis = docsOfClient.map(d => normalizeDni(d.data.dni)).filter(d => d.length >= 7);
                const uniqueDnis = [...new Set(allDnis)];

                // Si no hay DNI en ninguna póliza de este grupo, solo unificamos por clientId
                const targetDni = uniqueDnis.sort((a, b) => {
                    if (a.length === 11 && b.length !== 11) return -1;
                    if (b.length === 11 && a.length !== 11) return 1;
                    return b.length - a.length;
                })[0] || '';

                // Nombre canónico: el más largo del grupo (probablemente el más completo)
                const canonicalName = docsOfClient
                    .map(d => (d.data.clientName || '').trim().toUpperCase())
                    .sort((a, b) => b.length - a.length)[0];

                // Resolver/crear el clientId único para este grupo
                const clientId = await resolveClientId(db, canonicalName, targetDni);

                mergedClients++;

                for (const pDoc of docsOfClient) {
                    const patch = {};
                    const currentDni = normalizeDni(pDoc.data.dni);
                    if (targetDni && currentDni !== targetDni) patch.dni = targetDni;
                    if (pDoc.data.clientName !== canonicalName) patch.clientName = canonicalName;
                    if (pDoc.data.clientId !== clientId) patch.clientId = clientId;

                    if (Object.keys(patch).length > 0) {
                        currentBatch.update(pDoc.ref, patch);
                        opCount++;
                        modifiedPolicies++;
                        if (opCount >= 450) await commitBatch();
                    }
                }
            }

            await commitBatch();
            return { mergedClients, modifiedPolicies };
        } catch (error) {
            console.error("Critical error in mergeClientsByName:", error);
            throw error;
        }
    };

    const runAssignClientIds = async (onProgress) => {
        return assignClientIdsToAll(db, onProgress);
    };

    const updateClientData = async (dni, newData) => {
        if (!dni) return;
        const q = query(collection(db, 'policies'));
        const snap = await getDocs(q);
        const batch = writeBatch(db);
        let count = 0;

        snap.forEach(docSnap => {
            const data = docSnap.data();
            if (data.dni === dni || data.clientName === newData.clientName) {
                batch.update(docSnap.ref, newData);
                count++;
            }
        });

        if (count > 0) {
            await batch.commit();
        }
        return count;
    };

    const bulkAddPolicies = async (policiesList) => {
        // 1. Obtener todas las pólizas actuales para cotejar por número
        const snapshot = await getDocs(collection(db, 'policies'));
        const existingPoliciesMap = {}; // { policyNumber: { ref, data } }
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (data.policyNumber) {
                existingPoliciesMap[data.policyNumber.trim()] = { ref: docSnap.ref, data: data };
            }
        });

        let currentBatch = writeBatch(db);
        let opCount = 0;

        const commitBatch = async () => {
            if (opCount > 0) {
                await currentBatch.commit();
                currentBatch = writeBatch(db);
                opCount = 0;
            }
        };

        // 2. Procesar el lote entrante con unificación inteligente de renovaciones
        for (const p of policiesList) {
            if (!p.policyNumber) continue;

            // Extraer datos pesados para que no vayan al documento principal
            const { _pendingFileBase64, _pendingFileType, ...policyClean } = p;

            const normalizedNum = policyClean.policyNumber.toString().trim();
            const existingRecord = existingPoliciesMap[normalizedNum];
            let targetId = null;

            if (existingRecord) {
                // UNIFICAR: Póliza ya existe. Mantenemos historial de adjuntos.
                const { ref: existingRef, data: existingData } = existingRecord;
                targetId = existingRef.id;

                // Rescatar adjuntos viejos
                const oldAttachments = existingData.attachments || [];
                // Por compatibilidad con archivos guardados individualmente antes
                if (existingData.fileUrl && !oldAttachments.some(a => a.url === existingData.fileUrl)) {
                    oldAttachments.push({
                        url: existingData.fileUrl,
                        name: existingData.fileName || 'Póliza Anterior (Legado)',
                        timestamp: existingData.timestamp?.toISOString ? existingData.timestamp.toISOString() : new Date().toISOString()
                    });
                }

                // Sumarlos a los nuevos adjuntos entrantes
                const newAttachments = policyClean.attachments || [];
                const mergedAttachments = [...oldAttachments, ...newAttachments];

                // --- SMART MERGE LOGIC ---
                let finalData = { ...existingData };
                const oldEnd = existingData.endDate ? new Date(existingData.endDate) : new Date(0);
                const newEnd = policyClean.endDate ? new Date(policyClean.endDate) : new Date(0);
                const pIsNewer = (!existingData.endDate || newEnd >= oldEnd);

                // Campos de identidad: PROTECCIÓN (Solo llenar si vacíos)
                const identityFields = ['clientName', 'dni', 'address'];
                identityFields.forEach(f => {
                    const newVal = policyClean[f];
                    if (newVal && !existingData[f]) {
                        finalData[f] = newVal;
                    }
                });

                // Otros campos: actualizarlos si es más nuevo o si estaban vacíos
                const infoFields = ['riskType', 'policyNumber', 'company', 'currency', 'startDate', 'endDate', 'insuredSum', 'prima', 'premio'];
                infoFields.forEach(f => {
                    const newVal = policyClean[f];
                    if (newVal !== undefined && newVal !== null && newVal !== '') {
                        if (pIsNewer || !existingData[f]) {
                            finalData[f] = newVal;
                        }
                    }
                });

                // Deep Merge para riskDetails - GAP FILLING
                if (policyClean.riskDetails) {
                    if (!finalData.riskDetails) finalData.riskDetails = {};
                    if (policyClean.riskDetails.vehicle) {
                        if (!finalData.riskDetails.vehicle) finalData.riskDetails.vehicle = {};
                        Object.keys(policyClean.riskDetails.vehicle).forEach(vk => {
                            const vVal = policyClean.riskDetails.vehicle[vk];
                            if (vVal && !finalData.riskDetails.vehicle[vk]) {
                                finalData.riskDetails.vehicle[vk] = vVal;
                            }
                        });
                    }
                    if (!finalData.riskDetails.coverages || finalData.riskDetails.coverages.length === 0) {
                        if (policyClean.riskDetails.coverages) finalData.riskDetails.coverages = policyClean.riskDetails.coverages;
                    }
                    if (!finalData.riskDetails.insuredPersons || finalData.riskDetails.insuredPersons.length === 0) {
                        if (policyClean.riskDetails.insuredPersons) finalData.riskDetails.insuredPersons = policyClean.riskDetails.insuredPersons;
                    }
                    if (policyClean.riskDetails.alicuota && !finalData.riskDetails.alicuota) {
                        finalData.riskDetails.alicuota = policyClean.riskDetails.alicuota;
                    }
                }

                finalData.isRenewal = pIsNewer || existingData.isRenewal;
                finalData.attachments = mergedAttachments;
                finalData.updatedAt = serverTimestamp();

                currentBatch.update(existingRef, finalData);
            } else {
                // CREAR NUEVO
                const newDocRef = doc(collection(db, 'policies'));
                targetId = newDocRef.id;
                currentBatch.set(newDocRef, {
                    ...policyClean,
                    createdAt: serverTimestamp(),
                    timestamp: new Date()
                });
                existingPoliciesMap[normalizedNum] = { ref: newDocRef, data: policyClean };
            }

            // Si hay un archivo pendiente, guardarlo en chunks
            // Importante: saveFileChunks es async, pero no podemos esperarlo dentro del batch commit si queremos eficiencia masiva, 
            // sin embargo para evitar errores de limite, lo procesamos ahora. 
            if (_pendingFileBase64 && targetId) {
                // Nota: Esto ralentiza el loop pero asegura que el archivo se guarde asociado al ID correcto
                await saveFileChunks(targetId, _pendingFileBase64, policyClean.fileName || 'documento.pdf', _pendingFileType || 'application/pdf');
            }

            opCount++;
            if (opCount >= 450) await commitBatch();
        }

        await commitBatch();
        return policiesList.length;
    };

    const standardizeExistingData = async () => {
        const batch = writeBatch(db);
        let count = 0;

        invoices.forEach(inv => {
            const pos = inv.pointOfSale?.toString().padStart(5, '0') || '00001';
            const num = inv.number?.toString().padStart(8, '0') || '00000001';

            let cleanDate = inv.date;
            if (inv.date) {
                const dStr = inv.date.toString().trim();
                let dObj = null;

                if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(dStr)) {
                    const [d, m, y] = dStr.split(' ')[0].split('/').map(Number);
                    dObj = new Date(y, m - 1, d);
                } else if (/^\d{4}-\d{2}-\d{2}/.test(dStr)) {
                    const [y, m, d] = dStr.split('T')[0].split('-').map(Number);
                    dObj = new Date(y, m - 1, d);
                } else {
                    dObj = new Date(dStr);
                }

                if (dObj && !isNaN(dObj.getTime())) {
                    cleanDate = dObj.toISOString().split('T')[0];
                }
            }

            const docRef = doc(db, 'invoices', inv.id);
            batch.update(docRef, {
                type: 'Factura C',
                pointOfSale: pos,
                number: num,
                date: cleanDate
            });
            count++;
        });

        if (count > 0) {
            await batch.commit();
            console.log(`Standardized ${count} invoices`);
            alert(`Se estandarizaron ${count} facturas con éxito.`);
        }
    };

    const {
        pendingCount,
        pendingCompanies,
        expiringPolicies,
        expiringCount,
        missingFilePolicies,
        missingFileCount,
        totalClientsCount,
        isAutoExpired
    } = React.useMemo(() => {
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        const history = [...invoices, ...testInvoices];

        // 0a. Utilidad para parsear fechas que pueden ser Firestore Timestamp, string, o Date
        const parsePolicyDate = (dateVal) => {
            if (!dateVal) return null;
            if (dateVal instanceof Date) return isNaN(dateVal.getTime()) ? null : dateVal;
            if (typeof dateVal.toDate === 'function') return dateVal.toDate();
            if (dateVal.seconds != null) return new Date(dateVal.seconds * 1000);
            const d = new Date(dateVal);
            return isNaN(d.getTime()) ? null : d;
        };

        // 0. Utilidad para detectar auto-expiración (Feedback v16)
        // Pólizas de Accidentes Personales con vigencia <= 32 días que ya vencieron
        const isAutoExpired = (p) => {
            if (!p.endDate || p.isCancelled) return false;
            const risk = (p.riskType || '').toLowerCase();
            if (!risk.includes('accidente')) return false;

            const start = p.startDate ? parsePolicyDate(p.startDate) : null;
            const end = parsePolicyDate(p.endDate);
            if (!end) return false;

            // Si no hay fecha de inicio, asumimos que si venció, ya no es vigente (es AP short-term)
            // Si hay fecha de inicio, validamos que la vigencia sea de un mes o menos (~32 días)
            if (start) {
                const diffTime = end - start;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (diffDays > 32) return false; // Más de un mes, no auto-expira
            }

            // Si llegamos acá, es AP de corto plazo. ¿Ya venció?
            return end < now;
        };

        // 1. Contamos cuántas empresas NO tienen facturas este mes
        // Optimización: Usamos un Set para búsqueda O(1)
        const companiesWithInvoices = new Set();
        const historyLength = history.length;

        for (let i = 0; i < historyLength; i++) {
            const inv = history[i];
            const d = new Date(inv._timestamp);
            if (d.getMonth() === currentMonth && d.getFullYear() === currentYear) {
                companiesWithInvoices.add(inv._normalizedName);
                // Also add canonical alias for cross-name matching
                const compName = (inv.company || '').toUpperCase().trim();
                if (compName.includes('ACS COMERCIAL') || compName.includes('GALICIA') || compName.includes('1276')) companiesWithInvoices.add('__CANON_GALICIA');
                else if (compName.includes('MERCANTIL ANDINA') || compName.includes('MERCANTIL')) companiesWithInvoices.add('__CANON_MERCANTIL');
                else if (compName.includes('FEDERA')) companiesWithInvoices.add('__CANON_FEDERACION');
                else if (compName.includes('ALLIANZ')) companiesWithInvoices.add('__CANON_ALLIANZ');
                else if ((compName.includes('SWISS MEDICAL') && compName.includes('ART'))) companiesWithInvoices.add('__CANON_SWISS_MEDICAL_ART');
                else if (compName.includes('SMG') || (compName.includes('COMPANIA ARGENTINA') && compName.includes('SEGUROS')) || (compName.includes('SWISS MEDICAL') && !compName.includes('ART'))) companiesWithInvoices.add('__CANON_SMG');
                else if (compName.includes('MERIDIONAL')) companiesWithInvoices.add('__CANON_MERIDIONAL');
                else if (compName.includes('ZURICH')) companiesWithInvoices.add('__CANON_ZURICH');
                else if (compName.includes('RIVADAVIA')) companiesWithInvoices.add('__CANON_RIVADAVIA');
                else if (compName.includes('SANCOR')) companiesWithInvoices.add('__CANON_SANCOR');
                else if (compName.includes('SAN CRISTOBAL') || compName.includes('SAN CRIST\u00d3BAL')) companiesWithInvoices.add('__CANON_SANCRISTOBAL');
                else if (compName.includes('PROVINCIA')) companiesWithInvoices.add('__CANON_PROVINCIA');
                else if (compName.includes('MAPFRE')) companiesWithInvoices.add('__CANON_MAPFRE');
                else if (compName.includes('HAMBURGO')) companiesWithInvoices.add('__CANON_HAMBURGO');
                else if (compName.includes('INTEGRITY')) companiesWithInvoices.add('__CANON_INTEGRITY');
                else if (compName.includes('TRIUNFO')) companiesWithInvoices.add('__CANON_TRIUNFO');
                else if (compName.includes('EXPERTA ART')) companiesWithInvoices.add('__CANON_EXPERTA_ART');
                else if (compName.includes('EXPERTA')) companiesWithInvoices.add('__CANON_EXPERTA');
            }
        }

        // Helper: canonical key for a company name
        const getCanonKey = (name) => {
            if (!name) return null;
            const u = name.toUpperCase().trim();
            if (u.includes('ACS COMERCIAL') || u.includes('GALICIA') || u.includes('1276')) return '__CANON_GALICIA';
            if (u.includes('MERCANTIL ANDINA') || u.includes('MERCANTIL')) return '__CANON_MERCANTIL';
            if (u.includes('FEDERA')) return '__CANON_FEDERACION';
            if (u.includes('ALLIANZ')) return '__CANON_ALLIANZ';
            if ((u.includes('SWISS MEDICAL') && u.includes('ART')) || u.includes('SWISS MEDICAL ART')) return '__CANON_SWISS_MEDICAL_ART';
            if (u.includes('SMG') || (u.includes('COMPANIA ARGENTINA') && u.includes('SEGUROS')) || (u.includes('SWISS MEDICAL') && !u.includes('ART'))) return '__CANON_SMG';
            if (u.includes('MERIDIONAL')) return '__CANON_MERIDIONAL';
            if (u.includes('ZURICH')) return '__CANON_ZURICH';
            if (u.includes('RIVADAVIA')) return '__CANON_RIVADAVIA';
            if (u.includes('SANCOR')) return '__CANON_SANCOR';
            if (u.includes('SAN CRISTOBAL') || u.includes('SAN CRIST\u00d3BAL')) return '__CANON_SANCRISTOBAL';
            if (u.includes('PROVINCIA')) return '__CANON_PROVINCIA';
            if (u.includes('MAPFRE')) return '__CANON_MAPFRE';
            if (u.includes('HAMBURGO')) return '__CANON_HAMBURGO';
            if (u.includes('INTEGRITY')) return '__CANON_INTEGRITY';
            if (u.includes('TRIUNFO')) return '__CANON_TRIUNFO';
            if (u.includes('EXPERTA ART')) return '__CANON_EXPERTA_ART';
            if (u.includes('EXPERTA')) return '__CANON_EXPERTA';
            return null;
        };

        const pending = companies.filter(comp => {
            if (companiesWithInvoices.has(comp._normalizedName)) return false;
            const canon = getCanonKey(comp.name);
            if (canon && companiesWithInvoices.has(canon)) return false;
            return true;
        });

        // 2. Detectamos pólizas próximas a vencer (próximos 7 días)
        // Excluimos las que ya auto-expiraron para no ensuciar alertas
        const expiring = policies.filter(p => {
            if (!p.endDate || p.isCancelled || isAutoExpired(p)) return false;
            const end = parsePolicyDate(p.endDate);
            if (!end) return false;
            const diffTime = end - now;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            return diffDays >= 0 && diffDays <= 7;
        }).sort((a, b) => {
            const aEnd = parsePolicyDate(a.endDate) || new Date(0);
            const bEnd = parsePolicyDate(b.endDate) || new Date(0);
            return aEnd - bEnd;
        });

        // 3. Detectamos pólizas sin archivos adjuntos (activas y no auto-expiradas)
        const withoutFiles = policies.filter(p => !p.isCancelled && !p.fileUrl && !p.fileBase64 && !(p.attachments && p.attachments.length > 0) && !isAutoExpired(p));

        // 4. Contador de clientes totales (DNI/CUIT o Nombre únicos)
        const activePool = policies.filter(p => !p.isCancelled && !isAutoExpired(p));
        const totalClientsCount = new Set(activePool.map(p => {
            const id = (p.dni || p.cuit || '').toString().trim();
            if (id) return id;
            return (p.clientName || '').toString().trim().toLowerCase();
        }).filter(Boolean)).size;

        return {
            pendingCount: pending.length,
            pendingCompanies: pending,
            expiringPolicies: expiring,
            expiringCount: expiring.length,
            missingFilePolicies: withoutFiles,
            missingFileCount: withoutFiles.length,
            totalClientsCount,
            isAutoExpired
        };
    }, [invoices, testInvoices, companies, policies]);

    const saveExtractionPattern = async (companyName, hints) => {
        if (!companyName || !hints) return;
        try {
            const id = normalizeName(companyName);
            if (!id) return;
            await setDoc(doc(db, 'extraction_patterns', id), {
                hints,
                updatedAt: serverTimestamp(),
                companyName: companyName.trim()
            }, { merge: true });
            console.log(`✅ Patrón guardado para ${companyName}`);
        } catch (e) {
            console.warn("Error guardando patrón:", e);
        }
    };

    const addReminder = useCallback(async (text, dueDate = null, clientName = null, policyNumber = null) => {
        if (!text?.trim()) return;
        await addDoc(collection(db, 'reminders'), sanitizeFirestoreData({
            text: text.trim(),
            dueDate: dueDate || null,
            clientName: clientName || null,
            policyNumber: policyNumber || null,
            done: false,
            novedades: [],
            createdAt: serverTimestamp()
        }));
    }, []);

    const toggleReminder = useCallback(async (id) => {
        const r = reminders.find(r => r.id === id);
        if (!r) return;
        await updateDoc(doc(db, 'reminders', id), { done: !r.done });
    }, [reminders]);

    const deleteReminder = useCallback(async (id) => {
        await deleteDoc(doc(db, 'reminders', id));
    }, []);

    const addReminderNovedad = useCallback(async (id, texto) => {
        if (!texto?.trim()) return;
        await updateDoc(doc(db, 'reminders', id), {
            novedades: arrayUnion({
                texto: texto.trim(),
                fecha: new Date().toISOString()
            })
        });
    }, []);

    const remindersDueCount = reminders.filter(r => !r.done).length;

    // ─── SINIESTROS ───────────────────────────────────────────────
    const addSiniestro = useCallback(async (titulo, descripcion = null, dueDate = null, clientName = null, policyNumber = null) => {
        if (!titulo?.trim()) return;
        await addDoc(collection(db, 'siniestros'), sanitizeFirestoreData({
            titulo: titulo.trim(),
            descripcion: descripcion?.trim() || null,
            dueDate: dueDate || null,
            clientName: clientName || null,
            policyNumber: policyNumber || null,
            done: false,
            novedades: [],
            createdAt: serverTimestamp()
        }));
    }, []);

    const toggleSiniestro = useCallback(async (id) => {
        const s = siniestros.find(s => s.id === id);
        if (!s) return;
        await updateDoc(doc(db, 'siniestros', id), { done: !s.done });
    }, [siniestros]);

    const deleteSiniestro = useCallback(async (id) => {
        await deleteDoc(doc(db, 'siniestros', id));
    }, []);

    const addSiniestroNovedad = useCallback(async (id, texto) => {
        if (!texto?.trim()) return;
        await updateDoc(doc(db, 'siniestros', id), {
            novedades: arrayUnion({
                texto: texto.trim(),
                fecha: new Date().toISOString()
            })
        });
    }, []);

    const siniestrosPendingCount = siniestros.filter(s => !s.done).length;

    // ─── BANDEJA MÓVIL (iOS Shortcut) ─────────────────────────────
    const processMobileInboxItem = useCallback(async (item) => {
        if (!item?.id) return;
        try {
            if (item.tipo === 'siniestro') {
                await addDoc(collection(db, 'siniestros'), sanitizeFirestoreData({
                    titulo: item.titulo?.trim() || 'Siniestro desde iPhone',
                    descripcion: item.texto?.trim() || null,
                    dueDate: null,
                    clientName: null,
                    policyNumber: null,
                    done: false,
                    novedades: [],
                    createdAt: serverTimestamp(),
                }));
            } else {
                await addDoc(collection(db, 'reminders'), sanitizeFirestoreData({
                    text: [item.titulo?.trim(), item.texto?.trim()].filter(Boolean).join(' — '),
                    dueDate: null,
                    clientName: null,
                    policyNumber: null,
                    done: false,
                    createdAt: serverTimestamp(),
                }));
            }
            await remove(dbRef(rtdb, `mobile_inbox/${item.id}`));
        } catch (err) {
            console.error("AppContext: Error procesando item móvil:", err);
        }
    }, []);

    const deleteMobileInboxItem = useCallback(async (id) => {
        await remove(dbRef(rtdb, `mobile_inbox/${id}`));
    }, []);

    const mobileInboxCount = mobileInbox.length;

    return (
        <AppContext.Provider value={{
            invoices,
            uniqueInvoices,
            testInvoices,
            companies,
            policies,
            pendingCount,
            pendingCompanies,
            expiringPolicies,
            expiringCount,
            missingFilePolicies,
            missingFileCount,
            addInvoice,
            addTestInvoice,
            validateAndMoveInvoice,
            moveAllTestToProd,
            checkDuplicate,
            addCompany,
            updateCompany,
            updateInvoice,
            updateTestInvoice,
            deleteCompany,
            repairInvoiceCuits,
            syncCompanyCuits,
            deleteInvoice,
            deleteTestInvoice,
            addPolicy,
            updatePolicy,
            deletePolicy,
            updateClientData,
            bulkDeletePolicies,
            clearAllPolicies,
            unifyExistingPolicies,
            mergeClientsByName,
            runAssignClientIds,
            bulkAddPolicies,
            processFileWithAI,
            savePolicyResult,
            handleUnifiedSmartUpload,
            processCSVWithAI,
            analyzePolicyWithAI,
            standardizeExistingData,
            parseDate,
            normalizeName,
            normalizeRisk,
            globalSearchTerm,
            setGlobalSearchTerm,
            showOnlyMissingFiles,
            setShowOnlyMissingFiles,
            totalClientsCount,
            isAutoExpired,
            loading,
            user,
            login,
            logout,
            theme,
            toggleTheme,
            getGeminiUsage,
            patterns,
            saveExtractionPattern,
            quotaLock,
            triggerQuotaLock,
            resetQuotaLock,
            reminders,
            addReminder,
            toggleReminder,
            deleteReminder,
            addReminderNovedad,
            remindersDueCount,
            siniestros,
            addSiniestro,
            toggleSiniestro,
            deleteSiniestro,
            addSiniestroNovedad,
            siniestrosPendingCount,
            mobileInbox,
            mobileInboxCount,
            processMobileInboxItem,
            deleteMobileInboxItem
        }}>
            {children}
        </AppContext.Provider>
    );
};

export const useAppContext = () => useContext(AppContext);
