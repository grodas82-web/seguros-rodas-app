import React, { useState, useEffect, useRef } from 'react';
import { useAppContext } from '../context/AppContext';
import { Save, RefreshCcw, Landmark, CreditCard, Hash, DollarSign, Calendar, PlusCircle, Upload, Sparkles, Activity, ShieldCheck, Zap, Monitor, Plus, Trash2 } from 'lucide-react';

// ─── Formato pesos argentinos ─────────────────────────────────────────────────
const formatARS = (raw) => {
    const num = parseFloat(String(raw).replace(/\./g, '').replace(',', '.'));
    if (isNaN(num) || raw === '' || raw === undefined) return '';
    return num.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const parseARS = (str) => {
    const s = String(str || '').trim();
    if (!s) return 0;

    const hasDot   = s.includes('.');
    const hasComma = s.includes(',');

    let normalized;
    if (hasDot && hasComma) {
        // "27.905,73"  → punto = miles, coma = decimal
        normalized = s.replace(/\./g, '').replace(',', '.');
    } else if (hasComma && !hasDot) {
        // "27905,73"   → coma = decimal
        normalized = s.replace(',', '.');
    } else if (hasDot && !hasComma) {
        // "27905.73"   → si hay ≤2 dígitos tras el último punto → decimal
        // "27.905"     → 3 dígitos tras el punto → miles
        const afterLastDot = s.split('.').pop();
        normalized = afterLastDot.length <= 2 ? s : s.replace(/\./g, '');
    } else {
        normalized = s;
    }

    const n = parseFloat(normalized);
    return isNaN(n) ? 0 : n;
};

const SPANISH_MONTHS = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
    'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

const getPreviousMonthDefaults = () => {
    const today = new Date();
    const prevYear = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();
    const prevMonth = today.getMonth() === 0 ? 11 : today.getMonth() - 1;
    const firstDay = new Date(prevYear, prevMonth, 1).toISOString().split('T')[0];
    const lastDay = new Date(prevYear, prevMonth + 1, 0).toISOString().split('T')[0];
    const description = `COMISIONES DEL MES ${SPANISH_MONTHS[prevMonth]} DE ${prevYear}`;
    return { firstDay, lastDay, description };
};

const InvoiceEntry = ({ onFinish }) => {
    const { companies, addInvoice, quotaLock, invoices, testInvoices } = useAppContext();
    const { firstDay: prevFirstDay, lastDay: prevLastDay, description: prevDescription } = getPreviousMonthDefaults();
    const [formData, setFormData] = useState({
        company: '',
        cuit: '',
        type: 'Factura C',
        pointOfSale: '00004',
        date: new Date().toISOString().split('T')[0],
        description: prevDescription,
        fiscalCondition: 'Consumidor Final',
        ivaConditionId: 5,
        docType: 99,
        concept: 2,
        serviceFrom: prevFirstDay,
        serviceTo: prevLastDay,
        paymentDue: new Date().toISOString().split('T')[0]
    });
    // Ítems de descripción múltiple con monto en ARS
    const [lineItems, setLineItems] = useState([
        { description: prevDescription, display: '', raw: 0 }
    ]);

    // Total calculado desde los ítems
    const totalAmount = lineItems.reduce((s, i) => s + i.raw, 0);

    // Sincronizar amount y description al formData cuando cambian los ítems
    useEffect(() => {
        setFormData(prev => ({
            ...prev,
            amount: totalAmount || '',
            description: lineItems.map(i => i.description).filter(Boolean).join(' / '),
            lineItems: lineItems.map(i => ({ description: i.description, amount: i.raw }))
        }));
    }, [lineItems]);

    const addLineItem = () =>
        setLineItems(prev => [...prev, { description: '', display: '', raw: 0 }]);

    const removeLineItem = (idx) =>
        setLineItems(prev => prev.filter((_, i) => i !== idx));

    const updateLineDescription = (idx, value) =>
        setLineItems(prev => prev.map((item, i) => i === idx ? { ...item, description: value } : item));

    const updateLineAmount = (idx, inputValue) => {
        // Permitir tipeo libre; solo parsear al perder foco
        setLineItems(prev => prev.map((item, i) =>
            i === idx ? { ...item, display: inputValue, raw: parseARS(inputValue) } : item
        ));
    };

    const formatLineAmount = (idx) => {
        // Al perder foco, formatear el display con separador de miles
        setLineItems(prev => prev.map((item, i) =>
            i === idx ? { ...item, display: item.raw > 0 ? formatARS(item.raw) : '' } : item
        ));
    };

    const [isSaving, setIsSaving] = useState(false);
    const [useAfip, setUseAfip] = useState(false);
    const [afipOnline, setAfipOnline] = useState(null);
    const [isFetchingAfip, setIsFetchingAfip] = useState(false);

    // Check AFIP Status on load
    useEffect(() => {
        const checkStatus = async () => {
            try {
                const res = await window.electron.afipStatus();
                setAfipOnline(res.success);
            } catch (e) {
                setAfipOnline(false);
            }
        };
        checkStatus();
    }, []);

    // Auto-CUIT and Fiscal Condition Lookup
    useEffect(() => {
        const found = companies.find(c => (c.name || '').toLowerCase() === (formData.company || '').toLowerCase());
        if (found) {
            const conditionMap = {
                'Responsable Inscripto': 1,
                'Exento': 4,
                'Consumidor Final': 5,
                'Monotributista': 6
            };
            setFormData(prev => ({ 
                ...prev, 
                cuit: found.cuit,
                fiscalCondition: found.ivaType || 'Consumidor Final',
                ivaConditionId: conditionMap[found.ivaType] || 5,
                docType: found.cuit ? 80 : 99 
            }));
        }
    }, [formData.company, companies]);

    // Sync Next Voucher Number (AFIP + Local Fallback)
    const syncNextNumber = async () => {
        if (!formData.pointOfSale || isFetchingAfip) return;
        setIsFetchingAfip(true);
        try {
            // 1. Try AFIP Sync
            const typeMap = {
                'Factura A': 1,
                'Factura B': 6,
                'Factura C': 11,
                'Nota Crédito A': 3,
                'Nota Crédito B': 8
            };
            const res = await window.electron.afipGetLastVoucher({
                pos: formData.pointOfSale,
                type: typeMap[formData.type] || 11
            });

            if (res.success) {
                setFormData(prev => ({ ...prev, number: res.lastVoucher + 1 }));
                return;
            } else {
                alert(`Error al sincronizar con AFIP: ${res.error}`);
            }

            // 2. Fallback to Local History — solo facturas con CAE real (evita contar borradores sin CAE)
            console.log('AFIP Sync failed or offline, falling back to local history (CAE only)...');
            const historyToSearch = useAfip ? invoices : testInvoices;
            const sameTypeInv = (historyToSearch || []).filter(inv =>
                inv.type === formData.type &&
                inv.pointOfSale === formData.pointOfSale &&
                inv.cae  // Solo contar facturas con CAE válido emitido por AFIP
            );

            if (sameTypeInv.length > 0) {
                const maxNum = Math.max(...sameTypeInv.map(inv => parseInt(inv.number) || 0));
                setFormData(prev => ({ ...prev, number: maxNum + 1 }));
            } else {
                // If no history, default to 1 or leave empty
                setFormData(prev => ({ ...prev, number: prev.number || 1 }));
            }
        } catch (error) {
            console.error('Error syncing number:', error);
        } finally {
            setIsFetchingAfip(false);
        }
    };

    // Auto-sync when POS or Type changes if AFIP is enabled
    useEffect(() => {
        if (useAfip && formData.pointOfSale && formData.type) {
            syncNextNumber();
        }
    }, [useAfip, formData.pointOfSale, formData.type]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSaving(true);
        try {
            let afipData = null;
            if (useAfip) {
                const conditionMap = {
                    'Responsable Inscripto': 1,
                    'Exento': 4,
                    'Consumidor Final': 5,
                    'Monotributista': 6
                };
                const typeMap = {
                    'Factura A': 1,
                    'Factura B': 6,
                    'Factura C': 11,
                    'Nota Crédito A': 3,
                    'Nota Crédito B': 8
                };
                const afipDataPayload = {
                    ...formData,
                    typeId: typeMap[formData.type] || 11,
                    ivaConditionId: conditionMap[formData.fiscalCondition] || 5,
                    docType: formData.cuit ? 80 : 99,
                    amount: parseFloat(formData.amount) || 0,
                    netAmount: parseFloat(formData.amount) || 0,
                    ivaAmount: 0 
                };
                const res = await window.electron.afipCreateInvoice(afipDataPayload);
                if (!res.success) {
                    throw new Error(`Error AFIP: ${res.error}`);
                }
                afipData = res;
            }

            const finalData = {
                ...formData,
                ...(afipData ? { 
                    cae: afipData.cae, 
                    caeExpiration: afipData.caeExpiration,
                    afipInternal: afipData.fullResponse 
                } : {})
            };

            try {
                await addInvoice(finalData);
            } catch (fsErr) {
                console.error('Firebase DB Error:', fsErr);
                // Si la factura ya se emitió en AFIP, no podemos tapar el éxito fiscal por culpa de Firebase
                if (afipData) {
                    alert(`⚠️ ATENCIÓN: La Factura de AFIP SÍ SE EMITIÓ correctamente (CAE: ${afipData.cae}).\n\nSin embargo, hubo un error guardándola en tu base de datos local (Firebase: ${fsErr.message}).\n\nPor favor anota el CAE.`);
                } else {
                    throw fsErr;
                }
            }
            
            if (afipData) {
                if (window.confirm(`✅ Factura AFIP emitida con éxito!\nCAE: ${afipData.cae}\n\n¿Deseas descargar el PDF ahora?`)) {
                    await window.electron.afipGeneratePdf(finalData);
                }
            } else {
                alert('Factura grabada con éxito');
            }
            
            if (onFinish) onFinish();
        } catch (error) {
            console.error(error);
            alert(`Error: ${error.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="max-w-2xl mx-auto animate-in slide-in-from-bottom duration-500">
            <div className="bg-[#18181b] border border-zinc-800 rounded-3xl p-10 shadow-2xl relative overflow-hidden">
                
                {/* AFIP Status Badge */}
                <div className="absolute top-0 right-0 p-6 flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${afipOnline === null ? 'bg-zinc-500 animate-pulse' : afipOnline ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.5)]'}`} />
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                        AFIP {afipOnline === null ? '...' : afipOnline ? 'Online' : 'Offline'}
                    </span>
                </div>

                <div className="flex justify-between items-start mb-8">
                    <h3 className="text-2xl font-black text-white flex items-center gap-3">
                        <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-lg">
                            <PlusCircle size={24} />
                        </div>
                        Nueva Factura
                    </h3>
                </div>

                {/* AFIP Toggle - EXTREMELY PROMINENT */}
                <div className={`mb-8 p-8 rounded-[2rem] border-2 transition-all cursor-pointer flex items-center justify-between group shadow-xl ${useAfip ? 'bg-indigo-600/20 border-indigo-500 box-shadow-[0_0_40px_rgba(79,70,229,0.2)]' : 'bg-white/5 border-zinc-800 hover:border-zinc-700'}`}
                     onClick={() => setUseAfip(!useAfip)}>
                    <div className="flex items-center gap-6">
                        <div className={`p-5 rounded-2xl transition-all ${useAfip ? 'bg-indigo-500 text-white shadow-[0_0_20px_rgba(79,70,229,0.5)] scale-110' : 'bg-zinc-800 text-zinc-500'}`}>
                            {useAfip ? <ShieldCheck size={32} strokeWidth={3} /> : <Zap size={32} />}
                        </div>
                        <div>
                            <p className={`text-xl font-black uppercase tracking-tighter ${useAfip ? 'text-white' : 'text-zinc-500'}`}>
                                {useAfip ? 'FACTURACIÓN AFIP REAL' : 'MODO BORRADOR / INTERNO'}
                            </p>
                            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] mt-1">
                                {useAfip ? 'EMITIENDO COMPROBANTE OFICIAL CON CAE RECONOCIDO' : 'SOLO GUARDADO LOCAL EN LA APP (SIN VALIDEZ FISCAL)'}
                            </p>
                        </div>
                    </div>
                    <div className={`w-16 h-8 rounded-full relative transition-all ${useAfip ? 'bg-indigo-500' : 'bg-zinc-700'}`}>
                        <div className={`absolute top-1 w-6 h-6 rounded-full bg-white transition-all shadow-xl ${useAfip ? 'left-9' : 'left-1'}`} />
                    </div>
                </div>

                {quotaLock.isLocked && (
                    <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-3">
                        <Sparkles className="text-red-500 animate-pulse" size={18} />
                        <p className="text-red-500 font-black uppercase text-[10px] tracking-wider">
                            Límite alcanzado. Reintentando en: {quotaLock.remainingSeconds}s
                        </p>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Compañía */}
                        <div className="space-y-2">
                            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest ml-1">Compañía</label>
                            <div className="relative group">
                                <Landmark className="absolute left-4 top-3.5 text-zinc-500 group-focus-within:text-indigo-400 transition-colors" size={18} />
                                <input
                                    list="companies-list"
                                    type="text"
                                    required
                                    value={formData.company}
                                    onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                                    className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-3 pl-12 pr-4 outline-none focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10 transition-all text-white font-semibold"
                                    placeholder="Nombre de la empresa"
                                />
                                <datalist id="companies-list">
                                    {companies.map(c => <option key={c.id} value={c.name} />)}
                                </datalist>
                            </div>
                        </div>

                        {/* CUIT */}
                        <div className="space-y-2">
                            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest ml-1">CUIT / ID</label>
                            <div className="relative">
                                <Hash className="absolute left-4 top-3.5 text-zinc-500" size={18} />
                                <input
                                    type="text"
                                    required
                                    value={formData.cuit}
                                    onChange={(e) => setFormData({ ...formData, cuit: e.target.value })}
                                    className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-3 pl-12 pr-4 outline-none focus:border-indigo-500/50 transition-all text-white font-bold"
                                    placeholder="CUIT"
                                />
                            </div>
                        </div>

                        {/* Condicion Fiscal */}
                        <div className="space-y-2">
                            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest ml-1">Condición Fiscal</label>
                            <select
                                value={formData.fiscalCondition}
                                onChange={(e) => {
                                    const conditionMap = {
                                        'Responsable Inscripto': 1,
                                        'Exento': 4,
                                        'Consumidor Final': 5,
                                        'Monotributista': 6
                                    };
                                    setFormData({ 
                                        ...formData, 
                                        fiscalCondition: e.target.value,
                                        ivaConditionId: conditionMap[e.target.value] || 5,
                                        docType: (formData.cuit || e.target.value === 'Consumidor Final') ? (formData.cuit ? 80 : 99) : 80
                                    });
                                }}
                                className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-3 px-4 outline-none focus:border-indigo-500/50 transition-all text-white font-semibold appearance-none"
                            >
                                <option>Responsable Inscripto</option>
                                <option>Monotributista</option>
                                <option>Exento</option>
                                <option>Consumidor Final</option>
                            </select>
                        </div>
        
                        {/* Tipo FC */}
                        <div className="space-y-2">
                            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest ml-1">Tipo Documento</label>
                            <div className="relative">
                                <CreditCard className="absolute left-4 top-3.5 text-zinc-500" size={18} />
                                <select
                                    value={formData.type}
                                    onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                                    className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-3 pl-12 pr-4 outline-none focus:border-indigo-500/50 transition-all text-white font-semibold appearance-none"
                                >
                                    <option>Factura A</option>
                                    <option>Factura B</option>
                                    <option>Factura C</option>
                                    <option>Nota Crédito A</option>
                                    <option>Nota Crédito B</option>
                                </select>
                            </div>
                        </div>

                        {/* Punto de Venta */}
                        <div className="space-y-2">
                            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest ml-1">Punto de Venta</label>
                            <input
                                type="text"
                                required
                                value={formData.pointOfSale}
                                onChange={(e) => setFormData({ ...formData, pointOfSale: e.target.value })}
                                className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-3 px-4 outline-none focus:border-indigo-500/50 transition-all text-white font-semibold"
                                placeholder="00001"
                            />
                        </div>

                        {/* Numero FC */}
                        <div className="space-y-2">
                            <div className="flex justify-between items-center mb-1">
                                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest ml-1">Número</label>
                                {useAfip && (
                                    <button 
                                        type="button"
                                        onClick={syncNextNumber}
                                        className="text-[10px] font-bold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 uppercase tracking-tighter"
                                    >
                                        {isFetchingAfip ? <Activity className="animate-spin" size={10} /> : <RefreshCcw size={10} />}
                                        Sincronizar AFIP
                                    </button>
                                )}
                            </div>
                            <input
                                type="text"
                                required
                                value={formData.number}
                                onChange={(e) => setFormData({ ...formData, number: e.target.value })}
                                className={`w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-3 px-4 outline-none focus:border-indigo-500/50 transition-all text-white font-semibold ${useAfip ? 'border-indigo-500/30' : ''}`}
                                placeholder="Último + 1"
                            />
                        </div>

                        {/* Ítems de Descripción + Monto */}
                        <div className="space-y-3 md:col-span-2">
                            <div className="flex items-center justify-between">
                                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest ml-1">Descripción / Conceptos</label>
                                <button
                                    type="button"
                                    onClick={addLineItem}
                                    className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-indigo-400 hover:text-indigo-300 transition-colors"
                                >
                                    <Plus size={13} />
                                    Agregar ítem
                                </button>
                            </div>

                            <div className="space-y-2">
                                {lineItems.map((item, idx) => (
                                    <div key={idx} className="flex gap-2 items-center animate-in slide-in-from-top-1 duration-200">
                                        {/* Descripción */}
                                        <div className="relative flex-1">
                                            <Sparkles className="absolute left-3 top-3 text-indigo-500/60" size={15} />
                                            <input
                                                type="text"
                                                value={item.description}
                                                onChange={(e) => updateLineDescription(idx, e.target.value)}
                                                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2.5 pl-9 pr-3 outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/10 transition-all text-white text-sm font-semibold"
                                                placeholder="Ej: Comisiones Febrero 2026"
                                            />
                                        </div>

                                        {/* Monto ARS */}
                                        <div className="relative w-44 shrink-0">
                                            <span className="absolute left-3 top-2.5 text-emerald-500 text-sm font-bold pointer-events-none">$</span>
                                            <input
                                                type="text"
                                                inputMode="decimal"
                                                value={item.display}
                                                onChange={(e) => updateLineAmount(idx, e.target.value)}
                                                onBlur={() => formatLineAmount(idx)}
                                                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2.5 pl-7 pr-3 outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/10 transition-all text-white text-sm font-bold text-right"
                                                placeholder="0,00"
                                            />
                                        </div>

                                        {/* Eliminar */}
                                        {lineItems.length > 1 && (
                                            <button
                                                type="button"
                                                onClick={() => removeLineItem(idx)}
                                                className="p-2 rounded-lg text-zinc-600 hover:text-rose-400 hover:bg-rose-500/10 transition-all shrink-0"
                                            >
                                                <Trash2 size={15} />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {/* Total */}
                            <div className="flex justify-end items-center gap-3 pt-2 border-t border-zinc-800/80">
                                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Total Facturado</span>
                                <span className="text-xl font-black text-emerald-400 tabular-nums">
                                    $ {formatARS(totalAmount) || '0,00'}
                                </span>
                            </div>
                        </div>

                        {/* Fecha */}
                        <div className="space-y-2">
                            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest ml-1">Fecha Factura</label>
                            <div className="relative">
                                <Calendar className="absolute left-4 top-3.5 text-zinc-500" size={18} />
                                <input
                                    type="date"
                                    required
                                    value={formData.date}
                                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                                    className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-3 pl-12 pr-4 outline-none focus:border-indigo-500/50 transition-all text-white font-semibold"
                                />
                            </div>
                        </div>

                        {/* Concepto */}
                        <div className="space-y-2">
                            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest ml-1">Concepto</label>
                            <select
                                value={formData.concept}
                                onChange={(e) => setFormData({ ...formData, concept: parseInt(e.target.value) })}
                                className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-3 px-4 outline-none focus:border-indigo-500/50 transition-all text-white font-semibold appearance-none"
                            >
                                <option value={1}>Productos</option>
                                <option value={2}>Servicios</option>
                                <option value={3}>Productos y Servicios</option>
                            </select>
                        </div>

                        {/* Campos de Servicios (Solo si Concepto es 2 o 3) */}
                        {(formData.concept === 2 || formData.concept === 3) && (
                            <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4 p-6 bg-white/[0.02] border border-white/5 rounded-3xl animate-in zoom-in-95 duration-300">
                                <div className="space-y-2">
                                    <label className="text-[9px] font-black text-indigo-400 uppercase tracking-widest ml-1">Servicios Desde</label>
                                    <input
                                        type="date"
                                        required
                                        value={formData.serviceFrom}
                                        onChange={(e) => setFormData({ ...formData, serviceFrom: e.target.value })}
                                        className="w-full bg-black/40 border border-zinc-800 rounded-xl py-2.5 px-4 outline-none focus:border-indigo-500/50 transition-all text-white text-xs font-bold"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[9px] font-black text-indigo-400 uppercase tracking-widest ml-1">Servicios Hasta</label>
                                    <input
                                        type="date"
                                        required
                                        value={formData.serviceTo}
                                        onChange={(e) => setFormData({ ...formData, serviceTo: e.target.value })}
                                        className="w-full bg-black/40 border border-zinc-800 rounded-xl py-2.5 px-4 outline-none focus:border-indigo-500/50 transition-all text-white text-xs font-bold"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[9px] font-black text-emerald-400 uppercase tracking-widest ml-1">Vencimiento Pago</label>
                                    <input
                                        type="date"
                                        required
                                        value={formData.paymentDue}
                                        onChange={(e) => setFormData({ ...formData, paymentDue: e.target.value })}
                                        className="w-full bg-black/40 border border-zinc-800 rounded-xl py-2.5 px-4 outline-none focus:border-emerald-500/50 transition-all text-white text-xs font-bold"
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    <button
                        type="submit"
                        disabled={isSaving || quotaLock.isLocked}
                        className={`w-full ${useAfip ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-zinc-700 hover:bg-zinc-600'} text-white font-black py-4 rounded-2xl transition-all shadow-xl flex items-center justify-center gap-3 disabled:opacity-50 mt-4 active:scale-95 ${quotaLock.isLocked ? 'cursor-not-allowed' : ''}`}
                    >
                        {isSaving ? <RefreshCcw className="animate-spin" size={20} /> : useAfip ? <ShieldCheck size={20} /> : <Save size={20} />}
                        {isSaving ? 'GRABANDO...' : quotaLock.isLocked ? 'LÍMITE ALCANZADO' : useAfip ? 'EMITIR FACTURA AFIP' : 'GRABAR FACTURA INTERNA'}
                    </button>
                </form>
            </div>
        </div>
    );
};

const SoloPC = () => (
    <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-6 text-center px-8">
        <div className="p-6 rounded-3xl bg-zinc-800/60 border border-zinc-700">
            <Monitor size={56} className="text-zinc-500" />
        </div>
        <div>
            <h2 className="text-2xl font-black text-white mb-2">Facturación AFIP</h2>
            <p className="text-zinc-400 text-base">Este módulo solo está disponible en la<br />
                <span className="text-indigo-400 font-bold">aplicación de escritorio (PC)</span>.
            </p>
        </div>
    </div>
);

export default function InvoiceEntryGuard(props) {
    if (!window?.electron) return <SoloPC />;
    return <InvoiceEntry {...props} />;
}
