import React, { useState, useEffect, useRef } from 'react';
import { useAppContext } from '../context/AppContext';
import { Save, RefreshCcw, Landmark, CreditCard, Hash, DollarSign, Calendar, PlusCircle, Upload, Sparkles } from 'lucide-react';
import { analyzeInvoice } from '../services/aiManager';

const InvoiceEntry = ({ onFinish }) => {
    const { companies, addInvoice } = useAppContext();
    const fileInputRef = useRef(null);
    const [formData, setFormData] = useState({
        company: '',
        cuit: '',
        type: 'Factura C',
        pointOfSale: '',
        number: '',
        amount: '',
        date: new Date().toISOString().split('T')[0]
    });
    const [isSaving, setIsSaving] = useState(false);

    // Auto-CUIT Lookup
    useEffect(() => {
        const found = companies.find(c => (c.name || '').toLowerCase() === (formData.company || '').toLowerCase());
        if (found) {
            setFormData(prev => ({ ...prev, cuit: found.cuit }));
        }
    }, [formData.company, companies]);


    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSaving(true);
        try {
            await addInvoice(formData);
            alert('Factura grabada con éxito');
            if (onFinish) onFinish();
        } catch (error) {
            console.error(error);
            alert('Error al grabar factura');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="max-w-2xl mx-auto animate-in slide-in-from-bottom duration-500">
            <div className="bg-[#18181b] border border-zinc-800 rounded-3xl p-10 shadow-2xl relative overflow-hidden">

                <div className="flex justify-between items-start mb-8">
                    <h3 className="text-2xl font-black text-white flex items-center gap-3">
                        <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-lg">
                            <PlusCircle size={24} />
                        </div>
                        Nueva Factura
                    </h3>
                </div>

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
                                placeholder="0001"
                            />
                        </div>

                        {/* Numero FC */}
                        <div className="space-y-2">
                            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest ml-1">Número</label>
                            <input
                                type="text"
                                required
                                value={formData.number}
                                onChange={(e) => setFormData({ ...formData, number: e.target.value })}
                                className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-3 px-4 outline-none focus:border-indigo-500/50 transition-all text-white font-semibold"
                                placeholder="8 dígitos"
                            />
                        </div>

                        {/* Monto */}
                        <div className="space-y-2">
                            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest ml-1">Monto Total</label>
                            <div className="relative">
                                <DollarSign className="absolute left-4 top-3.5 text-emerald-500" size={18} />
                                <input
                                    type="number"
                                    required
                                    step="0.01"
                                    value={formData.amount}
                                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                                    className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-3 pl-12 pr-4 outline-none focus:border-emerald-500/50 transition-all text-white font-bold"
                                    placeholder="0.00"
                                />
                            </div>
                        </div>

                        {/* Fecha */}
                        <div className="space-y-2 md:col-span-2">
                            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest ml-1">Fecha Emisión</label>
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
                    </div>

                    <button
                        type="submit"
                        disabled={isSaving}
                        className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-black py-4 rounded-2xl transition-all shadow-xl shadow-indigo-500/20 flex items-center justify-center gap-3 disabled:opacity-50 mt-4 active:scale-95"
                    >
                        {isSaving ? <RefreshCcw className="animate-spin" size={20} /> : <Save size={20} />}
                        {isSaving ? 'GRABANDO...' : 'GRABAR FACTURA'}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default InvoiceEntry;
