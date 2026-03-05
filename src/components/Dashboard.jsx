import React, { useMemo } from 'react';
import { useAppContext } from '../context/AppContext';
import { FileText, TrendingUp, Users, DollarSign, ArrowUpRight, ArrowDownRight, Calendar, CheckCircle2, Download, ShieldAlert, X, Sun, Moon, RefreshCw, Upload, XCircle, Mail, Zap } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

// Configura el worker de PDF.js (CDN explícito con https para evitar problemas en Electron)
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

const StatCard = ({ title, value, icon: Icon, color, trend, subtitle }) => (
    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] backdrop-blur-xl rounded-2xl md:rounded-[2.5rem] p-4 md:p-6 shadow-[var(--card-shadow)] relative overflow-hidden group hover:scale-[1.01] transition-all duration-300">
        <div className="flex justify-between items-start mb-6 relative z-10">
            <div className={`p-3.5 rounded-2xl bg-${color}-500/10 text-${color}-500 group-hover:bg-${color}-500 group-hover:text-white transition-all duration-300`}>
                <Icon size={24} />
            </div>
            {trend !== undefined && (
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-2xl text-[9px] font-black tracking-widest uppercase ${trend >= 0 ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-600 border border-rose-500/20'
                    }`}>
                    {trend >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                    {Math.abs(trend)}%
                </div>
            )}
        </div>
        <div className="relative z-10">
            <p className="text-[var(--text-secondary)] text-[10px] font-black uppercase tracking-[0.2em] mb-2">{title}</p>
            <h3 className="text-3xl font-black text-[var(--text-color)] tracking-tight tabular-nums">{value}</h3>
            {subtitle && <p className="text-[var(--text-secondary)] text-[9px] mt-2 font-bold uppercase tracking-wider opacity-70 group-hover:opacity-100 transition-opacity">{subtitle}</p>}
        </div>

        {/* Dynamic Glow Orbs */}
        <div className={`absolute -right-12 -bottom-12 w-48 h-48 bg-${color}-500/10 blur-[40px] rounded-full opacity-0 group-hover:opacity-100 transition-all duration-500`} />
    </div>
);

const ProcesadorIA = () => {
    const context = useAppContext();
    const { processInvoiceFile, analyzePolicyWithAI, addPolicy } = context || {};
    const [files, setFiles] = React.useState([]);
    const [isDragging, setIsDragging] = React.useState(false);
    const [isScanning, setIsScanning] = React.useState(false);
    const [isProcessing, setIsProcessing] = React.useState(false);
    const [notifStatus, setNotifStatus] = React.useState(null); // null | 'sending' | {success, message, duplicate}
    const fileInputRef = React.useRef(null);
    const cancelRef = React.useRef(false);

    const handleCancelUpload = () => {
        cancelRef.current = true;
        setFiles(prev => prev.map(f => f.status === 'analizando' ? { ...f, status: 'cancelled', progressMsg: '', error: 'Cancelado por el usuario' } : f));
        setIsProcessing(false);
        setIsScanning(false);
    };

    const legacy_pdf_ia = async (fileList) => {
        cancelRef.current = false;
        setIsProcessing(true);
        const initialStatus = Array.from(fileList).map(f => ({
            id: Math.random().toString(36),
            name: f.name,
            status: 'analizando',
            data: null
        }));

        setFiles(prev => [...initialStatus, ...prev].slice(0, 10));

        const results = { added: [], duplicates: 0, errors: 0 };

        for (let i = 0; i < fileList.length; i++) {
            if (cancelRef.current) {
                // Mark remaining files as cancelled
                for (let j = i; j < fileList.length; j++) {
                    setFiles(prev => prev.map(f => f.id === initialStatus[j].id && f.status === 'analizando' ? { ...f, status: 'cancelled', progressMsg: '', error: 'Cancelado' } : f));
                }
                break;
            }
            const file = fileList[i];
            const currentItem = initialStatus[i];

            try {
                const result = await processInvoiceFile(file, null, (msg, pct) => {
                    if (cancelRef.current) return;
                    setFiles(prev => prev.map(f => f.id === currentItem.id ? { ...f, status: 'analizando', progressMsg: msg } : f));
                });
                if (cancelRef.current) break;
                if (result.status === 'success') {
                    results.added.push(result.data.company || 'Compañía desconocida');
                } else if (result.status === 'duplicate') {
                    results.duplicates++;
                } else if (result.status === 'error') {
                    results.errors++;
                    alert(`❌ Error al procesar ${file.name}:\n${result.error}`);
                }
                setFiles(prev => prev.map(f =>
                    f.id === currentItem.id ? { ...f, status: result.status, data: result.data, error: result.error, progressMsg: '' } : f
                ));
            } catch (error) {
                if (cancelRef.current) break;
                results.errors++;
                console.error("Error procesando archivo manual:", error);
                alert(`❌ Error al subir ${file.name}\n${error.message}`);
                setFiles(prev => prev.map(f => f.id === currentItem.id ? { ...f, status: 'error', error: error.message, progressMsg: '' } : f));
            }
        }

        setIsProcessing(false);
        if (!cancelRef.current && results.added.length > 0) {
            const uniqueCompanies = [...new Set(results.added)];
            alert(`✅ ¡Éxito! Se agregaron ${results.added.length} facturas nuevas.\n\nCompañías: ${uniqueCompanies.join(', ')}`);
        } else if (cancelRef.current) {
            alert('⛔ Subida cancelada por el usuario.');
        }
    };

    const legacy_sync = async () => {
        try {
            cancelRef.current = false;
            setIsScanning(true);
            setIsProcessing(true);

            // Intentar con el Bridge primero
            try {
                const response = await fetch('http://localhost:3002/api/scan-downloads');
                if (response.ok) {
                    const result = await response.json();
                    if (result.success && result.files.length > 0) {
                        const initialStatus = result.files.map(f => ({
                            id: Math.random().toString(36),
                            name: f.name,
                            status: 'analizando',
                            progressMsg: 'Iniciando...',
                            data: null
                        }));

                        setFiles(prev => [...initialStatus, ...prev].slice(0, 10));

                        const results = { added: [], duplicates: 0, errors: 0 };

                        for (let i = 0; i < result.files.length; i++) {
                            if (cancelRef.current) {
                                for (let j = i; j < result.files.length; j++) {
                                    setFiles(prev => prev.map(f => f.id === initialStatus[j].id && f.status === 'analizando' ? { ...f, status: 'cancelled', progressMsg: '', error: 'Cancelado' } : f));
                                }
                                break;
                            }
                            const fileData = result.files[i];
                            const currentItem = initialStatus[i];

                            try {
                                const analysis = await processInvoiceFile(null, fileData.base64, (msg, pct) => {
                                    if (cancelRef.current) return;
                                    setFiles(prev => prev.map(f => f.id === currentItem.id ? { ...f, status: 'analizando', progressMsg: msg } : f));
                                });
                                if (cancelRef.current) break;
                                if (analysis.status === 'success') {
                                    results.added.push(analysis.data.company || 'Compañía desconocida');
                                } else if (analysis.status === 'duplicate') {
                                    results.duplicates++;
                                } else if (analysis.status === 'error') {
                                    results.errors++;
                                    alert(`❌ Error al procesar ${fileData.name}:\n${analysis.error}`);
                                }
                                setFiles(prev => prev.map(f =>
                                    f.id === currentItem.id ? { ...f, status: analysis.status, data: analysis.data, error: analysis.error, progressMsg: '' } : f
                                ));
                            } catch (error) {
                                if (cancelRef.current) break;
                                results.errors++;
                                console.error("Error en batch bridge:", error);
                                setFiles(prev => prev.map(f => f.id === currentItem.id ? { ...f, status: 'error', error: error.message, progressMsg: '' } : f));
                            }
                        }

                        if (cancelRef.current) {
                            alert('⛔ Sincronización cancelada por el usuario.');
                            return;
                        }
                        if (results.added.length > 0) {
                            const uniqueCompanies = [...new Set(results.added)];
                            alert(`✅ ¡Sincronización completa! Se agregaron ${results.added.length} facturas nuevas.\n\nCompañías: ${uniqueCompanies.join(', ')}`);
                        } else if (results.duplicates > 0) {
                            alert(`ℹ️ Se encontraron ${results.duplicates} archivos pero todos estaban duplicados.`);
                        }

                        return; // Éxito con el bridge
                    } else if (result.success) {
                        alert("No se encontraron facturas nuevas en Descargas vinculadas a tu CUIT de facturación (últimos 15 días).");
                        return;
                    }
                }
            } catch (bridgeError) {
                console.log("Bridge local no detectado o bloqueado.");
                const isWeb = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
                if (isWeb) {
                    const proceed = confirm("⚠️ Estás en la versión WEB.\n\nPara sincronizar la carpeta 'Archivos Descargados', Chrome necesita que la selecciones manualmente una vez por sesión (por seguridad).\n\n¿Querés elegir la carpeta ahora?\n\nRuta: C:\\Users\\Admin\\OneDrive\\Documents\\Archivos Descargados");
                    if (!proceed) {
                        setIsScanning(false);
                        return;
                    }
                }
            }

            // Fallback al selector manual (si el bridge falla o no está)
            try {
                const directoryHandle = await window.showDirectoryPicker();
                const foundFiles = [];

                for await (const entry of directoryHandle.values()) {
                    const fileName = entry.name.toLowerCase();
                    // SOLO archivos de comisiones (CUIT exacto, no toca pólizas)
                    const isTargetFile = fileName.startsWith('23294824979_') && fileName.endsWith('.pdf');

                    if (entry.kind === 'file' && isTargetFile) {
                        const file = await entry.getFile();
                        const isAlreadyInSystem = (context.uniqueInvoices || []).some(inv =>
                            inv.fileName === file.name || inv.originalName === file.name
                        );

                        if (!isAlreadyInSystem) {
                            foundFiles.push(file);
                        }
                    }
                }

                if (foundFiles.length > 0) {
                    const sortedFiles = foundFiles.sort((a, b) => b.lastModified - a.lastModified).slice(0, 10);
                    await legacy_pdf_ia(sortedFiles);
                } else {
                    alert("No se encontraron comprobantes nuevos con el inicio '23294824..._011' en la carpeta seleccionada.\n\nAsegurate de seleccionar: Archivos Descargados");
                }
            } catch (dirErr) {
                if (dirErr.name === 'AbortError') return;

                let msg = "⚠️ Error de Seguridad de Chrome\n\n";
                msg += "Chrome bloquea el acceso directo a la carpeta 'Descargas' por protección.\n\n";
                msg += "SOLUCIÓN RÁPIDA:\n";
                msg += "1. Navegá a: OneDrive > Documents > Archivos Descargados.\n";
                msg += "2. Seleccioná esa carpeta.\n\n";
                msg += "O usá la App de Escritorio que sincroniza automáticamente.";

                alert(msg);
            }
        } finally {
            setIsScanning(false);
            setIsProcessing(false);
        }
    };

    // Helper: Extraer texto de las primeras 3 páginas para clasificación
    const classifyDocument = async (fileBase64) => {
        try {
            const base64Data = fileBase64.split(',')[1];
            const binaryString = atob(base64Data);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            const loadingTask = pdfjs.getDocument({ data: bytes });
            const pdf = await loadingTask.promise;

            let fullText = "";
            const pagesToRead = Math.min(pdf.numPages, 3);

            for (let i = 1; i <= pagesToRead; i++) {
                const page = await pdf.getPage(i);
                const content = await page.getTextContent();
                fullText += content.items.map(item => item.str).join(" ") + " ";
            }

            const textLower = fullText.toLowerCase();

            if (textLower.includes('2329482497') || textLower.includes('liquidación') || textLower.includes('comisión') || textLower.includes('liquidacion')) {
                return 'liquidacion';
            }
            if (textLower.includes('póliza') || textLower.includes('poliza') || textLower.includes('vigencia') || textLower.includes('asegurado')) {
                return 'poliza';
            }

            return 'unknown';
        } catch (e) {
            console.error("Error clasificando PDF:", e);
            return `error:${e.message}`;
        }
    };

    // --- NUEVO: Motor de Clasificación y Sincronización Inteligente v6.0 ---
    const syncIA = async (manualFiles = null) => {
        try {
            cancelRef.current = false;
            setIsScanning(true);
            setIsProcessing(true);

            let filesToProcess = [];

            if (manualFiles) {
                filesToProcess = Array.from(manualFiles).map(f => ({ file: f, name: f.name, source: 'manual' }));
            } else {
                // Escaneo automático vía Bridge
                try {
                    const resp = await fetch('http://localhost:3002/api/scan-downloads');
                    const result = await resp.json();
                    if (result.success && result.files?.length > 0) {
                        filesToProcess = result.files.map(f => ({ ...f, source: 'bridge' }));
                    }
                } catch (e) {
                    console.warn("Bridge no disponible para auto-sync:", e);
                }
            }

            if (filesToProcess.length === 0 && !manualFiles) {
                alert("No se encontraron archivos nuevos en Descargas.");
                return;
            }

            // Inicializar estados visuales
            const initialStatus = filesToProcess.map(f => ({
                id: Math.random().toString(36),
                name: f.name,
                status: 'detectando',
                progressMsg: 'Clasificando...',
                data: null
            }));
            setFiles(prev => [...initialStatus, ...prev].slice(0, 20));

            const summary = { liquidaciones: 0, polizas: 0, errors: 0, duplicates: 0 };

            for (let i = 0; i < filesToProcess.length; i++) {
                if (cancelRef.current) break;
                const item = filesToProcess[i];
                const statusItem = initialStatus[i];

                try {
                    // 1. Clasificación Profunda (PDF.js)
                    setFiles(prev => prev.map(f => f.id === statusItem.id ? { ...f, progressMsg: 'Leyendo PDF...' } : f));

                    let base64 = item.base64;
                    if (base64 && !base64.startsWith('data:')) {
                        base64 = `data:application/pdf;base64,${base64}`;
                    } else if (!base64) {
                        base64 = await new Promise((resolve) => {
                            const reader = new FileReader();
                            reader.onload = (e) => resolve(e.target.result);
                            reader.readAsDataURL(item.file);
                        });
                    }

                    const type = await classifyDocument(base64);

                    // 2. Procesamiento (Gemini con Backoff)
                    setFiles(prev => prev.map(f => f.id === statusItem.id ? { ...f, status: 'analizando', progressMsg: `Procesando ${type}...` } : f));

                    if (type === 'liquidacion') {
                        // Flujo de Liquidación existente
                        const result = await processInvoiceFile(item.file || null, base64, (msg) => {
                            setFiles(prev => prev.map(f => f.id === statusItem.id ? { ...f, progressMsg: msg } : f));
                        });

                        if (result.status === 'success') {
                            summary.liquidaciones++;
                        } else if (result.status === 'duplicate') {
                            summary.duplicates++;
                        } else {
                            summary.errors++;
                            summary.lastError = result.error || 'Falla al procesar liquidación';
                        }

                        setFiles(prev => prev.map(f => f.id === statusItem.id ? { ...f, status: result.status, data: result.data, error: result.error } : f));
                    } else if (type === 'poliza') {
                        // Flujo de Póliza (Nuevo en v6.0)
                        setFiles(prev => prev.map(f => f.id === statusItem.id ? { ...f, progressMsg: 'Extrayendo datos de póliza...' } : f));
                        try {
                            const result = await analyzePolicyWithAI(base64.split(',')[1]);
                            const policyData = {
                                ...result,
                                attachments: [{
                                    chunked: true,
                                    name: item.name,
                                    type: 'application/pdf',
                                    timestamp: new Date().toISOString()
                                }],
                                _pendingFileBase64: base64.split(',')[1],
                                _pendingFileType: 'application/pdf',
                                fileName: item.name,
                                timestamp: new Date()
                            };
                            await addPolicy(policyData);
                            summary.polizas++;
                            setFiles(prev => prev.map(f => f.id === statusItem.id ? { ...f, status: 'success', data: result } : f));
                        } catch (err) {
                            console.error("Error en extracción de póliza:", err);
                            setFiles(prev => prev.map(f => f.id === statusItem.id ? { ...f, status: 'error', error: err.message } : f));
                            summary.errors++;
                            summary.lastError = err.message;
                        }
                    } else if (type && type.startsWith('error:')) {
                        const errMsg = type.replace('error:', '');
                        setFiles(prev => prev.map(f => f.id === statusItem.id ? { ...f, status: 'error', error: `Falla al leer PDF: ${errMsg}` } : f));
                        summary.errors++;
                        summary.lastError = errMsg;
                    } else {
                        setFiles(prev => prev.map(f => f.id === statusItem.id ? { ...f, status: 'error', error: 'Documento no reconocido' } : f));
                        summary.errors++;
                    }

                } catch (error) {
                    console.error("Error en Sync IA:", error);
                    setFiles(prev => prev.map(f => f.id === statusItem.id ? { ...f, status: 'error', error: error.message } : f));
                    summary.errors++;
                    summary.lastError = error.message;
                }

                // Pequeño delay entre archivos para no saturar
                await new Promise(r => setTimeout(r, 500));
            }

            if (!cancelRef.current) {
                const errMsg = summary.lastError ? `\n\n🔎 Detalle del error: ${summary.lastError}` : '';
                alert(`🎯 Resumen de Sync IA:\n\n✅ Liquidaciones: ${summary.liquidaciones}\n✅ Pólizas: ${summary.polizas}\n♻️ Duplicados: ${summary.duplicates}\n❌ Errores: ${summary.errors}${errMsg}`);
            }

        } finally {
            setIsScanning(false);
            setIsProcessing(false);
        }
    };


    return (
        <div
            className={`lg:col-span-4 bg-[var(--card-bg)] border border-[var(--border-color)] backdrop-blur-3xl rounded-[2.5rem] p-6 relative overflow-hidden shadow-[var(--card-shadow)] ${isDragging ? 'bg-indigo-500/10 scale-[0.99] border-indigo-500/30' : ''
                }`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                syncIA(e.dataTransfer.files);
            }}
        >
            <input
                type="file"
                ref={fileInputRef}
                multiple
                accept=".pdf"
                onChange={(e) => {
                    syncIA(e.target.files);
                }}
                className="fixed opacity-0 pointer-events-none"
            />
            <div className="flex flex-col md:flex-row items-center justify-between gap-6 relative z-10">
                <div className="flex items-center gap-6">
                    <div className={`p-4 rounded-[1.5rem] ${isScanning ? 'bg-indigo-500 animate-spin-slow' : 'bg-indigo-500/10 text-indigo-400'} transition-all`}>
                        <TrendingUp size={24} />
                    </div>
                    <div>
                        <h3 className="font-black text-[var(--text-color)] uppercase text-[11px] tracking-[0.2em] mb-1">Carga Inteligente</h3>
                        <p className="text-[var(--text-secondary)] text-[10px] font-bold uppercase tracking-widest leading-none">
                            Gemini AI • Procesamiento en Tiempo Real
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-4 relative z-50">
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            syncIA();
                        }}
                        disabled={isScanning}
                        className="flex items-center gap-3 px-6 py-3 bg-indigo-500 hover:bg-indigo-600 text-white shadow-lg shadow-indigo-500/20 border border-indigo-500/30 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50 pointer-events-auto"
                        title="Sincronizar Inteligente (Facturas y Pólizas)"
                    >
                        <Zap size={14} className={isScanning ? 'animate-pulse' : ''} />
                        SYNC IA v6.0
                    </button>

                    <button
                        type="button"
                        onClick={async (e) => {
                            e.stopPropagation();
                            setNotifStatus('sending');
                            try {
                                const resp = await fetch('http://localhost:3002/api/send-notification', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        trackingId: 'TEST-0001',
                                        company: 'Allianz',
                                        grossAmount: 100000,
                                        iibbRate: 0.045,
                                        month: 'Marzo 2026'
                                    })
                                });
                                const result = await resp.json();
                                setNotifStatus(result);
                                if (result.duplicate) {
                                    alert(`⛔ Duplicado bloqueado!\n\n${result.message}`);
                                } else if (result.success) {
                                    alert(`✅ Email enviado con éxito!\n\nID: ${result.trackingId}\nCompañía: ${result.details.company}\nNeto: $${result.details.netAmount.toLocaleString('es-AR')}`);
                                } else {
                                    alert(`❌ Error: ${result.error || 'Error desconocido'}`);
                                }
                                setTimeout(() => setNotifStatus(null), 8000);
                            } catch (err) {
                                setNotifStatus({ success: false, error: err.message });
                                alert(`❌ No se pudo conectar al Bridge.\n\nAsegurate de tener el Bridge corriendo (INICIAR_BRIDGE.bat)\n\n${err.message}`);
                                setTimeout(() => setNotifStatus(null), 5000);
                            }
                        }}
                        disabled={notifStatus === 'sending'}
                        className={`flex items-center gap-3 px-5 py-3 text-[10px] font-black uppercase tracking-widest rounded-2xl active:scale-95 whitespace-nowrap pointer-events-auto transition-all ${notifStatus === 'sending' ? 'bg-amber-500 text-white animate-pulse' :
                            notifStatus?.success ? 'bg-emerald-500 text-white' :
                                notifStatus?.duplicate ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                                    'bg-purple-500/10 text-purple-400 border border-purple-500/20 hover:bg-purple-500 hover:text-white'
                            }`}
                        title="Enviar email de prueba al sistema"
                    >
                        <Mail size={14} />
                        {notifStatus === 'sending' ? 'Enviando...' :
                            notifStatus?.success ? '✅ Enviado' :
                                notifStatus?.duplicate ? '⛔ Duplicado' :
                                    'Test Email'}
                    </button>

                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            fileInputRef.current?.click();
                        }}
                        className="flex items-center gap-3 px-6 py-3 bg-indigo-500 hover:bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest rounded-2xl shadow-lg shadow-indigo-500/20 active:scale-95 whitespace-nowrap pointer-events-auto relative z-[60]"
                    >
                        <Upload size={14} />
                        Upload Archivo IA
                    </button>

                    {/* Botón CANCELAR - solo visible durante procesamiento */}
                    {(isProcessing || files.some(f => f.status === 'analizando')) && (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleCancelUpload();
                            }}
                            className="flex items-center gap-3 px-6 py-3 bg-rose-500 hover:bg-rose-600 text-white text-[10px] font-black uppercase tracking-widest rounded-2xl shadow-lg shadow-rose-500/30 active:scale-95 whitespace-nowrap pointer-events-auto relative z-[60] animate-pulse hover:animate-none transition-all"
                        >
                            <XCircle size={14} />
                            Cancelar Subida
                        </button>
                    )}
                </div>

                {files.length > 0 && (
                    <div className="flex flex-col items-end gap-2 shrink-0">
                        <div className="flex -space-x-3 overflow-hidden">
                            {files.slice(0, 5).map((file, i) => (
                                <div
                                    key={file.id}
                                    title={`${file.name}: ${file.progressMsg || (file.status === 'error' ? file.error : file.status)}`}
                                    className={`w-10 h-10 rounded-full border-2 border-[var(--bg-color)] flex items-center justify-center transition-all hover:scale-110 hover:z-20 ${file.status === 'success' ? 'bg-emerald-500/20 text-emerald-500 border-emerald-500/20' :
                                        file.status === 'duplicate' ? 'bg-amber-500/10 text-amber-400 border-amber-500/10' :
                                            file.status === 'error' ? 'bg-rose-500/20 text-rose-400 border-rose-500/20' :
                                                file.status === 'cancelled' ? 'bg-zinc-500/20 text-zinc-400 border-zinc-500/20' :
                                                    'bg-indigo-500/20 text-indigo-400 animate-pulse'
                                        }`}
                                >
                                    <FileText size={16} />
                                </div>
                            ))}
                            {files.length > 5 && (
                                <div className="w-10 h-10 rounded-full bg-[var(--border-color)] border-2 border-[var(--bg-color)] flex items-center justify-center text-[10px] font-black text-[var(--text-secondary)]">
                                    +{files.length - 5}
                                </div>
                            )}
                        </div>

                        {/* Mensaje de Progreso Activo */}
                        {files.some(f => f.status === 'analizando') && (
                            <div className="flex items-center gap-2 mt-1">
                                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping" />
                                <p className="text-[9px] text-indigo-400 font-black uppercase tracking-widest">
                                    {files.find(f => f.status === 'analizando')?.progressMsg || 'Analizando...'}
                                </p>
                            </div>
                        )}

                        {/* Mensaje de Error Compacto */}
                        {files.find(f => f.status === 'error') && (
                            <div className="max-w-[150px] text-right overflow-hidden">
                                <p className="text-[8px] text-rose-400 font-bold uppercase tracking-widest truncate" title={files.find(f => f.status === 'error').error}>
                                    ⚠️ {files.find(f => f.status === 'error').error}
                                </p>
                            </div>
                        )}
                    </div>
                )}

            </div>

            {/* Subtle Progress Bar for the entire batch if scanning */}
            {
                isScanning && (
                    <div className="absolute bottom-0 left-0 h-[2px] bg-indigo-500 shadow-[0_0_10px_#6366f1] animate-[progress_2s_ease-in-out_infinite]" style={{ width: '100%' }} />
                )
            }
        </div>
    );
};

const IIBB_FACTOR = 0.955; // 1 - 4.5% deduction

const Dashboard = ({ onNavigate }) => {
    const context = useAppContext();
    const {
        invoices = [],
        uniqueInvoices = [],
        testInvoices = [],
        companies = [],
        policies = [],
        expiringPolicies = [],
        addCompany,
        addInvoice,
        addPolicy,
        analyzePolicyWithAI,
        processInvoiceFile,
        updateCompany,
        parseDate,
        totalClientsCount,
        normalizeRisk,
        getGeminiUsage
    } = context || {};

    const [viewDate, setViewDate] = React.useState(new Date());

    // Lógica de fechas y comparativas sincronizada con viewDate
    const stats = useMemo(() => {
        if (!context) return null;
        let totalThisMonth = 0, totalLastMonth = 0, totalLastLastMonth = 0;
        let totalYear2026 = 0, totalYear2025 = 0;
        let countThisMonth = 0, countLastMonth = 0, countMonth2025 = 0, countMonth2024 = 0;

        const targetMonth = viewDate.getMonth();
        const targetYear = viewDate.getFullYear();

        // Deduplicación ya viene pre-calculada de AppContext

        // 1b. Las de prueba solo para el gráfico/estadísticas generales, pero NO para marcar cobertura
        const allRelevantInvoices = [...uniqueInvoices, ...testInvoices];
        const chartRaw = Array(12).fill(null).map(() => ({ '2024': 0, '2025': 0, '2026': 0 }));
        const companySumsThisMonth = new Map();
        const companySumsLastMonth = new Map();
        const loadedThisMonthSet = new Set();

        // Alias helper for matching company names
        const getCanon = (name) => {
            if (!name) return '';
            const u = name.toUpperCase().trim();
            if (u.includes('ACS COMERCIAL') || u.includes('GALICIA') || u.includes('1276')) return 'GALICIA';
            if (u.includes('MERCANTIL ANDINA') || u.includes('MERCANTIL')) return 'MERCANTIL';
            if (u.includes('FEDERA')) return 'FEDERACION';
            if (u.includes('ALLIANZ')) return 'ALLIANZ';
            if ((u.includes('SWISS MEDICAL') && u.includes('ART')) || u.includes('SWISS MEDICAL ART')) return 'SWISS MEDICAL ART';
            if (u.includes('SMG') || (u.includes('COMPANIA ARGENTINA') && u.includes('SEGUROS')) || (u.includes('SWISS MEDICAL') && !u.includes('ART'))) return 'SMG';
            if (u.includes('MERIDIONAL')) return 'MERIDIONAL';
            if (u.includes('ZURICH')) return 'ZURICH';
            if (u.includes('RIVADAVIA')) return 'RIVADAVIA';
            if (u.includes('SANCOR')) return 'SANCOR';
            if (u.includes('SAN CRISTOBAL') || u.includes('SAN CRIST\u00d3BAL')) return 'SAN CRISTOBAL';
            if (u.includes('PROVINCIA')) return 'PROVINCIA';
            if (u.includes('MAPFRE')) return 'MAPFRE';
            if (u.includes('HAMBURGO')) return 'HAMBURGO';
            if (u.includes('INTEGRITY')) return 'INTEGRITY';
            if (u.includes('TRIUNFO')) return 'TRIUNFO';
            return u.replace(/\s*(S\.?A\.?|SEGUROS|CIA\.?|COMPA\u00d1IA|ARGENTINA)\s*/gi, '').trim();
        };

        // 2. Procesamiento Single-Pass O(N)
        allRelevantInvoices.forEach(inv => {
            const d = new Date(inv._timestamp);
            const m = d.getMonth();
            const y = d.getFullYear();
            const amt = (Number(inv.amount) || 0) * IIBB_FACTOR;
            const companyName = (inv.company || '').toUpperCase().trim();

            if (m === targetMonth && y === targetYear) {
                totalThisMonth += amt;
                countThisMonth++;
                companySumsThisMonth.set(companyName, (companySumsThisMonth.get(companyName) || 0) + amt);
                loadedThisMonthSet.add(inv._normalizedName);
                loadedThisMonthSet.add(getCanon(inv.company));
            }
            if (m === targetMonth && y === 2025) countMonth2025++;
            if (m === targetMonth && y === 2024) countMonth2024++;

            // Comparativas (Mes Anterior y Mes Traspasado)
            const prevD = new Date(targetYear, targetMonth - 1, 1);
            if (m === prevD.getMonth() && y === prevD.getFullYear()) {
                totalLastMonth += amt;
                countLastMonth++;
                companySumsLastMonth.set(companyName, (companySumsLastMonth.get(companyName) || 0) + amt);
            }

            const pPrevD = new Date(targetYear, targetMonth - 2, 1);
            if (m === pPrevD.getMonth() && y === pPrevD.getFullYear()) {
                totalLastLastMonth += amt;
            }

            if (y === 2026) totalYear2026 += amt;
            if (y === 2025) totalYear2025 += amt;

            if (y >= 2024 && y <= 2026) {
                chartRaw[m][y.toString()] += amt;
            }
        });

        const topCompanies = Array.from(companySumsThisMonth.entries())
            .map(([name, total]) => ({
                name,
                total,
                prevTotal: companySumsLastMonth.get(name) || 0
            }))
            .sort((a, b) => b.total - a.total)
            .slice(0, 10);

        // 3. Checklist de Cobertura Unificado O(M)
        const allCompsWithStatus = companies.map(company => ({
            id: company.id,
            name: company.name,
            hasInvoice: loadedThisMonthSet.has(company._normalizedName) || loadedThisMonthSet.has(getCanon(company.name))
        }));

        const missingCompanies = allCompsWithStatus.filter(c => !c.hasInvoice).map(c => c.name);
        const doneCompanies = allCompsWithStatus.filter(c => c.hasInvoice).map(c => c.name);

        const activePolicies = policies.filter(p => !p.isCancelled);
        const totalPrimas = activePolicies.reduce((sum, p) => sum + (Number(p.prima) || 0), 0);

        return {
            totalThisMonth,
            countThisMonth,
            totalLastMonth,
            growthThisMonth: totalLastMonth === 0 ? 100 : Math.round(((totalThisMonth - totalLastMonth) / totalLastMonth) * 100),
            growthLastMonth: totalLastLastMonth === 0 ? 100 : Math.round(((totalLastMonth - totalLastLastMonth) / totalLastLastMonth) * 100),
            totalYear2026,
            totalYear2025,
            countMonth2025,
            countMonth2024,
            yearEvolution: totalYear2025 === 0 ? 100 : Math.round(((totalYear2026 - totalYear2025) / totalYear2025) * 100),
            chartData: chartRaw.map((data, m) => ({ name: ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'][m], ...data })),
            missingCompanies,
            doneCompanies,
            coverage: allCompsWithStatus,
            topCompanies,
            monthName: viewDate.toLocaleDateString('es-AR', { month: 'long' }),
            // New Policy Stats
            policiesCount: activePolicies.length,
            totalPrimas,
            // New Company Report Data
            companyReport: Array.from(activePolicies.reduce((acc, p) => {
                let c = (p.company || 'OTRA').trim().toUpperCase();

                // Normalización de nombres de compañías
                if (c.includes('MERCANTIL ANDINA')) {
                    c = 'MERCANTIL';
                } else if (c.includes('FEDERA')) {
                    c = 'FEDERACIÓN';
                } else if (c.includes('ACS COMERCIAL') || c.includes('GALICIA') || c.includes('1276')) {
                    c = 'GALICIA';
                } else if (c.includes('ALLIANZ')) {
                    c = 'ALLIANZ';
                } else if (c.includes('SMG') || c.includes('SWISS MEDICAL') || c.includes('COMPANIA ARGENTINA DE SEGUROS') || c.includes('COMPAÑIA ARGENTINA DE SEGUROS')) {
                    c = 'SMG SEGUROS';
                }

                const r = normalizeRisk(p.riskType);
                if (!acc.has(c)) acc.set(c, { total: 0, branches: {} });
                const d = acc.get(c);
                d.total++;
                d.branches[r] = (d.branches[r] || 0) + 1;
                return acc;
            }, new Map()).entries())
                .map(([name, data]) => ({ name, ...data }))
                .sort((a, b) => b.total - a.total)
        };
    }, [uniqueInvoices, testInvoices, companies, policies, viewDate]);

    const recentInvoices = useMemo(() => {
        return [...invoices, ...testInvoices]
            .filter(inv => inv.cuit !== '23294824979') // Filtrar CUIT del emisor
            .sort((a, b) => (b._timestamp || 0) - (a._timestamp || 0))
            .slice(0, 5);
    }, [invoices, testInvoices]);

    const changeMonth = (offset) => {
        const newDate = new Date(viewDate);
        newDate.setMonth(newDate.getMonth() + offset);
        setViewDate(newDate);
    };

    const generatePDFReport = () => {
        const doc = new jsPDF();
        const now = new Date();
        const dateStr = now.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const timeStr = now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
        const pageW = doc.internal.pageSize.width;
        const fmtMoney = n => `$ ${Math.round(n).toLocaleString('es-AR')}`;
        const indigo = [79, 70, 229];
        const emerald = [16, 185, 129];
        const rose = [244, 63, 94];
        const slate700 = [51, 65, 85];
        const slate400 = [148, 163, 184];
        const slate100 = [241, 245, 249];
        const amber = [245, 158, 11];

        // HEADER
        doc.setFillColor(indigo[0], indigo[1], indigo[2]);
        doc.rect(0, 0, pageW, 40, 'F');
        doc.setFontSize(24);
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.text('REPORTE EJECUTIVO', 20, 18);
        doc.setFontSize(12);
        doc.setFont('helvetica', 'normal');
        doc.text(stats.monthName.toUpperCase() + ' ' + viewDate.getFullYear() + ' \u2022 Gustavo Rodas Seguros', 20, 28);
        doc.setFontSize(9);
        doc.setTextColor(200, 200, 255);
        doc.text('Generado: ' + dateStr + ' ' + timeStr, 20, 36);

        // KPI CARDS
        let y = 50;
        const cardW = (pageW - 50) / 3;
        const drawCard = (x, label, value, sub, color) => {
            doc.setFillColor(slate100[0], slate100[1], slate100[2]);
            doc.roundedRect(x, y, cardW, 28, 3, 3, 'F');
            doc.setFillColor(color[0], color[1], color[2]);
            doc.roundedRect(x, y, 4, 28, 2, 2, 'F');
            doc.setFontSize(8);
            doc.setTextColor(slate400[0], slate400[1], slate400[2]);
            doc.setFont('helvetica', 'normal');
            doc.text(label.toUpperCase(), x + 10, y + 8);
            doc.setFontSize(16);
            doc.setTextColor(slate700[0], slate700[1], slate700[2]);
            doc.setFont('helvetica', 'bold');
            doc.text(value, x + 10, y + 19);
            doc.setFontSize(8);
            doc.setTextColor(color[0], color[1], color[2]);
            doc.setFont('helvetica', 'bold');
            doc.text(sub, x + 10, y + 26);
        };
        const gColor = stats.growthThisMonth >= 0 ? emerald : rose;
        const gSign = stats.growthThisMonth >= 0 ? '\u25b2' : '\u25bc';
        drawCard(15, 'Facturacion Mes Actual', fmtMoney(stats.totalThisMonth), stats.countThisMonth + ' facturas emitidas', indigo);
        drawCard(15 + cardW + 5, 'Mes Anterior', fmtMoney(stats.totalLastMonth), stats.countLastMonth + ' facturas emitidas', amber);
        drawCard(15 + (cardW + 5) * 2, 'Crecimiento Mensual', gSign + ' ' + Math.abs(stats.growthThisMonth) + '%', stats.growthThisMonth >= 0 ? 'Tendencia positiva' : 'Tendencia negativa', gColor);

        // RESUMEN FINANCIERO: Bruto / IIBB / Neto
        y = 85;
        const brutoTotal = stats.totalThisMonth / 0.955; // Reverse IIBB to get gross
        const iibbTotal = brutoTotal * 0.045;
        const netoTotal = stats.totalThisMonth;

        doc.setFontSize(13);
        doc.setTextColor(slate700[0], slate700[1], slate700[2]);
        doc.setFont('helvetica', 'bold');
        doc.text('RESUMEN FINANCIERO - CIERRE MENSUAL', 15, y);
        doc.setFontSize(8);
        doc.setTextColor(slate400[0], slate400[1], slate400[2]);
        doc.setFont('helvetica', 'normal');
        doc.text('Desglose de comisiones con retención IIBB 4.5%', 15, y + 6);
        y += 12;

        // Bruto
        doc.setFillColor(241, 245, 249);
        doc.roundedRect(15, y, pageW - 30, 12, 2, 2, 'F');
        doc.setFontSize(9);
        doc.setTextColor(slate700[0], slate700[1], slate700[2]);
        doc.setFont('helvetica', 'bold');
        doc.text('Total Bruto', 20, y + 8);
        doc.text(fmtMoney(brutoTotal), pageW - 20, y + 8, { align: 'right' });

        // IIBB
        y += 14;
        doc.setFillColor(254, 242, 242);
        doc.roundedRect(15, y, pageW - 30, 12, 2, 2, 'F');
        doc.setFillColor(rose[0], rose[1], rose[2]);
        doc.roundedRect(15, y, 3, 12, 1, 1, 'F');
        doc.setFontSize(9);
        doc.setTextColor(rose[0], rose[1], rose[2]);
        doc.setFont('helvetica', 'bold');
        doc.text('(-) Retención IIBB 4.5%', 22, y + 8);
        doc.text('- ' + fmtMoney(iibbTotal), pageW - 20, y + 8, { align: 'right' });

        // Neto
        y += 14;
        doc.setFillColor(indigo[0], indigo[1], indigo[2]);
        doc.roundedRect(15, y, pageW - 30, 14, 2, 2, 'F');
        doc.setFontSize(11);
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.text('COMISION NETA', 22, y + 10);
        doc.text(fmtMoney(netoTotal), pageW - 20, y + 10, { align: 'right' });

        // PIE CHART - Participación por Compañía
        y += 22;
        doc.setFontSize(13);
        doc.setTextColor(slate700[0], slate700[1], slate700[2]);
        doc.setFont('helvetica', 'bold');
        doc.text('PARTICIPACION POR COMPANIA', 15, y);
        doc.setFontSize(8);
        doc.setTextColor(slate400[0], slate400[1], slate400[2]);
        doc.setFont('helvetica', 'normal');
        doc.text('Distribución porcentual de ingresos por aseguradora', 15, y + 6);
        y += 12;

        const pieColors = [[79, 70, 229], [16, 185, 129], [245, 158, 11], [244, 63, 94], [139, 92, 246], [59, 130, 246], [236, 72, 153], [34, 197, 94], [249, 115, 22], [168, 85, 247]];
        const totalAll = stats.topCompanies.reduce((s, c) => s + c.total, 0) || 1;

        // Draw pie segments as colored bars (horizontal stacked bar as pie substitute in jsPDF)
        const pieBarW = pageW - 90;
        let pieX = 15;
        stats.topCompanies.slice(0, 8).forEach((comp, i) => {
            const pct = comp.total / totalAll;
            const segW = Math.max(pct * pieBarW, 2);
            const c = pieColors[i % pieColors.length];
            doc.setFillColor(c[0], c[1], c[2]);
            doc.roundedRect(pieX, y, segW, 8, i === 0 ? 2 : 0, i === stats.topCompanies.slice(0, 8).length - 1 ? 2 : 0, 'F');
            pieX += segW;
        });

        // Legend
        y += 14;
        stats.topCompanies.slice(0, 8).forEach((comp, i) => {
            const c = pieColors[i % pieColors.length];
            const pct = ((comp.total / totalAll) * 100).toFixed(1);
            const col = i < 4 ? 0 : 1;
            const row = i % 4;
            const lx = 15 + col * ((pageW - 30) / 2);
            const ly = y + row * 10;
            doc.setFillColor(c[0], c[1], c[2]);
            doc.roundedRect(lx, ly, 4, 4, 1, 1, 'F');
            doc.setFontSize(8);
            doc.setTextColor(slate700[0], slate700[1], slate700[2]);
            doc.setFont('helvetica', 'bold');
            doc.text(comp.name.substring(0, 20), lx + 7, ly + 3.5);
            doc.setTextColor(slate400[0], slate400[1], slate400[2]);
            doc.setFont('helvetica', 'normal');
            doc.text(pct + '% (' + fmtMoney(comp.total) + ')', lx + 60, ly + 3.5);
        });

        y += Math.min(stats.topCompanies.length, 4) * 10 + 8;

        // BAR CHART - Top 5
        y = Math.max(y, 200);
        doc.setFontSize(13);
        doc.setTextColor(slate700[0], slate700[1], slate700[2]);
        doc.setFont('helvetica', 'bold');
        doc.text('COMPARATIVO MENSUAL POR COMPANIA', 15, y);
        doc.setFontSize(8);
        doc.setTextColor(slate400[0], slate400[1], slate400[2]);
        doc.setFont('helvetica', 'normal');
        doc.text('Top 5 aseguradoras - Mes actual (azul) vs Mes anterior (gris)', 15, y + 6);
        y += 12;
        const top5 = stats.topCompanies.slice(0, 5);
        const maxVal = Math.max(...top5.map(c => Math.max(c.total, c.prevTotal)), 1);
        top5.forEach((comp, i) => {
            const barY = y + i * 18;
            const currW = (comp.total / maxVal) * 100;
            const prevW = (comp.prevTotal / maxVal) * 100;
            const growth = comp.prevTotal > 0 ? Math.round(((comp.total - comp.prevTotal) / comp.prevTotal) * 100) : 100;
            doc.setFontSize(9);
            doc.setTextColor(slate700[0], slate700[1], slate700[2]);
            doc.setFont('helvetica', 'bold');
            doc.text(comp.name.substring(0, 18), 15, barY + 4);
            doc.setFillColor(indigo[0], indigo[1], indigo[2]);
            doc.roundedRect(65, barY, Math.max(currW, 2), 6, 1, 1, 'F');
            doc.setFillColor(200, 200, 210);
            doc.roundedRect(65, barY + 8, Math.max(prevW, 2), 5, 1, 1, 'F');
            doc.setFontSize(7);
            doc.setTextColor(slate700[0], slate700[1], slate700[2]);
            doc.text(fmtMoney(comp.total), 65 + Math.max(currW, 2) + 3, barY + 5);
            doc.setTextColor(slate400[0], slate400[1], slate400[2]);
            doc.text(fmtMoney(comp.prevTotal), 65 + Math.max(prevW, 2) + 3, barY + 12);
            const gc = growth >= 0 ? emerald : rose;
            doc.setFontSize(8);
            doc.setTextColor(gc[0], gc[1], gc[2]);
            doc.setFont('helvetica', 'bold');
            doc.text((growth >= 0 ? '+' : '') + growth + '%', pageW - 20, barY + 8);
        });

        // MONTHLY EVOLUTION TABLE
        y = y + top5.length * 18 + 10;
        doc.setFontSize(13);
        doc.setTextColor(slate700[0], slate700[1], slate700[2]);
        doc.setFont('helvetica', 'bold');
        doc.text('EVOLUCION MENSUAL', 15, y);
        doc.setFontSize(8);
        doc.setTextColor(slate400[0], slate400[1], slate400[2]);
        doc.setFont('helvetica', 'normal');
        doc.text('Facturacion neta (IIBB) mes a mes - 2025 vs 2026', 15, y + 6);
        const mNames = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
        const evoRows = stats.chartData.map((d, i) => {
            const prev = d['2025'] || 0;
            const curr = d['2026'] || 0;
            const pct = prev > 0 ? Math.round(((curr - prev) / prev) * 100) : (curr > 0 ? 100 : 0);
            const arrow = (curr === 0 && prev === 0) ? '-' : (pct >= 0 ? '\u25b2 ' + pct + '%' : '\u25bc ' + Math.abs(pct) + '%');
            return [mNames[i], prev > 0 ? fmtMoney(prev) : '-', curr > 0 ? fmtMoney(curr) : '-', arrow];
        });
        autoTable(doc, {
            startY: y + 10, head: [['Mes', '2025', '2026', 'Crecimiento']], body: evoRows, theme: 'grid',
            headStyles: { fillColor: indigo, fontSize: 9, fontStyle: 'bold', halign: 'center' },
            bodyStyles: { fontSize: 8, halign: 'center' },
            columnStyles: { 0: { fontStyle: 'bold', halign: 'left' }, 3: { fontStyle: 'bold' } },
            margin: { left: 15, right: 15 },
            didParseCell: (data) => {
                if (data.section === 'body' && data.column.index === 3) {
                    const t = data.cell.raw || '';
                    if (t.includes('\u25b2')) data.cell.styles.textColor = emerald;
                    else if (t.includes('\u25bc')) data.cell.styles.textColor = rose;
                }
            }
        });

        // PAGE 2 - ANNUAL + PORTFOLIO
        doc.addPage();
        doc.setFillColor(indigo[0], indigo[1], indigo[2]);
        doc.rect(0, 0, pageW, 20, 'F');
        doc.setFontSize(12);
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.text('REPORTE EJECUTIVO - Continuacion', 15, 14);
        y = 32;
        doc.setFontSize(13);
        doc.setTextColor(slate700[0], slate700[1], slate700[2]);
        doc.setFont('helvetica', 'bold');
        doc.text('ACUMULADO ANUAL', 15, y);
        const halfW = (pageW - 40) / 2;
        y += 6;
        // Card 2025
        doc.setFillColor(slate100[0], slate100[1], slate100[2]);
        doc.roundedRect(15, y, halfW, 25, 3, 3, 'F');
        doc.setFillColor(amber[0], amber[1], amber[2]);
        doc.roundedRect(15, y, halfW, 4, 2, 2, 'F');
        doc.setFontSize(9);
        doc.setTextColor(slate400[0], slate400[1], slate400[2]);
        doc.setFont('helvetica', 'normal');
        doc.text('ANO 2025 (ACUMULADO)', 20, y + 12);
        doc.setFontSize(18);
        doc.setTextColor(slate700[0], slate700[1], slate700[2]);
        doc.setFont('helvetica', 'bold');
        doc.text(fmtMoney(stats.totalYear2025), 20, y + 22);
        // Card 2026
        doc.setFillColor(slate100[0], slate100[1], slate100[2]);
        doc.roundedRect(15 + halfW + 10, y, halfW, 25, 3, 3, 'F');
        doc.setFillColor(indigo[0], indigo[1], indigo[2]);
        doc.roundedRect(15 + halfW + 10, y, halfW, 4, 2, 2, 'F');
        doc.setFontSize(9);
        doc.setTextColor(slate400[0], slate400[1], slate400[2]);
        doc.setFont('helvetica', 'normal');
        doc.text('ANO 2026 (ACUMULADO)', 20 + halfW + 10, y + 12);
        doc.setFontSize(18);
        doc.setTextColor(slate700[0], slate700[1], slate700[2]);
        doc.setFont('helvetica', 'bold');
        doc.text(fmtMoney(stats.totalYear2026), 20 + halfW + 10, y + 22);
        // Year growth bar
        y += 30;
        const yrGC = stats.yearEvolution >= 0 ? emerald : rose;
        const yrS = stats.yearEvolution >= 0 ? '\u25b2' : '\u25bc';
        doc.setFillColor(yrGC[0], yrGC[1], yrGC[2]);
        doc.roundedRect(15, y, pageW - 30, 12, 3, 3, 'F');
        doc.setFontSize(11);
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.text(yrS + ' Variacion Interanual: ' + (stats.yearEvolution >= 0 ? '+' : '') + stats.yearEvolution + '%', pageW / 2, y + 8, { align: 'center' });

        // PORTFOLIO
        y += 22;
        doc.setFontSize(13);
        doc.setTextColor(slate700[0], slate700[1], slate700[2]);
        doc.setFont('helvetica', 'bold');
        doc.text('RESUMEN DE CARTERA', 15, y);
        const tgtMonth = viewDate.getMonth();
        const cancelled = policies.filter(p => {
            if (!p.isCancelled || !p.updatedAt) return false;
            try { const d = typeof p.updatedAt.toDate === 'function' ? p.updatedAt.toDate() : new Date(p.updatedAt); return d.getMonth() === tgtMonth; } catch (e) { return false; }
        }).length;
        autoTable(doc, {
            startY: y + 4,
            head: [['Metrica', 'Valor', 'Detalle']],
            body: [
                ['Clientes Totales', totalClientsCount.toString(), 'Cartera unica de asegurados'],
                ['Polizas Activas', stats.policiesCount.toString(), 'Vigentes sin anular'],
                ['Anulaciones del Periodo', cancelled.toString(), 'Bajas en ' + stats.monthName],
                ['Aseguradoras', stats.companyReport.length.toString(), 'Companias con polizas'],
                ['Valuacion (Primas Netas)', fmtMoney(stats.totalPrimas), 'Capital asegurado total']
            ],
            theme: 'striped', headStyles: { fillColor: slate700, fontSize: 10, fontStyle: 'bold' },
            bodyStyles: { fontSize: 9, cellPadding: 4 }, columnStyles: { 0: { fontStyle: 'bold' } },
            margin: { left: 15, right: 15 }
        });

        // TOP ASEGURADORAS POR POLIZAS
        let lastY2 = doc.lastAutoTable.finalY + 12;
        doc.setFontSize(13);
        doc.setTextColor(slate700[0], slate700[1], slate700[2]);
        doc.setFont('helvetica', 'bold');
        doc.text('TOP ASEGURADORAS POR VOLUMEN DE POLIZAS', 15, lastY2);
        const compR = stats.companyReport.slice(0, 10).map(c => [c.name, c.total.toString(), Object.entries(c.branches).map(([k, v]) => k + ': ' + v).join(', ')]);
        autoTable(doc, {
            startY: lastY2 + 4, head: [['Aseguradora', 'Polizas', 'Distribucion por Ramo']], body: compR,
            theme: 'grid', headStyles: { fillColor: indigo, fontSize: 9, fontStyle: 'bold' },
            bodyStyles: { fontSize: 8 }, columnStyles: { 0: { fontStyle: 'bold' }, 2: { fontSize: 7 } },
            margin: { left: 15, right: 15 }
        });

        // FOOTER
        const pc = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pc; i++) {
            doc.setPage(i);
            doc.setDrawColor(indigo[0], indigo[1], indigo[2]);
            doc.setLineWidth(0.5);
            doc.line(15, 282, pageW - 15, 282);
            doc.setFontSize(7);
            doc.setTextColor(slate400[0], slate400[1], slate400[2]);
            doc.setFont('helvetica', 'normal');
            doc.text('Pagina ' + i + ' de ' + pc, 15, 288);
            doc.text('Confidencial - Solo para uso interno de Presidencia', pageW / 2, 288, { align: 'center' });
            doc.text('J&L Brokers', pageW - 15, 288, { align: 'right' });
        }
        doc.save('Reporte_Ejecutivo_' + stats.monthName + '_' + viewDate.getFullYear() + '.pdf');
    };


    if (!stats) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
            </div>
        );
    }

    return (
        <div className="space-y-10 animate-in fade-in duration-300">
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                <ProcesadorIA />

                {/* AI Insights Widget - Premium Header */}
                <div className="lg:col-span-4 bg-gradient-to-r from-indigo-600/10 to-purple-600/10 border border-indigo-500/20 rounded-2xl md:rounded-[2rem] p-4 md:p-8 backdrop-blur-3xl relative overflow-hidden group mb-4 shadow-[var(--card-shadow)]">
                    <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                        <TrendingUp size={80} />
                    </div>
                    <div className="relative z-10 flex flex-col xl:flex-row xl:items-center justify-between gap-6">
                        <div className="flex-1 flex items-center gap-6">
                            <div className="hidden sm:flex p-3 bg-indigo-500 rounded-2xl shadow-lg shadow-indigo-500/30">
                                <TrendingUp size={18} className="text-white" />
                            </div>
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    <h3 className="font-black text-[var(--text-color)] uppercase text-[9px] tracking-[0.2em]">Análisis Proactivo</h3>
                                    <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-500 text-[7px] font-black uppercase">Live Analytics</span>
                                </div>
                                <div className="flex items-center gap-4">
                                    <p className="text-[var(--text-secondary)] text-[13px] font-bold leading-tight max-w-2xl">
                                        {stats.growthThisMonth > 0
                                            ? `¡Rentabilidad en alza! Tus comisiones netas subieron un ${stats.growthThisMonth}% tras la deducción del 4.5% de IIBB.`
                                            : `Las comisiones netas se mantienen estables. El cálculo ya contempla el descuento bancario por Ingresos Brutos.`
                                        }
                                    </p>
                                    <button
                                        onClick={generatePDFReport}
                                        className="flex items-center gap-2 px-6 py-2.5 bg-[var(--bg-color)] hover:bg-[var(--text-color)] hover:text-white border border-[var(--border-color)] rounded-xl text-[10px] font-black text-[var(--text-color)] uppercase tracking-widest transition-all active:scale-95 whitespace-nowrap"
                                    >
                                        <FileText size={14} className="text-indigo-500" />
                                        Generar Reporte PDF
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div className="flex gap-4 items-center">
                            <button
                                onClick={() => context?.toggleTheme?.()}
                                className="p-3 rounded-2xl bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500/20 transition-all border border-indigo-500/10 flex items-center justify-center"
                                title="Cambiar Tema"
                            >
                                {context?.theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
                            </button>
                            <div className="flex flex-col items-center px-6 border-x border-[var(--border-color)]">
                                <p className="text-[8px] font-black text-[var(--text-secondary)] uppercase tracking-widest mb-0.5">Previsión Mes</p>
                                <p className="text-lg font-black text-[var(--text-color)] tabular-nums">$ {(stats.totalThisMonth * 1.1).toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                            </div>
                            {(() => {
                                const usage = getGeminiUsage?.() || {};
                                const tokensByEngine = usage.tokensByEngine || { Claude: { total: 0 }, Gemini: { total: 0 } };
                                const quotaPct = usage.quotaPercent || 0;
                                const nearLimit = usage.nearLimit;
                                const geminiTokensK = ((tokensByEngine.Gemini?.total || 0) / 1000).toFixed(1);
                                const claudeTokensK = ((tokensByEngine.Claude?.total || 0) / 1000).toFixed(1);
                                const costUSD = (usage.estimatedCostToday || 0).toFixed(4);

                                return (
                                    <div className="flex flex-col gap-3">
                                        {/* Claude Counter (Primary) */}
                                        <div className="flex flex-col items-center px-4">
                                            <div className="flex items-center gap-1.5 mb-1">
                                                <Zap size={10} className="text-orange-400 fill-orange-400/20" />
                                                <p className="text-[8px] font-black text-orange-400 uppercase tracking-widest">IA Principal: Claude 3.5</p>
                                            </div>
                                            <p className="text-sm font-black text-[var(--text-color)] tabular-nums">{claudeTokensK}K <span className="text-[8px] text-[var(--text-secondary)] font-bold uppercase">tokens</span></p>
                                        </div>

                                        <div className="h-px w-full bg-[var(--border-color)] opacity-50" />

                                        {/* Gemini Counter (Fallback) */}
                                        <div className="flex flex-col items-center px-4 relative" title={`Acciones hoy: ${usage.today} | Costo Est. Gemini: $${costUSD} USD`}>
                                            <div className="flex items-center gap-1.5 mb-1">
                                                <p className="text-[8px] font-black text-indigo-400 uppercase tracking-widest">IA Respaldo: Gemini</p>
                                                {nearLimit && (
                                                    <span className="text-[7px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full font-black uppercase animate-pulse border border-amber-500/30">⚠️ Límite</span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <div className="flex items-center gap-1.5">
                                                    <div className={`w-1.5 h-1.5 rounded-full ${nearLimit ? 'bg-amber-500 shadow-[0_0_8px_#f59e0b]' : 'bg-emerald-500 shadow-[0_0_8px_#10b981]'}`} />
                                                    <p className="text-sm font-black text-[var(--text-color)] tabular-nums">{geminiTokensK}K <span className="text-[8px] text-[var(--text-secondary)] font-bold uppercase">tokens</span></p>
                                                </div>
                                            </div>
                                            <div className="w-full h-1 bg-[var(--border-color)] rounded-full mt-1.5 overflow-hidden">
                                                <div className={`h-full rounded-full transition-all duration-500 ${quotaPct > 80 ? 'bg-amber-500' : quotaPct > 50 ? 'bg-indigo-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(quotaPct, 100)}%` }} />
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                {/* Columna 1: Stack de Comisiones y Cierres */}
                <div className="flex flex-col gap-6 md:col-span-1">
                    <StatCard
                        title={`Comisión Neta (${stats.monthName})`}
                        value={`$${stats.totalThisMonth.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                        icon={DollarSign}
                        color="indigo"
                        trend={stats.growthThisMonth}
                        subtitle={`Post-IIBB 4.5% ($${stats.totalLastMonth.toLocaleString(undefined, { maximumFractionDigits: 0 })} prev)`}
                    />
                    <StatCard
                        title="Pólizas Activas"
                        value={stats.policiesCount}
                        icon={Users}
                        color="emerald"
                        subtitle={`Cartera Total Gestionada • Clientes: ${totalClientsCount}`}
                    />
                    <StatCard
                        title="Valuación Cartera"
                        value={`$${stats.totalPrimas.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                        icon={ShieldAlert}
                        color="rose"
                        subtitle="Suma de Primas Netas"
                    />
                </div>

                {/* Columna 2 y 3: Ranking Top 10 (Centro Prioritario) */}
                <div className="lg:col-span-2">
                    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] backdrop-blur-xl rounded-2xl md:rounded-[2.5rem] p-5 md:p-10 shadow-[var(--card-shadow)] relative overflow-hidden group hover:scale-[1.01] transition-all duration-300 h-full">
                        <div className="relative z-10">
                            <div className="flex justify-between items-center mb-10">
                                <div>
                                    <h3 className="text-sm font-black text-indigo-500 uppercase tracking-[0.3em] mb-1">Ranking Top 10</h3>
                                    <p className="text-[var(--text-secondary)] text-[10px] font-black uppercase tracking-widest">Desempeño por compañía en {stats.monthName}</p>
                                </div>
                                <div className="p-4 rounded-2xl bg-indigo-500/10 text-indigo-500">
                                    <Users size={32} />
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-6">
                                {stats.topCompanies.map((item, i) => (
                                    <div key={i} className="flex flex-col gap-2 group/rank">
                                        <div className="flex justify-between items-center">
                                            <div className="flex items-center gap-3">
                                                <span className="text-xl font-black text-[var(--text-secondary)] tabular-nums italic group-hover/rank:text-indigo-500/50 transition-colors">{(i + 1).toString().padStart(2, '0')}</span>
                                                <span className="text-[11px] font-black text-[var(--text-color)] truncate max-w-[140px] uppercase group-hover/rank:text-indigo-500 transition-colors">{item.name}</span>
                                            </div>
                                            <span className="text-sm font-black text-[var(--text-color)] tabular-nums">$ {item.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                        </div>
                                        <div className="flex justify-between items-center px-1">
                                            <span className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-tighter">Mes Anterior: $ {item.prevTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                            {item.total > item.prevTotal ? (
                                                <ArrowUpRight size={12} className="text-emerald-500" />
                                            ) : item.total < item.prevTotal ? (
                                                <ArrowDownRight size={12} className="text-rose-500" />
                                            ) : null}
                                        </div>
                                        <div className="h-1.5 w-full bg-[var(--border-color)] rounded-full overflow-hidden mt-1">
                                            <div
                                                className="h-full bg-indigo-500/60 group-hover/rank:bg-indigo-500 transition-all duration-300"
                                                style={{ width: `${(item.total / (stats.topCompanies[0]?.total || 1)) * 100}%` }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Columna 4: Balance Anual y Top Ranking */}
                <div className="flex flex-col gap-6">
                    <StatCard
                        title="Balance Neto Anual"
                        value={`$${stats.totalYear2026.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                        icon={TrendingUp}
                        color="purple"
                        trend={stats.yearEvolution}
                        subtitle={`Vs Total 2025: $${stats.totalYear2025.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                    />
                    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] backdrop-blur-3xl rounded-[2.5rem] p-6 flex-1 flex flex-col justify-start overflow-hidden min-h-[320px] shadow-[var(--card-shadow)]">
                        <div className="flex justify-between items-start mb-6">
                            <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-500">
                                <FileText size={20} />
                            </div>
                            <div className="flex flex-col items-end gap-1">
                                <span className="text-[10px] font-black text-[var(--text-color)] uppercase tracking-tighter">Cobertura {stats.monthName}</span>
                                <div className="flex gap-2">
                                    <span className="text-[9px] font-bold text-emerald-500">{stats.doneCompanies.length} Ok</span>
                                    <span className="text-[9px] font-bold text-rose-500">{stats.missingCompanies.length} Pend</span>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-3 overflow-y-auto custom-scrollbar pr-2 max-h-[120px]">
                            {stats.missingCompanies.length > 0 && (
                                <div className="mb-4">
                                    <p className="text-[9px] font-black text-rose-500/50 uppercase tracking-widest mb-2">Pendientes Factura</p>
                                    {stats.missingCompanies.map((name, i) => (
                                        <div key={i} className="flex items-center gap-2 mb-1.5">
                                            <div className="w-1 h-1 rounded-full bg-rose-500 animate-pulse" />
                                            <p className="text-[10px] text-[var(--text-color)] truncate uppercase font-bold">{name}</p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Nuevo Widget de Vencimientos */}
                        <div className="mt-4 pt-4 border-t border-[var(--border-color)] space-y-3">
                            <div className="flex items-center gap-2 mb-2">
                                <ShieldAlert size={14} className="text-amber-500" />
                                <p className="text-[9px] font-black text-amber-500/50 uppercase tracking-widest">Vencimientos Próximos</p>
                            </div>
                            <div className="space-y-2 overflow-y-auto custom-scrollbar pr-2 max-h-[100px]">
                                {expiringPolicies.length > 0 ? (
                                    expiringPolicies.slice(0, 5).map((p, i) => {
                                        const end = new Date(p.endDate);
                                        const diff = Math.ceil((end - new Date()) / (1000 * 60 * 60 * 24));
                                        return (
                                            <div key={i} className="flex flex-col gap-0.5 p-2 rounded-xl bg-[var(--bg-color)] hover:bg-[var(--border-color)] transition-all border border-transparent hover:border-[var(--border-color)] shadow-sm">
                                                <div className="flex justify-between items-center">
                                                    <p className="text-[9px] text-[var(--text-color)] truncate uppercase font-black max-w-[120px]">{p.clientName}</p>
                                                    <span className={`text-[8px] font-black uppercase ${diff < 7 ? 'text-rose-500' : 'text-amber-500'}`}>
                                                        {diff === 0 ? 'HOY' : `en ${diff}d`}
                                                    </span>
                                                </div>
                                                <p className="text-[7px] text-[var(--text-secondary)] font-bold uppercase tracking-widest">{p.company} • {p.riskType}</p>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <p className="text-[9px] text-[var(--text-secondary)] font-bold uppercase py-2">Sin vencimientos cercanos</p>
                                )}
                            </div>
                        </div>

                        <div className="mt-auto pt-4 border-t border-[var(--border-color)]">
                            <p className="text-[8px] font-black text-[var(--text-secondary)] uppercase tracking-widest text-center">
                                Gustavo Rodas <span className="italic">Seguros</span>
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">

                {/* Gráfico de Evolución */}
                <div className="lg:col-span-3 bg-[var(--card-bg)] border border-[var(--border-color)] backdrop-blur-3xl rounded-2xl md:rounded-[2.5rem] p-4 md:p-10 shadow-[var(--card-shadow)] relative overflow-hidden">
                    <div className="flex justify-between items-center mb-12 relative z-10">
                        <div>
                            <h3 className="font-black text-[var(--text-color)] uppercase text-sm tracking-[0.2em] mb-1">Evolución de Ingresos Comparativa</h3>
                            <p className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-widest">Análisis Multianual • 2024 - 2026</p>
                        </div>
                        <div className="flex items-center gap-4 bg-[var(--bg-color)] p-2 rounded-2xl border border-[var(--border-color)] shadow-sm">
                            <div className="flex items-center gap-2 px-3 py-1 bg-indigo-500/10 rounded-xl border border-indigo-500/20">
                                <div className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_8px_#6366f1]" />
                                <span className="text-[9px] font-black text-indigo-500 uppercase">2026</span>
                            </div>
                            <div className="flex items-center gap-2 px-3 py-1 bg-pink-500/5 rounded-xl border border-pink-500/10">
                                <div className="w-2 h-2 rounded-full bg-pink-500 opacity-60" />
                                <span className="text-[9px] font-black text-pink-500 uppercase">2025</span>
                            </div>
                            <div className="flex items-center gap-2 px-3 py-1 bg-amber-500/5 rounded-xl border border-amber-500/10">
                                <div className="w-2 h-2 rounded-full bg-amber-500 opacity-60" />
                                <span className="text-[9px] font-black text-amber-500 uppercase">2024</span>
                            </div>
                        </div>
                    </div>

                    <div className="h-[400px] w-full relative z-10">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={stats.chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.05} vertical={false} />
                                <XAxis
                                    dataKey="name"
                                    stroke="var(--text-secondary)"
                                    fontSize={10}
                                    tickLine={false}
                                    axisLine={false}
                                    dy={15}
                                    style={{ fontWeight: 'black', opacity: 0.5 }}
                                />
                                <YAxis
                                    stroke="#52525b"
                                    fontSize={10}
                                    tickLine={false}
                                    axisLine={false}
                                    tickFormatter={(value) => `$${value / 1000}k`}
                                    style={{ fontWeight: 'black', opacity: 0.5 }}
                                />
                                <Tooltip
                                    cursor={{ stroke: '#6366f1', strokeWidth: 2, strokeDasharray: '5 5' }}
                                    content={({ active, payload, label }) => {
                                        if (active && payload && payload.length) {
                                            return (
                                                <div className="bg-[var(--card-bg)] backdrop-blur-xl border border-[var(--border-color)] p-6 rounded-[2rem] shadow-2xl">
                                                    <p className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest mb-3">{label}</p>
                                                    <div className="space-y-2">
                                                        {payload.map((entry, idx) => (
                                                            <div key={idx} className="flex items-center justify-between gap-8">
                                                                <div className="flex items-center gap-2">
                                                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                                                                    <span className="text-xs font-bold text-[var(--text-secondary)]">{entry.name}</span>
                                                                </div>
                                                                <span className="text-sm font-black text-[var(--text-color)]">$ {entry.value.toLocaleString()}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        }
                                        return null;
                                    }}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="2026"
                                    stroke="#6366f1"
                                    strokeWidth={4}
                                    fillOpacity={1}
                                    fill="url(#colorTotal)"
                                    name="2026"
                                    animationDuration={2000}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="2025"
                                    stroke="#ec4899"
                                    strokeWidth={2}
                                    strokeDasharray="8 8"
                                    fillOpacity={0}
                                    name="2025"
                                    animationDuration={1500}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="2024"
                                    stroke="#fbbf24"
                                    strokeWidth={1}
                                    strokeDasharray="4 4"
                                    fillOpacity={0}
                                    name="2024"
                                    animationDuration={1000}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Checklist de Cobertura */}
                <div className="bg-[var(--card-bg)] border border-[var(--border-color)] backdrop-blur-3xl rounded-2xl md:rounded-[2.5rem] p-4 md:p-8 shadow-[var(--card-shadow)] flex flex-col relative overflow-hidden">
                    <div className="flex justify-between items-center mb-10 relative z-10">
                        <div>
                            <h3 className="font-black text-[var(--text-color)] uppercase text-xs tracking-[0.2em] mb-1">Cobertura Mensual</h3>
                            <p className="text-[var(--text-secondary)] text-[10px] font-black uppercase tracking-widest text-indigo-500">
                                {viewDate.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}
                            </p>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={() => changeMonth(-1)} className="p-2 border border-[var(--border-color)] bg-[var(--bg-color)] hover:bg-[var(--border-color)] rounded-xl text-[var(--text-secondary)] transition-all">
                                <ArrowDownRight className="rotate-135" size={16} />
                            </button>
                            <button onClick={() => changeMonth(1)} className="p-2 border border-[var(--border-color)] bg-[var(--bg-color)] hover:bg-[var(--border-color)] rounded-xl text-[var(--text-secondary)] transition-all">
                                <ArrowUpRight className="rotate-45" size={16} />
                            </button>
                        </div>
                    </div>

                    <div className="space-y-4 overflow-y-auto max-h-[400px] pr-2 scrollbar-none relative z-10">
                        {stats.coverage.map((item) => (
                            <div key={item.id} className="flex items-center justify-between p-4 rounded-2xl bg-[var(--bg-color)] border border-[var(--border-color)] hover:border-indigo-500/30 hover:bg-[var(--card-bg)] transition-all group">
                                <div className="flex items-center gap-4">
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-500 ${item.hasInvoice
                                        ? 'bg-emerald-500/10 text-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.1)]'
                                        : 'bg-[var(--border-color)] text-[var(--text-secondary)]'
                                        }`}>
                                        {item.hasInvoice ? <CheckCircle2 size={20} /> : <div className="w-2 h-2 rounded-full bg-zinc-700" />}
                                    </div>
                                    <div>
                                        <p className={`text-xs font-black uppercase tracking-tight ${item.hasInvoice ? 'text-[var(--text-color)]' : 'text-[var(--text-secondary)]'}`}>
                                            {item.name}
                                        </p>
                                        <p className="text-[9px] text-[var(--text-secondary)] font-bold uppercase tracking-widest">
                                            {item.hasInvoice ? 'Facturado' : 'Aún sin comprobante'}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="mt-auto pt-6 px-2 opacity-50">
                        <div className="h-1 bg-[var(--border-color)] rounded-full overflow-hidden">
                            <div
                                className="h-full bg-indigo-500 transition-all duration-500"
                                style={{ width: `${(stats.coverage.filter(c => c.hasInvoice).length / stats.coverage.length) * 100}%` }}
                            />
                        </div>
                    </div>
                </div>

                {/* Reporte de Compañías y Ramos (Formato Tabla) */}
                <div className="lg:col-span-4 bg-[var(--card-bg)] border border-[var(--border-color)] backdrop-blur-3xl rounded-2xl md:rounded-[2.5rem] p-4 md:p-8 shadow-[var(--card-shadow)]">
                    <div className="flex justify-between items-center mb-8 px-2">
                        <div>
                            <h3 className="font-black text-[var(--text-color)] mb-1 uppercase text-sm tracking-[0.2em]">Distribución por Compañía</h3>
                            <p className="text-[var(--text-secondary)] text-[10px] font-black uppercase tracking-widest">Cartera activa segmentada por aseguradora y ramo</p>
                        </div>
                        <div className="flex items-center gap-3">
                            {viewDate.getMonth() !== new Date().getMonth() || viewDate.getFullYear() !== new Date().getFullYear() ? (
                                <button
                                    onClick={() => setViewDate(new Date())}
                                    className="flex items-center gap-2 px-4 py-2 bg-rose-500/10 rounded-2xl border border-rose-500/20 hover:bg-rose-500/20 transition-all group"
                                    title="Borrar Filtro de Fecha"
                                >
                                    <X size={12} className="text-rose-400 group-hover:scale-110 transition-transform" />
                                    <span className="text-[10px] font-black text-rose-400 uppercase tracking-widest">Borrar Filtros</span>
                                </button>
                            ) : null}
                            <div className="flex items-center gap-2 px-4 py-2 bg-indigo-500/10 rounded-2xl border border-indigo-500/20">
                                <ShieldAlert size={14} className="text-indigo-400" />
                                <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">{stats.companyReport.length} Aseguradoras</span>
                            </div>
                        </div>
                    </div>

                    <div className="overflow-x-auto custom-scrollbar">
                        <table className="w-full border-separate border-spacing-y-2">
                            <thead>
                                <tr className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-[0.2em]">
                                    <th className="text-left pb-4 pl-6 font-black uppercase tracking-[0.2em]">Compañía</th>
                                    <th className="text-left pb-4 font-black uppercase tracking-[0.2em]">Apertura por Ramo</th>
                                    <th className="text-right pb-4 pr-10 font-black uppercase tracking-[0.2em]">Total Pólizas</th>
                                </tr>
                            </thead>
                            <tbody>
                                {stats.companyReport.map((comp, idx) => (
                                    <tr
                                        key={idx}
                                        onClick={() => onNavigate('clientes', comp.name)}
                                        className="group transition-all duration-300 cursor-pointer"
                                    >
                                        <td className="py-4 pl-6 rounded-l-[1.5rem] bg-[var(--bg-color)] border-y border-l border-[var(--border-color)] group-hover:bg-[var(--card-bg)] group-hover:border-indigo-500/30 transition-all">
                                            <p className="font-black text-[var(--text-color)] text-[13px] uppercase tracking-tight group-hover:text-indigo-400 transition-colors">
                                                {comp.name}
                                            </p>
                                        </td>
                                        <td className="py-4 bg-[var(--bg-color)] border-y border-[var(--border-color)] group-hover:bg-[var(--card-bg)] group-hover:border-y-indigo-500/30 transition-all">
                                            <div className="flex flex-wrap gap-1.5 pr-4">
                                                {Object.entries(comp.branches).map(([branch, count], bIdx) => (
                                                    <div key={bIdx} className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[var(--card-bg)] border border-[var(--border-color)] text-[9px] font-bold text-[var(--text-secondary)] group-hover:border-white/20 transition-all">
                                                        <span className="text-[var(--text-color)] font-black">{branch}</span>
                                                        <span className="w-4 h-4 rounded-md bg-indigo-500/20 flex items-center justify-center text-[8px] font-black text-indigo-400 shadow-[0_0_10px_rgba(99,102,241,0.1)]">
                                                            {count}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </td>
                                        <td className="py-4 pr-10 rounded-r-[1.5rem] bg-[var(--bg-color)] border-y border-r border-[var(--border-color)] text-right group-hover:bg-[var(--card-bg)] group-hover:border-r-indigo-500/30 group-hover:border-y-indigo-500/30 transition-all">
                                            <span className="font-black text-[var(--text-color)] text-xl tabular-nums leading-none tracking-tighter group-hover:text-indigo-400 transition-colors">
                                                {comp.total}
                                            </span>
                                            <p className="text-[8px] font-black text-[var(--text-secondary)] uppercase tracking-widest mt-1">pólizas</p>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {stats.companyReport.length === 0 && (
                        <div className="py-20 text-center border-2 border-dashed border-white/5 rounded-[2.5rem]">
                            <p className="text-[var(--text-secondary)] text-[10px] font-black uppercase tracking-[0.2em]">No hay pólizas registradas para generar el reporte</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
