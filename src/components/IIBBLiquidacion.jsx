import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    CheckSquare, Square, Upload, FileText, Download, AlertTriangle,
    CheckCircle, XCircle, Trash2, Edit3, Save, X, RefreshCw, Calculator, Sparkles
} from 'lucide-react';
import { analyzeIIBBCertificate } from '../services/aiManager';
import { useAppContext } from '../context/AppContext';
import { db } from '../firebase/config';
import { collection, addDoc, onSnapshot, orderBy, query, deleteDoc, doc, updateDoc, writeBatch, serverTimestamp } from 'firebase/firestore';

// ─────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────

// Lista fija de compañías conocidas (se agregan dinámicamente al sumar retenciones/pólizas)
const COMPANIES = [
    'ALLIANZ', 'AMCA', 'ASOCIART', 'BARBUSS', 'BERKLEY ART',
    'EXPERTA ART', 'EXPERTA SEGUROS', 'FEDERACION PATRONAL', 'GALICIA SEGUROS',
    'MERCANTIL ANDINA', 'MERIDIONAL', 'PROVINCIA ART', 'SMG ART', 'SMG SEGUROS', 'ZURICH'
];

// Mapeo de nombres devueltos por Gemini → clave exacta en COMPANIES
const COMPANY_MAP = {
    'ALLIANZ': 'ALLIANZ',
    'ALLIANZ ARGENTINA': 'ALLIANZ',
    'AMCA': 'AMCA',
    'ASOCIACION MUTUAL CONDUCTORES AUTOMOTORES': 'AMCA',
    'EXPERTA ART': 'EXPERTA ART',
    'EXPERTA SEGUROS': 'EXPERTA SEGUROS',
    'BARBUSS': 'BARBUSS',
    'BARBUSS RISK': 'BARBUSS',
    'BARBUSS RISK SA': 'BARBUSS',
    'HDI': 'BARBUSS',                        // HDI ahora es BARBUSS
    'FEDERACION PATRONAL': 'FEDERACION PATRONAL',
    'PATRONAL': 'FEDERACION PATRONAL',
    'GALICIA SEGUROS': 'GALICIA SEGUROS',
    'GALICIA': 'GALICIA SEGUROS',
    'SURA': 'GALICIA SEGUROS',               // SURA ahora es GALICIA SEGUROS
    'MERCANTIL ANDINA': 'MERCANTIL ANDINA',
    'LA MERCANTIL ANDINA': 'MERCANTIL ANDINA',
    'SMG ART': 'SMG ART',
    'SWISS MEDICAL ART': 'SMG ART',
    'SMG SEGUROS': 'SMG SEGUROS',
    'SMG CIA ARGENTINA DE SEGUROS': 'SMG SEGUROS',
    'ZURICH': 'ZURICH',
    'ZURICH ARGENTINA': 'ZURICH',
};

function mapearCompania(nombre) {
    if (!nombre) return null;
    return COMPANY_MAP[nombre.toUpperCase().trim()] || null;
}

const ALICUOTA_PROPIA = 3.5;

// ─────────────────────────────────────────────
// PARSER: PDF → base64 → Gemini AI
// ─────────────────────────────────────────────

async function parsearPDF(file) {
    // Leer el PDF como base64 y enviarlo directamente a Gemini
    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
    const base64 = `data:application/pdf;base64,${btoa(binary)}`;

    // Gemini devuelve un ARRAY de retenciones (un PDF puede tener múltiples)
    const retenciones = await analyzeIIBBCertificate(base64);

    return (retenciones || []).map(r => ({
        archivo:      file.name,
        compania:     r.compania     || '',
        cuit:         String(r.cuit  || '').replace(/\D/g, ''),
        fecha:        r.fecha        || '',
        certificado:  String(r.certificado || ''),
        jurisdiccion: String(r.jurisdiccion || '901'),
        monto:        parseFloat(r.monto)   || 0,
    }));
}

// ─────────────────────────────────────────────
// FORMATO SIFERE
// ─────────────────────────────────────────────

