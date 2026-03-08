import React, { useMemo } from 'react';
import { AlertCircle, CheckCircle2, Search, Download, FileWarning, ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { motion } from 'framer-motion';

import GAPS_DATA from '../data/sequence_gaps.json';
import ALL_FILES_RAW from '../data/all_found_invoices.csv?raw';

const SequenceGapList = () => {
    // Parsear el CSV de archivos encontrados
    const foundFilesMap = useMemo(() => {
        const map = new Map();
        try {
            const lines = ALL_FILES_RAW.split('\n').slice(1);
            lines.forEach(line => {
                const parts = line.split(',');
                if (parts.length >= 3) {
                    const fullName = parts[0].replace(/"/g, '');
                    const name = parts[1].replace(/"/g, '');
                    const nameParts = name.split('_');
                    if (nameParts.length >= 4) {
                        const pos = nameParts[2].padStart(5, '0');
                        const num = nameParts[3].replace('.pdf', '').split(' ')[0].padStart(8, '0');
                        map.set(`${pos}|${num}`, fullName);
                    }
                }
            });
        } catch (e) {
            console.error("Error parsing CSV:", e);
        }
        return map;
    }, []);

    const displayData = useMemo(() => {
        return GAPS_DATA.map(item => ({
            ...item,
            availableFiles: item.gaps.filter(gap => foundFilesMap.has(`${item.pos}|${gap}`)).length,
            nextGaps: item.gaps.slice(0, 10).map(gap => ({
                num: gap,
                isFound: foundFilesMap.has(`${item.pos}|${gap}`),
                path: foundFilesMap.get(`${item.pos}|${gap}`)
            }))
        }));
    }, [foundFilesMap]);

    return (
        <div className="space-y-8 max-w-6xl mx-auto pb-20">
            <header className="flex flex-col gap-3">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-amber-500/20 text-amber-500 rounded-2xl shadow-lg shadow-amber-500/5">
                        <Search size={28} />
                    </div>
                    <div>
                        <h2 className="text-3xl font-black text-white uppercase tracking-tighter">Recuperación de Secuencia</h2>
                        <p className="text-zinc-500 text-sm font-medium uppercase tracking-widest flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                            Búsqueda Global de Archivos PDF
                        </p>
                    </div>
                </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {displayData.map((item) => (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        key={item.pos}
                        className="bg-white/[0.03] border border-white/5 backdrop-blur-3xl rounded-[2.5rem] p-8 shadow-2xl relative overflow-hidden group hover:scale-[1.02] transition-all duration-700"
                    >
                        <div className="relative z-10">
                            <div className="flex justify-between items-start mb-10">
                                <div>
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 block mb-2">Punto de Venta</span>
                                    <h3 className="text-5xl font-black text-white italic tracking-tighter">{item.pos}</h3>
                                </div>
                                <div className={`px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-[0.15em] shadow-lg transition-all duration-500 ${item.gapsCount > 0
                                    ? 'bg-amber-500 text-white shadow-amber-500/20'
                                    : 'bg-emerald-500 text-white shadow-emerald-500/20'}`}>
                                    {item.gapsCount > 0 ? `${item.gapsCount} Brechas` : 'Secuencia OK'}
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-6 mb-12">
                                <div className="bg-white/[0.02] p-5 rounded-3xl border border-white/5 text-center group-hover:bg-white/[0.05] transition-colors">
                                    <p className="text-[9px] font-black text-zinc-600 uppercase mb-2 tracking-widest">Inicia en</p>
                                    <p className="text-sm font-black text-zinc-100 tabular-nums">#{item.min}</p>
                                </div>
                                <div className="bg-white/[0.02] p-5 rounded-3xl border border-white/5 text-center group-hover:bg-white/[0.05] transition-colors">
                                    <p className="text-[9px] font-black text-zinc-600 uppercase mb-2 tracking-widest">Finaliza en</p>
                                    <p className="text-sm font-black text-zinc-100 tabular-nums">#{item.max}</p>
                                </div>
                                <div className="bg-white/[0.02] p-5 rounded-3xl border border-white/5 text-center group-hover:bg-white/[0.05] transition-colors">
                                    <p className="text-[9px] font-black text-zinc-600 uppercase mb-2 tracking-widest">Detectadas</p>
                                    <p className="text-sm font-black text-white tabular-nums">{item.totalFound}</p>
                                </div>
                            </div>

                            <div className="space-y-6">
                                <div className="flex justify-between items-center px-1">
                                    <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] flex items-center gap-2">
                                        <FileWarning size={14} className="text-amber-500" />
                                        Próximas brechas
                                    </h4>
                                    {item.availableFiles > 0 && (
                                        <span className="text-[9px] font-black text-emerald-400 uppercase bg-emerald-400/10 px-2 py-0.5 rounded-full">
                                            {item.availableFiles} recuperables
                                        </span>
                                    )}
                                </div>
                                <div className="flex flex-wrap gap-2.5">
                                    {item.nextGaps.map(gap => (
                                        <div
                                            key={gap.num}
                                            title={gap.isFound ? `Archivo encontrado en disk` : 'No se encontró archivo físico'}
                                            className={`px-3.5 py-2 border rounded-xl text-[10px] font-black transition-all duration-500 ${gap.isFound
                                                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.05)]'
                                                : 'bg-zinc-800/30 border-white/5 text-zinc-600'
                                                }`}
                                        >
                                            #{gap.num}
                                        </div>
                                    ))}
                                    {item.gapsCount > 10 && (
                                        <div className="px-3.5 py-2 bg-zinc-900/10 border border-dashed border-zinc-800 rounded-xl text-[10px] font-black text-zinc-700 italic">
                                            + {item.gapsCount - 10}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Progress Bar and Summary */}
                        <div className="mt-12 flex flex-col gap-4 relative z-10">
                            <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest px-1">
                                <span className="text-zinc-500">Integridad de Serie</span>
                                <span className="text-white">{Math.round((item.totalFound / (parseInt(item.max) || 1)) * 100)}%</span>
                            </div>
                            <div className="h-2 bg-zinc-900/50 rounded-full overflow-hidden relative border border-white/5">
                                <motion.div
                                    initial={{ width: 0 }}
                                    whileInView={{ width: `${(item.totalFound / (parseInt(item.max) || 1)) * 100}%` }}
                                    transition={{ duration: 1.5, ease: "easeOut" }}
                                    className={`absolute top-0 left-0 h-full shadow-[0_0_15px_rgba(245,158,11,0.2)] ${item.gapsCount > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                />
                            </div>
                        </div>

                        <div className={`absolute -right-16 -bottom-16 w-64 h-64 blur-[100px] rounded-full transition-all duration-1000 opacity-20 group-hover:opacity-40 ${item.gapsCount > 0 ? 'bg-amber-500/20' : 'bg-emerald-500/20'}`} />
                    </motion.div>
                ))}
            </div>

            <div className="bg-gradient-to-r from-indigo-600/20 to-purple-600/20 border border-indigo-500/20 rounded-[2.5rem] p-10 flex flex-col md:flex-row items-center justify-between gap-8 backdrop-blur-3xl relative overflow-hidden group">
                <div className="flex items-center gap-8 text-center md:text-left relative z-10">
                    <div className="w-20 h-20 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400 shadow-2xl group-hover:scale-110 transition-transform duration-700">
                        <Download size={36} />
                    </div>
                    <div>
                        <h4 className="font-black text-white uppercase text-lg tracking-widest mb-2">Procesamiento Automatizado</h4>
                        <p className="text-zinc-500 text-sm font-medium">Ejecuta el script de recuperación masiva para rellenar las brechas detectadas.</p>
                    </div>
                </div>
                <button
                    onClick={() => alert('Para procesar masivamente, por favor ejecute: node scripts/recover_to_test.mjs')}
                    className="px-10 py-5 bg-indigo-500 hover:bg-indigo-400 text-white rounded-[2rem] font-black text-xs uppercase tracking-[0.2em] transition-all shadow-2xl shadow-indigo-500/40 relative z-10 hover:translate-y-[-2px] active:scale-95 duration-300"
                >
                    Iniciar Recuperación AI
                </button>
                <div className="absolute top-0 right-0 p-10 opacity-5 group-hover:opacity-10 transition-opacity">
                    <Sparkles size={120} className="text-white" />
                </div>
            </div>
        </div>
    );
};

const Sparkles = ({ size, className }) => (
    <div className={className}>
        <Search size={size} />
    </div>
);

export default SequenceGapList;
