import React, { useState, useMemo, useEffect } from 'react';
import {
    Users, Car, FileText, Upload, Search, Loader2,
    DollarSign, Cpu, Edit2, Trash2, X, Save, RefreshCw, Zap, CheckSquare, Square, AlertTriangle, Building2, ListFilter,
    FileWarning, Check, History, User, PlusCircle, MinusCircle, ChevronLeft, ChevronRight, ShieldCheck, Percent, Activity,
    Eye, Download, DownloadCloud
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppContext } from '../context/AppContext';
import { saveFileChunks, loadFileChunks, isChunkedAttachment } from '../utils/fileChunks';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import UploadResultModal from './UploadResultModal';

const RAMOS = [
    'Autos',
    'Motos',
    'Combinado Familiar',
    'Integral de Comercio',
    'Integral de Consorcio',
    'ART',
    'Vida',
    'Caución',
    'RC',
    'Accidentes Personales',
    'Otro'
];

const CANCEL_REASONS = [
    'Cambio de Compañía',
    'Venta de Unidad',
    'Por Costos',
    'Desestimiento',
    'Otro'
];

const PolicyManager = () => {
    const {
        policies = [],
        handleUnifiedSmartUpload: processPolicyFile,
        addPolicy,
        updatePolicy,
        deletePolicy,
        updateClientData,
        clearAllPolicies,
        unifyExistingPolicies,
        mergeClientsByName,
        bulkAddPolicies,
        bulkDeletePolicies,
        processCSVWithAI,
        analyzePolicyWithAI,
        globalSearchTerm,
        showOnlyMissingFiles,
        setShowOnlyMissingFiles,
        isAutoExpired,
        normalizeRisk,
        totalClientsCount,
        loading
    } = useAppContext();

    const [searchTerm, setSearchTerm] = useState((globalSearchTerm || '').trim());
    const [filterRisk, setFilterRisk] = useState('All');
    const [filterCompany, setFilterCompany] = useState('All');
    const [filterAttachment, setFilterAttachment] = useState('All'); // 'All', 'WithFile', 'WithoutFile'
    const [filterStatus, setFilterStatus] = useState('Active'); // 'All', 'Active', 'Expired'
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState({ message: '', percent: 0 });
    const [selectedIds, setSelectedIds] = useState([]);
    const [currentPage, setCurrentPage] = useState(1);
    const [cancellationReason, setCancellationReason] = useState('');
    const [auditResults, setAuditResults] = useState(null);
    const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);

    const [uploadResult, setUploadResult] = useState({ isOpen: false, status: '', message: '', details: [] });

    const ITEMS_PER_PAGE = 20;

    // --- Control de Anchos Dinámicos ---
    const [colWidths, setColWidths] = useState(() => {
        try {
            const saved = localStorage.getItem('policyTableWidths_v2');
            if (saved) return JSON.parse(saved);
        } catch (e) { console.error("Error al cargar anchos:", e); }
        return {
            client: 350,
            company: 160,
            risk: 90,
            premium: 120,
            endDate: 110,
            actions: 140
        };
    });

    useEffect(() => {
        localStorage.setItem('policyTableWidths_v2', JSON.stringify(colWidths));
    }, [colWidths]);

    const adjustWidth = (col, amount) => {
        setColWidths(prev => ({
            ...prev,
            [col]: Math.max(amount < 0 ? 40 : 80, prev[col] + amount)
        }));
    };

    const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
    React.useEffect(() => {
        const onResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    const WidthControl = ({ col }) => (
        <div className="hidden md:flex items-center gap-0.5 ml-2 opacity-0 group-hover/th:opacity-100 transition-opacity">
            <button
                onClick={(e) => { e.stopPropagation(); adjustWidth(col, -20); }}
                className="p-0.5 hover:bg-[var(--text-color)]/10 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-color)] transition-colors"
                title="Achicar"
            >
                <MinusCircle size={10} />
            </button>
            <button
                onClick={(e) => { e.stopPropagation(); adjustWidth(col, 20); }}
                className="p-0.5 hover:bg-[var(--text-color)]/10 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-color)] transition-colors"
                title="Agrandar"
            >
                <PlusCircle size={10} />
            </button>
        </div>
    );
    // ----------------------------------

    const abbreviateCompany = (name) => {
        if (!name) return '';
        const upper = name.toUpperCase();
        if (upper.includes('MERCANTIL ANDINA')) return 'Mercantil';
        if (upper.includes('FEDERA')) return 'Federación';
        if (upper.includes('ACS COMERCIAL') || upper.includes('GALICIA') || upper.includes('1276')) return 'Galicia';
        if (upper.includes('ALLIANZ')) return 'Allianz';
        if (upper.includes('SMG') || upper.includes('SWISS MEDICAL') || upper.includes('COMPANIA ARGENTINA DE SEGUROS') || upper.includes('COMPAÑIA ARGENTINA DE SEGUROS')) return 'SMG Seguros';
        if (upper.includes('SWISS MEDICAL SEGUROS')) return 'SMG Seguros';
        if (upper.includes('SWISS MEDICAL ART')) return 'SMG ART';
        if (upper.includes('SMG SEGUROS')) return 'SMG Seguros';
        if (upper.includes('SMG ART')) return 'SMG ART';
        if (upper.includes('ZURICH')) return 'Zurich';
        if (upper.includes('LA MERIDIONAL') || upper.includes('MERIDIONAL')) return 'Meridional Seguros';
        if (upper.includes('EXPERTA ART')) return 'EXPERTA ART';
        if (upper.includes('EXPERTA')) return 'EXPERTA SEGUROS';
        return name;
    };

    // Sincronizar con búsqueda global y resetear filtros para asegurar visibilidad
    useEffect(() => {
        const trimmed = (globalSearchTerm || '').trim();
        setSearchTerm(trimmed);
        if (trimmed) {
            setFilterRisk('All');
            setFilterCompany('All');
        }
    }, [globalSearchTerm]);

    const getExpirationColor = (endDate) => {
        if (!endDate) return 'text-[var(--text-secondary)]';
        const now = new Date();
        const end = new Date(endDate);
        const diffTime = end - now;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays < 0) return 'text-red-500 font-black'; // Vencida
        if (diffDays <= 9) return 'text-orange-500 font-black'; // 0-9 días
        if (diffDays <= 19) return 'text-yellow-500 font-black'; // 10-19 días
        if (diffDays <= 45) return 'text-blue-400 font-black'; // 20-45 días
        return 'text-emerald-400 font-black'; // +46 días
    };

    // Color de fondo para la fila según vencimiento
    const getExpirationRowBg = (endDate) => {
        if (!endDate) return '';
        const now = new Date();
        const end = new Date(endDate);
        const diffDays = Math.ceil((end - now) / (1000 * 60 * 60 * 24));

        if (diffDays < 0) return 'bg-red-500/8 border-l-4 border-l-red-500'; // Vencida
        if (diffDays <= 9) return 'bg-orange-500/8 border-l-4 border-l-orange-500'; // Urgente
        if (diffDays <= 19) return 'bg-yellow-500/6 border-l-4 border-l-yellow-500'; // Pronto
        if (diffDays <= 45) return 'bg-blue-500/5 border-l-4 border-l-blue-400'; // Normal
        return ''; // +46 días, sin color extra
    };

    // Estados para el Modal
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isCancellationModalOpen, setIsCancellationModalOpen] = useState(false);
    const [editingPolicy, setEditingPolicy] = useState(null);
    const [isSaving, setIsSaving] = useState(false);

    // Formateo de Moneda ARS/USD
    const formatCurrency = (value, currency = 'ARS') => {
        if (value === null || value === undefined || value === '') return '';

        const symbol = currency === 'USD' ? 'u$s ' : '$ ';
        let strVal = value.toString().replace('$ ', '').replace('u$s ', '');

        if (!strVal.includes(',')) {
            const parts = strVal.split('.');
            let enteros = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
            let decimales = parts[1] !== undefined ? ',' + parts[1] : '';
            return symbol + enteros + decimales;
        } else {
            let cleanStr = strVal.replace(/\./g, '');
            const parts = cleanStr.split(',');
            let enteros = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
            let decimales = parts[1] !== undefined ? ',' + parts[1] : '';
            return symbol + enteros + decimales;
        }
    };

    const parseCurrency = (value) => {
        if (!value) return '';
        let clean = value.replace(/[^0-9,-]/g, '');
        return clean.replace(',', '.');
    };

    // Resetear a página 1 cuando cambian los filtros
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, filterCompany, filterRisk, filterAttachment, filterStatus, showOnlyMissingFiles]);

    // Cerrar modal con tecla ESC
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && isModalOpen && !isSaving) {
                setIsModalOpen(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isModalOpen, isSaving]);

    // 1. Cálculos para las Tarjetas del Dashboard (con Safety Guards)
    const stats = useMemo(() => {
        if (!Array.isArray(policies)) return {
            totalClients: 0,
            totalActivePolicies: 0,
            totalPrima: 0,
            totalCancelled: 0,
            branchCounts: RAMOS.reduce((acc, r) => ({ ...acc, [r]: 0 }), {}),
            clientsByBranch: RAMOS.reduce((acc, r) => ({ ...acc, [r]: 0 }), {}),
            policiesPerClient: {},
            companies: []
        };

        const activePolicies = policies.filter(p => !p?.isCancelled && !isAutoExpired(p));
        const cancelledPolicies = policies.filter(p => p?.isCancelled || (p && isAutoExpired(p)));

        // Conteo robusto de clientes únicos usando DNI o Nombre como identificador
        const totalClients = new Set(activePolicies.map(p => p?.dni || p?.clientName).filter(Boolean)).size;
        const totalPrimaARS = activePolicies
            .filter(p => !p.currency || p.currency === 'ARS')
            .reduce((sum, p) => sum + (Number(p?.prima) || 0), 0);

        const totalPrimaUSD = activePolicies
            .filter(p => p.currency === 'USD')
            .reduce((sum, p) => sum + (Number(p?.prima) || 0), 0);

        const clientsByBranch = RAMOS.reduce((acc, r) => ({ ...acc, [r]: 0 }), {});

        activePolicies.forEach(p => {
            const risk = normalizeRisk(p.riskType);
            if (clientsByBranch.hasOwnProperty(risk)) {
                clientsByBranch[risk]++;
            } else {
                clientsByBranch['Otro']++;
            }
        });

        const branchCounts = { ...clientsByBranch };
        const policiesPerClient = {};
        activePolicies.forEach(p => {
            if (p?.dni) {
                policiesPerClient[p.dni] = (policiesPerClient[p.dni] || 0) + 1;
            }
        });

        const companiesSet = new Set();
        // Usar policies (todas) para que no desaparezcan del dropdown al filtrar
        policies.forEach(p => {
            if (p?.company) {
                companiesSet.add(abbreviateCompany(p.company).trim());
            }
        });


        return {
            totalClients,
            totalActivePolicies: activePolicies.length,
            totalPrimaARS,
            totalPrimaUSD,
            totalCancelled: cancelledPolicies.length,
            cancelledByReason: cancelledPolicies.reduce((acc, p) => {
                const reason = p.cancellationReason || 'Otros / Vencidos';
                acc[reason] = (acc[reason] || 0) + 1;
                return acc;
            }, {}),
            branchCounts,
            clientsByBranch,
            policiesPerClient,
            companies: Array.from(companiesSet).sort()
        };
    }, [policies]);

    // 2. Filtrado de la lista (con Safety Guards)
    const filteredPolicies = useMemo(() => {
        if (!Array.isArray(policies)) return [];
        return policies
            .filter(p => {
                if (!p) return false;
                const terms = searchTerm.toLowerCase().split(' ').filter(t => t.length > 0);
                const searchBlob = `
                    ${(p.clientName || '').toLowerCase()} 
                    ${(p.dni || '')} 
                    ${(p.policyNumber || '')} 
                    ${(p.company || '').toLowerCase()} 
                    ${(p.riskType || '').toLowerCase()}
                `.toLowerCase();

                const matchesSearch = terms.every(term => searchBlob.includes(term));

                const matchesRisk = filterRisk === 'All' || normalizeRisk(p.riskType) === filterRisk;
                const matchesCompany = filterCompany === 'All' || abbreviateCompany(p.company) === filterCompany;

                // Filtro de Adjuntos (Modernizado)
                const hasFile = p.fileUrl || p.fileBase64 || (p.attachments && p.attachments.length > 0);
                const matchesAttachment = filterAttachment === 'All' ||
                    (filterAttachment === 'WithFile' ? hasFile : !hasFile);

                // Filtro especial para pólizas sin adjuntos (Legacy support)
                const matchesMissingFilter = !showOnlyMissingFiles || !hasFile;

                // 🛑 ESTADO: Activa vs Vencida vs Anulada
                const expired = isAutoExpired(p);
                const cancelled = !!p.isCancelled;

                let matchesStatus = true;
                if (filterStatus === 'Active') {
                    matchesStatus = !cancelled && !expired;
                } else if (filterStatus === 'Expired') {
                    matchesStatus = expired && !cancelled;
                } else if (filterStatus === 'Cancelled') {
                    matchesStatus = cancelled;
                }

                return matchesSearch && matchesRisk && matchesCompany && matchesAttachment && matchesMissingFilter && matchesStatus;
            })
            .sort((a, b) => {
                // 1. Canceladas abajo del todo
                if (a.isCancelled && !b.isCancelled) return 1;
                if (!a.isCancelled && b.isCancelled) return -1;

                // 2. Pólizas vencidas arriba (no canceladas)
                const now = new Date();
                const aExpired = a.endDate && new Date(a.endDate) < now && !a.isCancelled;
                const bExpired = b.endDate && new Date(b.endDate) < now && !b.isCancelled;

                if (aExpired && !bExpired) return -1;
                if (!aExpired && bExpired) return 1;

                // 3. Si ambas están vencidas, la más reciente primero
                if (aExpired && bExpired) {
                    return new Date(b.endDate) - new Date(a.endDate);
                }

                // 4. Si ambas están activas, ordenar por fecha de vencimiento (más cercana primero)
                if (!a.isCancelled && !b.isCancelled) {
                    if (!a.endDate) return 1;
                    if (!b.endDate) return -1;
                    return new Date(a.endDate) - new Date(b.endDate);
                }

                return 0;
            });
    }, [policies, searchTerm, filterRisk, filterCompany, filterAttachment, filterStatus, showOnlyMissingFiles]);

    const groupedPolicies = useMemo(() => {
        const groups = {};
        filteredPolicies.forEach(pol => {
            const key = pol.dni || pol.clientName;
            if (!groups[key]) {
                groups[key] = {
                    id: key,
                    clientName: pol.clientName,
                    dni: pol.dni,
                    policies: [],
                    latestTimestamp: 0
                };
            }
            groups[key].policies.push(pol);

            // Extraer timestamp numérico para ordenar con máxima robustez
            let ts = 0;
            if (pol.timestamp) {
                if (typeof pol.timestamp.toMillis === 'function') {
                    ts = pol.timestamp.toMillis();
                } else if (pol.timestamp.seconds) {
                    ts = pol.timestamp.seconds * 1000;
                } else if (pol.timestamp instanceof Date) {
                    ts = pol.timestamp.getTime();
                } else {
                    ts = new Date(pol.timestamp).getTime();
                }
            }
            if (isNaN(ts)) ts = 0;

            if (ts > groups[key].latestTimestamp) {
                groups[key].latestTimestamp = ts;
            }
        });

        // Orden: Primero los que tienen al menos una póliza activa/vigente
        // Luego por latestTimestamp (lo más reciente arriba)
        return Object.values(groups).sort((a, b) => {
            const now = new Date();
            const aHasActive = a.policies.some(p => !p.isCancelled && !isAutoExpired(p));
            const bHasActive = b.policies.some(p => !p.isCancelled && !isAutoExpired(p));

            // Primero: clientes con pólizas vencidas (no anuladas)
            const aHasExpired = a.policies.some(p => !p.isCancelled && p.endDate && new Date(p.endDate) < now);
            const bHasExpired = b.policies.some(p => !p.isCancelled && p.endDate && new Date(p.endDate) < now);

            if (aHasExpired && !bHasExpired) return -1;
            if (!aHasExpired && bHasExpired) return 1;

            // Segundo: activos antes que inactivos
            if (aHasActive && !bHasActive) return -1;
            if (!aHasActive && bHasActive) return 1;

            // Tercero: ordenar por próximo vencimiento más cercano
            const aNextEnd = a.policies.filter(p => !p.isCancelled && p.endDate).map(p => new Date(p.endDate)).sort((x, y) => x - y)[0];
            const bNextEnd = b.policies.filter(p => !p.isCancelled && p.endDate).map(p => new Date(p.endDate)).sort((x, y) => x - y)[0];

            if (aNextEnd && bNextEnd) return aNextEnd - bNextEnd;
            if (aNextEnd && !bNextEnd) return -1;
            if (!aNextEnd && bNextEnd) return 1;

            return b.latestTimestamp - a.latestTimestamp;
        });
    }, [filteredPolicies]);


    // Selección múltiple
    const toggleSelectAll = () => {
        if (selectedIds.length === filteredPolicies.length && filteredPolicies.length > 0) {
            setSelectedIds([]);
        } else {
            setSelectedIds(filteredPolicies.map(p => p.id));
        }
    };

    const toggleSelect = (id) => {
        setSelectedIds(prev =>
            prev.includes(id)
                ? prev.filter(i => i !== id)
                : [...prev, id]
        );
    };

    const handleBulkDelete = async () => {
        if (selectedIds.length === 0) return;
        const msg = selectedIds.length === filteredPolicies.length && searchTerm === '' && filterRisk === 'All' && filterCompany === 'All'
            ? `¿Estás TOTALMENTE SEGURO de eliminar TODA la Cartera(${selectedIds.length} pólizas) ? `
            : `¿Estás seguro de eliminar las ${selectedIds.length} pólizas seleccionadas ? `;

        if (window.confirm(msg)) {
            setIsProcessing(true);
            setProgress({ message: 'Eliminando registros...', percent: 50 });
            try {
                await bulkDeletePolicies(selectedIds);
                setSelectedIds([]);
            } catch (error) {
                alert("Error al eliminar pólizas");
            } finally {
                setIsProcessing(false);
                setProgress({ message: '', percent: 0 });
            }
        }
    };

    const handleWipeAll = async () => {
        if (window.confirm("🚨 ATENCIÓN: Esto eliminará ABSOLUTAMENTE TODAS las pólizas de la base de datos. ¿Deseas continuar?")) {
            setIsProcessing(true);
            setProgress({ message: 'Vaciando Cartera...', percent: 50 });
            try {
                await clearAllPolicies();
                setSelectedIds([]);
                alert("Cartera vaciada con éxito.");
            } catch (error) {
                alert("Error al vaciar Cartera");
            } finally {
                setIsProcessing(false);
                setProgress({ message: '', percent: 0 });
            }
        }
    };

    const handleUnify = async () => {
        if (window.confirm("Este proceso unificará todos los registros que tengan el mismo número de póliza, manteniendo los datos más completos y eliminando repetidos. ¿Continuar?")) {
            setIsProcessing(true);
            setProgress({ message: 'Analizando y Unificando Cartera...', percent: 30 });
            try {
                const result = await unifyExistingPolicies();
                alert(`✅ Limpieza completada: \n - Se analizaron todos los registros.\n - Se unificaron ${result.unifiedGroups} grupos de pólizas.\n - Se eliminaron ${result.totalDeleted} registros duplicados.`);
                setSelectedIds([]);
            } catch (error) {
                alert("Error al unificar pólizas");
            } finally {
                setIsProcessing(false);
                setProgress({ message: '', percent: 0 });
            }
        }
    };

    const handleMergeClients = async () => {
        if (window.confirm("Esta función analizará clientes con exactamente el mismo nombre pero con distintos DNI/CUIT (ej: DNI vs CUIT largo) y les asignará el mismo identificador óptimo a todos. ¿Deseas proceder?")) {
            setIsProcessing(true);
            setProgress({ message: 'Buscando clientes para fusionar...', percent: 40 });
            try {
                const result = await mergeClientsByName();
                if (result.mergedClients > 0) {
                    alert(`✅ Fusión de Clientes Exitosa: \n - Se detectaron equivalencias en ${result.mergedClients} clientes distintos.\n - Se corrigió el DNI/CUIT en ${result.modifiedPolicies} pólizas para unificarlos en su cuenta principal.`);
                } else {
                    alert("No se encontraron clientes homónimos con distinto DNI/CUIT para fusionar. Tu base de datos está limpia en este aspecto.");
                }
                setSelectedIds([]);
            } catch (error) {
                console.error("Error al fusionar clientes:", error);
                alert(`❌ Error técnico al fusionar clientes: ${error.message || 'Error desconocido'}`);
            } finally {
                setIsProcessing(false);
                setProgress({ message: '', percent: 0 });
            }
        }
    };

    const handleFileUpload = async (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        setIsProcessing(true);
        const results = [];
        let successCount = 0;
        const failedFiles = [];
        const successFileNames = [];

        try {
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const displayIndex = i + 1;
                const total = files.length;

                // Pausa anti-rate-limit entre archivos (excepto el primero)
                if (i > 0) {
                    for (let s = 3; s > 0; s--) {
                        setProgress({
                            message: `⏳ Esperando ${s}s antes de archivo ${displayIndex}/${total} (evitar límite IA)...`,
                            percent: Math.round((i / total) * 100)
                        });
                        await new Promise(r => setTimeout(r, 1000));
                    }
                }

                setProgress({
                    message: `Procesando archivo ${displayIndex} de ${total}: ${file.name}...`,
                    percent: Math.round((i / total) * 100)
                });

                try {
                    const result = await processPolicyFile(file, (msg, pc) => {
                        const basePc = (i / total) * 100;
                        const stepPc = pc / total;
                        setProgress({ message: `[${displayIndex}/${total}] ${msg}`, percent: Math.round(basePc + stepPc) });
                    });

                    if (result.status === 'success') {
                        successCount++;
                        results.push({
                            name: file.name,
                            type: result.type,
                            cuit: result.data?.cuit || 'N/A',
                            client: result.data?.clientName || 'N/A',
                            company: result.data?.company || 'N/A',
                            policyNumber: result.data?.policyNumber || result.data?.number || 'N/A'
                        });
                    } else {
                        console.error(`Error en archivo ${file.name}:`, result.error);
                        failedFiles.push({ name: file.name, error: result.error || 'Error desconocido' });
                    }
                } catch (err) {
                    console.error(`Fallo crítico en archivo ${file.name}:`, err);
                    failedFiles.push({ name: file.name, error: err.message || 'Error crítico' });
                }
            }

            if (successCount > 0) {
                let msg = `✅ RESULTADO DE CARGA IA\n`;
                msg += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                msg += `Guardado Automático Completado.\n`;
                msg += `✅ ÉXITOS: ${successCount} de ${files.length} archivos procesados\n\n`;

                if (results.length > 0) {
                    msg += `📋 DETALLE DE ARCHIVOS GUARDADOS:\n`;
                    results.forEach(d => {
                        msg += `  ✓ ${d.name}\n`;
                        msg += `    └─ Tipo: ${d.type || 'N/A'} | Cliente: ${d.client} | Cía: ${d.company} | Nro: ${d.policyNumber}\n`;
                    });
                }

                if (failedFiles.length > 0) {
                    msg += `\n❌ FALLARON (${failedFiles.length}):\n`;
                    failedFiles.forEach(f => { msg += `  ✗ ${f.name}\n    → ${f.error}\n`; });
                    msg += `\nPodés volver a subirlos individualmente.`;
                }

                alert(msg);
            } else if (failedFiles.length > 0) {
                let msg = `❌ No se pudo procesar ningún archivo\n\n`;
                msg += `ARCHIVOS FALLIDOS:\n`;
                failedFiles.forEach(f => { msg += `  ✗ ${f.name}\n    → ${f.error}\n`; });
                msg += `\nRevisá los archivos e intentá subirlos de nuevo.`;
                alert(msg);
            }

        } catch (err) {
            alert(`Error general al procesar: ${err.message}`);
        } finally {
            setIsProcessing(false);
            setProgress({ message: '', percent: 0 });
            e.target.value = '';
        }
    };

    const handleAuditUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setIsProcessing(true);
        setProgress({ message: 'Preparando Auditoría...', percent: 10 });

        try {
            const reader = new FileReader();
            const buffer = await new Promise((resolve, reject) => {
                reader.onload = (e) => resolve(new Uint8Array(e.target.result));
                reader.onerror = reject;
                reader.readAsArrayBuffer(file);
            });

            const workbook = XLSX.read(buffer, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const csvText = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);

            setProgress({ message: 'IA analizando Cartera de Compañía...', percent: 40 });

            const result = await processCSVWithAI(csvText, (msg, pc) => {
                setProgress({ message: msg, percent: pc });
            });

            if (result.status === 'success') {
                setProgress({ message: 'Cruzando datos con tu sistema...', percent: 85 });

                const externalList = result.data;
                const missingInSystem = [];
                const foundInSystem = [];

                externalList.forEach(ext => {
                    // Criterio de match: Mismo número de póliza (normalizado)
                    const extPolNum = (ext.policyNumber || '').toString().trim().toLowerCase();
                    const match = policies.find(p => {
                        const systemPolNum = (p.policyNumber || '').toString().trim().toLowerCase();
                        return systemPolNum === extPolNum && extPolNum !== '';
                    });

                    if (match) {
                        foundInSystem.push({ external: ext, system: match });
                    } else {
                        missingInSystem.push(ext);
                    }
                });

                setAuditResults({
                    fileName: file.name,
                    totalExternal: externalList.length,
                    missing: missingInSystem,
                    found: foundInSystem
                });
                setIsAuditModalOpen(true);
            } else {
                alert(`Error: ${result.error}`);
            }
        } catch (err) {
            console.error("Audit error:", err);
            alert(`Error en auditoría: ${err.message}`);
        } finally {
            setIsProcessing(false);
            setProgress({ message: '', percent: 0 });
            e.target.value = '';
        }
    };

    const handleCsvUploadWithAI = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setIsProcessing(true);
        setProgress({ message: 'Leyendo archivo...', percent: 10 });

        try {
            const reader = new FileReader();
            const buffer = await new Promise((resolve, reject) => {
                reader.onload = (e) => resolve(new Uint8Array(e.target.result));
                reader.onerror = reject;
                reader.readAsArrayBuffer(file);
            });

            const workbook = XLSX.read(buffer, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];

            const csvText = XLSX.utils.sheet_to_csv(worksheet);

            setProgress({ message: 'La IA está analizando los datos...', percent: 40 });

            const result = await processCSVWithAI(csvText, (msg, pc) => {
                setProgress({ message: msg, percent: pc });
            });

            if (result.status === 'success') {
                setProgress({ message: 'Unificando registros y guardando...', percent: 80 });
                const count = await bulkAddPolicies(result.data.map(p => ({
                    ...p,
                    status: 'AI Bulk Import'
                })));
                alert(`✅ IA completó la extracción: se procesaron ${count} registros con unificación automática por número.`);
            } else {
                alert(`Error de IA: ${result.error} `);
            }

        } catch (err) {
            alert(`Error al procesar: ${err.message} `);
        } finally {
            setIsProcessing(false);
            setProgress({ message: '', percent: 0 });
            e.target.value = '';
        }
    };

    const handleSavePolicy = async () => {
        if (!editingPolicy) return;
        setIsSaving(true);
        try {
            if (editingPolicy.id) {
                await updatePolicy(editingPolicy.id, editingPolicy);
            } else {
                await addPolicy(editingPolicy);
            }
            setIsModalOpen(false);
            setEditingPolicy(null);
        } catch (error) {
            console.error("Error al guardar póliza:", error);
            alert("Error al guardar póliza");
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (id) => {
        if (window.confirm("¿Estás seguro de eliminar esta póliza?")) {
            await deletePolicy(id);
        }
    };

    const handleEdit = (pol) => {
        console.log("Opening modal for edit:", pol);
        setEditingPolicy({ ...pol });
        setIsModalOpen(true);
    };

    const handleManualAdd = () => {
        console.log("Opening modal for manual add");
        const today = new Date();
        const nextYear = new Date();
        nextYear.setFullYear(today.getFullYear() + 1);

        setEditingPolicy({
            clientName: '',
            dni: '',
            riskType: 'Autos', // Default más común
            isRenewal: false,
            company: '',
            policyNumber: '',
            prima: '',
            premio: '', // Nuevo campo
            insuredSum: '',
            startDate: today.toISOString().split('T')[0],
            endDate: nextYear.toISOString().split('T')[0], // Default 1 año
            address: '',
            currency: 'ARS',
            observations: '',
            fileUrl: null,
            fileName: null
        });
        setIsModalOpen(true);
    };

    const handleExportPDF = () => {
        try {
            const doc = new jsPDF();
            const pageWidth = doc.internal.pageSize.width;
            const now = new Date();

            // Estilos y Colores
            const primaryColor = [79, 70, 229]; // Indigo-600
            const secondaryColor = [107, 114, 128]; // Zinc-500

            // Título
            doc.setFontSize(22);
            doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
            doc.setFont(undefined, 'bold');
            doc.text("GUSTAVO RODAS SEGUROS", pageWidth / 2, 20, { align: 'center' });

            doc.setFontSize(10);
            doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
            doc.setFont(undefined, 'normal');
            doc.text(`REPORTE DE CARTERA - GENERADO EL ${now.toLocaleDateString('es-AR')} A LAS ${now.toLocaleTimeString('es-AR')}`, pageWidth / 2, 28, { align: 'center' });

            // Línea separadora
            doc.setDrawColor(primaryColor[0], primaryColor[1], primaryColor[2]);
            doc.setLineWidth(0.5);
            doc.line(14, 32, pageWidth - 14, 32);

            let currentY = 42;

            groupedPolicies.forEach((group) => {
                if (currentY > 260) {
                    doc.addPage();
                    currentY = 20;
                }

                // Datos del Asegurado
                doc.setFontSize(13);
                doc.setTextColor(30, 41, 59); // Slate-800
                doc.setFont(undefined, 'bold');
                doc.text(group.clientName.toUpperCase(), 14, currentY);

                doc.setFontSize(9);
                doc.setFont(undefined, 'normal');
                doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
                doc.text(`DNI/CUIT: ${group.dni || 'N/A'}`, 14, currentY + 5);

                const tableData = group.policies.map(p => [
                    p.company || '-',
                    normalizeRisk(p.riskType) || '-',
                    p.policyNumber || '-',
                    p.endDate ? new Date(p.endDate).toLocaleDateString('es-AR') : '-',
                    p.isCancelled ? 'ANULADA' : (isAutoExpired(p) ? 'VENCIDA' : 'ACTIVA'),
                    formatCurrency(p.insuredSum, p.currency)
                ]);

                autoTable(doc, {
                    startY: currentY + 8,
                    head: [['Compañía', 'Ramo', 'Póliza', 'Vencimiento', 'Estado', 'Suma Asegurada']],
                    body: tableData,
                    theme: 'grid',
                    headStyles: {
                        fillColor: primaryColor,
                        textColor: 255,
                        fontSize: 8,
                        fontStyle: 'bold',
                        halign: 'center'
                    },
                    bodyStyles: {
                        fontSize: 7.5,
                        textColor: [50, 50, 50]
                    },
                    columnStyles: {
                        4: { fontStyle: 'bold', halign: 'center' },
                        5: { halign: 'right' }
                    },
                    margin: { left: 14, right: 14 },
                    didParseCell: (data) => {
                        if (data.column.index === 4) {
                            if (data.cell.raw === 'ANULADA') data.cell.styles.textColor = [220, 38, 38];
                            if (data.cell.raw === 'VENCIDA') data.cell.styles.textColor = [245, 158, 11];
                            if (data.cell.raw === 'ACTIVA') data.cell.styles.textColor = [16, 185, 129];
                        }
                    }
                });

                currentY = doc.lastAutoTable.finalY + 15;
            });

            const totalPages = doc.internal.getNumberOfPages();
            for (let i = 1; i <= totalPages; i++) {
                doc.setPage(i);
                doc.setFontSize(8);
                doc.setTextColor(150);
                doc.text(`Página ${i} de ${totalPages} - gusrodas.seguros@gmail.com`, pageWidth / 2, doc.internal.pageSize.height - 10, { align: 'center' });
            }

            doc.save(`Reporte_Cartera_${now.toISOString().split('T')[0]}.pdf`);
        } catch (error) {
            console.error("Error generating PDF:", error);
            alert("Hubo un error al generar el PDF.");
        }
    };

    const handleExportSummaryPDF = () => {
        try {
            const doc = new jsPDF();
            const pageWidth = doc.internal.pageSize.width;
            const now = new Date();

            // Estilos y Colores
            const primaryColor = [79, 70, 229]; // Indigo-600
            const secondaryColor = [107, 114, 128]; // Zinc-500

            // Título
            doc.setFontSize(22);
            doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
            doc.setFont(undefined, 'bold');
            doc.text("GUSTAVO RODAS SEGUROS", pageWidth / 2, 20, { align: 'center' });

            doc.setFontSize(10);
            doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
            doc.setFont(undefined, 'normal');
            doc.text(`RESUMEN DE CARTERA POR COMPAÑÍA - ${now.toLocaleDateString('es-AR')}`, pageWidth / 2, 28, { align: 'center' });

            // Línea separadora
            doc.setDrawColor(primaryColor[0], primaryColor[1], primaryColor[2]);
            doc.setLineWidth(0.5);
            doc.line(14, 32, pageWidth - 14, 32);

            // Base de datos amplia: Respetamos búsqueda, ramo y compañía, pero IGNORAMOS el filtro de estado (Activa/Vencida/Anulada)
            // para que el reporte sea completo.
            const reportBase = policies.filter(p => {
                if (!p) return false;
                const terms = searchTerm.toLowerCase().split(' ').filter(t => t.length > 0);
                const searchBlob = `${(p.clientName || '')} ${(p.dni || '')} ${(p.policyNumber || '')} ${(p.company || '')} ${(p.riskType || '')}`.toLowerCase();
                const matchesSearch = terms.every(term => searchBlob.includes(term));
                const matchesRisk = filterRisk === 'All' || normalizeRisk(p.riskType) === filterRisk;
                const matchesCompany = filterCompany === 'All' || abbreviateCompany(p.company) === filterCompany;
                return matchesSearch && matchesRisk && matchesCompany;
            });

            // Calcular Datos Agrupados por Compañía
            const companyStats = {};

            reportBase.forEach(p => {
                const comp = (p.company || 'OTRA').toUpperCase();
                if (!companyStats[comp]) {
                    companyStats[comp] = {
                        activePolicies: 0,
                        cancelledPolicies: 0,
                        expiredPolicies: 0,
                        activePrimaARS: 0,
                        cancelledPrimaARS: 0,
                        expiredPrimaARS: 0,
                        activeClients: new Set(),
                        cancelledClients: new Set(),
                        expiredClients: new Set()
                    };
                }

                const dni = (p.dni || p.cuit || p.clientName || '').toString().trim();
                const isCancelled = !!p.isCancelled;
                const isExpired = !isCancelled && isAutoExpired(p);
                const isActive = !isCancelled && !isExpired;

                const valor = parseFloat(p.prima || 0);
                const valorCalculado = isNaN(valor) ? 0 : (p.currency === 'USD' ? valor * 1000 : valor);

                if (isCancelled) {
                    companyStats[comp].cancelledPolicies++;
                    companyStats[comp].cancelledClients.add(dni);
                    companyStats[comp].cancelledPrimaARS += valorCalculado;
                } else if (isExpired) {
                    companyStats[comp].expiredPolicies++;
                    companyStats[comp].expiredClients.add(dni);
                    companyStats[comp].expiredPrimaARS += valorCalculado;
                } else if (isActive) {
                    companyStats[comp].activePolicies++;
                    companyStats[comp].activeClients.add(dni);
                    companyStats[comp].activePrimaARS += valorCalculado;
                }
            });

            // Preparar filas para la tabla
            const tableData = Object.entries(companyStats)
                .sort((a, b) => b[1].activePolicies - a[1].activePolicies)
                .map(([name, s]) => {
                    const lostPremiums = s.cancelledPrimaARS + s.expiredPrimaARS;
                    return [
                        name,
                        s.activePolicies,
                        s.cancelledPolicies,
                        s.expiredPolicies,
                        `$ ${s.activePrimaARS.toLocaleString('es-AR')}`,
                        `$ ${s.cancelledPrimaARS.toLocaleString('es-AR')}`,
                        `$ ${s.activePrimaARS.toLocaleString('es-AR')}` // Mostramos Prima Activa como referencia o el balance? 
                        // El usuario pidió "totales", pongamos lo que es relevante.
                    ];
                });

            // Totales Generales
            const grandTotal = Object.values(companyStats).reduce((acc, s) => ({
                policies: acc.policies + s.activePolicies,
                cancelled: acc.cancelled + s.cancelledPolicies,
                expired: acc.expired + s.expiredPolicies,
                activePrima: acc.activePrima + s.activePrimaARS,
                cancelledPrima: acc.cancelledPrima + s.cancelledPrimaARS,
                expiredPrima: acc.expiredPrima + s.expiredPrimaARS
            }), { policies: 0, cancelled: 0, expired: 0, activePrima: 0, cancelledPrima: 0, expiredPrima: 0 });

            autoTable(doc, {
                startY: 40,
                head: [['Compañía', 'Actv', 'Anul', 'Venc', 'Prima Vigente', 'Prima Perdida (Anul)', 'Total Prima']],
                body: tableData,
                foot: [[
                    'TOTALES',
                    grandTotal.policies,
                    grandTotal.cancelled,
                    grandTotal.expired,
                    `$ ${grandTotal.activePrima.toLocaleString('es-AR')}`,
                    `$ ${grandTotal.cancelledPrima.toLocaleString('es-AR')}`,
                    `$ ${(grandTotal.activePrima + grandTotal.cancelledPrima).toLocaleString('es-AR')}`
                ]],
                theme: 'striped',
                headStyles: { fillColor: primaryColor, textColor: 255, fontStyle: 'bold', halign: 'center', fontSize: 8 },
                footStyles: { fillColor: [241, 245, 249], textColor: [30, 41, 59], fontStyle: 'bold', halign: 'center', fontSize: 8 },
                bodyStyles: { fontSize: 8 },
                columnStyles: {
                    0: { fontStyle: 'bold', cellWidth: 'auto' },
                    1: { halign: 'center' },
                    2: { halign: 'center' },
                    3: { halign: 'right' },
                    4: { halign: 'right' },
                    5: { halign: 'right', fontStyle: 'bold' }
                },
                margin: { top: 40 }
            });

            // Pie de página
            doc.setFontSize(8);
            doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
            doc.text(`Este reporte refleja únicamente los datos filtrados en pantalla.`, 14, doc.lastAutoTable.finalY + 10);

            doc.save(`Resumen_Cartera_${now.toISOString().split('T')[0]}.pdf`);
        } catch (error) {
            console.error("Error al generar resumen PDF:", error);
            alert("Error al generar el resumen.");
        }
    };

    const handleUpdateFile = async (e) => {
        const file = e.target.files[0];
        if (!file || !editingPolicy) return;

        if (file.size > 15 * 1024 * 1024) {
            alert("El archivo es demasiado grande (máximo 15MB)");
            return;
        }

        setIsSaving(true);
        const name = file.name.replace(/[^a-zA-Z0-9.]/g, '_');

        try {
            const reader = new FileReader();
            const base64Promise = new Promise((resolve) => {
                reader.onload = (ev) => resolve(ev.target.result);
                reader.readAsDataURL(file);
            });
            const fullBase64 = await base64Promise;
            const rawBase64 = fullBase64.split(',')[1];

            let aiData = {};

            try {
                aiData = await analyzePolicyWithAI(rawBase64);
            } catch (err) {
                console.warn("IA falló al leer manual:", err);
            }

            // Guardar archivo en chunks de Firestore
            setIsLoading(true); // Usamos el estado del modal si existe

            const newAttachment = {
                chunked: true,
                name: file.name,
                type: file.type || 'application/pdf',
                size: file.size,
                timestamp: new Date().toISOString()
            };

            // Fusion NO destructiva
            const updatedPolicy = { ...editingPolicy };
            Object.keys(aiData).forEach(k => {
                const existingVal = editingPolicy[k];
                const newVal = aiData[k];

                if (k === 'riskDetails' && aiData.riskDetails) {
                    if (!updatedPolicy.riskDetails) updatedPolicy.riskDetails = {};
                    if (aiData.riskDetails.vehicle) {
                        if (!updatedPolicy.riskDetails.vehicle) updatedPolicy.riskDetails.vehicle = {};
                        Object.keys(aiData.riskDetails.vehicle).forEach(vk => {
                            const vVal = aiData.riskDetails.vehicle[vk];
                            if (vVal && !editingPolicy.riskDetails?.vehicle?.[vk]) {
                                updatedPolicy.riskDetails.vehicle[vk] = vVal;
                            }
                        });
                    }
                    if ((aiData.riskDetails.coverages?.length || 0) > (updatedPolicy.riskDetails.coverages?.length || 0)) {
                        updatedPolicy.riskDetails.coverages = aiData.riskDetails.coverages;
                    }
                } else if (newVal !== undefined && newVal !== null && newVal !== '') {
                    if (!existingVal || existingVal === '' || existingVal === '0' || existingVal === 0) {
                        updatedPolicy[k] = newVal;
                    }
                }
            });

            // Guardar attachment metadata
            updatedPolicy.attachments = [newAttachment];
            updatedPolicy.fileName = file.name;

            setEditingPolicy(updatedPolicy);

            if (editingPolicy.id) {
                await updatePolicy(editingPolicy.id, updatedPolicy);
                // Guardar los chunks despues de tener el ID (o usar el existente)
                await saveFileChunks(editingPolicy.id, rawBase64, file.name, file.type || 'application/pdf');
            }

            setUploadResult({
                isOpen: true,
                status: 'success',
                message: '¡Archivo y datos guardados!',
                details: [`✅ ${file.name}: Guardado correctamente en la póliza.`]
            });
        } catch (error) {
            console.error("Upload error:", error);
            setUploadResult({
                isOpen: true,
                status: 'error',
                message: 'Error al actualizar el archivo.',
                details: [`❌ Error: ${error.message}`]
            });
        } finally {
            setIsSaving(false);
            if (e.target) e.target.value = '';
        }
    };

    const handleRemoveFile = (index) => {
        if (window.confirm("¿Estás seguro de eliminar este archivo adjunto?")) {
            setEditingPolicy(prev => {
                const newAttachments = [...(prev.attachments || [])];
                newAttachments.splice(index, 1);

                const updated = {
                    ...prev,
                    attachments: newAttachments
                };

                // Si borramos el último y queda el legacy, lo limpiamos también para consistencia
                if (newAttachments.length === 0) {
                    updated.fileUrl = null;
                    updated.fileName = null;
                    updated.fileBase64 = null;
                }

                return updated;
            });
        }
    };

    const handleQuickUpload = async (pol, file) => {
        if (!file || !pol?.id) return;

        if (file.size > 15 * 1024 * 1024) {
            alert("El archivo es demasiado grande (máximo 15MB)");
            return;
        }

        setIsProcessing(true);
        setProgress({ message: `Preparando subida para ${pol.clientName}...`, percent: 10 });

        const name = file.name.replace(/[^a-zA-Z0-9.]/g, '_');

        try {
            const reader = new FileReader();
            const base64Promise = new Promise((resolve) => {
                reader.onload = (ev) => resolve(ev.target.result);
                reader.readAsDataURL(file);
            });
            const fullBase64 = await base64Promise;
            const rawBase64 = fullBase64.split(',')[1];

            let aiData = {};

            // Intentar extraer datos con IA
            try {
                setProgress({ message: 'Escaneando con IA...', percent: 20 });
                aiData = await analyzePolicyWithAI(rawBase64);
            } catch (err) {
                console.warn("IA falló en QuickUpload:", err);
            }

            // Guardar archivo en chunks de Firestore
            setProgress({ message: 'Guardando archivo...', percent: 50 });

            const newAttachment = {
                chunked: true,
                name: file.name,
                type: file.type || 'application/pdf',
                size: file.size,
                timestamp: new Date().toISOString()
            };

            setProgress({ message: 'Guardando datos...', percent: 70 });

            const updatedData = { ...pol };
            Object.keys(aiData).forEach(k => {
                const existingVal = pol[k];
                const newVal = aiData[k];

                if (k === 'riskDetails' && aiData.riskDetails) {
                    if (!updatedData.riskDetails) updatedData.riskDetails = {};
                    if (aiData.riskDetails.vehicle) {
                        if (!updatedData.riskDetails.vehicle) updatedData.riskDetails.vehicle = {};
                        Object.keys(aiData.riskDetails.vehicle).forEach(vk => {
                            const vVal = aiData.riskDetails.vehicle[vk];
                            if (vVal && !pol.riskDetails?.vehicle?.[vk]) {
                                updatedData.riskDetails.vehicle[vk] = vVal;
                            }
                        });
                    }
                    if ((aiData.riskDetails.coverages?.length || 0) > (updatedData.riskDetails.coverages?.length || 0)) {
                        updatedData.riskDetails.coverages = aiData.riskDetails.coverages;
                    }
                } else if (newVal !== undefined && newVal !== null && newVal !== '') {
                    if (!existingVal || existingVal === '' || existingVal === '0' || existingVal === 0) {
                        updatedData[k] = newVal;
                    }
                }
            });

            // Guardar attachment metadata (sin base64 inline)
            updatedData.attachments = [newAttachment];
            updatedData.fileName = file.name;

            await updatePolicy(pol.id, updatedData);

            // Sincronizar info del cliente en todas sus pólizas
            if (aiData.clientName || aiData.dni) {
                const syncData = {};
                if (aiData.clientName) syncData.clientName = aiData.clientName;
                if (aiData.dni) syncData.dni = aiData.dni;
                if (Object.keys(syncData).length > 0) {
                    await updateClientData(pol.dni || aiData.dni, syncData);
                }
            }

            // Guardar el archivo como chunks en subcollection
            setProgress({ message: 'Subiendo archivo...', percent: 85 });
            await saveFileChunks(pol.id, rawBase64, file.name, file.type || 'application/pdf');

            setProgress({ message: 'Archivo guardado!', percent: 100 });
            setTimeout(() => {
                setIsProcessing(false);
                setProgress({ message: '', percent: 0 });
            }, 1000);

        } catch (error) {
            console.error("Quick upload error:", error);
            alert(`ERROR: ${error.message}`);
            setIsProcessing(false);
            setProgress({ message: '', percent: 0 });
        }
    };

    // Alias para uso en la UI de subida directa
    const handleUploadDirect = handleQuickUpload;

    // Helper: encuentra el mejor archivo disponible para una póliza
    const getFileData = (pol) => {
        // 1. Buscar en attachments (chunked o con datos directos)
        if (pol.attachments && pol.attachments.length > 0) {
            const validAttachment = pol.attachments.find(a => a.chunked || a.url || a.base64);
            if (validAttachment) return validAttachment;
        }
        // 2. Fallback: campos legacy
        if (pol.fileUrl || pol.fileBase64) {
            return { url: pol.fileUrl, base64: pol.fileBase64, name: pol.fileName };
        }
        return null;
    };

    // Helper: tiene archivo?
    const hasFileData = (pol) => getFileData(pol) !== null;

    const handleOpenFile = async (pol) => {
        try {
            let fileToOpen = getFileData(pol);

            if (!fileToOpen) {
                alert("Este registro no tiene archivo adjunto.");
                return;
            }

            // Si es chunked, cargar los chunks de Firestore
            if (fileToOpen.chunked && pol.id) {
                setIsProcessing(true);
                setProgress({ message: 'Cargando archivo...', percent: 30 });
                const base64Data = await loadFileChunks(pol.id);
                setIsProcessing(false);
                setProgress({ message: '', percent: 0 });

                if (!base64Data) {
                    alert("No se pudo cargar el archivo.");
                    return;
                }

                const mimeType = fileToOpen.type || 'application/pdf';
                const byteCharacters = atob(base64Data);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                const blobFile = new Blob([byteArray], { type: mimeType });
                const blobUrl = URL.createObjectURL(blobFile);
                window.open(blobUrl, '_blank');
                return;
            }

            if (fileToOpen.url) {
                window.open(fileToOpen.url, '_blank');
            } else if (fileToOpen.base64) {
                openBase64(fileToOpen.base64);
            } else {
                alert("El archivo no tiene datos. Subi uno nuevo.");
            }
        } catch (err) {
            console.error("Error en handleOpenFile:", err);
            alert("Error al abrir: " + err.message);
            setIsProcessing(false);
            setProgress({ message: '', percent: 0 });
        }
    };

    const handleDownloadFile = async (file, policyId) => {
        if (!file.url && !file.base64 && !file.chunked) {
            alert("No hay datos para descargar");
            return;
        }

        try {
            let cleanBase64 = null;
            let mimeType = file.type || 'application/pdf';

            // Si es chunked, cargar desde subcollection
            if (file.chunked && policyId) {
                setIsProcessing(true);
                setProgress({ message: 'Cargando archivo...', percent: 30 });
                cleanBase64 = await loadFileChunks(policyId);
                setIsProcessing(false);
                setProgress({ message: '', percent: 0 });

                if (!cleanBase64) {
                    alert("No se pudo cargar el archivo.");
                    return;
                }
            } else if (file.url) {
                window.open(file.url, '_blank');
                return;
            } else if (file.base64) {
                cleanBase64 = file.base64;
                if (cleanBase64.includes(',')) {
                    const parts = cleanBase64.split(',');
                    const match = parts[0].match(/data:(.*?);/);
                    if (match) mimeType = match[1];
                    cleanBase64 = parts[1];
                }
            }

            if (cleanBase64) {
                const byteCharacters = atob(cleanBase64);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                const blobFile = new Blob([byteArray], { type: mimeType });
                const url = window.URL.createObjectURL(blobFile);

                const a = document.createElement('a');
                a.href = url;
                a.download = file.name || 'documento.pdf';
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
            }
        } catch (err) {
            console.error("Error al descargar:", err);
            alert("Error al intentar descargar el archivo");
            setIsProcessing(false);
            setProgress({ message: '', percent: 0 });
        }
    };

    const openBase64 = (base64String) => {
        try {
            let cleanBase64 = base64String;
            let mimeType = 'application/pdf';

            if (cleanBase64.includes(',')) {
                const parts = cleanBase64.split(',');
                const match = parts[0].match(/data:(.*?);/);
                if (match) mimeType = match[1];
                cleanBase64 = parts[1];
            }

            const byteCharacters = atob(cleanBase64);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: mimeType });
            const blobUrl = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = blobUrl;
            link.target = '_blank';
            document.body.appendChild(link);
            link.click();

            // Limpiar memoria después de un tiempo
            setTimeout(() => {
                URL.revokeObjectURL(blobUrl);
                document.body.removeChild(link);
            }, 10000);
        } catch (err) {
            console.error("Error al abrir Base64:", err);
            alert("No se pudo abrir el archivo base64");
        }
    };

    return (
        <div className="w-full relative">
            <div className="w-full space-y-8 animate-in fade-in duration-500 mb-20">
                {/* 1. Fila de Encabezado (Título y Acciones Globales) */}
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3 md:gap-4 bg-[var(--card-bg)] p-3 md:p-5 rounded-2xl md:rounded-[24px] border border-[var(--border-color)] backdrop-blur-xl transition-all shadow-[var(--card-shadow)]">
                    <div className="flex flex-col gap-5">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-indigo-500/10 rounded-xl">
                                <Users size={24} className="text-indigo-500" />
                            </div>
                            <div>
                                <h1 className="text-xl md:text-2xl font-black text-[var(--text-color)] uppercase tracking-tight">
                                    Gestión de Clientes
                                </h1>
                                <p className="text-[var(--text-secondary)] text-[10px] font-black uppercase tracking-[0.3em]">
                                    Cartera de Seguros Activa
                                </p>
                            </div>
                        </div>

                        {/* Botones de Acciones - ABAJO DEL TÍTULO (Feedback v17) */}
                        <div className="flex flex-wrap items-center gap-1.5 p-1 bg-[var(--bg-color)] rounded-xl border border-[var(--border-color)] w-fit shadow-inner">
                            <button
                                onClick={handleManualAdd}
                                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-500 text-white hover:bg-indigo-400 transition-all font-black uppercase text-[10px] tracking-widest shadow-lg shadow-indigo-500/10"
                            >
                                <Save size={14} />
                                Nueva
                            </button>
                            <label className="flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer hover:bg-[var(--text-color)]/5 text-[var(--text-secondary)] hover:text-[var(--text-color)] transition-all">
                                <Zap size={14} className="text-emerald-500" />
                                <span className="text-[10px] font-black uppercase tracking-widest">Planilla</span>
                                <input type="file" className="hidden" accept=".csv,.xlsx,.xls" onChange={handleCsvUploadWithAI} disabled={isProcessing} />
                            </label>
                            <label className="flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer hover:bg-[var(--text-color)]/5 text-[var(--text-secondary)] hover:text-[var(--text-color)] transition-all">
                                <Upload size={14} className="text-indigo-500" />
                                <span className="text-[10px] font-black uppercase tracking-widest">PDF IA</span>
                                <input type="file" className="hidden" accept=".pdf" onChange={handleFileUpload} disabled={isProcessing} multiple />
                            </label>
                            <label className="flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer hover:bg-[var(--text-color)]/5 text-[var(--text-secondary)] hover:text-[var(--text-color)] transition-all border-l border-[var(--border-color)] ml-1">
                                <ShieldCheck size={14} className="text-orange-500" />
                                <span className="text-[10px] font-black uppercase tracking-widest">Auditar</span>
                                <input type="file" className="hidden" accept=".xlsx,.xls" onChange={handleAuditUpload} disabled={isProcessing} />
                            </label>
                            <button
                                onClick={handleExportPDF}
                                className="flex items-center gap-2 px-3 py-2.5 rounded-lg hover:bg-orange-500/10 text-orange-400 transition-all group"
                                title="Exportar Cartera Completa a PDF"
                            >
                                <DownloadCloud size={14} className="group-hover:scale-110 transition-transform duration-500" />
                                <span className="text-[10px] font-black uppercase tracking-widest hidden sm:inline">Exportar PDF</span>
                            </button>
                            <button
                                onClick={handleExportSummaryPDF}
                                className="flex items-center gap-2 px-3 py-2.5 rounded-lg hover:bg-indigo-500/10 text-indigo-400 transition-all group"
                                title="Reporte Resumen de Totales"
                            >
                                <Activity size={14} className="group-hover:scale-110 transition-transform duration-500" />
                                <span className="text-[10px] font-black uppercase tracking-widest hidden sm:inline">Resumen</span>
                            </button>
                            {policies.length > 0 && (
                                <div className="flex items-center gap-1 border-l border-white/5 pl-1 ml-1">
                                    <button
                                        onClick={handleMergeClients}
                                        disabled={isProcessing}
                                        className="flex items-center gap-2 px-3 py-2.5 rounded-lg hover:bg-emerald-500/10 text-emerald-400 transition-all group"
                                        title="Unificar pólizas de un mismo cliente bajo un único DNI/CUIT"
                                    >
                                        <Users size={14} className="group-hover:scale-110 transition-transform duration-500" />
                                        <span className="text-[10px] font-black uppercase tracking-widest hidden sm:inline">Fusionar Clientes</span>
                                    </button>
                                    <button
                                        onClick={handleUnify}
                                        className="p-2.5 rounded-lg text-[var(--text-secondary)] hover:text-indigo-400 hover:bg-indigo-500/10 transition-all"
                                        title="Unificar Duplicados"
                                    >
                                        <RefreshCw size={16} />
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        {/* Métricas Globales en línea */}
                        <div className="hidden xl:flex items-center gap-6 px-6 border-r border-[var(--border-color)] mr-2">
                            <div className="text-center">
                                <p className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-widest leading-none mb-1">Activas</p>
                                <p className="text-base font-black text-[var(--text-color)] leading-none">{stats.totalActivePolicies}</p>
                            </div>
                            <div className="text-center border-l border-[var(--border-color)] pl-4">
                                <p className="text-[9px] font-black text-indigo-500 uppercase tracking-widest leading-none mb-1">Total Clientes</p>
                                <p className="text-base font-black text-[var(--text-color)] leading-none">{stats.totalClients}</p>
                            </div>
                            <div className="flex gap-4">
                                <div className="text-center border-l border-[var(--border-color)] pl-4">
                                    <p className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-widest leading-none mb-1">Valuación ARS</p>
                                    <p className="text-base font-black text-emerald-500 leading-none">${stats.totalPrimaARS.toLocaleString('es-AR')}</p>
                                </div>
                                {stats.totalPrimaUSD > 0 && (
                                    <div className="text-center border-l border-[var(--border-color)] pl-4">
                                        <p className="text-[9px] font-black text-indigo-500 uppercase tracking-widest leading-none mb-1">Valuación USD</p>
                                        <p className="text-base font-black text-indigo-500 leading-none">u$s {stats.totalPrimaUSD.toLocaleString('es-AR')}</p>
                                    </div>
                                )}
                                {stats.totalCancelled > 0 && (
                                    <>
                                        <div className="text-center border-l border-[var(--border-color)] pl-4 group/canc">
                                            <p className="text-[9px] font-black text-red-500 uppercase tracking-widest leading-none mb-1 group-hover/canc:animate-pulse">Anuladas</p>
                                            <p className="text-base font-black text-red-500 leading-none">{stats.totalCancelled}</p>
                                        </div>
                                        <div className="hidden 2xl:flex items-center gap-3 border-l border-[var(--border-color)] pl-4 overflow-hidden">
                                            {Object.entries(stats.cancelledByReason).map(([reason, count]) => (
                                                <div key={reason} className="flex flex-col items-start px-2 border-r border-white/5 last:border-0 hover:bg-white/5 rounded-lg transition-colors py-1">
                                                    <span className="text-[7px] font-black uppercase text-zinc-500 tracking-tighter">{reason}</span>
                                                    <span className="text-[11px] font-black text-red-400 leading-none">{count}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Barra de Búsqueda y Filtros Rápidos */}
                        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
                            {/* Búsqueda (Más grande en PC) */}
                            <div className="relative flex-1 md:flex-initial md:w-64 xl:w-96 group">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] group-focus-within:text-indigo-500 transition-colors" size={16} />
                                <input
                                    type="text"
                                    placeholder="Buscar por nombre, DNI o póliza..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="w-full bg-[var(--bg-color)] border border-[var(--border-color)] rounded-xl py-2.5 pl-10 pr-4 text-[13px] text-[var(--text-color)] focus:outline-none focus:border-indigo-500/50 transition-all font-bold tracking-wide placeholder:text-[var(--text-secondary)]/50 shadow-sm"
                                />
                            </div>

                            {/* Filtro Archivo */}
                            <div className="relative">
                                <select
                                    value={filterAttachment}
                                    onChange={(e) => setFilterAttachment(e.target.value)}
                                    className="bg-[var(--bg-color)] border border-[var(--border-color)] rounded-xl px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 transition-all appearance-none cursor-pointer pr-10 shadow-sm min-w-[140px]"
                                >
                                    <option value="All">Todos los Archivos</option>
                                    <option value="WithFile">Con Adjunto ✅</option>
                                    <option value="WithoutFile">Sin Adjunto ❌</option>
                                </select>
                                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-indigo-400">
                                    <FileText size={14} />
                                </div>
                            </div>

                            {/* Filtro Estado (Vencidas) */}
                            <div className="relative">
                                <select
                                    value={filterStatus}
                                    onChange={(e) => setFilterStatus(e.target.value)}
                                    className="bg-[var(--bg-color)] border border-[var(--border-color)] rounded-xl px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-500/30 transition-all appearance-none cursor-pointer pr-10 shadow-sm min-w-[140px]"
                                >
                                    <option value="All">Todos los Estados</option>
                                    <option value="Active">Solo Vigentes</option>
                                    <option value="Expired">Solo Vencidas ⌛</option>
                                    <option value="Cancelled">Solo Anuladas 🚫</option>
                                </select>
                                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-orange-400">
                                    <AlertTriangle size={14} />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 2. Barra de Estadísticas por Ramo (Full Width) - FILTROS ACTIVOS */}
                <div className="w-full bg-[var(--card-bg)] border border-[var(--border-color)] rounded-[16px] p-1.5 md:p-3 backdrop-blur-md overflow-x-auto no-scrollbar shadow-[var(--card-shadow)] group/strip">
                    <div className="flex items-center justify-between min-w-max px-1">
                        <div className="flex items-center gap-1.5 pr-3 border-r border-[var(--border-color)] ml-1">
                            <div className="p-1 bg-orange-500/10 text-orange-500 rounded-lg group-hover/strip:bg-orange-500 group-hover/strip:text-black transition-all duration-500">
                                <ListFilter size={14} />
                            </div>
                            <span className="text-[8px] font-black text-[var(--text-secondary)] uppercase tracking-[0.1em] whitespace-nowrap">Ramos</span>
                        </div>
                        <div className="flex-1 flex justify-around px-1">
                            {RAMOS.map(ramo => {
                                const isActive = filterRisk === ramo;
                                return (
                                    <button
                                        key={ramo}
                                        onClick={() => setFilterRisk(isActive ? 'All' : ramo)}
                                        className={`flex flex-col items-center group/item cursor-pointer px-1 relative transition-all ${isActive ? 'scale-105' : 'opacity-70 hover:opacity-100'}`}
                                    >
                                        <span className={`text-[7px] font-black uppercase tracking-tight transition-colors ${isActive ? 'text-indigo-500' : 'text-[var(--text-secondary)] group-hover/item:text-indigo-500'}`}>
                                            {ramo}
                                        </span>
                                        <div className="flex items-baseline gap-1 mt-0.5">
                                            <span className={`text-[14px] font-black italic drop-shadow-md transition-all duration-300 ${isActive ? 'text-indigo-500 scale-105' : 'text-[var(--text-color)] group-hover/item:scale-110'}`}>
                                                {stats.clientsByBranch[ramo] || 0}
                                            </span>
                                            <div className={`h-0.5 w-0.5 rounded-full transition-all ${isActive ? 'bg-indigo-500 scale-125 shadow-[0_0_8px_rgba(129,140,248,0.8)]' : 'bg-indigo-500/20 group-hover/item:bg-indigo-500 group-hover/item:scale-125'}`} />
                                        </div>
                                        <div className={`absolute -bottom-1 left-1/2 -translate-x-1/2 h-0.5 bg-indigo-500 transition-all duration-300 rounded-full ${isActive ? 'w-full opacity-100' : 'w-0 opacity-0 group-hover/item:w-full opacity-50'}`} />
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>



                {/* Float Action Bar for selection */}
                <AnimatePresence>
                    {selectedIds.length > 0 && (
                        <motion.div
                            initial={{ opacity: 0, y: 50 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 50 }}
                            className="fixed bottom-24 md:bottom-10 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 md:gap-6 px-4 md:px-8 py-3 md:py-4 bg-[var(--card-bg)] border border-indigo-500/30 rounded-2xl md:rounded-3xl shadow-[var(--card-shadow)] backdrop-blur-3xl w-[calc(100%-2rem)] md:w-auto"
                        >
                            <div className="flex flex-col">
                                <span className="text-[11px] font-black text-indigo-500 uppercase tracking-widest">{selectedIds.length} Pólizas seleccionadas</span>
                                <span className="text-[9px] text-[var(--text-secondary)] uppercase font-bold">Resumen de acciones masivas</span>
                            </div>
                            <div className="w-px h-8 bg-[var(--border-color)]" />
                            <button
                                onClick={handleBulkDelete}
                                className="flex items-center gap-3 px-6 py-2.5 bg-red-500/10 text-red-500 border border-red-500/20 rounded-xl hover:bg-red-500 hover:text-white transition-all text-[10px] font-black uppercase tracking-widest"
                            >
                                <Trash2 size={16} />
                                Borrar todos los registros que elegí
                            </button>
                            <button
                                onClick={() => setSelectedIds([])}
                                className="text-[var(--text-secondary)] hover:text-white transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Extraction Progress Overlay */}
                <AnimatePresence>
                    {isProcessing && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-6"
                        >
                            <div className="w-full max-w-md bg-zinc-900 border border-white/10 p-8 rounded-[32px] text-center shadow-2xl">
                                <div className="w-20 h-20 bg-indigo-500/10 rounded-full flex items-center justify-center mx-auto mb-6 relative">
                                    <div className="absolute inset-0 rounded-full border-2 border-indigo-500/10" />
                                    <div
                                        className="absolute inset-0 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin"
                                        style={{ animationDuration: '0.8s' }}
                                    />
                                    <Cpu size={32} className="text-indigo-400" />
                                </div>

                                <h3 className="text-lg font-black text-white uppercase tracking-tight mb-2">
                                    {progress.message}
                                </h3>
                                <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden mb-4">
                                    <motion.div
                                        className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500"
                                        initial={{ width: 0 }}
                                        animate={{ width: `${progress.percent}% ` }}
                                    />
                                </div>
                                <p className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-widest animate-pulse">
                                    Por favor no cierres esta ventana
                                </p>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>


                {/* 3. Search and Table Filter Area */}
                <div className="bg-[var(--card-bg)] rounded-[28px] border border-[var(--border-color)] overflow-hidden backdrop-blur-xl transition-all shadow-[var(--card-shadow)]">
                    <div className="p-2.5 border-b border-[var(--border-color)] flex flex-col xl:flex-row justify-between items-center gap-3">
                        <div className="flex items-center gap-4 w-full xl:w-auto">
                            {/* Company Filter Standardized */}
                            <div className="relative">
                                <select
                                    value={filterCompany}
                                    onChange={(e) => setFilterCompany(e.target.value)}
                                    className="bg-[var(--bg-color)] border border-[var(--border-color)] rounded-xl px-4 py-2 text-[11px] font-black uppercase tracking-widest text-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all appearance-none cursor-pointer pr-10 shadow-sm"
                                >
                                    <option value="All" className="bg-[var(--card-bg)]">Todas las Compañías</option>
                                    {stats.companies.map(c => (
                                        <option key={c} value={c} className="bg-[var(--card-bg)]">{c}</option>
                                    ))}
                                </select>
                                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-indigo-500">
                                    <ListFilter size={14} />
                                </div>
                            </div>

                            {(filterCompany !== 'All' || filterRisk !== 'All' || searchTerm !== '' || showOnlyMissingFiles) && (
                                <button
                                    onClick={() => {
                                        setFilterCompany('All');
                                        setFilterRisk('All');
                                        setFilterAttachment('All');
                                        setFilterStatus('Active');
                                        setSearchTerm('');
                                        setShowOnlyMissingFiles(false);
                                    }}
                                    className="flex items-center gap-2 px-4 py-2.5 bg-rose-500/10 rounded-xl border border-rose-500/20 hover:bg-rose-500/20 text-rose-400 transition-all group"
                                    title="Quitar todos los filtros"
                                >
                                    <RefreshCw size={12} className="group-hover:rotate-180 transition-transform duration-500" />
                                    <span className="text-[10px] font-black uppercase tracking-widest">Borrar Filtros</span>
                                </button>
                            )}
                        </div>

                        {showOnlyMissingFiles && (
                            <div className="flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 px-3 py-1 rounded-xl">
                                <FileWarning size={12} className="text-indigo-400" />
                                <span className="text-[10px] font-bold text-white uppercase tracking-wider">Solo sin adjuntos</span>
                                <button
                                    onClick={() => setShowOnlyMissingFiles(false)}
                                    className="ml-1 p-1 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white transition-all"
                                >
                                    <X size={12} />
                                </button>
                            </div>
                        )}


                        <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto">
                            <div className="flex gap-1 p-1 bg-[var(--bg-color)] rounded-xl border border-[var(--border-color)] overflow-x-auto max-w-full shadow-inner">
                                {['Todos', ...RAMOS].map(risk => (
                                    <button
                                        key={risk}
                                        onClick={() => setFilterRisk(risk === 'Todos' ? 'All' : risk)}
                                        className={`
                                        px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-[0.05em] transition-all whitespace-nowrap
                                        ${(filterRisk === 'All' && risk === 'Todos') || filterRisk === risk ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'text-[var(--text-secondary)] hover:text-indigo-500 hover:bg-indigo-500/5'}
                                    `}
                                    >
                                        {risk}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] backdrop-blur-3xl rounded-2xl md:rounded-[2.5rem] p-1 shadow-[var(--card-shadow)] mt-4 md:mt-6">

                        {/* === MOBILE CARD LAYOUT === */}
                        <div className="md:hidden p-2 space-y-2">
                            {loading ? (
                                [1, 2, 3].map(i => (
                                    <div key={i} className="animate-pulse bg-[var(--bg-color)] rounded-xl p-4 border border-[var(--border-color)]">
                                        <div className="w-32 h-3 bg-[var(--text-color)]/10 rounded mb-2" />
                                        <div className="w-20 h-2 bg-[var(--text-color)]/5 rounded" />
                                    </div>
                                ))
                            ) : (() => {
                                const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
                                const paginatedGroups = groupedPolicies.slice(startIndex, startIndex + ITEMS_PER_PAGE);
                                return paginatedGroups.map((group) => {
                                    const allCancelled = group.policies.every(p => p.isCancelled);
                                    const anyWithFile = group.policies.some(p => hasFileData(p));
                                    return (
                                        <div key={group.id} className={`bg-[var(--bg-color)] rounded-xl border border-[var(--border-color)] p-3 ${allCancelled ? 'opacity-50' : ''}`}>
                                            {/* Client Header */}
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="flex items-center gap-2 min-w-0 flex-1" onClick={() => handleEdit(group.policies[0])}>
                                                    <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
                                                        <Users size={14} />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="text-[12px] font-black text-[var(--text-color)] uppercase truncate leading-tight">{group.clientName}</p>
                                                        <p className="text-[10px] text-[var(--text-secondary)] font-bold italic">DNI: {group.dni}</p>
                                                    </div>
                                                </div>
                                                {/* Client-level File Action (Mobile) */}
                                                <div className="ml-2">
                                                    {anyWithFile ? (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                const polWithFile = group.policies.find(p => hasFileData(p));
                                                                if (polWithFile) handleOpenFile(polWithFile);
                                                            }}
                                                            className="w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500"
                                                        >
                                                            <Check size={14} strokeWidth={4} />
                                                        </button>
                                                    ) : (
                                                        <label className="w-8 h-8 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-500 cursor-pointer">
                                                            <Upload size={14} strokeWidth={3} />
                                                            <input
                                                                type="file"
                                                                className="hidden"
                                                                onChange={(e) => {
                                                                    const file = e.target.files[0];
                                                                    if (file) handleQuickUpload(group.policies[0], file);
                                                                }}
                                                                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                                                            />
                                                        </label>
                                                    )}
                                                </div>
                                            </div>
                                            {/* Policies List */}
                                            {group.policies.map(p => (
                                                <div key={p.id} className={`mt-1.5 p-2 rounded-lg border ${p.isCancelled ? 'bg-red-500/5 border-red-500/20' : getExpirationRowBg(p.endDate) || 'bg-black/20 border-white/5'}`}>
                                                    <div className="flex items-center justify-between gap-2 mb-1">
                                                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase ${p.isCancelled ? 'bg-red-500/20 text-red-400' : 'bg-indigo-500/10 text-indigo-400'}`}>{p.riskType}</span>
                                                            <span className="text-[10px] font-bold text-[var(--text-secondary)] truncate italic">{abbreviateCompany(p.company)}</span>
                                                        </div>
                                                        <span className="text-[12px] font-black text-emerald-400 italic shrink-0">${(Number(p.prima) || 0).toLocaleString('es-AR')}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between">
                                                        <span className={`text-[10px] ${getExpirationColor(p.endDate)}`}>
                                                            Vence: {p.endDate ? new Date(p.endDate).toLocaleDateString('es-AR') : '--'}
                                                        </span>
                                                        {/* Action Buttons */}
                                                        <div className="flex items-center gap-1">
                                                            <button onClick={() => handleEdit(p)} className="p-2 rounded-lg bg-[var(--text-color)]/5 text-[var(--text-secondary)] active:bg-indigo-500/20 active:text-indigo-400" title="Editar">
                                                                <Edit2 size={14} />
                                                            </button>
                                                            <button onClick={() => handleDelete(p.id)} className="p-2 rounded-lg bg-[var(--text-color)]/5 text-[var(--text-secondary)] active:bg-red-500/20 active:text-red-400" title="Eliminar">
                                                                <Trash2 size={14} />
                                                            </button>
                                                            {hasFileData(p) ? (
                                                                <>
                                                                    <button onClick={() => handleOpenFile(p)} className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500 active:bg-emerald-500 active:text-white" title="Ver">
                                                                        <Eye size={14} />
                                                                    </button>
                                                                    <button onClick={() => { const f = getFileData(p); if (f) handleDownloadFile(f, p.id); }} className="p-2 rounded-lg bg-indigo-500/10 text-indigo-500 active:bg-indigo-500 active:text-white" title="Descargar">
                                                                        <Download size={14} />
                                                                    </button>
                                                                </>
                                                            ) : (
                                                                <label className="p-2 rounded-lg bg-indigo-500/10 text-indigo-500 active:bg-indigo-500 active:text-white cursor-pointer flex">
                                                                    <Upload size={14} />
                                                                    <input type="file" className="hidden" onChange={(e) => { const file = e.target.files[0]; if (file) handleUploadDirect(p, file); }} accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" />
                                                                </label>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    );
                                });
                            })()}
                        </div>

                        {/* === DESKTOP TABLE LAYOUT === */}
                        <div className="hidden md:block overflow-x-auto min-h-[500px] custom-scrollbar px-6 py-2">
                            <table className="w-full border-separate border-spacing-y-2 relative" style={{ tableLayout: 'fixed' }}>
                                <thead className="sticky top-0 bg-[var(--card-bg)]/90 backdrop-blur-md z-20">
                                    <tr className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-[0.1em]">
                                        <th className="w-8 py-4 px-2 text-center group/th rounded-l-[1rem]" style={{ width: colWidths.check }}>
                                            <div className="flex items-center justify-center">
                                                <WidthControl col="check" />
                                                <button
                                                    onClick={toggleSelectAll}
                                                    className="p-1 rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-indigo-400 transition-all bg-[var(--bg-color)] shadow-sm"
                                                    title="Seleccionar todo de esta página"
                                                >
                                                    {filteredPolicies.length > 0 && selectedIds.length > 0
                                                        ? selectedIds.length === filteredPolicies.length
                                                            ? <CheckSquare size={12} className="text-indigo-500" />
                                                            : <MinusCircle size={12} className="text-indigo-400" />
                                                        : <Square size={12} />
                                                    }
                                                </button>
                                            </div>
                                        </th>
                                        <th className="py-4 text-left group/th pl-4" style={{ width: colWidths.client }}>
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                                                    <User size={11} /> Cliente / DNI
                                                </div>
                                                <WidthControl col="client" />
                                            </div>
                                        </th>
                                        <th className="py-4 text-left group/th" style={{ width: colWidths.company }}>
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                                                    <Building2 size={11} /> Compañía
                                                </div>
                                                <WidthControl col="company" />
                                            </div>
                                        </th>
                                        <th className="py-4 pr-2 text-right group/th" style={{ width: colWidths.risk }}>
                                            <div className="flex items-center justify-end">
                                                <WidthControl col="risk" />
                                                <div className="flex items-center gap-1 text-[var(--text-secondary)] ml-1">
                                                    <Zap size={11} /> Ramo
                                                </div>
                                            </div>
                                        </th>
                                        <th className="py-4 pl-2 text-left group/th" style={{ width: colWidths.premium }}>
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-1 text-[var(--text-secondary)]">
                                                    <DollarSign size={11} /> Prima
                                                </div>
                                                <WidthControl col="premium" />
                                            </div>
                                        </th>
                                        <th className="py-4 pl-4 text-left group/th" style={{ width: colWidths.endDate }}>
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                                                    <History size={11} /> Vence
                                                </div>
                                                <WidthControl col="endDate" />
                                            </div>
                                        </th>
                                        <th className="py-4 px-2 text-center group/th rounded-r-[1rem]" style={{ width: colWidths.actions }}>
                                            <div className="flex items-center justify-center">
                                                <span className="text-[10px]">Acciones</span>
                                                <WidthControl col="actions" />
                                            </div>
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loading ? (
                                        [1, 2, 3, 4, 5].map(i => (
                                            <tr key={i} className="animate-pulse">
                                                <td className="px-5 py-2"><div className="w-4 h-4 bg-[var(--text-color)]/5 rounded mx-auto" /></td>
                                                <td className="px-5 py-2">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-7 h-7 rounded-lg bg-[var(--text-color)]/5" />
                                                        <div className="space-y-1">
                                                            <div className="w-20 h-2 bg-[var(--text-color)]/10 rounded" />
                                                            <div className="w-12 h-1.5 bg-[var(--text-color)]/5 rounded" />
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-3 py-2"><div className="w-16 h-2 bg-[var(--text-color)]/5 rounded" /></td>
                                                <td className="px-3 py-2"><div className="w-10 h-4 bg-[var(--text-color)]/5 rounded-full" /></td>
                                                <td className="px-3 py-2 text-right"><div className="w-12 h-2 bg-[var(--text-color)]/5 rounded ml-auto" /></td>
                                                <td className="px-3 py-2"><div className="w-12 h-2 bg-[var(--text-color)]/5 rounded" /></td>
                                                <td className="px-3 py-2 text-center"><div className="w-20 h-6 bg-[var(--text-color)]/5 rounded-lg mx-auto" /></td>
                                            </tr>
                                        ))
                                    ) : (
                                        <AnimatePresence>
                                            {(() => {
                                                const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
                                                const paginatedGroups = groupedPolicies.slice(startIndex, startIndex + ITEMS_PER_PAGE);

                                                return paginatedGroups.map((group) => {
                                                    const pol = group.policies[0]; // Datos base del primer registro
                                                    const hasMultiple = group.policies.length > 1;
                                                    const allCancelled = group.policies.every(p => p.isCancelled);
                                                    const anyWithFile = group.policies.some(p => hasFileData(p));

                                                    // Totales y rangos
                                                    const totalPrima = group.policies.reduce((sum, p) => sum + (Number(p.prima) || 0), 0);
                                                    const totalPremio = group.policies.reduce((sum, p) => sum + (Number(p.premio) || 0), 0);

                                                    // Fecha más cercana (vencimiento)
                                                    const nextEndDate = group.policies
                                                        .filter(p => p.endDate && !p.isCancelled)
                                                        .map(p => new Date(p.endDate))
                                                        .sort((a, b) => a - b)[0];

                                                    return (
                                                        <motion.tr
                                                            key={group.id}
                                                            initial={false}
                                                            animate={{ opacity: 1, y: 0 }}
                                                            exit={{ opacity: 0, x: -20 }}
                                                            className={`group transition-all text-[13.5px] cursor-pointer hover:shadow-md ${allCancelled ? 'bg-red-500/5 text-red-400' : getExpirationRowBg(nextEndDate?.toISOString?.())}`}
                                                        >
                                                            <td className="py-2 px-2 text-center bg-[var(--bg-color)] border-y border-l border-[var(--border-color)] rounded-l-[1.5rem] group-hover:bg-[var(--card-bg)] group-hover:border-indigo-500/30 transition-all">
                                                                <div className="flex flex-col gap-1 items-center">
                                                                    {group.policies.map(p => (
                                                                        <button
                                                                            key={p.id}
                                                                            onClick={(e) => { e.stopPropagation(); toggleSelect(p.id); }}
                                                                            className={`p-1.5 rounded-lg border transition-all shadow-sm ${selectedIds.includes(p.id) ? 'bg-indigo-500 border-indigo-500 text-white shadow-indigo-500/20' : 'bg-black/20 border-white/10 text-[var(--text-secondary)] hover:border-indigo-500/50 hover:text-indigo-400'}`}
                                                                        >
                                                                            {selectedIds.includes(p.id) ? <CheckSquare size={12} /> : <Square size={12} />}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            </td>
                                                            <td className="py-3 px-4 bg-[var(--bg-color)] border-y border-[var(--border-color)] group-hover:bg-[var(--card-bg)] group-hover:border-y-indigo-500/30 transition-all font-black text-xs uppercase tracking-tight text-[var(--text-color)]" onClick={() => handleEdit(group.policies[0])}>
                                                                <div className="flex items-center gap-3">
                                                                    <div className="w-10 h-10 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0 shadow-inner">
                                                                        <Users size={18} />
                                                                    </div>
                                                                    <div className="flex flex-col gap-0 min-w-0">
                                                                        <div className="flex items-center gap-1.5">
                                                                            <p className="text-[15px] font-black text-[var(--text-color)] uppercase tracking-tight leading-tight truncate">{group.clientName}</p>
                                                                            {anyWithFile ? (
                                                                                <div
                                                                                    className="w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0 hover:bg-emerald-500 hover:text-white transition-all cursor-pointer"
                                                                                    title="Ver adjunto del cliente"
                                                                                    onClick={(e) => {
                                                                                        e.stopPropagation();
                                                                                        const polWithFile = group.policies.find(p => hasFileData(p));
                                                                                        if (polWithFile) handleOpenFile(polWithFile);
                                                                                    }}
                                                                                >
                                                                                    <Check size={10} strokeWidth={4} />
                                                                                </div>
                                                                            ) : (
                                                                                <label
                                                                                    className="w-5 h-5 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0 hover:bg-indigo-500 hover:text-white transition-all cursor-pointer"
                                                                                    title="Subir adjunto para el cliente"
                                                                                    onClick={e => e.stopPropagation()}
                                                                                >
                                                                                    <Upload size={10} strokeWidth={3} />
                                                                                    <input
                                                                                        type="file"
                                                                                        className="hidden"
                                                                                        onChange={(e) => {
                                                                                            const file = e.target.files[0];
                                                                                            if (file) handleUploadDirect(group.policies[0], file);
                                                                                        }}
                                                                                        accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                                                                                    />
                                                                                </label>
                                                                            )}
                                                                        </div>
                                                                        <p className="text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-tight italic">DNI: {group.dni}</p>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td className="py-3 px-4 bg-[var(--bg-color)] border-y border-[var(--border-color)] group-hover:bg-[var(--card-bg)] group-hover:border-y-indigo-500/30 transition-all" onClick={() => handleEdit(group.policies[0])}>
                                                                <div className="flex flex-col gap-1">
                                                                    {group.policies.map(p => (
                                                                        <div key={p.id} className="flex flex-col leading-tight">
                                                                            <p className="text-[11px] font-black text-[var(--text-color)] italic uppercase tracking-tight truncate">{abbreviateCompany(p.company)}</p>
                                                                            <div className="flex items-center gap-1 opacity-60">
                                                                                <FileText size={10} className="text-[var(--text-secondary)]" />
                                                                                <span className="text-[10px] font-mono text-[var(--text-secondary)]">#{p.policyNumber}</span>
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </td>
                                                            <td className="py-3 px-4 bg-[var(--bg-color)] border-y border-[var(--border-color)] group-hover:bg-[var(--card-bg)] group-hover:border-y-indigo-500/30 transition-all text-right pr-2" onClick={() => handleEdit(group.policies[0])}>
                                                                <div className="flex flex-col items-end gap-1.5">
                                                                    {group.policies.map(p => (
                                                                        <div key={p.id} className="flex flex-col gap-0.5 items-end">
                                                                            <span className={`inline-flex items-center w-fit px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-tight ${p.isCancelled ? 'bg-red-500/20 text-red-400' : 'bg-indigo-500/10 text-indigo-400'}`}>
                                                                                {p.riskType}
                                                                            </span>
                                                                            <div className="flex items-center gap-1">
                                                                                <div className={`w-1.5 h-1.5 rounded-full ${p.isCancelled ? 'bg-red-500' : 'bg-emerald-500'}`} />
                                                                                <span className="text-[9.5px] font-bold text-[var(--text-secondary)] uppercase tracking-tight">
                                                                                    {p.isCancelled ? 'Anulada' : p.isRenewal ? 'Ren.' : 'Vig.'}
                                                                                </span>
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </td>
                                                            <td className="py-3 px-4 bg-[var(--bg-color)] border-y border-[var(--border-color)] group-hover:bg-[var(--card-bg)] group-hover:border-y-indigo-500/30 transition-all text-left pl-2 italic" onClick={() => handleEdit(group.policies[0])}>
                                                                <div className="flex flex-col gap-1">
                                                                    {group.policies.map(p => (
                                                                        <div key={p.id} className="flex flex-col leading-tight">
                                                                            <div className="flex items-center gap-1.5">
                                                                                <span className="text-[13.5px] font-black text-emerald-400 italic tracking-tighter">
                                                                                    ${(Number(p.prima) || 0).toLocaleString('es-AR')}
                                                                                </span>
                                                                                {p.currency === 'USD' && (
                                                                                    <span className="px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-500 text-[8px] font-black uppercase tracking-tighter border border-emerald-500/20">
                                                                                        USD
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                            {p.premio && (
                                                                                <div className="flex items-center gap-1.5">
                                                                                    <span className="text-[11px] font-bold text-[var(--text-secondary)] italic tracking-tighter">
                                                                                        ${(Number(p.premio) || 0).toLocaleString('es-AR')}
                                                                                    </span>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </td>
                                                            <td className="py-1.5 pl-4 bg-[var(--bg-color)] border-y border-[var(--border-color)] group-hover:bg-[var(--card-bg)] group-hover:border-y-indigo-500/30 transition-all overflow-hidden">
                                                                <div className="flex flex-col gap-2">
                                                                    {group.policies.map(p => (
                                                                        <div key={p.id} className="flex flex-col leading-none">
                                                                            <span className={`text-[12px] italic ${getExpirationColor(p.endDate)}`}>
                                                                                {p.endDate ? new Date(p.endDate).toLocaleDateString('es-AR') : '--/--/--'}
                                                                            </span>
                                                                            <span className="text-[9px] font-bold text-zinc-600 uppercase">vence</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </td>
                                                            <td className="py-2 px-2 bg-[var(--bg-color)] border-y border-r border-[var(--border-color)] rounded-r-[1.5rem] group-hover:bg-[var(--card-bg)] group-hover:border-indigo-500/30 transition-all">
                                                                <div className="flex flex-col gap-1.5 justify-center items-center">
                                                                    {group.policies.map(p => (
                                                                        <div key={p.id} className="flex flex-wrap justify-center items-center gap-1.5 p-1.5 rounded-xl bg-black/20 border border-white/5 shadow-[inset_0_1px_2px_rgba(255,255,255,0.02)] transition-all hover:bg-black/40">
                                                                            <button
                                                                                onClick={(e) => { e.stopPropagation(); handleEdit(p); }}
                                                                                className="p-1.5 rounded-lg bg-[var(--text-color)]/5 text-[var(--text-secondary)] hover:bg-indigo-500/20 hover:text-indigo-400 transition-all active:scale-95 shadow-sm"
                                                                                title="Editar"
                                                                            >
                                                                                <Edit2 size={12} />
                                                                            </button>
                                                                            <button
                                                                                onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }}
                                                                                className="p-1.5 rounded-lg bg-[var(--text-color)]/5 text-[var(--text-secondary)] hover:bg-red-500/20 hover:text-red-400 transition-all shadow-sm"
                                                                                title="Eliminar"
                                                                            >
                                                                                <Trash2 size={12} />
                                                                            </button>
                                                                            {hasFileData(p) ? (
                                                                                <div className="flex gap-1.5 border-l border-white/10 pl-1.5 ml-0.5">
                                                                                    <button
                                                                                        onClick={(e) => { e.stopPropagation(); handleOpenFile(p); }}
                                                                                        className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-white transition-all active:scale-95 shadow-sm"
                                                                                        title="Ver Archivo"
                                                                                    >
                                                                                        <Eye size={12} />
                                                                                    </button>
                                                                                    <button
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            const fileToDownload = getFileData(p);
                                                                                            if (fileToDownload) handleDownloadFile(fileToDownload);
                                                                                            else alert('Este archivo no tiene datos para descargar.');
                                                                                        }}
                                                                                        className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500 hover:text-white transition-all active:scale-95 shadow-sm"
                                                                                        title="Descargar"
                                                                                    >
                                                                                        <Download size={12} />
                                                                                    </button>
                                                                                </div>
                                                                            ) : (
                                                                                <div className="border-l border-white/10 pl-1.5 ml-0.5">
                                                                                    <label className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500 hover:text-white transition-all cursor-pointer active:scale-95 flex shadow-sm" onClick={e => e.stopPropagation()}>
                                                                                        <Upload size={12} />
                                                                                        <input
                                                                                            type="file"
                                                                                            className="hidden"
                                                                                            onChange={(e) => {
                                                                                                const file = e.target.files[0];
                                                                                                if (file) handleUploadDirect(p, file);
                                                                                            }}
                                                                                            accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                                                                                        />
                                                                                    </label>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </td>
                                                        </motion.tr>
                                                    );
                                                });
                                            })()}
                                        </AnimatePresence>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination Controls - visible on all screen sizes */}
                        {groupedPolicies.length > ITEMS_PER_PAGE && (
                            <div className="flex flex-col md:flex-row items-center justify-between gap-2 px-3 md:px-6 py-3 md:py-4 bg-[var(--bg-color)]/50 border-t border-[var(--border-color)]">
                                <p className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest">
                                    Pág <span className="text-[var(--text-color)]">{currentPage}</span> de {Math.ceil(groupedPolicies.length / ITEMS_PER_PAGE)}
                                    <span className="ml-2 opacity-50">({groupedPolicies.length} reg.)</span>
                                </p>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                        disabled={currentPage === 1}
                                        className={`flex items-center gap-1 px-3 py-2 rounded-xl border transition-all text-[10px] font-black uppercase tracking-widest ${currentPage === 1
                                            ? 'bg-transparent border-[var(--border-color)] text-[var(--text-secondary)]/30 cursor-not-allowed'
                                            : 'bg-[var(--card-bg)] border-[var(--border-color)] text-[var(--text-color)] hover:bg-[var(--bg-color)] hover:border-indigo-500/30'
                                            }`}
                                    >
                                        <ChevronLeft size={14} /> <span className="hidden md:inline">Anterior</span>
                                    </button>
                                    <button
                                        onClick={() => setCurrentPage(prev => Math.min(Math.ceil(groupedPolicies.length / ITEMS_PER_PAGE), prev + 1))}
                                        disabled={currentPage >= Math.ceil(groupedPolicies.length / ITEMS_PER_PAGE)}
                                        className={`flex items-center gap-1 px-3 py-2 rounded-xl border transition-all text-[10px] font-black uppercase tracking-widest ${currentPage >= Math.ceil(groupedPolicies.length / ITEMS_PER_PAGE)
                                            ? 'bg-transparent border-[var(--border-color)] text-[var(--text-secondary)]/30 cursor-not-allowed'
                                            : 'bg-indigo-500 border-indigo-400/30 text-white hover:bg-indigo-400 shadow-lg shadow-indigo-500/20'
                                            }`}
                                    >
                                        <span className="hidden md:inline">Siguiente</span> <ChevronRight size={14} />
                                    </button>
                                </div>
                            </div>
                        )}

                        {filteredPolicies.length === 0 && !isProcessing && (
                            <div className="p-10 md:p-20 text-center">
                                <div className="w-16 h-16 md:w-20 md:h-20 rounded-3xl bg-[var(--text-color)]/5 mx-auto flex items-center justify-center text-[var(--text-secondary)]/30 mb-4 md:mb-6">
                                    <Users size={32} />
                                </div>
                                <p className="text-sm font-black text-[var(--text-secondary)] uppercase tracking-[0.2em]">No se encontraron pólizas</p>
                                <p className="text-xs text-zinc-600 mt-2 uppercase italic">Probá cambiando los filtros de Compañía o Ramo</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Policy Update/Review Modal */}
                <AnimatePresence>
                    {isModalOpen && (
                        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="absolute inset-0 bg-black/80 backdrop-blur-md"
                                onClick={() => !isSaving && setIsModalOpen(false)}
                            />
                            <motion.div
                                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                                animate={{ scale: 1, opacity: 1, y: 0 }}
                                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                                className="bg-[var(--card-bg)] border border-[var(--border-color)] w-full max-w-3xl rounded-[32px] shadow-[var(--card-shadow)] overflow-hidden relative"
                            >
                                <div className="p-4 border-b border-[var(--border-color)] flex justify-between items-center bg-[var(--bg-color)]/50">
                                    <h3 className="text-lg font-black text-[var(--text-color)] italic uppercase tracking-tighter">
                                        {editingPolicy?.id ? 'Editar Póliza' : 'Revisar Extracción IA'}
                                    </h3>
                                    <button onClick={() => setIsModalOpen(false)} className="p-1.5 hover:bg-[var(--text-color)]/5 rounded-full transition-colors">
                                        <X size={18} className="text-[var(--text-secondary)]" />
                                    </button>
                                </div>

                                <div className="p-6 overflow-y-auto custom-scrollbar bg-[var(--bg-color)]/30 max-h-[82vh]">
                                    <div className="flex flex-col gap-6">
                                        {/* SECCIÓN 1: COMPAÑÍA Y RAMO (EL ALMA DEL REGISTRO) */}
                                        <div className="grid grid-cols-2 gap-4 bg-[var(--text-color)]/5 p-4 rounded-[24px] border border-[var(--border-color)] shadow-inner">
                                            <label className="block">
                                                <span className="text-[10px] font-black text-[var(--text-secondary)] uppercase ml-2 flex items-center gap-1.5">
                                                    <Building2 size={10} className="text-[var(--text-secondary)]/70" /> Compañía
                                                </span>
                                                <input
                                                    type="text"
                                                    placeholder="Ej: SMG Seguros"
                                                    value={editingPolicy?.company || ''}
                                                    onChange={(e) => setEditingPolicy({ ...editingPolicy, company: e.target.value })}
                                                    className="w-full bg-[var(--bg-color)] border border-[var(--border-color)] rounded-xl py-2.5 px-4 text-[var(--text-color)] uppercase text-[12px] focus:border-indigo-500 outline-none mt-1.5 transition-all font-bold"
                                                />
                                            </label>
                                            <label className="block">
                                                <span className="text-[10px] font-black text-[var(--text-secondary)] uppercase ml-2 flex items-center gap-1.5">
                                                    <ListFilter size={10} className="text-[var(--text-secondary)]/70" /> Ramo / Riesgo
                                                </span>
                                                <select
                                                    value={editingPolicy?.riskType || ''}
                                                    onChange={(e) => setEditingPolicy({ ...editingPolicy, riskType: e.target.value })}
                                                    className="w-full bg-[var(--bg-color)] border border-[var(--border-color)] rounded-xl py-2.5 px-4 text-[var(--text-color)] text-[11.5px] focus:border-indigo-500 outline-none mt-1.5 transition-all uppercase font-bold cursor-pointer appearance-none"
                                                >
                                                    <option value="" disabled>Seleccionar Ramo</option>
                                                    {RAMOS.map(ramo => (
                                                        <option key={ramo} value={ramo} className="bg-[var(--card-bg)]">
                                                            {ramo}
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>
                                        </div>

                                        {/* SECCIÓN 2: DATOS DEL CLIENTE Y UBICACIÓN */}
                                        <div className="space-y-4 bg-[var(--text-color)]/2 p-5 rounded-[24px] border border-[var(--border-color)]">
                                            <div className="grid grid-cols-2 gap-4">
                                                <label className="block">
                                                    <span className="text-[10px] font-black text-[var(--text-secondary)] uppercase ml-2 flex items-center gap-1.5">
                                                        <User size={10} className="text-[var(--text-secondary)]/70" /> Nombre del Asegurado
                                                    </span>
                                                    <input
                                                        type="text"
                                                        value={editingPolicy?.clientName || ''}
                                                        onChange={(e) => setEditingPolicy({ ...editingPolicy, clientName: e.target.value })}
                                                        className="w-full bg-[var(--bg-color)] border border-[var(--border-color)] rounded-xl py-2.5 px-4 text-[var(--text-color)] uppercase text-[12px] focus:border-indigo-500 outline-none mt-1.5 transition-all font-medium"
                                                    />
                                                </label>
                                                <label className="block">
                                                    <span className="text-[10px] font-black text-[var(--text-secondary)] uppercase ml-2 flex items-center gap-1.5">
                                                        DNI / CUIT
                                                    </span>
                                                    <input
                                                        type="text"
                                                        value={editingPolicy?.dni || ''}
                                                        onChange={(e) => setEditingPolicy({ ...editingPolicy, dni: e.target.value })}
                                                        className="w-full bg-[var(--bg-color)] border border-[var(--border-color)] rounded-xl py-2.5 px-4 text-[var(--text-color)] text-[12px] focus:border-indigo-500 outline-none mt-1.5 transition-all font-mono"
                                                    />
                                                </label>
                                            </div>
                                            <label className="block">
                                                <span className="text-[10px] font-black text-[var(--text-secondary)] uppercase ml-2">Dirección de Cobro / Riesgo</span>
                                                <input
                                                    type="text"
                                                    value={editingPolicy?.address || ''}
                                                    onChange={(e) => setEditingPolicy({ ...editingPolicy, address: e.target.value })}
                                                    className="w-full bg-[var(--bg-color)] border border-[var(--border-color)] rounded-xl py-2.5 px-4 text-[var(--text-color)] text-[12px] focus:border-indigo-500 outline-none mt-1.5 transition-all capitalize"
                                                />
                                            </label>
                                        </div>

                                        {/* SECCIÓN 3: DATOS DE VIGENCIA Y PÓLIZA */}
                                        <div className="grid grid-cols-2 gap-6 p-1">
                                            <div className="space-y-4">
                                                <div className="grid grid-cols-2 gap-3">
                                                    <label className="block">
                                                        <span className="text-[10px] font-black text-[var(--text-secondary)] uppercase ml-2">Vigencia</span>
                                                        <input
                                                            type="date"
                                                            value={editingPolicy?.startDate || ''}
                                                            onChange={(e) => setEditingPolicy({ ...editingPolicy, startDate: e.target.value })}
                                                            className="w-full bg-[var(--bg-color)] border border-[var(--border-color)] rounded-xl py-2 px-3 text-[var(--text-color)] text-[11px] focus:border-indigo-500 outline-none mt-1.5 transition-all"
                                                        />
                                                    </label>
                                                    <label className="block">
                                                        <span className="text-[10px] font-black text-[var(--text-secondary)] uppercase ml-2">Vencimiento</span>
                                                        <input
                                                            type="date"
                                                            value={editingPolicy?.endDate || ''}
                                                            onChange={(e) => setEditingPolicy({ ...editingPolicy, endDate: e.target.value })}
                                                            className="w-full bg-[var(--bg-color)] border border-[var(--border-color)] rounded-xl py-2 px-3 text-[var(--text-color)] text-[11px] focus:border-indigo-500 outline-none mt-1.5 transition-all"
                                                        />
                                                    </label>
                                                </div>
                                                <label className="block">
                                                    <span className="text-[10px] font-black text-[var(--text-secondary)] uppercase ml-2">N° de Póliza</span>
                                                    <input
                                                        type="text"
                                                        value={editingPolicy?.policyNumber || ''}
                                                        onChange={(e) => setEditingPolicy({ ...editingPolicy, policyNumber: e.target.value })}
                                                        className="w-full bg-[var(--bg-color)] border border-[var(--border-color)] rounded-xl py-2.5 px-4 text-indigo-500 text-[13px] focus:border-indigo-500 outline-none mt-1.5 transition-all font-mono font-black tracking-wider shadow-inner"
                                                    />
                                                </label>
                                            </div>

                                            <div className="space-y-4">
                                                <div className="grid grid-cols-2 gap-3">
                                                    <label className="block">
                                                        <span className="text-[10px] font-black text-[var(--text-secondary)] uppercase ml-2">Suma Asegurada</span>
                                                        <input
                                                            type="text"
                                                            value={formatCurrency(editingPolicy?.insuredSum, editingPolicy?.currency)}
                                                            onChange={(e) => setEditingPolicy({ ...editingPolicy, insuredSum: parseCurrency(e.target.value) })}
                                                            className="w-full bg-[var(--bg-color)] border border-[var(--border-color)] rounded-xl py-2 px-3 text-indigo-500 text-[11.5px] focus:border-indigo-500 outline-none mt-1.5 transition-all font-bold"
                                                        />
                                                    </label>
                                                    <label className="block">
                                                        <span className="text-[10px] font-black text-[var(--text-secondary)] uppercase ml-2">Movimiento</span>
                                                        <select
                                                            value={editingPolicy?.isRenewal ? 'true' : 'false'}
                                                            onChange={(e) => setEditingPolicy({ ...editingPolicy, isRenewal: e.target.value === 'true' })}
                                                            className="w-full bg-[var(--bg-color)] border border-[var(--border-color)] rounded-xl py-2 px-3 text-[var(--text-color)] text-[11px] focus:border-indigo-500 outline-none mt-1.5 transition-all uppercase font-black"
                                                        >
                                                            <option value="false">Nuevo Negocio</option>
                                                            <option value="true">Renovación</option>
                                                        </select>
                                                    </label>
                                                </div>
                                                <div className="block pt-[24px]">
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            if (editingPolicy?.isCancelled) {
                                                                if (window.confirm("¿Deseas reactivar esta póliza?")) {
                                                                    setEditingPolicy({ ...editingPolicy, isCancelled: false, cancellationReason: '', cancellationDate: '' });
                                                                }
                                                            } else {
                                                                setIsCancellationModalOpen(true);
                                                            }
                                                        }}
                                                        className={`flex items-center gap-3 border rounded-xl py-2.5 px-4 cursor-pointer transition-all h-[42px] w-full hover:scale-[1.01] active:scale-[0.98] ${editingPolicy?.isCancelled ? 'bg-red-500 text-white border-red-500 shadow-lg shadow-red-500/20' : 'bg-red-500/10 border-red-500/20 text-red-100 hover:bg-red-500/20'}`}
                                                    >
                                                        <div className={`w-4 h-4 rounded-md border-2 flex items-center justify-center transition-all ${editingPolicy?.isCancelled ? 'bg-white border-white text-red-500' : 'bg-red-500/20 border-red-500/40'}`}>
                                                            {editingPolicy?.isCancelled && <Check size={12} strokeWidth={4} />}
                                                        </div>
                                                        <span className="text-[9px] font-black uppercase tracking-[0.15em] mt-0.5">
                                                            {editingPolicy?.isCancelled ? 'Póliza Anulada' : 'Anular Póliza'}
                                                        </span>
                                                    </button>
                                                </div>
                                            </div>
                                        </div>

                                        {/* --- SECCIÓN DINÁMICA: DETALLES DEL RIESGO --- */}
                                        {(editingPolicy?.riskType === 'Autos' || editingPolicy?.riskType === 'Motos') && (
                                            <div className="bg-indigo-500/5 p-5 rounded-[24px] border border-indigo-500/10 space-y-4">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <Car size={16} className="text-indigo-400" />
                                                    <span className="text-[11px] font-black text-[var(--text-color)] uppercase tracking-wider">Datos del Vehículo</span>
                                                </div>
                                                <div className="grid grid-cols-3 gap-3">
                                                    <label className="block">
                                                        <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase ml-2">Marca / Modelo</span>
                                                        <input
                                                            type="text"
                                                            value={`${editingPolicy?.riskDetails?.vehicle?.brand || ''} ${editingPolicy?.riskDetails?.vehicle?.model || ''}`.trim()}
                                                            onChange={(e) => {
                                                                const val = e.target.value;
                                                                setEditingPolicy({
                                                                    ...editingPolicy,
                                                                    riskDetails: {
                                                                        ...editingPolicy.riskDetails,
                                                                        vehicle: { ...editingPolicy.riskDetails?.vehicle, brand: val }
                                                                    }
                                                                });
                                                            }}
                                                            className="w-full bg-[var(--bg-color)] border border-[var(--border-color)] rounded-xl py-2 px-3 text-[var(--text-color)] text-[11px] outline-none mt-1 transition-all uppercase"
                                                        />
                                                    </label>
                                                    <label className="block">
                                                        <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase ml-2">Año</span>
                                                        <input
                                                            type="text"
                                                            value={editingPolicy?.riskDetails?.vehicle?.year || ''}
                                                            onChange={(e) => setEditingPolicy({
                                                                ...editingPolicy,
                                                                riskDetails: { ...editingPolicy.riskDetails, vehicle: { ...editingPolicy.riskDetails?.vehicle, year: e.target.value } }
                                                            })}
                                                            className="w-full bg-[var(--bg-color)] border border-[var(--border-color)] rounded-xl py-2 px-3 text-[var(--text-color)] text-[11px] outline-none mt-1 transition-all"
                                                        />
                                                    </label>
                                                    <label className="block">
                                                        <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase ml-2">Patente</span>
                                                        <input
                                                            type="text"
                                                            value={editingPolicy?.riskDetails?.vehicle?.plate || ''}
                                                            onChange={(e) => setEditingPolicy({
                                                                ...editingPolicy,
                                                                riskDetails: { ...editingPolicy.riskDetails, vehicle: { ...editingPolicy.riskDetails?.vehicle, plate: e.target.value } }
                                                            })}
                                                            className="w-full bg-[var(--bg-color)] border border-[var(--border-color)] rounded-xl py-2 px-3 text-indigo-500 font-mono font-bold text-[11px] outline-none mt-1 transition-all uppercase"
                                                        />
                                                    </label>
                                                </div>
                                                <div className="grid grid-cols-2 gap-3">
                                                    <label className="block">
                                                        <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase ml-2">N° Chasis</span>
                                                        <input
                                                            type="text"
                                                            value={editingPolicy?.riskDetails?.vehicle?.chassis || ''}
                                                            onChange={(e) => setEditingPolicy({
                                                                ...editingPolicy,
                                                                riskDetails: { ...editingPolicy.riskDetails, vehicle: { ...editingPolicy.riskDetails?.vehicle, chassis: e.target.value } }
                                                            })}
                                                            className="w-full bg-black/40 border border-white/5 rounded-xl py-2 px-3 text-white font-mono text-[10px] outline-none mt-1 transition-all uppercase"
                                                        />
                                                    </label>
                                                    <label className="block">
                                                        <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase ml-2">N° Motor</span>
                                                        <input
                                                            type="text"
                                                            value={editingPolicy?.riskDetails?.vehicle?.engine || ''}
                                                            onChange={(e) => setEditingPolicy({
                                                                ...editingPolicy,
                                                                riskDetails: { ...editingPolicy.riskDetails, vehicle: { ...editingPolicy.riskDetails?.vehicle, engine: e.target.value } }
                                                            })}
                                                            className="w-full bg-black/40 border border-white/5 rounded-xl py-2 px-3 text-white font-mono text-[10px] outline-none mt-1 transition-all uppercase"
                                                        />
                                                    </label>
                                                </div>
                                                <div className="grid grid-cols-2 gap-3">
                                                    <label className="block">
                                                        <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase ml-2">Cobertura</span>
                                                        <input
                                                            type="text"
                                                            value={editingPolicy?.riskDetails?.vehicle?.coverage || ''}
                                                            onChange={(e) => setEditingPolicy({
                                                                ...editingPolicy,
                                                                riskDetails: { ...editingPolicy.riskDetails, vehicle: { ...editingPolicy.riskDetails?.vehicle, coverage: e.target.value } }
                                                            })}
                                                            className="w-full bg-[var(--bg-color)] border border-[var(--border-color)] rounded-xl py-2 px-3 text-emerald-500 font-bold text-[11px] outline-none mt-1 transition-all uppercase"
                                                        />
                                                    </label>
                                                    {(editingPolicy?.riskDetails?.vehicle?.coverage?.toUpperCase().includes('TODO RIESGO') || editingPolicy?.riskDetails?.vehicle?.coverage?.toUpperCase().includes(' D')) && (
                                                        <label className="block">
                                                            <span className="text-[9px] font-black text-rose-500 uppercase ml-2">Franquicia</span>
                                                            <div className="relative">
                                                                <input
                                                                    type="text"
                                                                    value={formatCurrency(editingPolicy?.riskDetails?.vehicle?.deductible, editingPolicy?.currency)}
                                                                    onChange={(e) => setEditingPolicy({
                                                                        ...editingPolicy,
                                                                        riskDetails: { ...editingPolicy.riskDetails, vehicle: { ...editingPolicy.riskDetails?.vehicle, deductible: parseCurrency(e.target.value) } }
                                                                    })}
                                                                    className="w-full bg-[var(--bg-color)] border border-rose-500/20 rounded-xl py-2 px-3 text-rose-500 font-bold text-[11px] outline-none mt-1 transition-all"
                                                                />
                                                            </div>
                                                        </label>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {(['Combinado Familiar', 'Integral de Comercio', 'Integral de Consorcio', 'RC', 'Caución'].some(r => editingPolicy?.riskType?.includes(r))) && (
                                            <div className="bg-amber-500/5 p-5 rounded-[24px] border border-amber-500/10 space-y-4">
                                                <div className="flex items-center justify-between mb-2">
                                                    <div className="flex items-center gap-2">
                                                        <ShieldCheck size={16} className="text-amber-400" />
                                                        <span className="text-[11px] font-black text-[var(--text-color)] uppercase tracking-wider">Detalle de Coberturas</span>
                                                    </div>
                                                    <button
                                                        onClick={() => {
                                                            const current = editingPolicy?.riskDetails?.coverages || [];
                                                            setEditingPolicy({
                                                                ...editingPolicy,
                                                                riskDetails: { ...editingPolicy.riskDetails, coverages: [...current, { description: '', amount: 0 }] }
                                                            });
                                                        }}
                                                        className="p-1 px-2 rounded-lg bg-amber-500/10 text-amber-500 text-[9px] font-black uppercase hover:bg-amber-500 hover:text-[var(--text-color)] transition-all"
                                                    >
                                                        + Agregar Ítem
                                                    </button>
                                                </div>
                                                <div className="space-y-2">
                                                    {(editingPolicy?.riskDetails?.coverages || [{ description: 'Incendio Edificio', amount: 0 }, { description: 'Robo Contenido', amount: 0 }]).map((cov, idx) => (
                                                        <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                                                            <input
                                                                type="text"
                                                                placeholder="Descripción (ej: Incendio)"
                                                                value={cov.description}
                                                                onChange={(e) => {
                                                                    const newList = [...(editingPolicy?.riskDetails?.coverages || [])];
                                                                    newList[idx] = { ...newList[idx], description: e.target.value };
                                                                    setEditingPolicy({ ...editingPolicy, riskDetails: { ...editingPolicy.riskDetails, coverages: newList } });
                                                                }}
                                                                className="col-span-7 bg-[var(--bg-color)] border border-[var(--border-color)] rounded-xl py-2 px-3 text-[var(--text-color)] text-[11px] outline-none uppercase"
                                                            />
                                                            <div className="col-span-4 relative">
                                                                <input
                                                                    type="text"
                                                                    placeholder="$ Suma"
                                                                    value={formatCurrency(cov.amount, editingPolicy?.currency)}
                                                                    onChange={(e) => {
                                                                        const newList = [...(editingPolicy?.riskDetails?.coverages || [])];
                                                                        newList[idx] = { ...newList[idx], amount: parseCurrency(e.target.value) };
                                                                        setEditingPolicy({ ...editingPolicy, riskDetails: { ...editingPolicy.riskDetails, coverages: newList } });
                                                                    }}
                                                                    className="w-full bg-[var(--bg-color)] border border-[var(--border-color)] rounded-xl py-2 px-3 text-emerald-500 font-bold text-[11px] outline-none"
                                                                />
                                                            </div>
                                                            <button
                                                                onClick={() => {
                                                                    const newList = editingPolicy.riskDetails.coverages.filter((_, i) => i !== idx);
                                                                    setEditingPolicy({ ...editingPolicy, riskDetails: { ...editingPolicy.riskDetails, coverages: newList } });
                                                                }}
                                                                className="col-span-1 p-2 text-rose-500/50 hover:text-rose-500"
                                                            >
                                                                <MinusCircle size={14} />
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {(editingPolicy?.riskType === 'ART') && (
                                            <div className="bg-sky-500/5 p-5 rounded-[24px] border border-sky-500/10 space-y-4">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <Percent size={16} className="text-sky-400" />
                                                    <span className="text-[11px] font-black text-[var(--text-color)] uppercase tracking-wider">Datos de ART</span>
                                                </div>
                                                <div className="grid grid-cols-2 gap-3">
                                                    <label className="block">
                                                        <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase ml-2">Alícuota (%)</span>
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            value={editingPolicy?.riskDetails?.alicuota || ''}
                                                            onChange={(e) => setEditingPolicy({
                                                                ...editingPolicy,
                                                                riskDetails: { ...editingPolicy.riskDetails, alicuota: parseFloat(e.target.value) }
                                                            })}
                                                            className="w-full bg-[var(--bg-color)] border border-[var(--border-color)] rounded-xl py-2 px-3 text-sky-400 font-bold text-[11px] outline-none mt-1 transition-all"
                                                            placeholder="Ej: 3.5"
                                                        />
                                                    </label>
                                                </div>
                                            </div>
                                        )}

                                        {(['Accidentes Personales', 'Vida'].includes(editingPolicy?.riskType)) && (
                                            <div className="bg-indigo-500/5 p-5 rounded-[24px] border border-indigo-500/10 space-y-4">
                                                <div className="flex items-center justify-between mb-2">
                                                    <div className="flex items-center gap-2">
                                                        <Users size={16} className="text-indigo-500" />
                                                        <span className="text-[11px] font-black text-[var(--text-color)] uppercase tracking-wider">Nómina de Asegurados</span>
                                                    </div>
                                                    <button
                                                        onClick={() => {
                                                            const current = editingPolicy?.riskDetails?.insuredPersons || [];
                                                            setEditingPolicy({
                                                                ...editingPolicy,
                                                                riskDetails: { ...editingPolicy.riskDetails, insuredPersons: [...current, { name: '', amount: 0 }] }
                                                            });
                                                        }}
                                                        className="p-1 px-2 rounded-lg bg-indigo-500/10 text-indigo-500 text-[9px] font-black uppercase hover:bg-indigo-500 hover:text-[var(--text-color)] transition-all"
                                                    >
                                                        + Añadir Asegurado
                                                    </button>
                                                </div>
                                                <div className="space-y-2">
                                                    {(editingPolicy?.riskDetails?.insuredPersons || [{ name: '', amount: 0 }]).map((person, idx) => (
                                                        <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                                                            <input
                                                                type="text"
                                                                placeholder="Nombre / DNI (ej: Juan Pérez)"
                                                                value={person.name}
                                                                onChange={(e) => {
                                                                    const newList = [...(editingPolicy?.riskDetails?.insuredPersons || [])];
                                                                    newList[idx] = { ...newList[idx], name: e.target.value };
                                                                    setEditingPolicy({ ...editingPolicy, riskDetails: { ...editingPolicy.riskDetails, insuredPersons: newList } });
                                                                }}
                                                                className="col-span-7 bg-[var(--bg-color)] border border-[var(--border-color)] rounded-xl py-2 px-3 text-[var(--text-color)] text-[11px] outline-none uppercase"
                                                            />
                                                            <div className="col-span-4 relative">
                                                                <input
                                                                    type="text"
                                                                    placeholder="$ Suma"
                                                                    value={formatCurrency(person.amount, editingPolicy?.currency)}
                                                                    onChange={(e) => {
                                                                        const newList = [...(editingPolicy?.riskDetails?.insuredPersons || [])];
                                                                        newList[idx] = { ...newList[idx], amount: parseCurrency(e.target.value) };
                                                                        setEditingPolicy({ ...editingPolicy, riskDetails: { ...editingPolicy.riskDetails, insuredPersons: newList } });
                                                                    }}
                                                                    className="w-full bg-[var(--bg-color)] border border-[var(--border-color)] rounded-xl py-2 px-3 text-indigo-500 font-bold text-[11px] outline-none"
                                                                />
                                                            </div>
                                                            <button
                                                                onClick={() => {
                                                                    const newList = editingPolicy.riskDetails.insuredPersons.filter((_, i) => i !== idx);
                                                                    setEditingPolicy({ ...editingPolicy, riskDetails: { ...editingPolicy.riskDetails, insuredPersons: newList } });
                                                                }}
                                                                className="col-span-1 p-2 text-rose-500/50 hover:text-rose-500"
                                                            >
                                                                <MinusCircle size={14} />
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* SECCIÓN 4: COSTOS (LO QUE EL CLIENTE PAGA) */}
                                        <div className="bg-emerald-500/5 p-5 rounded-[24px] border border-emerald-500/10 shadow-lg space-y-4">
                                            <div className="flex items-center justify-between px-2">
                                                <span className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest">Moneda de la Póliza</span>
                                                <div className="flex bg-black/40 p-1 rounded-xl border border-white/5">
                                                    <button
                                                        onClick={() => setEditingPolicy({ ...editingPolicy, currency: 'ARS' })}
                                                        className={`px-4 py-1.5 rounded-lg text-[10px] font-black transition-all ${(!editingPolicy?.currency || editingPolicy?.currency === 'ARS') ? 'bg-emerald-500 text-[var(--text-color)] shadow-lg' : 'text-[var(--text-secondary)] hover:text-[var(--text-color)]'}`}
                                                    >
                                                        PESOS (ARS)
                                                    </button>
                                                    <button
                                                        onClick={() => setEditingPolicy({ ...editingPolicy, currency: 'USD' })}
                                                        className={`px-4 py-1.5 rounded-lg text-[10px] font-black transition-all ${editingPolicy?.currency === 'USD' ? 'bg-indigo-500 text-[var(--text-color)] shadow-lg' : 'text-[var(--text-secondary)] hover:text-[var(--text-color)]'}`}
                                                    >
                                                        DÓLARES (USD)
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <label className="block">
                                                    <div className="flex items-center gap-1.5 ml-2 mb-1.5">
                                                        <DollarSign size={10} className="text-emerald-500/70" />
                                                        <span className="text-[10px] font-black text-emerald-500/70 uppercase">Prima (Neto)</span>
                                                    </div>
                                                    <div className="relative">
                                                        <input
                                                            type="text"
                                                            value={formatCurrency(editingPolicy?.prima, editingPolicy?.currency)}
                                                            onChange={(e) => setEditingPolicy({ ...editingPolicy, prima: parseCurrency(e.target.value) })}
                                                            className="w-full bg-black/60 border border-emerald-500/20 rounded-xl py-3 px-4 text-emerald-500 text-[18px] focus:border-emerald-500 outline-none transition-all font-mono font-black"
                                                        />
                                                    </div>
                                                </label>
                                                <label className="block">
                                                    <div className="flex items-center gap-1.5 ml-2 mb-1.5">
                                                        <Zap size={10} className="text-amber-500/70" />
                                                        <span className="text-[10px] font-black text-amber-500/70 uppercase">Premio (Total Final)</span>
                                                    </div>
                                                    <div className="relative">
                                                        <input
                                                            type="text"
                                                            value={formatCurrency(editingPolicy?.premio, editingPolicy?.currency)}
                                                            onChange={(e) => setEditingPolicy({ ...editingPolicy, premio: parseCurrency(e.target.value) })}
                                                            className="w-full bg-black/60 border border-amber-500/20 rounded-xl py-3 px-4 text-amber-400 text-[20px] focus:border-amber-500 outline-none transition-all font-mono font-black"
                                                        />
                                                    </div>
                                                </label>
                                            </div>
                                        </div>

                                        {/* SECCIÓN 5: OBSERVACIONES */}
                                        <label className="block p-1">
                                            <span className="text-[10px] font-black text-[var(--text-secondary)] uppercase ml-2 flex items-center gap-1.5">
                                                <FileWarning size={10} className="text-zinc-600" /> Notas Internas / Observaciones
                                            </span>
                                            <textarea
                                                value={editingPolicy?.observations || ''}
                                                onChange={(e) => setEditingPolicy({ ...editingPolicy, observations: e.target.value })}
                                                placeholder="Ej: Pendiente de inspección, segundo vehículo, cliente preferencial..."
                                                className="w-full bg-[var(--bg-color)] border border-[var(--border-color)] rounded-xl py-3 px-4 text-[var(--text-color)] text-[11.5px] focus:border-indigo-500 outline-none mt-1.5 transition-all h-20 resize-none italic"
                                            />
                                        </label>

                                        {/* SECCIÓN 6: ADJUNTOS PDF (SOPORTE MULTI-ARCHIVO) */}
                                        <div className="bg-white/[0.02] border border-white/5 rounded-[24px] p-5">
                                            <div className="flex items-center justify-between mb-4 px-1">
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest">Documentación Adjunta</span>
                                                    <span className="text-[9px] text-zinc-600 font-bold uppercase mt-0.5">Podés subir varios archivos</span>
                                                </div>
                                                <div className="w-8 h-8 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-500 border border-indigo-500/20">
                                                    <FileText size={14} />
                                                </div>
                                            </div>

                                            {/* Lista de Archivos Actuales */}
                                            <div className="space-y-2 mb-4">
                                                {/* Legacy File (si existe y no está en el array) */}
                                                {editingPolicy.fileUrl && (!editingPolicy.attachments || editingPolicy.attachments.length === 0) && (
                                                    <div className="flex items-center gap-3 p-3 bg-[var(--bg-color)]/50 rounded-xl border border-[var(--border-color)] group">
                                                        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                                                            <FileText size={14} />
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-[10px] font-black text-[var(--text-color)] uppercase truncate">{editingPolicy.fileName || 'Archivo Antiguo'}</p>
                                                            <p className="text-[8px] text-[var(--text-secondary)] font-bold uppercase mt-0.5">Migración Automática</p>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <div className="flex items-center gap-1">
                                                                <button
                                                                    onClick={() => handleOpenFile(editingPolicy)}
                                                                    className="p-2 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-white rounded-lg transition-all"
                                                                    title="Ver archivo"
                                                                >
                                                                    <Eye size={14} />
                                                                </button>
                                                                <button
                                                                    onClick={() => handleDownloadFile({ url: editingPolicy.fileUrl, base64: editingPolicy.fileBase64, name: editingPolicy.fileName }, editingPolicy.id)}
                                                                    className="p-2 bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500 hover:text-white rounded-lg transition-all"
                                                                    title="Descargar archivo"
                                                                >
                                                                    <Download size={14} />
                                                                </button>
                                                            </div>
                                                            <button
                                                                onClick={() => {
                                                                    if (window.confirm("¿Seguro de eliminar este archivo?")) {
                                                                        setEditingPolicy(prev => ({ ...prev, fileUrl: null, fileName: null, fileBase64: null }));
                                                                    }
                                                                }}
                                                                className="p-2 bg-red-500/10 text-red-400/50 hover:text-red-400 rounded-lg transition-all"
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Nuevos Adjuntos (Lista) */}
                                                {editingPolicy.attachments?.map((file, idx) => (
                                                    <div key={idx} className="flex items-center gap-3 p-3 bg-black/40 rounded-xl border border-white/5 group hover:border-indigo-500/30 transition-all">
                                                        <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-500">
                                                            <FileText size={14} />
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-[10px] font-black text-indigo-100 uppercase truncate">{file.name}</p>
                                                            <p className="text-[8px] text-[var(--text-secondary)] font-bold uppercase mt-0.5">
                                                                {file.timestamp ? new Date(file.timestamp).toLocaleDateString() : 'Cargado'} • {file.chunked ? 'Base de Datos' : file.url ? 'En la Nube' : 'Temporal Local'}
                                                            </p>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            {(file.chunked || file.url || file.base64) && (
                                                                <div className="flex items-center gap-1">
                                                                    <button
                                                                        onClick={() => handleOpenFile(editingPolicy)}
                                                                        className="p-2 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-white rounded-lg transition-all"
                                                                        title="Ver archivo"
                                                                    >
                                                                        <Eye size={14} />
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleDownloadFile(file, editingPolicy.id)}
                                                                        className="p-2 bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500 hover:text-white rounded-lg transition-all"
                                                                        title="Descargar archivo"
                                                                    >
                                                                        <Download size={14} />
                                                                    </button>
                                                                </div>
                                                            )}
                                                            <button
                                                                onClick={() => handleRemoveFile(idx)}
                                                                className="p-2 bg-red-500/10 text-red-400/50 hover:text-red-400 rounded-lg transition-all"
                                                                title="Eliminar archivo"
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>

                                            {/* Dropzone / Upload Button */}
                                            <label className={`
                                                w-full flex items-center justify-center gap-3 border-2 border-dashed rounded-2xl p-4 cursor-pointer transition-all
                                                ${isSaving
                                                    ? 'bg-[var(--text-color)]/5 border-[var(--border-color)] opacity-50 cursor-not-allowed'
                                                    : 'bg-[var(--text-color)]/5 border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-indigo-500/5 hover:border-indigo-500/30 hover:text-indigo-500'
                                                }
                                            `}>
                                                {isSaving ? (
                                                    <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                                                ) : (
                                                    <Upload size={14} />
                                                )}
                                                <span className="text-[10px] font-black uppercase tracking-widest">
                                                    {isSaving ? 'Subiendo...' : editingPolicy.attachments?.length > 0 ? 'Añadir Otro Archivo' : 'Subir Póliza (PDF)'}
                                                </span>
                                                {!isSaving && <input type="file" className="hidden" accept=".pdf" onChange={handleUpdateFile} />}
                                            </label>
                                        </div>
                                    </div>
                                </div>

                                <div className="p-6 bg-[var(--bg-color)]/50 border-t border-[var(--border-color)] flex gap-3">
                                    <button
                                        onClick={() => setIsModalOpen(false)}
                                        className="flex-1 py-3 rounded-xl border border-[var(--border-color)] text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-widest hover:bg-[var(--text-color)]/5 transition-all"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        onClick={handleSavePolicy}
                                        disabled={isSaving}
                                        className="flex-[2] py-3 rounded-xl bg-indigo-500 text-white shadow-xl shadow-indigo-500/20 text-[9px] font-black uppercase tracking-widest hover:bg-indigo-400 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                                    >
                                        {isSaving ? (
                                            <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                        ) : (
                                            <>
                                                <Save size={14} />
                                                {editingPolicy?.id ? 'Guardar' : 'Confirmar Alta'}
                                            </>
                                        )}
                                    </button>
                                </div>
                            </motion.div>
                        </div>
                    )}
                </AnimatePresence>

                {/* --- Audit Results Modal --- */}
                <AnimatePresence>
                    {isAuditModalOpen && auditResults && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl"
                        >
                            <motion.div
                                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                                animate={{ scale: 1, opacity: 1, y: 0 }}
                                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                                className="w-full max-w-4xl bg-[var(--card-bg)] border border-[var(--border-color)] rounded-[32px] overflow-hidden shadow-[var(--card-shadow)] flex flex-col max-h-[90vh] backdrop-blur-xl"
                            >
                                {/* Header */}
                                <div className="p-6 border-b border-[var(--border-color)] bg-[var(--bg-color)]/50 flex justify-between items-center">
                                    <div className="flex items-center gap-4">
                                        <div className="p-3 bg-orange-500/10 rounded-2xl">
                                            <ShieldCheck size={24} className="text-orange-500" />
                                        </div>
                                        <div>
                                            <h2 className="text-xl font-black text-[var(--text-color)] uppercase tracking-tight">Reporte de Auditoría</h2>
                                            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest">{auditResults.fileName}</p>
                                        </div>
                                    </div>
                                    <button onClick={() => setIsAuditModalOpen(false)} className="p-2 hover:bg-[var(--text-color)]/5 rounded-xl text-[var(--text-secondary)] hover:text-[var(--text-color)] transition-all">
                                        <X size={20} />
                                    </button>
                                </div>

                                {/* Stats Bar */}
                                <div className="grid grid-cols-3 gap-1 bg-[var(--bg-color)] border-b border-[var(--border-color)] p-1">
                                    <div className="p-4 rounded-2xl bg-[var(--card-bg)]/50 text-center">
                                        <p className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest mb-1">Encontrados en XLS</p>
                                        <p className="text-2xl font-black text-[var(--text-color)]">{auditResults.totalExternal}</p>
                                    </div>
                                    <div className="p-4 rounded-2xl bg-[var(--card-bg)]/50 text-center border-x border-[var(--border-color)]">
                                        <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest mb-1">Coincidencias</p>
                                        <p className="text-2xl font-black text-emerald-500">{auditResults.found.length}</p>
                                    </div>
                                    <div className="p-4 rounded-2xl bg-rose-500/10 text-center">
                                        <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest mb-1">Faltantes en Sistema</p>
                                        <p className="text-2xl font-black text-rose-500">{auditResults.missing.length}</p>
                                    </div>
                                </div>

                                {/* Content */}
                                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                                    {auditResults.missing.length > 0 ? (
                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between">
                                                <h3 className="text-[11px] font-black text-[var(--text-secondary)] uppercase tracking-[0.2em]">Pólizas que te faltan subir</h3>
                                                <button
                                                    onClick={async () => {
                                                        if (window.confirm(`¿Cargar las ${auditResults.missing.length} pólizas faltantes automáticamente?`)) {
                                                            setIsProcessing(true);
                                                            setProgress({ message: 'Cargando pólizas faltantes...', percent: 50 });
                                                            try {
                                                                const count = await bulkAddPolicies(auditResults.missing.map(p => ({ ...p, status: 'Audit Auto-Add' })));
                                                                alert(`✅ Se cargaron ${count} pólizas con éxito.`);
                                                                setIsAuditModalOpen(false);
                                                            } catch (err) {
                                                                alert("Error al cargar faltantes");
                                                            } finally {
                                                                setIsProcessing(false);
                                                            }
                                                        }
                                                    }}
                                                    className="px-4 py-2 bg-indigo-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-400 transition-all shadow-lg shadow-indigo-500/20"
                                                >
                                                    Cargar Todo
                                                </button>
                                            </div>
                                            <div className="grid gap-2">
                                                {auditResults.missing.map((p, idx) => (
                                                    <div key={idx} className="group p-4 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl hover:bg-[var(--text-color)]/5 transition-all flex items-center justify-between shadow-sm">
                                                        <div className="flex items-center gap-4">
                                                            <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center text-rose-500">
                                                                <FileWarning size={18} />
                                                            </div>
                                                            <div>
                                                                <p className="text-sm font-black text-[var(--text-color)]">{p.clientName}</p>
                                                                <div className="flex items-center gap-3 mt-1">
                                                                    <span className="text-[10px] font-bold text-[var(--text-secondary)] uppercase">Póliza: <span className="text-[var(--text-color)]">{p.policyNumber || 'S/N'}</span></span>
                                                                    <span className="text-[10px] font-bold text-[var(--text-secondary)] uppercase">DNI: <span className="text-[var(--text-color)]">{p.dni || 'S/D'}</span></span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="text-right">
                                                            <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">{p.company}</p>
                                                            <p className="text-[10px] font-bold text-[var(--text-secondary)] mt-1">{p.riskType}</p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="h-64 flex flex-col items-center justify-center text-center">
                                            <div className="w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center text-emerald-500 mb-6">
                                                <Check size={40} />
                                            </div>
                                            <h3 className="text-lg font-black text-[var(--text-color)] uppercase mb-2">¡Cartera Al Día!</h3>
                                            <p className="text-[var(--text-secondary)] text-sm max-w-xs">Todas las pólizas registradas en el archivo de la compañía ya existen en tu sistema.</p>
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Sub-Modal de Anulación */}
                <AnimatePresence>
                    {isCancellationModalOpen && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/70 backdrop-blur-md p-4"
                        >
                            <motion.div
                                initial={{ scale: 0.9, y: 20 }}
                                animate={{ scale: 1, y: 0 }}
                                exit={{ scale: 0.9, y: 20 }}
                                className="w-full max-w-md bg-zinc-900 border border-red-500/30 p-6 rounded-[32px] shadow-2xl shadow-red-500/10"
                            >
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="p-3 bg-red-500/20 rounded-2xl text-red-500">
                                        <AlertTriangle size={24} />
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-black text-white uppercase tracking-tight">Anular Póliza</h3>
                                        <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">Registrar motivo y fecha</p>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <label className="block">
                                        <span className="text-[10px] font-black text-zinc-400 uppercase ml-2">Motivo de Anulación</span>
                                        <div className="grid grid-cols-1 gap-2 mt-1.5">
                                            {CANCEL_REASONS.map(reason => (
                                                <button
                                                    key={reason}
                                                    type="button"
                                                    onClick={() => setEditingPolicy({ ...editingPolicy, cancellationReason: reason })}
                                                    className={`px-4 py-2.5 rounded-xl text-[11px] font-black uppercase text-left transition-all border ${editingPolicy?.cancellationReason === reason ? 'bg-red-500 border-red-500 text-white shadow-lg' : 'bg-white/5 border-white/10 text-zinc-400 hover:bg-white/10'}`}
                                                >
                                                    {reason}
                                                </button>
                                            ))}
                                        </div>
                                    </label>

                                    <label className="block">
                                        <span className="text-[10px] font-black text-zinc-400 uppercase ml-2">Fecha de Anulación</span>
                                        <input
                                            type="date"
                                            value={editingPolicy?.cancellationDate || new Date().toISOString().split('T')[0]}
                                            onChange={(e) => setEditingPolicy({ ...editingPolicy, cancellationDate: e.target.value })}
                                            className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-4 text-white text-[12px] focus:border-red-500 outline-none mt-1.5 transition-all"
                                        />
                                    </label>
                                </div>

                                <div className="grid grid-cols-2 gap-3 mt-8">
                                    <button
                                        type="button"
                                        onClick={() => setIsCancellationModalOpen(false)}
                                        className="py-3 px-4 rounded-2xl bg-white/5 text-zinc-400 text-[11px] font-black uppercase hover:bg-white/10 transition-all"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (!editingPolicy?.cancellationReason) {
                                                alert("Por favor elegí un motivo");
                                                return;
                                            }
                                            setEditingPolicy({ ...editingPolicy, isCancelled: true });
                                            setIsCancellationModalOpen(false);
                                        }}
                                        className="py-3 px-4 rounded-2xl bg-red-600 text-white text-[11px] font-black uppercase shadow-lg shadow-red-600/20 hover:bg-red-500 transition-all hover:scale-[1.02] active:scale-[0.98]"
                                    >
                                        Confirmar Anulación
                                    </button>
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div >
    );
};

export default PolicyManager;
