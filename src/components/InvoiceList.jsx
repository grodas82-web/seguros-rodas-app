import React, { useState, useMemo } from 'react';
import { useAppContext } from '../context/AppContext';
import { Search, Filter, Download, Trash2, FileText, ChevronRight, ChevronDown, Folder, Sparkles, Loader2, CheckCircle2, Wrench, Pencil, X, Check, CalendarDays, ArrowUpDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const InvoiceList = () => {
    const { invoices, deleteInvoice, repairInvoiceCuits, updateInvoice, processInvoiceFile } = useAppContext();
    const [editingInvoice, setEditingInvoice] = useState(null);
    const [editForm, setEditForm] = useState({});
    const [searchTerm, setSearchTerm] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [stats, setStats] = useState({ total: 0, current: 0 });
    const [displayLimit, setDisplayLimit] = useState(50);
    const [processLog, setProcessLog] = useState([]);
    const [expandedMonths, setExpandedMonths] = useState({});
    const [sortBy, setSortBy] = useState('amount'); // 'amount' | 'number'

    // Deduplicación en tiempo real para el usuario
    const deduplicated = useMemo(() => {
        const map = new Map();
        invoices.forEach(inv => {
            const pos = (inv.pointOfSale || '').toString().padStart(5, '0');
            const num = (inv.number || '').toString().padStart(8, '0');
            const amt = Number(inv.amount || 0).toFixed(2);
            const date = (inv.date || '').toString();
            const cuit = (inv.cuit || '').toString();
            // Incluimos CUIT en la clave para evitar colisiones si el emisor es el mismo pero el receptor cambia
            const key = `${pos}-${num}-${amt}-${date}-${cuit}`;
            if (!map.has(key)) map.set(key, inv);
        });
        return Array.from(map.values());
    }, [invoices]);

    const filtered = useMemo(() => {
        return deduplicated
            .filter(inv =>
                (inv.company || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                (inv.number || '').includes(searchTerm)
            )
            .sort((a, b) => {
                if (sortBy === 'amount') {
                    // Mayor a menor por Importe
                    const amtA = Number(a.amount) || 0;
                    const amtB = Number(b.amount) || 0;
                    if (Math.abs(amtB - amtA) > 0.01) return amtB - amtA;

                    // Fallback a Punto de Venta/Número
                    const posA = parseInt(a.pointOfSale) || 0;
                    const posB = parseInt(b.pointOfSale) || 0;
                    if (posB !== posA) return posB - posA;

                    const numA = parseInt(a.number) || 0;
                    const numB = parseInt(b.number) || 0;
                    return numB - numA;
                } else {
                    // Mayor a menor por Punto de Venta luego Número
                    const posA = parseInt(a.pointOfSale) || 0;
                    const posB = parseInt(b.pointOfSale) || 0;
                    if (posB !== posA) return posB - posA;

                    const numA = parseInt(a.number) || 0;
                    const numB = parseInt(b.number) || 0;
                    return numB - numA;
                }
            });
    }, [deduplicated, searchTerm, sortBy]);

    const handleEdit = (inv) => {
        setEditingInvoice(inv);
        setEditForm({
            company: inv.company || '',
            cuit: inv.cuit || '',
            date: inv.date || '',
            amount: inv.amount || 0
        });
    };

    const handleSaveEdit = async () => {
        if (!editingInvoice) return;
        await updateInvoice(editingInvoice.id, editForm);
        setEditingInvoice(null);
        alert('Factura actualizada correctamente.');
    };

    const handleDelete = async (id) => {
        if (window.confirm('¿Está seguro de eliminar esta factura?')) {
            await deleteInvoice(id);
        }
    };

    const syncDownloads = async () => {
        try {
            setIsProcessing(true);
            setProcessLog([]);
            const currentMonth = new Date().getMonth();
            const currentYear = new Date().getFullYear();

            // 1. Intentar con el Bridge primero
            try {
                const response = await fetch('http://localhost:3002/api/scan-downloads');
                if (response.ok) {
                    const result = await response.json();
                    if (result.success && result.files.length > 0) {
                        setStats({ total: result.files.length, current: 0 });

                        for (let i = 0; i < result.files.length; i++) {
                            const fileData = result.files[i];
                            setStats(prev => ({ ...prev, current: i + 1 }));

                            try {
                                // Nota: processInvoiceFile ya agrega a la DB si es éxito
                                const analysis = await processInvoiceFile(null, fileData.base64);

                                if (analysis.status === 'success') {
                                    const invDate = new Date(analysis.data.date);
                                    if (invDate.getMonth() !== currentMonth || invDate.getFullYear() !== currentYear) {
                                        setProcessLog(prev => [...prev, { name: fileData.name, status: 'warning', msg: 'Mes Incorrecto' }]);
                                    } else {
                                        setProcessLog(prev => [...prev, { name: fileData.name, status: 'success' }]);
                                    }
                                } else {
                                    setProcessLog(prev => [...prev, { name: fileData.name, status: 'error', msg: analysis.error || 'Duplicado' }]);
                                }
                            } catch (error) {
                                setProcessLog(prev => [...prev, { name: fileData.name, status: 'error', msg: error.message }]);
                            }
                        }
                        return;
                    }
                }
            } catch {
                console.log("Bridge local no detectado en Historial.");
            }

            // 2. Fallback al selector manual
            const directoryHandle = await window.showDirectoryPicker();
            const pdfFiles = [];
            for await (const entry of directoryHandle.values()) {
                if (entry.kind === 'file' && entry.name.startsWith('23294824979_') && entry.name.endsWith('.pdf')) {
                    const file = await entry.getFile();
                    pdfFiles.push(file);
                }
            }

            if (!pdfFiles.length) {
                alert('No se encontraron facturas nuevas en la carpeta seleccionada.');
                return;
            }

            setStats({ total: pdfFiles.length, current: 0 });

            for (let i = 0; i < pdfFiles.length; i++) {
                const file = pdfFiles[i];
                setStats(prev => ({ ...prev, current: i + 1 }));

                try {
                    const result = await processInvoiceFile(file);
                    if (result.status === 'success') {
                        const invDate = new Date(result.data.date);
                        if (invDate.getMonth() !== currentMonth || invDate.getFullYear() !== currentYear) {
                            setProcessLog(prev => [...prev, { name: file.name, status: 'warning', msg: 'Mes Incorrecto' }]);
                        } else {
                            setProcessLog(prev => [...prev, { name: file.name, status: 'success' }]);
                        }
                    } else {
                        setProcessLog(prev => [...prev, { name: file.name, status: 'error', msg: result.error || 'Duplicado' }]);
                    }
                } catch (error) {
                    setProcessLog(prev => [...prev, { name: file.name, status: 'error', msg: error.message }]);
                }
            }
        } catch (err) {
            if (err.name !== 'AbortError') alert("Error al sincronizar: " + err.message);
        } finally {
            setIsProcessing(false);
        }
    };

    const lastUpdate = useMemo(() => {
        if (!invoices.length) return null;
        const dates = invoices
            .map(inv => inv.timestamp?.seconds ? inv.timestamp.seconds * 1000 :
                (inv.timestamp ? new Date(inv.timestamp).getTime() : null))
            .filter(t => t !== null && !isNaN(t));
        if (!dates.length) return null;
        return new Date(Math.max(...dates));
    }, [invoices]);

    const gapStats = useMemo(() => {
        if (!invoices.length) return { gaps: 0, max: 0, pos: 'N/A' };

        const poses = {};
        invoices.forEach(inv => {
            const p = inv.pointOfSale || '00001';
            poses[p] = (poses[p] || 0) + 1;
        });
        const mainPos = poses['00003'] ? '00003' : Object.keys(poses).sort((a, b) => poses[b] - poses[a])[0];

        const nums = invoices
            .filter(inv => inv.pointOfSale === mainPos)
            .map(inv => parseInt(inv.number))
            .filter(n => !isNaN(n))
            .sort((a, b) => a - b);

        if (!nums.length) return { gaps: 0, max: 0, pos: mainPos };

        const max = nums[nums.length - 1];
        const numSet = new Set(nums);
        let gaps = 0;

        for (let i = 1; i <= max; i++) {
            if (!numSet.has(i)) gaps++;
        }

        return { gaps, max, pos: mainPos };
    }, [invoices]);

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Summary Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
                <div className="bg-white/[0.03] border border-white/5 backdrop-blur-3xl rounded-[2.5rem] p-8 flex items-center justify-between shadow-2xl relative overflow-hidden group hover:scale-[1.01] transition-all duration-300">
                    <div className="relative z-10">
                        <p className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-3">Producción Total</p>
                        <h4 className="text-4xl font-black text-white tabular-nums">{deduplicated.length}</h4>
                        <p className="text-[9px] text-zinc-600 font-bold uppercase tracking-widest mt-2">Facturas Únicas</p>
                    </div>
                    <div className="p-5 bg-indigo-500/10 text-indigo-400 rounded-2xl group-hover:bg-indigo-500 group-hover:text-white transition-all duration-300 shadow-lg shadow-indigo-500/5 relative z-10">
                        <FileText size={28} />
                    </div>
                    <div className="absolute -right-8 -bottom-8 w-32 h-32 bg-indigo-500/5 blur-[50px] rounded-full group-hover:bg-indigo-500/10 transition-all duration-1000" />
                </div>

                <div className="bg-white/[0.03] border border-white/5 backdrop-blur-3xl rounded-[2.5rem] p-8 flex items-center justify-between shadow-2xl relative overflow-hidden group hover:scale-[1.01] transition-all duration-300">
                    <div className="relative z-10">
                        <p className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-3">Brechas (POS {gapStats.pos})</p>
                        <h4 className="text-4xl font-black text-amber-500 tabular-nums">{gapStats.gaps}</h4>
                        <p className="text-[9px] text-zinc-600 font-bold uppercase tracking-widest mt-2">Hasta la #{gapStats.max}</p>
                    </div>
                    <div className="p-5 bg-amber-500/10 text-amber-500 rounded-2xl group-hover:bg-amber-500 group-hover:text-white transition-all duration-300 shadow-lg shadow-amber-500/5 relative z-10">
                        <Search size={28} />
                    </div>
                    <div className="absolute -right-8 -bottom-8 w-32 h-32 bg-amber-500/5 blur-[50px] rounded-full group-hover:bg-amber-500/10 transition-all duration-1000" />
                </div>

                <div className="bg-white/[0.03] border border-white/5 backdrop-blur-3xl rounded-[2.5rem] p-8 flex items-center justify-between shadow-2xl relative overflow-hidden group hover:scale-[1.01] transition-all duration-300">
                    <div className="relative z-10">
                        <p className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-3">Última Carga</p>
                        <h4 className="text-lg font-black text-zinc-200 uppercase tracking-tight italic">
                            {lastUpdate ? lastUpdate.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }) : 'Sin datos'}
                        </h4>
                        <p className="text-[10px] text-emerald-500 font-black uppercase tracking-widest mt-2 flex items-center gap-2">
                            <CheckCircle2 size={12} /> Sistemas OK
                        </p>
                    </div>
                    <div className="p-5 bg-emerald-500/10 text-emerald-400 rounded-2xl group-hover:bg-emerald-500 group-hover:text-white transition-all duration-300 shadow-lg shadow-emerald-500/5 relative z-10">
                        <CheckCircle2 size={28} />
                    </div>
                    <div className="absolute -right-8 -bottom-8 w-32 h-32 bg-emerald-500/5 blur-[50px] rounded-full group-hover:bg-emerald-500/10 transition-all duration-1000" />
                </div>
            </div>

            {/* Ingestion Status Overlay */}
            <AnimatePresence>
                {isProcessing && (
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className="bg-indigo-600/10 border border-indigo-500/20 rounded-3xl p-6 flex items-center justify-between mb-8"
                    >
                        <div className="flex items-center gap-4">
                            <div className="relative">
                                <Loader2 className="text-indigo-500 animate-spin" size={32} />
                                <Sparkles className="absolute -top-1 -right-1 text-indigo-400 animate-pulse" size={12} />
                            </div>
                            <div>
                                <h4 className="font-black text-white text-sm uppercase tracking-widest">Ingestando facturas a producción...</h4>
                                <p className="text-zinc-500 text-[10px] font-bold uppercase">Procesando {stats.current} de {stats.total} archivos</p>
                            </div>
                        </div>
                        <div className="text-right">
                            <span className="text-2xl font-black text-white">{Math.round((stats.current / stats.total) * 100)}%</span>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Actions Bar */}
            <div className="flex flex-col md:flex-row gap-4 justify-between items-center mb-8">
                <div className="flex items-center gap-4 w-full md:w-auto">
                    <div className="relative w-full md:w-96 group">
                        <Search className="absolute left-4 top-3.5 text-zinc-500 group-focus-within:text-indigo-400 transition-colors" size={18} />
                        <input
                            type="text"
                            placeholder="Buscar en el historial..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-3 pl-12 pr-12 outline-none focus:border-indigo-500/50 transition-all text-white font-medium placeholder:text-zinc-600"
                        />
                        {searchTerm && (
                            <button
                                onClick={() => setSearchTerm('')}
                                className="absolute right-4 top-3 text-zinc-500 hover:text-white transition-colors"
                            >
                                <X size={18} />
                            </button>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setSortBy(prev => prev === 'amount' ? 'number' : 'amount')}
                        className="px-6 py-3 bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 text-white rounded-2xl transition-all flex items-center gap-3 font-black text-xs uppercase tracking-widest active:scale-95 shadow-xl"
                        title="Cambiar modo de ordenamiento"
                    >
                        <ArrowUpDown size={18} className={sortBy === 'amount' ? 'text-emerald-400' : 'text-indigo-400'} />
                        {sortBy === 'amount' ? 'ORDEN: $ IMPORTE' : 'ORDEN: NRO FACTURA'}
                    </button>
                    <button
                        onClick={syncDownloads}
                        disabled={isProcessing}
                        className={`bg-indigo-600 hover:bg-indigo-500 text-white font-black px-10 py-3 rounded-2xl transition-all shadow-xl shadow-indigo-500/20 flex items-center gap-3 text-xs uppercase tracking-widest ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        <Folder size={20} className={isProcessing ? 'animate-spin' : ''} />
                        {isProcessing ? 'SINCRONIZANDO...' : 'SINCRONIZAR DESCARGAS'}
                    </button>
                    <button
                        onClick={repairInvoiceCuits}
                        className="px-10 py-3 bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 text-white rounded-2xl transition-all flex items-center gap-3 font-black text-xs uppercase tracking-widest active:scale-95 shadow-xl"
                    >
                        <Wrench size={18} className="text-indigo-400" />
                        REPARAR
                    </button>
                    <button className="px-10 py-3 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-white rounded-2xl transition-all flex items-center gap-3 font-black text-xs uppercase tracking-widest active:scale-95 shadow-xl">
                        <Download size={18} />
                        EXPORTAR
                    </button>
                </div>
            </div>

            {/* List - Grouped by Month */}
            {(() => {
                const currentMonthKey = new Date().toISOString().substring(0, 7);
                const monthLabel = (mk) => {
                    const [y, m] = mk.split('-');
                    const d = new Date(Number(y), Number(m) - 1, 1);
                    return d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }).replace(/^\w/, c => c.toUpperCase());
                };

                // Group filtered invoices by month (based on emission date)
                const groups = {};
                filtered.forEach(inv => {
                    let mk = 'sin-fecha';
                    if (inv.date) {
                        const d = inv.date.includes('/')
                            ? inv.date.split('/').reverse().join('-').substring(0, 7)
                            : inv.date.substring(0, 7);
                        if (d && d.match(/^\d{4}-\d{2}$/)) mk = d;
                    }
                    if (!groups[mk]) groups[mk] = [];
                    groups[mk].push(inv);
                });

                const sortedMonths = Object.keys(groups).sort((a, b) => b.localeCompare(a));
                const toggleMonth = (mk) => setExpandedMonths(prev => ({ ...prev, [mk]: !prev[mk] }));

                const renderTable = (items, compact = false) => (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className={compact ? "bg-zinc-800/30 border-b border-zinc-800/50" : "bg-zinc-900/50 border-b border-zinc-800"}>
                                    <th className={`${compact ? 'p-4' : 'p-8'} text-[10px] font-black text-zinc-500 uppercase tracking-widest`}>Pto Venta / Nro</th>
                                    <th className={`${compact ? 'p-4' : 'p-8'} text-[10px] font-black text-zinc-500 uppercase tracking-widest`}>Compañía Receptor</th>
                                    <th className={`${compact ? 'p-4' : 'p-8'} text-[10px] font-black text-zinc-500 uppercase tracking-widest`}>Fecha</th>
                                    <th className={`${compact ? 'p-4' : 'p-8'} text-[10px] font-black text-zinc-500 uppercase tracking-widest text-right`}>Bruto</th>
                                    <th className={`${compact ? 'p-4' : 'p-8'} text-[10px] font-black text-zinc-500 uppercase tracking-widest text-right`}>Neto</th>
                                    <th className={`${compact ? 'p-4' : 'p-8'} text-[10px] font-black text-zinc-500 uppercase tracking-widest text-center`}>Gestión</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-800/50 text-sm font-medium">
                                {items.map((inv) => (
                                    <tr key={inv.id} className="hover:bg-indigo-500/[0.02] transition-colors group">
                                        <td className={compact ? 'p-4' : 'p-8'}>
                                            <div className="flex flex-col">
                                                <span className="text-indigo-400 text-[10px] font-black uppercase tracking-widest mb-1">Factura C</span>
                                                <span className="text-zinc-400 font-mono text-xs tracking-tighter group-hover:text-zinc-200 transition-colors">
                                                    {(inv.number || '0').toString().padStart(8, '0')}
                                                </span>
                                            </div>
                                        </td>
                                        <td className={compact ? 'p-4' : 'p-8'}>
                                            <div className="flex items-center gap-3">
                                                {!compact && (
                                                    <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500 group-hover:text-indigo-400 group-hover:border-indigo-500/30 group-hover:scale-110 transition-all">
                                                        <FileText size={20} />
                                                    </div>
                                                )}
                                                <div>
                                                    <p className={`font-black text-zinc-100 uppercase tracking-tight mb-0.5 ${compact ? 'text-xs' : ''}`}>{inv.company}</p>
                                                    <p className="text-[10px] text-zinc-600 font-bold tracking-widest uppercase">CUIT: {inv.cuit || 'N/D'}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className={compact ? 'p-4' : 'p-8'}>
                                            <span className={`text-zinc-100 font-bold ${compact ? 'text-xs' : 'text-xs'}`}>
                                                {inv.date ? (inv.date.includes('/') ? inv.date : new Date(inv.date).toLocaleDateString('es-AR')) : 'Sin Fecha'}
                                            </span>
                                        </td>
                                        <td className={`${compact ? 'p-4' : 'p-8'} text-right`}>
                                            <p className={`font-black text-white tabular-nums ${compact ? 'text-sm' : 'text-lg'}`}>$ {Number(inv.amount).toLocaleString()}</p>
                                        </td>
                                        <td className={`${compact ? 'p-4' : 'p-8'} text-right`}>
                                            <p className={`font-bold text-emerald-400 tabular-nums ${compact ? 'text-sm' : 'text-base'}`}>$ {(Number(inv.amount) * 0.955).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</p>
                                        </td>
                                        <td className={`${compact ? 'p-4' : 'p-8'} text-center`}>
                                            <div className="flex justify-center items-center gap-1">
                                                <button onClick={() => handleDelete(inv.id)} className={`${compact ? 'p-2' : 'p-4'} text-zinc-600 hover:text-rose-500 hover:bg-rose-500/10 rounded-2xl transition-all`} title="Eliminar"><Trash2 size={compact ? 16 : 20} /></button>
                                                <button onClick={() => handleEdit(inv)} className={`${compact ? 'p-2' : 'p-4'} text-zinc-600 hover:text-indigo-400 hover:bg-indigo-400/10 rounded-2xl transition-all`} title="Editar"><Pencil size={compact ? 16 : 20} /></button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                );

                return (
                    <div className="space-y-6">
                        {sortedMonths.map(mk => {
                            const items = groups[mk];
                            const isCurrentMonth = mk === currentMonthKey;
                            const isExpanded = isCurrentMonth || expandedMonths[mk];
                            const totalComision = items.reduce((s, inv) => s + Number(inv.amount || 0), 0);
                            const totalGross = items.reduce((s, inv) => s + Number(inv.grossTotal || 0), 0);

                            return (
                                <div key={mk} className="bg-[#18181b] border border-zinc-800 rounded-[2.5rem] overflow-hidden shadow-2xl">
                                    {/* Month Header */}
                                    <button
                                        onClick={() => !isCurrentMonth && toggleMonth(mk)}
                                        className={`w-full p-6 md:p-8 flex items-center justify-between transition-colors ${!isCurrentMonth ? 'hover:bg-zinc-800/30 cursor-pointer' : 'cursor-default'}`}
                                    >
                                        <div className="flex items-center gap-4">
                                            {!isCurrentMonth && (
                                                isExpanded ? <ChevronDown size={20} className="text-zinc-500" /> : <ChevronRight size={20} className="text-zinc-500" />
                                            )}
                                            <CalendarDays size={18} className={isCurrentMonth ? 'text-indigo-400' : 'text-zinc-600'} />
                                            <h3 className={`font-black uppercase tracking-widest text-sm ${isCurrentMonth ? 'text-indigo-400' : 'text-zinc-300'}`}>
                                                {mk === 'sin-fecha' ? 'Sin Fecha' : monthLabel(mk)}
                                            </h3>
                                            {isCurrentMonth && (
                                                <span className="text-[9px] bg-indigo-500/10 text-indigo-400 px-3 py-1 rounded-full font-black uppercase tracking-widest border border-indigo-500/20">Mes en curso</span>
                                            )}
                                            <span className="text-[10px] bg-zinc-800 text-zinc-500 px-3 py-1 rounded-full font-black">{items.length} fact.</span>
                                        </div>
                                        <div className="flex items-center gap-6">
                                            <div className="text-right">
                                                <p className="text-[9px] text-zinc-600 font-black uppercase tracking-widest">Bruto</p>
                                                <p className="text-white font-black text-sm tabular-nums">$ {totalComision.toLocaleString()}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-[9px] text-zinc-600 font-black uppercase tracking-widest">Neto (-4.5%)</p>
                                                <p className="text-emerald-400 font-bold text-sm tabular-nums">$ {(totalComision * 0.955).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</p>
                                            </div>
                                        </div>
                                    </button>

                                    {/* Expanded content */}
                                    {isExpanded && (
                                        <div className="border-t border-zinc-800">
                                            {renderTable(isCurrentMonth ? items.slice(0, displayLimit) : items, !isCurrentMonth)}
                                            {isCurrentMonth && items.length > displayLimit && (
                                                <div className="p-8 flex justify-center border-t border-zinc-800 bg-zinc-900/20">
                                                    <button
                                                        onClick={() => setDisplayLimit(prev => prev + 100)}
                                                        className="px-12 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-black text-xs uppercase tracking-[0.2em] rounded-2xl transition-all border border-zinc-700 active:scale-95 flex items-center gap-3"
                                                    >
                                                        <ChevronRight size={18} className="rotate-90" />
                                                        Cargar más ({items.length - displayLimit} restantes)
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {filtered.length === 0 && !isProcessing && (
                            <div className="bg-[#18181b] border border-zinc-800 rounded-[2.5rem] p-32 text-center">
                                <div className="w-24 h-24 bg-zinc-900/50 rounded-full flex items-center justify-center mx-auto text-zinc-800 border-2 border-dashed border-zinc-800 mb-8 animate-pulse">
                                    <FileText size={40} />
                                </div>
                                <h5 className="text-white font-black uppercase text-sm tracking-widest mb-2">Bóveda vacía</h5>
                                <p className="text-zinc-600 text-xs font-medium max-w-xs mx-auto">No se encontraron registros de producción.</p>
                            </div>
                        )}
                    </div>
                );
            })()}
            {/* Edit Modal */}
            <AnimatePresence>
                {editingInvoice && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setEditingInvoice(null)}
                            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
                        />
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.95, opacity: 0, y: 20 }}
                            className="bg-zinc-900 border border-white/10 rounded-[2.5rem] w-full max-w-lg p-10 shadow-2xl relative z-10"
                        >
                            <div className="flex justify-between items-center mb-8">
                                <div>
                                    <h2 className="text-2xl font-black text-white uppercase tracking-tight">Editar Factura</h2>
                                    <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest mt-1">
                                        Modificando registro {(editingInvoice.pointOfSale || '00001')}-{(editingInvoice.number || '0')}
                                    </p>
                                </div>
                                <button onClick={() => setEditingInvoice(null)} className="p-3 hover:bg-white/5 rounded-full transition-colors text-zinc-400">
                                    <X size={24} />
                                </button>
                            </div>

                            <div className="space-y-6">
                                <div>
                                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2 block">Compañía Receptor</label>
                                    <input
                                        type="text"
                                        value={editForm.company}
                                        onChange={(e) => setEditForm({ ...editForm, company: e.target.value })}
                                        className="w-full bg-black/50 border border-white/10 rounded-2xl p-4 text-white font-medium outline-none focus:border-indigo-500/50 transition-all font-black uppercase text-sm"
                                    />
                                </div>

                                <div>
                                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2 block">CUIT Receptor</label>
                                    <input
                                        type="text"
                                        value={editForm.cuit}
                                        onChange={(e) => setEditForm({ ...editForm, cuit: e.target.value })}
                                        className="w-full bg-black/50 border border-white/10 rounded-2xl p-4 text-indigo-400 font-mono text-sm outline-none focus:border-indigo-500/50 transition-all"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2 block">Fecha</label>
                                        <input
                                            type="date"
                                            value={editForm.date}
                                            onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                                            className="w-full bg-black/50 border border-white/10 rounded-2xl p-4 text-white outline-none focus:border-indigo-500/50 transition-all"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2 block">Importe Total</label>
                                        <input
                                            type="number"
                                            value={editForm.amount}
                                            onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })}
                                            className="w-full bg-black/50 border border-white/10 rounded-2xl p-4 text-white font-black outline-none focus:border-indigo-500/50 transition-all"
                                        />
                                    </div>
                                </div>

                                <div className="pt-4 flex gap-4">
                                    <button
                                        onClick={() => setEditingInvoice(null)}
                                        className="flex-1 px-8 py-4 bg-zinc-800 text-zinc-400 font-black text-xs uppercase tracking-widest rounded-2xl hover:bg-zinc-700 transition-all"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        onClick={handleSaveEdit}
                                        className="flex-1 px-8 py-4 bg-indigo-600 text-white font-black text-xs uppercase tracking-widest rounded-2xl hover:bg-indigo-500 transition-all shadow-xl shadow-indigo-500/20 flex items-center justify-center gap-3"
                                    >
                                        <Check size={18} />
                                        Guardar Cambios
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default InvoiceList;
