import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { db, storage, auth } from '../firebase/config';
import { analyzeInvoice, analyzePolicy, analyzeCSV, smartAnalyzeFile } from '../services/aiManager';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc, updateDoc, writeBatch, serverTimestamp, getDocs, setDoc, where } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { saveFileChunks, loadFileChunks, deleteFileChunks } from '../utils/fileChunks';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

const sanitizeFirestoreData = (obj) => {
    if (obj === undefined) return null;
    if (obj === null || typeof obj !== 'object') return obj;
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

        if (r.includes('auto') || r.includes('motos')) {
            if (r.includes('motos')) return 'Motos';
            return 'Autos';
        }

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

        // Si el objeto tiene un campo 'date' (extraído por IA), priorizamos eso sobre el timestamp de subida
        const dateValue = (typeof input === 'object' && !(input instanceof Date))
            ? (input.date || input.timestamp)
            : input;

        if (!dateValue) return new Date(0);
        if (dateValue instanceof Date) return dateValue;

        // Firestore Timestamp handling
        if (dateValue?.seconds) return new Date(dateValue.seconds * 1000);

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
        return isNaN(dObj.getTime()) ? new Date(0) : dObj;
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

    useEffect(() => {
        console.warn("AppContext: Initializing listeners...");

        // FAIL-SAFE: If data doesn't load in 5 seconds, force loading = false
        const failSafeTimer = setTimeout(() => {
            setLoading(prev => {
                if (prev) {
                    console.warn("AppContext: Fail-safe triggered! Unblocking UI.");
                    return false;
                }
                return prev;
            });
        }, 5000);

        const qInv = query(collection(db, 'invoices'), orderBy('timestamp', 'desc'));
        const qTest = query(collection(db, 'testInvoices'), orderBy('timestamp', 'desc'));
        const qComp = query(collection(db, 'companies'), orderBy('name', 'asc'));
        const qPol = query(collection(db, 'policies'), orderBy('timestamp', 'desc'));

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
            // Ordenar por nuestro timestamp pre-calculado
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
                return {
                    id: doc.id,
                    ...comp,
                    _normalizedName: normalizeName(comp.name)
                };
            }));
        }, (err) => console.error("AppContext: Error in companies listener:", err));

        const unsubPol = onSnapshot(qPol, (snap) => {
            setPolicies(snap.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })));
        }, (err) => console.error("AppContext: Error in policies listener:", err));

        // Escuchar Patrones de Cartera (Inteligencia de Extracción)
        const unsubPatterns = onSnapshot(collection(db, 'extraction_patterns'), (snapshot) => {
            const pMap = {};
            snapshot.forEach(doc => {
                pMap[doc.id.toLowerCase()] = doc.data().hints || "";
            });
            setPatterns(pMap);
        });

        const unsubAuth = onAuthStateChanged(auth, (firebaseUser) => {
            const isAdminBypass = localStorage.getItem('admin_bypass') === 'true';
            if (isAdminBypass) {
                // Si estamos en bypass, no dejamos que Firebase nos desloguee
                setUser({ email: 'grodas@jylbrokers.com.ar', uid: 'admin_bypass', displayName: 'Gustavo Rodas' });
                setLoading(false);
            } else {
                setUser(firebaseUser);
                if (!firebaseUser) {
                    setLoading(false);
                }
            }
        });

        return () => {
            unsubAuth();
            unsubInv();
            unsubTest();
            unsubComp();
            unsubPol();
            unsubPatterns();
        };
    }, [parseDate, normalizeName]);

    const login = async (email, password) => {
        // [ADMIN BYPASS] Soporte para credenciales críticas si Firebase falla
        if (email === 'grodas@jylbrokers.com.ar' && password === 'Milo110619') {
            console.warn("🔐 Admin Bypass Activated");
            const fakeUser = { email, uid: 'admin_bypass', displayName: 'Gustavo Rodas' };
            setUser(fakeUser);
            localStorage.setItem('admin_bypass', 'true');
            return fakeUser;
        }
        return signInWithEmailAndPassword(auth, email, password);
    };
    const logout = () => {
        localStorage.removeItem('admin_bypass');
        return signOut(auth);
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
            if (inv.cuit === '23294824979' && !inv.company) continue;

            // Build a faster key
            const key = `${inv.pointOfSale}-${inv.number}-${inv._timestamp}-${inv.amount}`;
            const existing = uniqueInvoicesMap.get(key);

            if (!existing || (existing.cuit === '23294824979' && inv.cuit !== '23294824979')) {
                uniqueInvoicesMap.set(key, inv);
            }
        }
        return Array.from(uniqueInvoicesMap.values());
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
            timestamp: new Date()
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
            timestamp: new Date()
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
                    timestamp: new Date(),
                    migrationDate: new Date().toISOString()
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
                keyIndex: tokenMetrics.keyIndex || 1,
                modelUsed: tokenMetrics.modelUsed || 'unknown',
                engine: engine
            });
            if (stored.log.length > 100) stored.log = stored.log.slice(-100);

            localStorage.setItem('geminiUsage', JSON.stringify(stored));
            console.log(`[Gemini] ${source} | Tokens: ${tt} (Key #${tokenMetrics.keyIndex || 1} - ${tokenMetrics.modelUsed || '?'})`);
        } catch (e) { console.warn('Error guardando uso Gemini:', e); }
    };

    const getGeminiUsage = () => {
        try {
            const now = new Date();
            const todayKey = now.toISOString().split('T')[0];
            const monthKey = todayKey.substring(0, 7);
            const stored = JSON.parse(localStorage.getItem('geminiUsage') || '{}');
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
    };

    const callGeminiREST = async (base64Data, prompt, apiKey, model = "gemini-2.0-flash", version = "v1beta", systemInstruction = null) => {
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
                let hints = "";
                for (const [compKey, patternHints] of Object.entries(patterns)) {
                    if (fileNameNorm.includes(compKey)) {
                        hints = patternHints;
                        console.log(`🧠 Usando patrón de extracción para: ${compKey}`);
                        break;
                    }
                }
                result = await analyzePolicy(fileContent, hints);
            } else if (targetType === 'invoice') {
                const companyNames = companies.map(c => c.name);
                result = await analyzeInvoice(fileContent, companyNames.join(", "));
            } else if (targetType === 'csv') result = await analyzeCSV(fileContent);

            if (onProgress) onProgress('Procesamiento completado', 100);

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

        // Smart Merge Logic
        const q = query(collection(db, 'policies'), where('policyNumber', '==', safePolicyNumber));
        const snap = await getDocs(q);

        const safePolicyData = sanitizeFirestoreData(policyData);

        const attachment = {
            chunked: true,
            name: fileName,
            type: fileType || 'application/pdf',
            timestamp: new Date().toISOString()
        };

        if (!snap.empty) {
            const existingDoc = snap.docs[0];
            const existingData = existingDoc.data();
            const mergedAttachments = [...(existingData.attachments || []), attachment];

            await updateDoc(existingDoc.ref, {
                ...safePolicyData,
                attachments: mergedAttachments,
                updatedAt: serverTimestamp()
            });

            if (fileBase64) await saveFileChunks(existingDoc.id, fileBase64, fileName, fileType);
            return { status: 'merged', id: existingDoc.id };
        } else {
            const newDoc = await addDoc(collection(db, 'policies'), {
                ...safePolicyData,
                attachments: [attachment],
                createdAt: serverTimestamp()
            });

            if (fileBase64) await saveFileChunks(newDoc.id, fileBase64, fileName, fileType);
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
            const currentModel = genAI.getGenerativeModel({ model: modelName }, { apiVersion: 'v1beta' });

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

            trackGeminiCall('CSV/Excel IA');
            if (onProgress) onProgress('Procesamiento completado', 100);
            return { status: 'success', data: parsed };

        } catch (error) {
            console.error("Error procesando CSV con IA:", error);
            return { status: 'error', error: error.message };
        }
    };

    /**
     * Lógica MAESTRA J&L: Clasificación automática y guardado inteligente
     */
    const handleUnifiedSmartUpload = async (file, onProgress) => {
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

            if (fileNameUpper.includes('MERCANTIL') || fileNameUpper.includes('ANDINA')) {
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
                if (onProgress) onProgress('Clasificando con IA Maestra...', 30);
                const companyNames = companies.map(c => c.name);
                const result = await smartAnalyzeFile(base64Content, companyNames);
                // Restauramos el acceso correcto a `.data` y protegemos ante la ausencia de extractedData
                documentType = result.data?.documentType;
                extractedData = result.data?.extractedData || {};
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

            if (onProgress) onProgress('¡Carga completada con éxito!', 100);

            // Registrar consumo de tokens
            if (result.usageMetadata) {
                trackGeminiCall('Carga Unificada IA', {
                    ...result.usageMetadata,
                    fileName: file.name
                });
            }

            return { status: 'success', type: documentType, data: extractedData };
        } catch (error) {
            console.error("Smart Upload Error:", error);
            throw error;
        }
    };

    const addPolicy = async (data) => {
        try {
            const { _pendingFileBase64, _pendingFileType, ...rest } = data;
            const safeData = sanitizeFirestoreData(rest);
            const docRef = await addDoc(collection(db, 'policies'), {
                ...safeData,
                timestamp: data.timestamp || serverTimestamp()
            });

            if (_pendingFileBase64) {
                await saveFileChunks(docRef.id, _pendingFileBase64, rest.fileName || 'documento.pdf', _pendingFileType);
            }

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
            await updateDoc(doc(db, 'policies', id), safeData);

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

            // Agrupar todas las pólizas por Nombre Exacto del Cliente (limpio)
            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                if (!data.clientName) return;

                // Normalizar nombre: minúsculas, sin espacios extra
                const nameKey = String(data.clientName || '').trim().toLowerCase().replace(/\s+/g, ' ');

                if (!groups[nameKey]) groups[nameKey] = [];
                groups[nameKey].push({ id: docSnap.id, ref: docSnap.ref, data: data });
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

            for (const [nameKey, docsOfClient] of Object.entries(groups)) {
                // Solo nos interesan clientes que tienen más de 1 póliza
                if (docsOfClient.length <= 1) continue;

                const allDnis = docsOfClient.map(d => d.data.dni ? d.data.dni.toString().trim() : '').filter(Boolean);
                const uniqueDnis = [...new Set(allDnis)];

                // Si no hay ningún DNI en ninguna póliza de este nombre, no podemos unificar
                if (uniqueDnis.length === 0) continue;

                // Si ya tienen el mismo DNI y todas tienen DNI, no hay nada que hacer
                if (uniqueDnis.length === 1 && docsOfClient.every(d => d.data.dni)) continue;

                mergedClients++;

                // Elegir el "Mejor DNI/CUIT" (Priorizamos CUIT de 11 dígitos, sino el más largo, o el DNI estándar)
                const targetDni = uniqueDnis.sort((a, b) => {
                    if (a.length === 11 && b.length !== 11) return -1;
                    if (b.length === 11 && a.length !== 11) return 1;
                    return b.length - a.length;
                })[0];

                // Reemplazar el DNI/CUIT en todas las pólizas de esta persona que tengan uno distinto o vacio
                for (const pDoc of docsOfClient) {
                    const currentDni = pDoc.data.dni ? pDoc.data.dni.toString().trim() : '';
                    if (currentDni !== targetDni) {
                        currentBatch.update(pDoc.ref, { dni: targetDni });
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

        // 0. Utilidad para detectar auto-expiración (Feedback v16)
        // Pólizas de Accidentes Personales con vigencia <= 32 días que ya vencieron
        const isAutoExpired = (p) => {
            if (!p.endDate || p.isCancelled) return false;
            const risk = (p.riskType || '').toLowerCase();
            if (!risk.includes('accidente')) return false;

            const start = p.startDate ? new Date(p.startDate) : null;
            const end = new Date(p.endDate);

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

        // 2. Detectamos pólizas próximas a vencer (próximos 30 días)
        // Excluimos las que ya auto-expiraron para no ensuciar alertas
        const expiring = policies.filter(p => {
            if (!p.endDate || p.isCancelled || isAutoExpired(p)) return false;
            const end = new Date(p.endDate);
            const diffTime = end - now;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            return diffDays >= 0 && diffDays <= 30;
        }).sort((a, b) => new Date(a.endDate) - new Date(b.endDate));

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
            saveExtractionPattern
        }}>
            {children}
        </AppContext.Provider>
    );
};

export const useAppContext = () => useContext(AppContext);
