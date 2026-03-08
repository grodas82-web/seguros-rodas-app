import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { db } from '../firebase/config';
import { collection, doc, writeBatch } from 'firebase/firestore';
import { FileUp, CheckCircle2, AlertCircle, Database, ArrowRight, Loader2, Sparkles } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { motion, AnimatePresence } from 'framer-motion';

const DataMigrator = () => {
    const { standardizeExistingData } = useAppContext();
    const [status, setStatus] = useState('idle'); // idle, loading, success, error
    const [progress, setProgress] = useState('');
    const [stats, setStats] = useState({ invoices: 0, companies: 0 });
    const [errorMsg, setErrorMsg] = useState('');

    const handleFile = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setStatus('loading');
        setProgress('Leyendo archivo Excel...');
        setErrorMsg('');

        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                // 1. Verificar configuración Firebase
                if (!db.app.options.apiKey) {
                    throw new Error("FACTURACIÓN: Falta configurar el API Key de Firebase.");
                }

                const dataBody = new Uint8Array(evt.target.result);
                const wb = XLSX.read(dataBody, { type: 'array', cellDates: true });

                console.log("Hojas detectadas:", wb.SheetNames);
                setProgress('Analizando datos...');

                const getSheet = (name) => {
                    const foundName = wb.SheetNames.find(s => s.toLowerCase().includes(name.toLowerCase()));
                    return foundName ? wb.Sheets[foundName] : null;
                };

                const getVal = (obj, key) => {
                    if (!obj) return null;
                    const normalizedKey = key.toLowerCase().trim();
                    const actualKey = Object.keys(obj).find(k => k.toLowerCase().trim() === normalizedKey);
                    return actualKey ? obj[actualKey] : null;
                };

                // Función para guardar en batches de 500 (límite de Firestore)
                const saveBatch = async (collectionName, items, typeLabel) => {
                    const batchSize = 500;
                    let totalCount = 0;

                    for (let i = 0; i < items.length; i += batchSize) {
                        const batch = writeBatch(db);
                        const chunk = items.slice(i, i + batchSize);

                        chunk.forEach(item => {
                            const newDocRef = doc(collection(db, collectionName));
                            batch.set(newDocRef, {
                                ...item,
                                timestamp: new Date(),
                                migrationSource: 'Excel Import'
                            });
                        });

                        setProgress(`Guardando ${typeLabel} (${i + chunk.length}/${items.length})...`);
                        await batch.commit();
                        totalCount += chunk.length;
                    }
                    return totalCount;
                };

                // 1. Procesar Compañías
                let cCount = 0;
                const shCuit = getSheet('Cuit');
                if (shCuit) {
                    const rawCuit = XLSX.utils.sheet_to_json(shCuit, { range: 2 });
                    const companiesToSave = rawCuit
                        .filter(row => getVal(row, 'Compañias') || getVal(row, 'Compañías') || getVal(row, 'Companias') || getVal(row, 'Nombre'))
                        .map(row => ({
                            name: (getVal(row, 'Compañias') || getVal(row, 'Compañías') || getVal(row, 'Companias') || getVal(row, 'Nombre'))?.toString().trim(),
                            cuit: getVal(row, 'Cuit')?.toString().trim() || '',
                            ivaType: (getVal(row, 'Tipo de Iva') || getVal(row, 'IVA') || getVal(row, 'Iva'))?.toString().trim() || 'Responsable Inscripto'
                        }));

                    if (companiesToSave.length > 0) {
                        cCount = await saveBatch('companies', companiesToSave, 'Compañías');
                    }
                }

                // 2. Procesar Facturas
                let iCount = 0;
                const shFact = getSheet('Facturas');
                if (shFact) {
                    const rawFact = XLSX.utils.sheet_to_json(shFact, { range: 2 });
                    const invoicesToSave = rawFact
                        .filter(row => getVal(row, 'Compaia') || getVal(row, 'Compañía') || getVal(row, 'Compania') || getVal(row, 'Empresa'))
                        .map(row => {
                            const totalRaw = getVal(row, 'Total') || getVal(row, 'Monto') || getVal(row, 'Importe');
                            let cleanAmt = 0;
                            if (totalRaw) {
                                const valStr = totalRaw.toString().replace(/[$\s]/g, '');
                                if (valStr.includes(',') && valStr.includes('.')) {
                                    cleanAmt = parseFloat(valStr.replace(/\./g, '').replace(',', '.'));
                                } else if (valStr.includes(',')) {
                                    cleanAmt = parseFloat(valStr.replace(',', '.'));
                                } else {
                                    cleanAmt = parseFloat(valStr);
                                }
                            }

                            return {
                                number: (getVal(row, 'Numero FC') || getVal(row, 'Número') || getVal(row, 'Nro') || getVal(row, 'Comprobante'))?.toString().trim() || '',
                                date: getVal(row, 'Fecha')?.toString().trim() || '',
                                company: (getVal(row, 'Compaia') || getVal(row, 'Compañía') || getVal(row, 'Compania') || getVal(row, 'Empresa'))?.toString().trim(),
                                amount: isNaN(cleanAmt) ? 0 : cleanAmt,
                                type: 'Factura C',
                                pointOfSale: '00001',
                                cuit: ''
                            };
                        });

                    if (invoicesToSave.length > 0) {
                        iCount = await saveBatch('invoices', invoicesToSave, 'Facturas');
                    }
                }

                setStats({ invoices: iCount, companies: cCount });
                if (iCount === 0 && cCount === 0) {
                    throw new Error("No se detectaron datos válidos en las hojas 'Facturas' o 'Cuit'.");
                }

                setStatus('success');
            } catch (err) {
                console.error("ERROR CRÍTICO MIGRACIÓN:", err);
                setErrorMsg(err.message || 'Error desconocido durante la carga.');
                setStatus('error');
            }
        };
        reader.onerror = (e) => {
            console.error("Error lectura archivo:", e);
            setStatus('error');
        };
        reader.readAsArrayBuffer(file);
    };

    return (
        <div className="max-w-4xl mx-auto py-12 px-4 pb-32">
            <div className="bg-white/[0.03] backdrop-blur-3xl border border-white/5 rounded-[3rem] p-8 md:p-12 shadow-2xl overflow-hidden relative group">
                {/* Background Decoration */}
                <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 blur-[100px] -mr-32 -mt-32 rounded-full" />

                <div className="relative z-10">
                    <div className="flex items-center gap-5 mb-10">
                        <div className="p-4 bg-indigo-500/10 text-indigo-400 rounded-2xl border border-indigo-500/20 shadow-inner">
                            <Database size={32} />
                        </div>
                        <div>
                            <h2 className="text-3xl font-black text-white tracking-tight uppercase leading-none mb-2">Migración de Datos</h2>
                            <p className="text-zinc-500 font-medium">Historial completo desde Excel a la nube.</p>
                        </div>
                    </div>

                    <AnimatePresence mode="wait">
                        {status === 'idle' && (
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -20 }}
                                className="bg-zinc-900/30 border-2 border-dashed border-zinc-800 rounded-[2rem] p-12 md:p-20 text-center"
                            >
                                <div className="mb-8 flex justify-center">
                                    <div className="p-6 bg-zinc-800/50 rounded-full text-zinc-600">
                                        <FileUp size={64} />
                                    </div>
                                </div>
                                <h4 className="text-2xl font-black text-zinc-100 mb-3">Sube tu archivo .XLSM o .XLSX</h4>
                                <p className="text-zinc-500 mb-10 max-w-sm mx-auto font-medium">Procesaremos automáticamente las pestañas de Facturas y Cuit para sincronizarlas.</p>

                                <label className="group relative inline-flex items-center gap-3 bg-white text-black font-black px-10 py-5 rounded-2xl transition-all cursor-pointer hover:scale-105 active:scale-95 shadow-xl">
                                    <FileUp size={24} />
                                    <span>SELECCIONAR ARCHIVO</span>
                                    <input type="file" className="hidden" accept=".xlsm,.xlsx" onChange={handleFile} />
                                </label>

                                <div className="mt-12 pt-8 border-t border-zinc-800/50">
                                    <button
                                        onClick={async () => {
                                            if (window.confirm('¿Quieres estandarizar todas las facturas a TIPO C y formatos de 5-8 dígitos?')) {
                                                setStatus('loading');
                                                setProgress('Estandarizando base de datos...');
                                                await standardizeExistingData();
                                                setStatus('success');
                                            }
                                        }}
                                        className="text-indigo-400 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 mx-auto hover:text-white transition-colors"
                                    >
                                        <Sparkles size={14} /> Corregir formatos de datos existentes
                                    </button>
                                </div>
                            </motion.div>
                        )}

                        {status === 'loading' && (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="py-24 text-center"
                            >
                                <div className="relative w-24 h-24 mx-auto mb-10">
                                    <div className="absolute inset-0 border-4 border-indigo-500/20 rounded-full" />
                                    <div className="absolute inset-0 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                                    <Loader2 className="absolute inset-0 m-auto text-indigo-400 animate-pulse" size={32} />
                                </div>
                                <h4 className="text-2xl font-black text-white italic tracking-[0.2em] uppercase mb-4">{progress}</h4>
                                <div className="flex items-center justify-center gap-2 text-zinc-500 font-medium text-sm">
                                    <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-ping" />
                                    Mantén esta ventana abierta para completar la sincronización
                                </div>
                            </motion.div>
                        )}

                        {status === 'success' && (
                            <motion.div
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                className="bg-emerald-500/5 border border-emerald-500/20 rounded-[2rem] p-12 text-center"
                            >
                                <div className="w-20 h-20 bg-emerald-500 text-black rounded-full flex items-center justify-center mx-auto mb-8 shadow-lg shadow-emerald-500/20">
                                    <CheckCircle2 size={48} />
                                </div>
                                <h4 className="text-3xl font-black text-white mb-4 uppercase tracking-tight">¡Sincronización Exitosa!</h4>
                                <p className="text-zinc-500 mb-10 font-medium">Los datos históricos ya están disponibles en todos tus dispositivos.</p>

                                <div className="grid grid-cols-2 gap-6 max-w-lg mx-auto mb-10">
                                    <div className="bg-zinc-900/80 p-6 rounded-3xl border border-zinc-800 shadow-xl">
                                        <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Total Facturas</p>
                                        <p className="text-4xl font-black text-white">{stats.invoices}</p>
                                    </div>
                                    <div className="bg-zinc-900/80 p-6 rounded-3xl border border-zinc-800 shadow-xl">
                                        <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Total Compañías</p>
                                        <p className="text-4xl font-black text-white">{stats.companies}</p>
                                    </div>
                                </div>

                                <button
                                    onClick={() => window.location.reload()}
                                    className="bg-zinc-100 text-black font-black px-12 py-5 rounded-2xl hover:bg-white transition-all flex items-center gap-3 mx-auto shadow-xl"
                                >
                                    VOLVER AL PANEL <ArrowRight size={24} />
                                </button>
                            </motion.div>
                        )}

                        {status === 'error' && (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="bg-rose-500/5 border border-rose-500/20 rounded-[2rem] p-12 text-center"
                            >
                                <div className="w-20 h-20 bg-rose-500/20 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-8">
                                    <AlertCircle size={48} />
                                </div>
                                <h4 className="text-2xl font-black text-white mb-3 uppercase tracking-tight">Error en el Proceso</h4>
                                <div className="bg-black/40 p-6 rounded-2xl border border-rose-500/10 mb-10 text-rose-400 font-mono text-sm leading-relaxed">
                                    {errorMsg || "No se pudo completar la migración. Verifica el archivo excel y tu conexión a internet."}
                                </div>
                                <button
                                    onClick={() => setStatus('idle')}
                                    className="bg-rose-600 hover:bg-rose-500 text-white font-black px-12 py-5 rounded-2xl transition-all shadow-xl shadow-rose-600/20"
                                >
                                    REINTENTAR CARGA
                                </button>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </div>
    );
};

export default DataMigrator;
