import React, { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { UserPlus, Building2, Trash2, Edit2, ShieldCheck, CheckCircle2, Search, ArrowUpDown } from 'lucide-react';

const IIBB_FACTOR = 0.955; // 1 - 4.5% deduction

const CompanyManager = () => {
    const {
        companies,
        invoices,
        testInvoices,
        addCompany,
        updateCompany,
        deleteCompany,
        syncCompanyCuits,
        globalSearchTerm,
        policies = []
    } = useAppContext();
    const [isAdding, setIsAdding] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [searchTerm, setSearchTerm] = useState((globalSearchTerm || '').trim());
    const [onlyPending, setOnlyPending] = useState(false);

    // Sincronizar con búsqueda global y resetear filtros
    React.useEffect(() => {
        const trimmed = (globalSearchTerm || '').trim();
        setSearchTerm(trimmed);
        if (trimmed) {
            setOnlyPending(false);
        }
    }, [globalSearchTerm]);
    const [newComp, setNewComp] = useState({ name: '', cuit: '', ivaType: 'Responsable Inscripto' });
    const [editForm, setEditForm] = useState({ name: '', cuit: '', ivaType: 'Responsable Inscripto' });

    const handleAdd = async (e) => {
        e.preventDefault();
        await addCompany(newComp);
        setNewComp({ name: '', cuit: '', ivaType: 'Responsable Inscripto' });
        setIsAdding(false);
    };

    const handleEdit = (comp) => {
        setEditingId(comp.id);
        setEditForm({ name: comp.name, cuit: comp.cuit, ivaType: comp.ivaType });
    };

    const handleSaveEdit = async (id) => {
        await updateCompany(id, editForm);
        setEditingId(null);
    };

    const handleDelete = async (id) => {
        if (window.confirm('¿Estás seguro de eliminar esta compañía?')) {
            await deleteCompany(id);
        }
    };

    const handleSync = async () => {
        const count = await syncCompanyCuits();
        if (count > 0) {
            alert(`Sincronización completada: ${count} CUITs actualizados.`);
        } else {
            alert('No se encontraron CUITs nuevos para actualizar.');
        }
    };

    // Contexto de tiempo estricto (Febrero 2026)
    const { currentMonth, currentYear } = React.useMemo(() => {
        const d = new Date();
        return { currentMonth: d.getMonth(), currentYear: d.getFullYear() };
    }, []);


    // Helper: Unifica nombres de compañías con aliases conocidos
    const getCanonicalCompanyName = React.useCallback((name) => {
        if (!name) return '';
        const upper = name.toUpperCase().trim();
        if (upper.includes('ACS COMERCIAL') || upper.includes('GALICIA') || upper.includes('1276')) return 'GALICIA';
        if (upper.includes('MERCANTIL') || upper.includes('MERCANTIN')) return 'MERCANTIL';
        if (upper.includes('FEDERA')) return 'FEDERACION';
        if (upper.includes('ALLIANZ')) return 'ALLIANZ';
        if ((upper.includes('SWISS MEDICAL') && upper.includes('ART')) || upper.includes('SWISS MEDICAL ART')) return 'SWISS MEDICAL ART';
        if (upper.includes('SMG') || (upper.includes('COMPANIA ARGENTINA') && upper.includes('SEGUROS')) || (upper.includes('SWISS MEDICAL') && !upper.includes('ART'))) return 'SMG';
        if (upper.includes('MERIDIONAL')) return 'MERIDIONAL';
        if (upper.includes('ZURICH')) return 'ZURICH';
        if (upper.includes('RIVADAVIA')) return 'RIVADAVIA';
        if (upper.includes('SANCOR')) return 'SANCOR';
        if (upper.includes('SAN CRISTOBAL') || upper.includes('SAN CRISTÓBAL')) return 'SAN CRISTOBAL';
        if (upper.includes('PROVINCIA')) return 'PROVINCIA';
        if (upper.includes('MAPFRE')) return 'MAPFRE';
        if (upper.includes('HAMBURGO')) return 'HAMBURGO';
        if (upper.includes('INTEGRITY')) return 'INTEGRITY';
        if (upper.includes('TRIUNFO')) return 'TRIUNFO';
        if (upper.includes('EXPERTA ART')) return 'EXPERTA ART';
        if (upper.includes('EXPERTA')) return 'EXPERTA';
        return upper
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Quitar acentos
            .replace(/\s*(S\.?A\.?|SEGUROS|CIA\.?|COMPAÑIA|COMPANIA|ARGENTINA)\s*/gi, '')
            .trim();
    }, []);

    // Inyectar estado de facturación real basado en historial (con aliases)
    const companiesWithStatus = React.useMemo(() => {
        const combined = [...invoices];

        // 1. Agrupar facturas por CUIT y por nombre
        const invoiceGroupsByCuit = new Map();
        const invoiceGroupsByName = new Map();

        combined.forEach(inv => {
            const rawCuit = inv.cuit ? inv.cuit.replace(/[^0-9]/g, '') : '';
            if (rawCuit) {
                if (!invoiceGroupsByCuit.has(rawCuit)) invoiceGroupsByCuit.set(rawCuit, []);
                invoiceGroupsByCuit.get(rawCuit).push(inv);
            }

            const canonName = getCanonicalCompanyName(inv.company);
            const normName = inv._normalizedName;

            if (canonName) {
                if (!invoiceGroupsByName.has(canonName)) invoiceGroupsByName.set(canonName, []);
                invoiceGroupsByName.get(canonName).push(inv);
            }
            if (normName && normName !== canonName) {
                if (!invoiceGroupsByName.has(normName)) invoiceGroupsByName.set(normName, []);
                invoiceGroupsByName.get(normName).push(inv);
            }
        });

        // 2. Procesar cada compañía dando prioridad al CUIT
        return companies.map(comp => {
            const compCuit = comp.cuit ? comp.cuit.replace(/[^0-9]/g, '') : '';
            const canonKey = getCanonicalCompanyName(comp.name);
            const normKey = comp._normalizedName;

            const historyByCuit = compCuit ? (invoiceGroupsByCuit.get(compCuit) || []) : [];
            const historyByCanon = invoiceGroupsByName.get(canonKey) || [];
            const historyByNorm = invoiceGroupsByName.get(normKey) || [];

            // Deduplicar con validación estricta de CUIT para evitar mezclas homónimas
            const seen = new Set();
            const history = [];

            const addIfValid = (inv) => {
                const key = inv.id || (inv.number + inv.date);
                if (!seen.has(key)) {
                    // CUIT STRICT CHECK: Ignorar si AMBOS tienen CUIT y NO coinciden.
                    // Esto permite que empresas sin CUIT cargado igualmente absorban facturas por nombre.
                    const invCuit = inv.cuit ? inv.cuit.replace(/[^0-9]/g, '') : '';
                    if (compCuit && invCuit && compCuit !== invCuit) {
                        return; // Evita que Experta ART absorba a Experta Seguros o viceversa
                    }
                    seen.add(key);
                    history.push(inv);
                }
            };

            // Agregamos primero por CUIT (máxima certeza), luego por nombre. Las repeticiones se saltean.
            historyByCuit.forEach(addIfValid);
            historyByCanon.forEach(addIfValid);
            historyByNorm.forEach(addIfValid);

            // Filtrar SOLO facturas del mes actual
            const thisMonthInvoices = history.filter(inv => {
                let dMonth = -1;
                let dYear = -1;

                if (inv.date) {
                    if (inv.date.includes('/')) {
                        const parts = inv.date.split('/');
                        dMonth = parseInt(parts[1], 10) - 1;
                        dYear = parseInt(parts[2], 10);
                    } else if (inv.date.includes('-')) {
                        const parts = inv.date.split('-');
                        dYear = parseInt(parts[0], 10);
                        dMonth = parseInt(parts[1], 10) - 1;
                    }
                } else if (inv.timestamp?.seconds) {
                    const d = new Date(inv.timestamp.seconds * 1000);
                    dMonth = d.getMonth();
                    dYear = d.getFullYear();
                } else if (inv.timestamp) {
                    const d = new Date(inv.timestamp);
                    dMonth = d.getMonth();
                    dYear = d.getFullYear();
                }

                return dMonth === currentMonth && dYear === currentYear;
            });

            const isLoaded = thisMonthInvoices.length > 0;
            const totalThisMonth = thisMonthInvoices.reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0) * IIBB_FACTOR;
            const invoiceNumbers = thisMonthInvoices.map(inv => inv.number).join(', ');

            const maxInvoiceNumber = thisMonthInvoices.length > 0
                ? Math.max(...thisMonthInvoices.map(inv => parseInt(inv.number?.slice(-8) || 0)))
                : 0;

            return {
                ...comp,
                isLoaded,
                totalAmount: totalThisMonth,
                invoiceNumbers,
                invoiceCount: thisMonthInvoices.length,
                maxInvoiceNumber
            };
        });
    }, [companies, invoices, currentMonth, currentYear, getCanonicalCompanyName]);

    // Filtrado y Ordenamiento: Pendientes ARRIBA, Realizadas por Nro Factura Desc
    const filteredCompanies = React.useMemo(() => {
        return companiesWithStatus
            .filter(c => {
                const q = searchTerm.toLowerCase();
                const isSearchMatch =
                    c.name.toLowerCase().includes(q) ||
                    c.cuit.includes(searchTerm) ||
                    policies.some(p =>
                        (p.company || '').toLowerCase() === c.name.toLowerCase() &&
                        (p.clientName || '').toLowerCase().includes(q)
                    );

                if (!isSearchMatch) return false;
                if (onlyPending && c.isLoaded) return false;
                return true;
            })
            .sort((a, b) => {
                // 1. PRIORIDAD MÁXIMA: Pendientes arriba (isLoaded: false -> -1)
                if (a.isLoaded !== b.isLoaded) return a.isLoaded ? 1 : -1;

                // 2. Si son Realizadas (isLoaded: true), ordenar por MAYOR a MENOR (Monto y luego Nro Factura)
                if (a.isLoaded) {
                    // Primero por monto total liquidado
                    const amountDiff = (b.totalAmount || 0) - (a.totalAmount || 0);
                    if (Math.abs(amountDiff) > 0.01) return amountDiff;

                    // Segundo por número de factura más alto
                    const numDiff = (b.maxInvoiceNumber || 0) - (a.maxInvoiceNumber || 0);
                    if (numDiff !== 0) return numDiff;
                }

                // 3. Fallback: Orden alfabético
                return a.name.localeCompare(b.name);
            });
    }, [companiesWithStatus, searchTerm, onlyPending, policies]);

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-left-4 duration-500 pb-20">
            <div className="flex justify-between items-center px-2">
                <div>
                    <h2 className="text-4xl font-black text-white tracking-tight uppercase italic flex items-center gap-4">
                        <Building2 className="text-indigo-500" size={36} />
                        Directorio de Compañías
                    </h2>
                    <p className="text-zinc-500 text-sm font-medium mt-1">Sincronizado con historial de {new Date().toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}.</p>
                </div>
                <div className="flex gap-4">
                    <button
                        onClick={handleSync}
                        className="bg-zinc-800 hover:bg-zinc-700 text-white font-black px-6 py-4 rounded-2xl transition-all flex items-center gap-3 border border-zinc-700 active:scale-95 uppercase tracking-widest text-xs"
                    >
                        <ShieldCheck size={18} className="text-indigo-400" />
                        SINCRONIZAR CUITS
                    </button>
                    <button
                        onClick={() => setIsAdding(!isAdding)}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white font-black px-6 py-4 rounded-2xl transition-all flex items-center gap-3 shadow-[0_10px_30px_rgba(79,70,229,0.3)] active:scale-95 uppercase tracking-widest text-xs"
                    >
                        <UserPlus size={18} />
                        {isAdding ? 'CANCELAR' : 'NUEVA'}
                    </button>
                </div>
            </div>

            {/* Barra de Búsqueda y Filtros Premium */}
            <div className="flex flex-col md:flex-row gap-6 items-center">
                <div className="relative group flex-1 w-full">
                    <div className="absolute inset-y-0 left-6 flex items-center pointer-events-none">
                        <Search className="text-zinc-500 group-focus-within:text-indigo-400 transition-colors" size={20} />
                    </div>
                    <input
                        type="text"
                        placeholder="BUSCAR POR NOMBRE O CUIT..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full bg-white/[0.02] border border-white/5 backdrop-blur-3xl rounded-2xl py-5 pl-16 pr-6 outline-none focus:border-indigo-500/50 transition-all text-white font-bold tracking-widest text-xs"
                    />
                </div>

                <button
                    onClick={() => setOnlyPending(!onlyPending)}
                    className={`flex items-center gap-3 px-8 py-5 rounded-2xl font-black text-xs tracking-widest uppercase transition-all border ${onlyPending
                        ? 'bg-rose-500/20 border-rose-500/40 text-rose-400 shadow-[0_0_20px_rgba(244,63,94,0.2)]'
                        : 'bg-white/[0.02] border-white/5 text-zinc-500 hover:text-white hover:border-white/10'
                        }`}
                >
                    <div className={`w-2 h-2 rounded-full ${onlyPending ? 'bg-rose-500 animate-pulse' : 'bg-zinc-700'}`} />
                    SOLO PENDIENTES
                </button>
            </div>

            {isAdding && (
                <div className="bg-white/[0.03] backdrop-blur-3xl border border-white/10 rounded-[2.5rem] p-10 animate-in zoom-in-95 duration-200">
                    <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-3 gap-8 items-end">
                        <div className="space-y-3">
                            <label className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] ml-1">Nombre Comercial</label>
                            <input
                                type="text"
                                required
                                value={newComp.name}
                                onChange={(e) => setNewComp({ ...newComp, name: e.target.value })}
                                className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-4 px-5 outline-none focus:border-indigo-500/50 transition-all text-white font-bold"
                                placeholder="SMG SEGUROS..."
                            />
                        </div>
                        <div className="space-y-3">
                            <label className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] ml-1">CUIT</label>
                            <input
                                type="text"
                                required
                                value={newComp.cuit}
                                onChange={(e) => setNewComp({ ...newComp, cuit: e.target.value })}
                                className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-4 px-5 outline-none focus:border-indigo-500/50 transition-all text-white font-bold font-mono"
                                placeholder="30-..."
                            />
                        </div>
                        <div className="space-y-3">
                            <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">IVA</label>
                            <select
                                value={newComp.ivaType}
                                onChange={(e) => setNewComp({ ...newComp, ivaType: e.target.value })}
                                className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-4 px-5 outline-none focus:border-indigo-500/50 transition-all text-white font-bold appearance-none cursor-pointer"
                            >
                                <option>Responsable Inscripto</option>
                                <option>Exento</option>
                                <option>Monotributista</option>
                            </select>
                        </div>
                        <button type="submit" className="md:col-span-3 bg-white text-black font-black py-5 rounded-2xl hover:bg-zinc-200 transition-all shadow-xl uppercase tracking-widest">
                            GUARDAR REGISTRO
                        </button>
                    </form>
                </div>
            )}

            {/* View: List Mode Intelligent Table */}
            <div className="bg-[#121214] border border-white/5 rounded-[2.5rem] overflow-hidden shadow-2xl backdrop-blur-3xl">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <th className="p-8 text-[11px] font-black text-zinc-500 uppercase tracking-[0.2em] pl-12 min-w-[300px]">Compañía / Estado</th>
                            <th className="p-6 text-[11px] font-black text-zinc-500 uppercase tracking-[0.2em] min-w-[200px]">Identificación</th>
                            <th className="p-6 text-[11px] font-black text-zinc-500 uppercase tracking-[0.2em] min-w-[250px]">Actividad {new Date().toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}</th>
                            <th className="p-6 text-[11px] font-black text-zinc-500 uppercase tracking-[0.2em] text-right min-w-[180px]">Total Liquidado</th>
                            <th className="p-6 text-[11px] font-black text-zinc-500 uppercase tracking-[0.2em] text-center pr-12 min-w-[150px]">Gestión</th>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {filteredCompanies.map((comp) => {
                                const isIncorrect = comp.cuit === '23294824979';
                                const isEditing = editingId === comp.id;
                                const { lastInvoice, invoiceThisMonth } = comp;

                                return (
                                    <tr
                                        key={comp.id}
                                        className={`transition-all duration-300 group ${comp.isLoaded
                                            ? 'bg-emerald-500/[0.04] hover:bg-emerald-500/[0.08]'
                                            : 'bg-rose-500/[0.03] hover:bg-rose-500/[0.06]'
                                            }`}
                                    >
                                        <td className="p-6 pl-10">
                                            <div className="flex items-center gap-5">
                                                <div
                                                    className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all border shadow-lg ${comp.isLoaded
                                                        ? 'bg-emerald-500 border-emerald-400 text-black shadow-emerald-500/20'
                                                        : 'bg-rose-500/10 border-rose-500/30 text-rose-500 shadow-rose-500/10 animate-pulse'
                                                        }`}
                                                >
                                                    {comp.isLoaded ? <CheckCircle2 size={24} strokeWidth={3} /> : <div className="font-black text-lg">!</div>}
                                                </div>
                                                <div className="flex flex-col gap-0.5">
                                                    {isEditing ? (
                                                        <input
                                                            type="text"
                                                            value={editForm.name}
                                                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                                            className="bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1 text-white font-black uppercase text-xs outline-none focus:border-indigo-500"
                                                        />
                                                    ) : (
                                                        <span className={`font-black uppercase tracking-tight text-base ${comp.isLoaded ? 'text-emerald-400' : 'text-zinc-100'}`}>
                                                            {comp.name}
                                                        </span>
                                                    )}
                                                    <div className="flex items-center gap-2">
                                                        <span className={`text-[9px] font-black tracking-[0.2em] uppercase ${comp.isLoaded ? 'text-emerald-500/70' : 'text-rose-500'}`}>
                                                            {comp.isLoaded ? 'FACTURADO' : 'PENDIENTE DE CARGA'}
                                                        </span>
                                                        {isIncorrect && (
                                                            <span className="text-[9px] font-black text-amber-500 uppercase tracking-widest bg-amber-500/10 px-1.5 rounded-sm border border-amber-500/20">
                                                                CUIT ERRÓNEO
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-6">
                                            <div className="flex flex-col gap-0.5">
                                                {isEditing ? (
                                                    <input
                                                        type="text"
                                                        value={editForm.cuit}
                                                        onChange={(e) => setEditForm({ ...editForm, cuit: e.target.value })}
                                                        className="bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1 text-white font-mono text-xs outline-none focus:border-indigo-500"
                                                    />
                                                ) : (
                                                    <span className={`font-mono text-sm tracking-tight ${isIncorrect ? 'text-amber-500 font-black' : 'text-zinc-300'}`}>
                                                        {comp.cuit}
                                                    </span>
                                                )}
                                                <span className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest truncate max-w-[150px]">
                                                    {comp.ivaType}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="p-6">
                                            <div className="flex flex-col">
                                                <span className={`font-black text-sm tabular-nums ${comp.isLoaded ? 'text-zinc-200' : 'text-rose-500 animate-pulse'}`}>
                                                    {comp.isLoaded ? 'COMPLETADO' : 'PENDIENTE'}
                                                </span>
                                                <span className="text-[9px] text-zinc-600 font-black uppercase tracking-widest italic mt-0.5">
                                                    {comp.isLoaded ? `FC: ${comp.invoiceNumbers}` : new Date().toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }).toUpperCase()}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="p-6 text-right tabular-nums">
                                            {comp.isLoaded ? (
                                                <div className="flex flex-col items-end">
                                                    <span className="text-emerald-400 font-black text-sm">$ {Number(comp.totalAmount).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
                                                    <span className="text-[8px] text-zinc-700 font-black uppercase tracking-widest">
                                                        {comp.invoiceCount} {comp.invoiceCount === 1 ? 'Factura' : 'Facturas'} • Comisión Neta
                                                    </span>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col items-end">
                                                    <span className="text-rose-500 font-black text-sm uppercase tracking-tighter animate-pulse">Sin Registrar</span>
                                                    <p className="text-[7px] text-zinc-600 font-bold uppercase tracking-widest">Este Mes</p>
                                                </div>
                                            )}
                                        </td>
                                        <td className="p-6 pr-10 text-right">
                                            <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all translate-x-2 group-hover:translate-x-0">
                                                {isEditing ? (
                                                    <>
                                                        <button onClick={() => handleSaveEdit(comp.id)} className="px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-500 transition-all font-black text-[10px] uppercase tracking-widest shadow-lg">OK</button>
                                                        <button onClick={() => setEditingId(null)} className="px-4 py-2 bg-zinc-800 text-zinc-400 rounded-xl hover:bg-zinc-700 transition-all font-black text-[10px] uppercase tracking-widest">X</button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <button onClick={() => handleEdit(comp)} className="p-3 text-zinc-500 hover:text-white bg-zinc-900 border border-zinc-800 rounded-xl transition-all shadow-xl hover:border-indigo-500/50">
                                                            <Edit2 size={16} />
                                                        </button>
                                                        <button onClick={() => handleDelete(comp.id)} className="p-3 text-zinc-500 hover:text-rose-500 bg-zinc-900 border border-zinc-800 rounded-xl transition-all shadow-xl hover:border-rose-500/50">
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                {filteredCompanies.length === 0 && (
                    <div className="p-20 text-center">
                        <Building2 size={80} className="mx-auto text-zinc-800 mb-6 opacity-20" />
                        <h3 className="text-zinc-600 font-black uppercase tracking-widest text-xl">No se encontraron compañías</h3>
                        <p className="text-zinc-700 text-xs mt-2 uppercase font-bold">Intenta con otro término de búsqueda</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default CompanyManager;
