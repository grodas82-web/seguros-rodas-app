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
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    // Auto-CUIT Lookup
    useEffect(() => {
        const found = companies.find(c => (c.name || '').toLowerCase() === (formData.company || '').toLowerCase());
        if (found) {
            setFormData(prev => ({ ...prev, cuit: found.cuit }));
        }
    }, [formData.company, companies]);

    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setIsAnalyzing(true);
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const base64 = event.target.result;
                const result = await analyzeInvoice(base64);

                // Map Gemini results to form
                setFormData(prev => ({
                    ...prev,
                    ...result,
                    type: 'Factura C', // Forzar Factura C
                    pointOfSale: result.pointOfSale?.toString().padStart(5, '0') || prev.pointOfSale,
                    number: result.number?.toString().padStart(8, '0') || prev.number
                }));
            } catch {
                alert("No se pudo analizar la factura. Por favor, ingresa los datos a mano.");
            } finally {
                setIsAnalyzing(false);
            }
        };
        reader.readAsDataURL(file);
    };

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
                {/* AI Loading Overlay */}
                {isAnalyzing && (
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-md z-20 flex flex-col items-center justify-center text-center p-8">
                        <div className="w-16 h-16 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-6"></div>
                        <h4 className="text-xl font-black text-white italic flex items-center gap-2">
                            <Sparkles className="text-indigo-400 animate-pulse" />
                            GEMINI ESTÁ LEYENDO...
                        </h4>
                        <p className="text-zinc-400 text-sm mt-2 max-w-xs">Analizando imagen para extraer datos automáticamente.</p>
                    </div>
                )}

                <div className="flex justify-between items-start mb-8">
                    <h3 className="text-2xl font-black text-white flex items-center gap-3">
                        <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-lg">
                            <PlusCircle size={24} />
                        </div>
                        Nueva Factura
                    </h3>

                    {/* Botón de IA */}
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileUpload}
                        className="hidden"
                        accept="image/*,application/pdf"
                    />
                    <button
                        onClick={() => fileInputRef.current.click()}
                        className="bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 border border-indigo-600/20 rounded-2xl px-5 py-2.5 transition-all flex items-center gap-2 text-xs font-black uppercase tracking-widest group"
                    >
                        <Upload size={16} className="group-hover:-translate-y-1 transition-transform" />
                        Subir Factura (IA)
                        <Sparkles size={14} className="ml-1" />
                    </button>
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