function formatearLineaSifere(r) {
    const juris = String(r.jurisdiccion || '901').padStart(3, '0').slice(0, 3);
    const cuit  = String(r.cuit || '00000000000').padStart(11, '0').slice(0, 11);
    const fecha = String(r.fecha || '01/01/2026').slice(0, 10);
    const cert  = String(r.certificado || '0').padStart(16, '0').slice(0, 16);
    const cents = Math.round((parseFloat(r.monto) || 0) * 100);
    const monto = String(cents).padStart(15, '0').slice(0, 15);
    return juris + cuit + fecha + cert + monto;
}

function generarSifereTxt(retenciones) {
    return retenciones.map(formatearLineaSifere).join('\n') + '\n';
}

function descargarArchivo(contenido, nombre) {
    const blob = new Blob([contenido], { type: 'text/plain;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = nombre;
    a.click();
    URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────
// COMPONENTE PRINCIPAL
// ─────────────────────────────────────────────

export default function IIBBLiquidacion() {
    const { invoices = [] } = useAppContext();
    const [tab, setTab]           = useState('checklist');
    const [checklist, setChecklist] = useState(() => {
        try {
            const saved = localStorage.getItem('iibb_checklist');
            if (saved) return JSON.parse(saved);
        } catch {}
        return Object.fromEntries(COMPANIES.map(c => [c, false]));
    });
    const [retenciones, setRetenciones] = useState([]);
    const [procesando, setProcesando]   = useState(false);
    const [progreso, setProgreso]       = useState({ total: 0, actual: 0, archivo: '' });
    const [errores, setErrores]         = useState([]);
    const [editId, setEditId]           = useState(null);
    const [editData, setEditData]       = useState({});
    const [alicuotaBanco, setAlicuotaBanco] = useState(
        () => parseFloat(localStorage.getItem('iibb_alicuota_banco') || '4.5')
    );
    const [sircrebResult, setSircrebResult] = useState(null);
    const fileInputRef = useRef(null);

    // Persistencia: retenciones en Firestore (accesibles desde el reporte de mail)
    useEffect(() => {
        const q = query(collection(db, 'iibb_retenciones'), orderBy('createdAt', 'asc'));
        const unsub = onSnapshot(q, snap => {
            setRetenciones(snap.docs.map(d => ({ ...d.data(), id: d.id })));
        });
        return () => unsub();
    }, []);

    // Checklist y alícuota en localStorage (preferencias locales)
    useEffect(() => { localStorage.setItem('iibb_checklist',      JSON.stringify(checklist));   }, [checklist]);
    useEffect(() => { localStorage.setItem('iibb_alicuota_banco', String(alicuotaBanco));       }, [alicuotaBanco]);

    // Comisiones brutas del mes en curso — suma automática desde Historial de Facturas
    const mesActual = new Date();
    const comisionesDelMes = invoices.reduce((sum, inv) => {
        if (!inv.date) return sum;
        let m, y;
        if (String(inv.date).includes('/')) {
            const parts = inv.date.split('/');
            // DD/MM/YYYY
            m = parseInt(parts[1], 10) - 1;
            y = parseInt(parts[2], 10);
        } else {
            // YYYY-MM-DD
            const d = new Date(inv.date);
            m = d.getMonth(); y = d.getFullYear();
        }
        if (m === mesActual.getMonth() && y === mesActual.getFullYear()) {
            return sum + (Number(inv.amount) || 0);
        }
        return sum;
    }, 0);
    const mesLabel = mesActual.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });

    const checklistKeys  = Object.keys(checklist);
    const totalChecked   = Object.values(checklist).filter(Boolean).length;
    const totalMonto     = retenciones.reduce((s, r) => s + (parseFloat(r.monto) || 0), 0);
    const total901       = retenciones.filter(r => r.jurisdiccion === '901').reduce((s, r) => s + (parseFloat(r.monto) || 0), 0);
    const total902       = retenciones.filter(r => r.jurisdiccion === '902').reduce((s, r) => s + (parseFloat(r.monto) || 0), 0);

    const toggleCheck = (company) => {
        setChecklist(prev => ({ ...prev, [company]: !prev[company] }));
    };

    const toggleAll = () => {
        const allChecked = totalChecked === checklistKeys.length;
        setChecklist(prev => Object.fromEntries(checklistKeys.map(c => [c, !allChecked])));
    };

    const handleDrop = useCallback(async (e) => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer?.files || e.target.files || [])
            .filter(f => f.name.toLowerCase().endsWith('.pdf'));
        if (!files.length) return;
        setProcesando(true);
        setProgreso({ total: files.length, actual: 0, archivo: '' });
        setErrores([]);
        const nuevos = [];
        const errs   = [];
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            setProgreso({ total: files.length, actual: i + 1, archivo: file.name });
            try {
                const resultados = await parsearPDF(file);
                if (resultados.length === 0) {
                    errs.push({ archivo: file.name, error: 'Gemini no encontró retenciones de IIBB en este archivo.' });
                } else {
                    nuevos.push(...resultados);
                }
            } catch (err) {
                errs.push({ archivo: file.name, error: err.message });
            }
        }
        // Guardar cada retención nueva en Firestore
        for (const r of nuevos) {
            await addDoc(collection(db, 'iibb_retenciones'), { ...r, createdAt: serverTimestamp() });
        }
        // Auto-check y auto-agregar compañías detectadas
        if (nuevos.length) {
            setChecklist(prev => {
                const next = { ...prev };
                nuevos.forEach(r => {
                    const mapped = mapearCompania(r.compania);
                    const key = mapped || r.compania?.toUpperCase().trim();
                    if (!key) return;
                    if (!(key in next)) next[key] = false; // nueva compañía → agregar sin marcar
                    if (mapped) next[key] = true;          // conocida → marcar como descargada
                });
                return next;
            });
            setTab('retenciones');
        }
        setErrores(errs);
        setProcesando(false);
        setProgreso({ total: 0, actual: 0, archivo: '' });
    }, []);

    const eliminar = (id) => deleteDoc(doc(db, 'iibb_retenciones', id));

    const iniciarEdicion = (r) => {
        setEditId(r.id);
        setEditData({ ...r });
    };

    const guardarEdicion = async () => {
        const { id, createdAt, ...data } = editData;
        await updateDoc(doc(db, 'iibb_retenciones', id), data);
        setEditId(null);
        setEditData({});
    };

    const cancelarEdicion = () => { setEditId(null); setEditData({}); };

    const calcularSircreb = () => {
        const fb = comisionesDelMes;
        if (!fb || fb <= 0) return;
        const determinado = fb * ALICUOTA_PROPIA / 100;
        const sircreb     = fb * alicuotaBanco / 100;
        const totalConSircreb = totalMonto + sircreb;
        setSircrebResult({
            facturacion: fb,
            determinado,
            sircreb,
            totalConSircreb,
            excedente: totalConSircreb > determinado ? totalConSircreb - determinado : 0,
            saldoPagar: totalConSircreb <= determinado ? determinado - totalConSircreb : 0,
            alarma: totalConSircreb > determinado,
        });
    };

    const TABS = [
        { id: 'checklist',   label: 'Checklist Mensual' },
        { id: 'retenciones', label: `Retenciones${retenciones.length ? ` (${retenciones.length})` : ''}` },
        { id: 'sifere',      label: 'SIFERE & Control' },
    ];

    return (
        <div className="space-y-6">
            {/* HEADER */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-black uppercase tracking-tighter italic" style={{ color: 'var(--text-color)' }}>
                        Liquidación IIBB
                    </h1>
                    <p className="text-[11px] font-bold uppercase tracking-widest mt-1" style={{ color: 'var(--text-secondary)' }}>
                        Ingresos Brutos · Convenio Multilateral · SIFERE WEB
                    </p>
                </div>
                {retenciones.length > 0 && (
                    <div className="flex gap-3">
                        <div className="px-4 py-2 rounded-2xl border border-[var(--border-color)] text-center">
                            <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: 'var(--text-secondary)' }}>CABA 901</p>
                            <p className="text-sm font-black text-indigo-400">$ {total901.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</p>
                        </div>
                        <div className="px-4 py-2 rounded-2xl border border-[var(--border-color)] text-center">
                            <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: 'var(--text-secondary)' }}>PBA 902</p>
                            <p className="text-sm font-black text-purple-400">$ {total902.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</p>
                        </div>
                        <div className="px-4 py-2 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-center">
                            <p className="text-[9px] font-black uppercase tracking-widest text-indigo-400">TOTAL</p>
                            <p className="text-sm font-black text-indigo-400">$ {totalMonto.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</p>
                        </div>
                    </div>
                )}
            </div>

            {/* INNER TABS */}
            <div className="flex gap-1 p-1 rounded-2xl border border-[var(--border-color)]" style={{ background: 'var(--card-bg)' }}>
                {TABS.map(t => (
                    <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        className={`flex-1 py-2.5 px-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all duration-300 ${
                            tab === t.id
                                ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                                : 'hover:bg-white/5'
                        }`}
                        style={{ color: tab === t.id ? 'white' : 'var(--text-secondary)' }}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            <AnimatePresence mode="wait">
                <motion.div
                    key={tab}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                >

                    {/* ── TAB: CHECKLIST ── */}
                    {tab === 'checklist' && (
                        <div className="rounded-2xl border border-[var(--border-color)] overflow-hidden" style={{ background: 'var(--card-bg)' }}>
                            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)]">
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--text-secondary)' }}>
                                        Descarga de certificados
                                    </p>
                                    <p className="text-xs font-bold mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                                        {totalChecked} de {checklistKeys.length} compañías descargadas
                                    </p>
                                </div>
                                <button
                                    onClick={toggleAll}
                                    className="px-4 py-2 rounded-xl border border-[var(--border-color)] text-[10px] font-black uppercase tracking-widest hover:bg-white/5 transition-all"
                                    style={{ color: 'var(--text-secondary)' }}
                                >
                                    {totalChecked === checklistKeys.length ? 'Desmarcar Todo' : 'Marcar Todo'}
                                </button>
                            </div>

                            {/* Comisiones brutas del mes — automático desde Historial */}
                            <div className="px-6 py-4 border-b border-[var(--border-color)] flex flex-col md:flex-row gap-4 items-start md:items-center">
                                <div className="flex-1">
                                    <p className="text-[9px] font-black uppercase tracking-widest mb-1" style={{ color: 'var(--text-secondary)' }}>
                                        Comisiones brutas · {mesLabel}
                                    </p>
                                    <p className="text-2xl font-black" style={{ color: comisionesDelMes > 0 ? 'var(--text-color)' : 'var(--text-secondary)' }}>
                                        $ {comisionesDelMes.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                                    </p>
                                    <p className="text-[9px] mt-1" style={{ color: 'var(--text-secondary)' }}>
                                        Suma automática de facturas del mes en curso
                                    </p>
                                </div>
                                <div>
                                    <label className="text-[9px] font-black uppercase tracking-widest block mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                                        Alícuota banco (SIRCREB)
                                    </label>
                                    <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 w-32">
                                        <input
                                            type="number"
                                            step="0.1"
                                            min="0"
                                            max="10"
                                            value={alicuotaBanco}
                                            onChange={e => { setAlicuotaBanco(parseFloat(e.target.value) || 0); setSircrebResult(null); }}
                                            className="flex-1 bg-transparent outline-none font-black text-sm text-amber-400 w-12"
                                        />
                                        <span className="font-black text-sm text-amber-400">%</span>
                                    </div>
                                </div>
                            </div>

                            {/* Barra de progreso */}
                            <div className="px-6 py-3 border-b border-[var(--border-color)]">
                                <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                                    <motion.div
                                        className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500"
                                        initial={{ width: 0 }}
                                        animate={{ width: checklistKeys.length ? `${(totalChecked / checklistKeys.length) * 100}%` : '0%' }}
                                        transition={{ duration: 0.4 }}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-0">
                                {checklistKeys.map((company, idx) => (
                                    <motion.button
                                        key={company}
                                        onClick={() => toggleCheck(company)}
                                        className={`flex items-center gap-3 px-6 py-4 text-left transition-all duration-200 border-b border-r border-[var(--border-color)] hover:bg-white/5 ${
                                            checklist[company] ? 'bg-emerald-500/5' : ''
                                        }`}
                                        whileTap={{ scale: 0.98 }}
                                    >
                                        {checklist[company]
                                            ? <CheckSquare size={18} className="text-emerald-400 flex-shrink-0" />
                                            : <Square size={18} className="flex-shrink-0" style={{ color: 'var(--text-secondary)' }} />
                                        }
                                        <span className={`text-[11px] font-black uppercase tracking-wider ${
                                            checklist[company] ? 'text-emerald-400 line-through decoration-emerald-400/40' : ''
                                        }`} style={{ color: checklist[company] ? undefined : 'var(--text-color)' }}>
                                            {company}
                                        </span>
                                    </motion.button>
                                ))}
                            </div>

                            {checklistKeys.length > 0 && totalChecked === checklistKeys.length && (
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="flex items-center gap-3 px-6 py-4 bg-emerald-500/10 border-t border-emerald-500/20"
                                >
                                    <CheckCircle size={18} className="text-emerald-400" />
                                    <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400">
                                        Todas las compañías descargadas · Pasá a la pestaña Retenciones
                                    </p>
                                </motion.div>
                            )}
                        </div>
                    )}

                    {/* ── TAB: RETENCIONES ── */}
                    {tab === 'retenciones' && (
                        <div className="space-y-4">
                            {/* Drop zone */}
                            <div
                                onDragOver={e => e.preventDefault()}
                                onDrop={handleDrop}
                                onClick={() => fileInputRef.current?.click()}
                                className="rounded-2xl border-2 border-dashed border-indigo-500/30 p-10 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-indigo-500/60 hover:bg-indigo-500/5 transition-all duration-300"
                            >
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".pdf"
                                    multiple
                                    className="hidden"
                                    onChange={handleDrop}
                                />
                                {procesando
                                    ? <Sparkles size={32} className="text-indigo-400 animate-pulse" />
                                    : <Upload size={32} className="text-indigo-400" />
                                }
                                <p className="text-[11px] font-black uppercase tracking-widest text-indigo-400">
                                    {procesando ? 'Gemini IA leyendo certificados...' : 'Arrastrá los PDFs aquí o hacé clic'}
                                </p>
                                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-secondary)' }}>
                                    {procesando
                                        ? (progreso.total > 1 ? `Archivo ${progreso.actual} de ${progreso.total}` : 'Esto puede tardar unos segundos')
                                        : 'Zurich · Mercantil · SMG · Allianz · y más'
                                    }
                                </p>
                                {procesando && (
                                    <div className="w-full max-w-xs mt-1">
                                        {progreso.total > 1 && (
                                            <p className="text-[9px] font-bold text-center mb-1.5 truncate max-w-xs" style={{ color: 'var(--text-secondary)' }}>
                                                {progreso.archivo}
                                            </p>
                                        )}
                                        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                                            <motion.div
                                                className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500"
                                                animate={{ width: progreso.total > 0 ? `${(progreso.actual / progreso.total) * 100}%` : '100%' }}
                                                transition={{ duration: 0.3 }}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Errores */}
                            {errores.length > 0 && (
                                <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 space-y-2">
                                    {errores.map((e, i) => (
                                        <div key={i} className="flex items-center gap-2">
                                            <XCircle size={14} className="text-rose-400 flex-shrink-0" />
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-rose-400">
                                                {e.archivo}: {e.error}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Tabla de retenciones */}
                            {retenciones.length > 0 && (
                                <div className="rounded-2xl border border-[var(--border-color)] overflow-hidden" style={{ background: 'var(--card-bg)' }}>
                                    <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)]">
                                        <div className="flex items-center gap-3">
                                            <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--text-secondary)' }}>
                                                {retenciones.length} certificado{retenciones.length !== 1 ? 's' : ''} acumulado{retenciones.length !== 1 ? 's' : ''}
                                            </p>
                                            <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-emerald-400">
                                                <Save size={10} />
                                                Guardado
                                            </span>
                                        </div>
                                        <button
                                            onClick={async () => {
                                                if (window.confirm('¿Iniciar nuevo período? Se borrarán todas las retenciones acumuladas.')) {
                                                    const batch = writeBatch(db);
                                                    retenciones.forEach(r => batch.delete(doc(db, 'iibb_retenciones', r.id)));
                                                    await batch.commit();
                                                }
                                            }}
                                            className="text-[10px] font-black uppercase tracking-widest text-rose-400 hover:text-rose-300 transition-colors"
                                        >
                                            Nuevo Período
                                        </button>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-[11px]">
                                            <thead>
                                                <tr className="border-b border-[var(--border-color)]">
                                                    {['Compañía', 'CUIT', 'Fecha', 'Certificado', 'Juris.', 'Monto', ''].map(h => (
                                                        <th key={h} className="px-4 py-3 text-left font-black uppercase tracking-widest text-[9px]" style={{ color: 'var(--text-secondary)' }}>
                                                            {h}
                                                        </th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {retenciones.map(r => (
                                                    <tr key={r.id} className="border-b border-[var(--border-color)] hover:bg-white/5 transition-colors">
                                                        {editId === r.id ? (
                                                            <>
                                                                <td className="px-4 py-2">
                                                                    <input value={editData.compania} onChange={e => setEditData(p => ({ ...p, compania: e.target.value }))}
                                                                        className="w-full bg-white/10 rounded-lg px-2 py-1 text-[11px] font-bold border border-indigo-500/40 outline-none" style={{ color: 'var(--text-color)' }} />
                                                                </td>
                                                                <td className="px-4 py-2">
                                                                    <input value={editData.cuit} onChange={e => setEditData(p => ({ ...p, cuit: e.target.value }))}
                                                                        className="w-24 bg-white/10 rounded-lg px-2 py-1 text-[11px] font-bold border border-indigo-500/40 outline-none" style={{ color: 'var(--text-color)' }} />
                                                                </td>
                                                                <td className="px-4 py-2">
                                                                    <input value={editData.fecha} onChange={e => setEditData(p => ({ ...p, fecha: e.target.value }))}
                                                                        placeholder="DD/MM/AAAA"
                                                                        className="w-28 bg-white/10 rounded-lg px-2 py-1 text-[11px] font-bold border border-indigo-500/40 outline-none" style={{ color: 'var(--text-color)' }} />
                                                                </td>
                                                                <td className="px-4 py-2">
                                                                    <input value={editData.certificado} onChange={e => setEditData(p => ({ ...p, certificado: e.target.value }))}
                                                                        className="w-32 bg-white/10 rounded-lg px-2 py-1 text-[11px] font-bold border border-indigo-500/40 outline-none" style={{ color: 'var(--text-color)' }} />
                                                                </td>
                                                                <td className="px-4 py-2">
                                                                    <select value={editData.jurisdiccion} onChange={e => setEditData(p => ({ ...p, jurisdiccion: e.target.value }))}
                                                                        className="bg-white/10 rounded-lg px-2 py-1 text-[11px] font-bold border border-indigo-500/40 outline-none" style={{ color: 'var(--text-color)' }}>
                                                                        <option value="901">901 - CABA</option>
                                                                        <option value="902">902 - PBA</option>
                                                                    </select>
                                                                </td>
                                                                <td className="px-4 py-2">
                                                                    <input type="number" value={editData.monto} onChange={e => setEditData(p => ({ ...p, monto: e.target.value }))}
                                                                        className="w-28 bg-white/10 rounded-lg px-2 py-1 text-[11px] font-bold border border-indigo-500/40 outline-none" style={{ color: 'var(--text-color)' }} />
                                                                </td>
                                                                <td className="px-4 py-2">
                                                                    <div className="flex gap-1">
                                                                        <button onClick={guardarEdicion} className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors"><Save size={13} /></button>
                                                                        <button onClick={cancelarEdicion} className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors" style={{ color: 'var(--text-secondary)' }}><X size={13} /></button>
                                                                    </div>
                                                                </td>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <td className="px-4 py-3">
                                                                    <span className="font-black uppercase tracking-wide text-[10px]" style={{ color: 'var(--text-color)' }}>{r.compania}</span>
                                                                </td>
                                                                <td className="px-4 py-3 font-mono" style={{ color: r.cuit ? 'var(--text-color)' : 'var(--text-secondary)' }}>
                                                                    {r.cuit || <span className="text-rose-400">—</span>}
                                                                </td>
                                                                <td className="px-4 py-3" style={{ color: r.fecha ? 'var(--text-color)' : 'var(--text-secondary)' }}>
                                                                    {r.fecha || <span className="text-rose-400">—</span>}
                                                                </td>
                                                                <td className="px-4 py-3 font-mono text-[10px]" style={{ color: r.certificado ? 'var(--text-color)' : 'var(--text-secondary)' }}>
                                                                    {r.certificado || <span className="text-rose-400">—</span>}
                                                                </td>
                                                                <td className="px-4 py-3">
                                                                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${
                                                                        r.jurisdiccion === '901' ? 'bg-indigo-500/20 text-indigo-400' : 'bg-purple-500/20 text-purple-400'
                                                                    }`}>
                                                                        {r.jurisdiccion}
                                                                    </span>
                                                                </td>
                                                                <td className="px-4 py-3 font-black" style={{ color: r.monto > 0 ? 'var(--text-color)' : 'var(--text-secondary)' }}>
                                                                    {r.monto > 0
                                                                        ? `$ ${parseFloat(r.monto).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`
                                                                        : <span className="text-rose-400">—</span>
                                                                    }
                                                                </td>
                                                                <td className="px-4 py-3">
                                                                    <div className="flex gap-1">
                                                                        <button onClick={() => iniciarEdicion(r)} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors" style={{ color: 'var(--text-secondary)' }}><Edit3 size={13} /></button>
                                                                        <button onClick={() => eliminar(r.id)} className="p-1.5 rounded-lg hover:bg-rose-500/20 text-rose-400 transition-colors"><Trash2 size={13} /></button>
                                                                    </div>
                                                                </td>
                                                            </>
                                                        )}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── TAB: SIFERE & CONTROL ── */}
                    {tab === 'sifere' && (
                        <div className="space-y-4">
                            {/* Generar TXT */}
                            <div className="rounded-2xl border border-[var(--border-color)] overflow-hidden" style={{ background: 'var(--card-bg)' }}>
                                <div className="px-6 py-4 border-b border-[var(--border-color)]">
                                    <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--text-secondary)' }}>Generar Archivo SIFERE</p>
                                </div>
                                <div className="p-6">
                                    {retenciones.length === 0 ? (
                                        <div className="text-center py-8">
                                            <FileText size={32} className="mx-auto mb-3" style={{ color: 'var(--text-secondary)' }} />
                                            <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--text-secondary)' }}>
                                                Primero procesá los PDFs en la pestaña Retenciones
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            <div className="grid grid-cols-3 gap-4">
                                                <div className="rounded-2xl p-4 border border-[var(--border-color)] text-center">
                                                    <p className="text-[9px] font-black uppercase tracking-widest mb-1" style={{ color: 'var(--text-secondary)' }}>Registros</p>
                                                    <p className="text-2xl font-black text-indigo-400">{retenciones.length}</p>
                                                </div>
                                                <div className="rounded-2xl p-4 border border-[var(--border-color)] text-center">
                                                    <p className="text-[9px] font-black uppercase tracking-widest mb-1" style={{ color: 'var(--text-secondary)' }}>CABA 901</p>
                                                    <p className="text-lg font-black text-indigo-400">$ {total901.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</p>
                                                </div>
                                                <div className="rounded-2xl p-4 border border-[var(--border-color)] text-center">
                                                    <p className="text-[9px] font-black uppercase tracking-widest mb-1" style={{ color: 'var(--text-secondary)' }}>PBA 902</p>
                                                    <p className="text-lg font-black text-purple-400">$ {total902.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</p>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => descargarArchivo(generarSifereTxt(retenciones), 'importacion_sifere.txt')}
                                                className="w-full py-4 rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-black uppercase text-[11px] tracking-widest shadow-xl shadow-indigo-500/20 hover:shadow-indigo-500/40 hover:scale-[1.01] transition-all duration-300 flex items-center justify-center gap-2"
                                            >
                                                <Download size={16} />
                                                Descargar importacion_sifere.txt
                                            </button>
                                            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-1">
                                                <p className="text-[10px] font-black uppercase tracking-widest text-amber-400">Pasos para subir a SIFERE WEB</p>
                                                <ol className="text-[10px] font-bold space-y-1 mt-2" style={{ color: 'var(--text-secondary)' }}>
                                                    <li>1. AFIP → Clave Fiscal → Convenio Multilateral – SIFERE WEB – DDJJ</li>
                                                    <li>2. Seleccioná el período y hacé clic en <strong>Deducciones</strong></li>
                                                    <li>3. Dentro de Deducciones → <strong>Retenciones</strong></li>
                                                    <li>4. Botón <strong>IMPORTAR</strong> → seleccioná <code>importacion_sifere.txt</code></li>
                                                </ol>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Control SIRCREB */}
                            <div className="rounded-2xl border border-[var(--border-color)] overflow-hidden" style={{ background: 'var(--card-bg)' }}>
                                <div className="px-6 py-4 border-b border-[var(--border-color)]">
                                    <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--text-secondary)' }}>Control SIRCREB</p>
                                    <p className="text-[10px] font-bold mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                                        Compara retenciones acumuladas vs. tu alícuota propia ({ALICUOTA_PROPIA}%)
                                    </p>
                                </div>
                                <div className="p-6 space-y-4">
                                    <div className="flex gap-3">
                                        <div className="flex-1">
                                            <label className="text-[9px] font-black uppercase tracking-widest block mb-2" style={{ color: 'var(--text-secondary)' }}>
                                                Comisiones brutas · {mesLabel}
                                            </label>
                                            <div className="flex items-center gap-2 px-4 py-3 rounded-2xl border border-[var(--border-color)] bg-white/5">
                                                <span className="text-sm font-black" style={{ color: 'var(--text-secondary)' }}>$</span>
                                                <span className="flex-1 font-black text-sm" style={{ color: comisionesDelMes > 0 ? 'var(--text-color)' : 'var(--text-secondary)' }}>
                                                    {comisionesDelMes > 0
                                                        ? comisionesDelMes.toLocaleString('es-AR', { minimumFractionDigits: 2 })
                                                        : 'Sin facturas del mes'}
                                                </span>
                                            </div>
                                        </div>
                                        <button
                                            onClick={calcularSircreb}
                                            className="self-end px-6 py-3 rounded-2xl bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 font-black text-[10px] uppercase tracking-widest hover:bg-indigo-500/30 transition-all flex items-center gap-2"
                                        >
                                            <Calculator size={14} />
                                            Calcular
                                        </button>
                                    </div>

                                    <AnimatePresence>
                                        {sircrebResult && (
                                            <motion.div
                                                initial={{ opacity: 0, y: 8 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0 }}
                                                className={`rounded-2xl border p-5 space-y-3 ${
                                                    sircrebResult.alarma
                                                        ? 'border-rose-500/30 bg-rose-500/5'
                                                        : 'border-emerald-500/30 bg-emerald-500/5'
                                                }`}
                                            >
                                                <div className="grid grid-cols-2 gap-3 text-[11px]">
                                                    {[
                                                        { label: `Comisiones brutas ${mesLabel}`, val: sircrebResult.facturacion, color: 'var(--text-color)' },
                                                        { label: `Impuesto det. (${ALICUOTA_PROPIA}%)`, val: sircrebResult.determinado, color: 'var(--text-color)' },
                                                        { label: 'Retenciones compañías', val: totalMonto, color: 'var(--text-color)' },
                                                        { label: `Banco SIRCREB (${alicuotaBanco}%)`, val: sircrebResult.sircreb, color: 'var(--text-color)' },
                                                        { label: 'Total retenciones + SIRCREB', val: sircrebResult.totalConSircreb, color: sircrebResult.alarma ? '#f87171' : '#34d399', bold: true },
                                                    ].map(item => (
                                                        <div key={item.label} className="flex justify-between items-center py-1 border-b border-white/10">
                                                            <span className={`font-black uppercase tracking-widest text-[9px] ${item.bold ? 'text-white' : ''}`} style={{ color: item.bold ? undefined : 'var(--text-secondary)' }}>
                                                                {item.label}
                                                            </span>
                                                            <span className={`font-black ${item.bold ? 'text-sm' : ''}`} style={{ color: item.color }}>
                                                                $ {item.val.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>

                                                {sircrebResult.alarma ? (
                                                    <div className="flex items-start gap-3 pt-2">
                                                        <AlertTriangle size={18} className="text-rose-400 flex-shrink-0 mt-0.5" />
                                                        <div>
                                                            <p className="text-[10px] font-black uppercase tracking-widest text-rose-400">
                                                                URGENTE: Estás acumulando saldo a favor
                                                            </p>
                                                            <p className="text-[10px] font-bold mt-1 text-rose-300">
                                                                Excedente estimado: $ {sircrebResult.excedente.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                                                                {' '}· Enviá este reporte al contador para pedir exclusión de SIRCREB.
                                                            </p>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-3 pt-2">
                                                        <CheckCircle size={18} className="text-emerald-400 flex-shrink-0" />
                                                        <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400">
                                                            Saldo a pagar estimado: $ {sircrebResult.saldoPagar.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                                                        </p>
                                                    </div>
                                                )}
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </div>
                        </div>
                    )}

                </motion.div>
            </AnimatePresence>
        </div>
    );
}
