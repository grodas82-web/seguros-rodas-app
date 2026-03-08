import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, FileText, Building2, X, Command, ArrowRight, Users } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppContext } from '../context/AppContext';

const GlobalSearch = ({ isOpen, onClose, onSelect }) => {
    const { invoices, companies, policies = [] } = useAppContext();
    const [query, setQuery] = useState('');
    const inputRef = useRef(null);

    useEffect(() => {
        if (isOpen) {
            setTimeout(() => inputRef.current?.focus(), 100);
            const handleEsc = (e) => {
                if (e.key === 'Escape') onClose();
                if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    onClose();
                }
            };
            window.addEventListener('keydown', handleEsc);
            return () => window.removeEventListener('keydown', handleEsc);
        }
    }, [isOpen, onClose]);

    const results = useMemo(() => {
        if (!query) return { invoices: [], companies: [], policies: [] };

        const q = query.toLowerCase();
        const filteredInvoices = invoices.filter(inv =>
            (inv.company || '').toLowerCase().includes(q) ||
            (inv.number || '').includes(q)
        ).slice(0, 5);

        const filteredCompanies = companies.filter(c => {
            const hasQuery = (c.name || '').toLowerCase().includes(q) || (c.cuit && c.cuit.includes(q));
            if (hasQuery) return true;

            // Check if any client belonging to this company matches the query
            return policies.some(p =>
                (p.company || '').toLowerCase() === (c.name || '').toLowerCase() &&
                ((p.clientName || '').toLowerCase().includes(q) || (p.dni || '').toString().includes(q))
            );
        }).slice(0, 3);

        const filteredPolicies = policies.filter(p =>
            (p.clientName || '').toLowerCase().includes(q) ||
            (p.company || '').toLowerCase().includes(q) ||
            (p.dni || '').toString().includes(q) ||
            (p.policyNumber || '').toString().includes(q)
        ).slice(0, 5);

        return {
            invoices: filteredInvoices,
            companies: filteredCompanies,
            policies: filteredPolicies
        };
    }, [query, invoices, companies, policies]);

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4 backdrop-blur-sm bg-black/40"
                onClick={onClose}
            >
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: -20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -20 }}
                    className="w-full max-w-2xl bg-[#121214] border border-white/10 rounded-[2rem] shadow-2xl shadow-black overflow-hidden"
                    onClick={e => e.stopPropagation()}
                >
                    <div className="p-6 border-b border-white/5 flex items-center gap-4 bg-white/[0.02]">
                        <Search size={20} className="text-indigo-400" />
                        <input
                            ref={inputRef}
                            type="text"
                            placeholder="Busca por empresa, CUIT o número de factura..."
                            className="bg-transparent border-none outline-none text-white w-full text-lg font-medium placeholder:text-zinc-600"
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                        />
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono text-zinc-500 bg-zinc-800 px-2 py-1 rounded border border-white/5 uppercase">Esc</span>
                            <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-xl transition-colors text-zinc-500 hover:text-white">
                                <X size={20} />
                            </button>
                        </div>
                    </div>

                    <div className="max-h-[60vh] overflow-y-auto p-4 scrollbar-none">
                        {!query && (
                            <div className="p-10 text-center space-y-4">
                                <Command size={40} className="mx-auto text-zinc-800" />
                                <p className="text-zinc-500 text-sm font-medium">Escribe algo para empezar a buscar...</p>
                                <div className="flex justify-center gap-4 text-[10px] uppercase font-black tracking-widest text-zinc-600">
                                    <span className="flex items-center gap-1"><ArrowRight size={10} /> Facturas</span>
                                    <span className="flex items-center gap-1"><ArrowRight size={10} /> Clientes</span>
                                    <span className="flex items-center gap-1"><ArrowRight size={10} /> CUITs</span>
                                </div>
                            </div>
                        )}

                        {query && results.invoices.length === 0 && results.companies.length === 0 && results.policies.length === 0 && (
                            <div className="p-10 text-center text-zinc-500 text-sm">
                                No se encontraron resultados para "{query}"
                            </div>
                        )}

                        {results.policies.length > 0 && (
                            <div className="mb-6">
                                <h4 className="px-4 text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-3">Pólizas / Clientes</h4>
                                <div className="space-y-1">
                                    {results.policies.map(p => (
                                        <button
                                            key={p.id}
                                            onClick={() => onSelect('clientes', p.id, query)}
                                            className="w-full flex items-center justify-between p-4 rounded-2xl hover:bg-white/5 transition-all group"
                                        >
                                            <div className="flex items-center gap-4">
                                                <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center group-hover:scale-110 transition-transform">
                                                    <Users size={20} />
                                                </div>
                                                <div className="text-left">
                                                    <p className="font-bold text-zinc-100 uppercase text-xs">{p.clientName}</p>
                                                    <p className="text-[10px] text-zinc-500 font-bold tracking-widest uppercase">
                                                        {p.company} • {p.riskType}
                                                        {p.policyNumber && ` • #${p.policyNumber}`}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex flex-col items-end">
                                                {p.dni && <p className="text-[9px] font-black text-zinc-600 uppercase tracking-tighter mb-1">DNI: {p.dni}</p>}
                                                <ArrowRight size={16} className="text-zinc-700 group-hover:text-indigo-400 group-hover:translate-x-1 transition-all" />
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {results.companies.length > 0 && (
                            <div className="mb-6">
                                <h4 className="px-4 text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-3">Compañías</h4>
                                <div className="space-y-1">
                                    {results.companies.map(c => (
                                        <button
                                            key={c.id}
                                            onClick={() => onSelect('companies', c.id, query)}
                                            className="w-full flex items-center justify-between p-4 rounded-2xl hover:bg-white/5 transition-all group"
                                        >
                                            <div className="flex items-center gap-4">
                                                <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center group-hover:scale-110 transition-transform">
                                                    <Building2 size={20} />
                                                </div>
                                                <div className="text-left">
                                                    <p className="font-bold text-zinc-100 uppercase text-xs">{c.name}</p>
                                                    <p className="text-[10px] text-zinc-500 font-bold tracking-widest uppercase">CUIT: {c.cuit || 'S/D'}</p>
                                                </div>
                                            </div>
                                            <ArrowRight size={16} className="text-zinc-700 group-hover:text-indigo-400 group-hover:translate-x-1 transition-all" />
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {results.invoices.length > 0 && (
                            <div>
                                <h4 className="px-4 text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-3">Facturas</h4>
                                <div className="space-y-1">
                                    {results.invoices.map(inv => (
                                        <button
                                            key={inv.id}
                                            onClick={() => onSelect('history', inv.id, query)}
                                            className="w-full flex items-center justify-between p-4 rounded-2xl hover:bg-white/5 transition-all group"
                                        >
                                            <div className="flex items-center gap-4">
                                                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center group-hover:scale-110 transition-transform">
                                                    <FileText size={20} />
                                                </div>
                                                <div className="text-left">
                                                    <p className="font-bold text-zinc-100 uppercase text-xs line-clamp-1">{inv.company}</p>
                                                    <p className="text-[10px] text-zinc-500 font-bold tracking-widest uppercase">#{inv.number} • ${Number(inv.amount).toLocaleString()}</p>
                                                </div>
                                            </div>
                                            <div className="flex flex-col items-end">
                                                <p className="text-[9px] font-black text-zinc-600 uppercase tracking-tighter mb-1">{inv.date}</p>
                                                <ArrowRight size={16} className="text-zinc-700 group-hover:text-indigo-400 group-hover:translate-x-1 transition-all" />
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="p-4 bg-white/[0.01] border-t border-white/5 flex items-center justify-between text-[10px] font-black text-zinc-600 uppercase tracking-widest px-8">
                        <div className="flex gap-6">
                            <span className="flex items-center gap-2"><div className="w-1 h-1 rounded-full bg-indigo-500" /> Seleccionar</span>
                            <span className="flex items-center gap-2"><div className="w-1 h-1 rounded-full bg-zinc-600" /> Navegar</span>
                        </div>
                        <div className="flex items-center gap-2">
                            Antigravity <span className="text-indigo-500/50">Search Engine</span>
                        </div>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};

export default GlobalSearch;
