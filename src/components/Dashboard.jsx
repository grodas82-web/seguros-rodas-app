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

// ProcesadorIA removed in favor of unified Layout upload button


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
        const normalizeName = (n) => {
            if (!n) return '';
            return n.normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .toLowerCase()
                .replace(/s\.a\.|sa|compia|compañía|cia\.| \/|seg\.|argentina|nacion|asoc\.|mutual|asociacin|asociacion|riesgos|trabajo|art|seguros|servicios/gi, '')
                .replace(/\s+/g, '')
                .replace(/[^a-z0-9]/g, '')
                .trim();
        };

        const getCanon = (name) => {
            if (!name) return null;
            const u = name.toUpperCase().trim();
            if (u.includes('ACS COMERCIAL') || u.includes('GALICIA') || u.includes('1276')) return '__CANON_GALICIA';
            if (u.includes('MERCANTIL ANDINA') || u.includes('MERCANTIL')) return '__CANON_MERCANTIL';
            if (u.includes('FEDERA')) return '__CANON_FEDERACION';
            if (u.includes('ALLIANZ')) return '__CANON_ALLIANZ';
            if ((u.includes('SWISS MEDICAL') && u.includes('ART')) || u.includes('SWISS MEDICAL ART')) return '__CANON_SWISS_MEDICAL_ART';
            if (u.includes('SMG') || (u.includes('COMPANIA ARGENTINA') && u.includes('SEGUROS')) || (u.includes('SWISS MEDICAL') && !u.includes('ART'))) return '__CANON_SMG';
            if (u.includes('MERIDIONAL')) return '__CANON_MERIDIONAL';
            if (u.includes('ZURICH')) return '__CANON_ZURICH';
            if (u.includes('RIVADAVIA')) return '__CANON_RIVADAVIA';
            if (u.includes('SANCOR')) return '__CANON_SANCOR';
            if (u.includes('SAN CRISTOBAL') || u.includes('SAN CRIST\u00d3BAL')) return '__CANON_SANCRISTOBAL';
            if (u.includes('PROVINCIA')) return '__CANON_PROVINCIA';
            if (u.includes('MAPFRE')) return '__CANON_MAPFRE';
            if (u.includes('HAMBURGO')) return '__CANON_HAMBURGO';
            if (u.includes('INTEGRITY')) return '__CANON_INTEGRITY';
            if (u.includes('TRIUNFO')) return '__CANON_TRIUNFO';
            if (u.includes('EXPERTA')) return '__CANON_EXPERTA';
            if (u.includes('GALENO')) return '__CANON_GALENO';
            if (u.includes('OMINT')) return '__CANON_OMINT';
            if (u.includes('BERKLEY')) return '__CANON_BERKLEY';
            if (u.includes('NOBLE')) return '__CANON_NOBLE';
            return null;
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

                // Normalización de nombres de compañías (Sincronizado con main.cjs)
                if (c.includes('MERCANTIL ANDINA') || c.includes('MERCANTIL')) c = 'MERCANTIL';
                else if (c.includes('FEDERA')) c = 'FEDERACIÓN';
                else if (c.includes('ACS COMERCIAL') || c.includes('GALICIA') || c.includes('1276')) c = 'GALICIA';
                else if (c.includes('ALLIANZ')) c = 'ALLIANZ';
                else if ((c.includes('SWISS MEDICAL') && c.includes('ART')) || c.includes('SWISS MEDICAL ART')) c = 'SWISS MEDICAL ART';
                else if (c.includes('SMG') || (c.includes('COMPANIA ARGENTINA') && c.includes('SEGUROS')) || (c.includes('SWISS MEDICAL') && !c.includes('ART'))) c = 'SMG';
                else if (c.includes('MERIDIONAL')) c = 'MERIDIONAL';
                else if (c.includes('ZURICH')) c = 'ZURICH';
                else if (c.includes('RIVADAVIA')) c = 'RIVADAVIA';
                else if (c.includes('SANCOR')) c = 'SANCOR';
                else if (c.includes('SAN CRISTOBAL') || c.includes('SAN CRIST\u00d3BAL')) c = 'SAN CRISTOBAL';
                else if (c.includes('PROVINCIA')) c = 'PROVINCIA';
                else if (c.includes('MAPFRE')) c = 'MAPFRE';
                else if (c.includes('HAMBURGO')) c = 'HAMBURGO';
                else if (c.includes('INTEGRITY')) c = 'INTEGRITY';
                else if (c.includes('TRIUNFO')) c = 'TRIUNFO';
                else if (c.includes('EXPERTA')) c = 'EXPERTA';

                const r = normalizeRisk(p.riskType);
                if (!acc.has(c)) acc.set(c, { total: 0, branches: {} });
                const d = acc.get(c);
                d.total++;
                d.branches[r] = (d.branches[r] || 0) + 1;
                return acc;
            }, new Map()).entries())
                .map(([name, data]) => ({ name, ...data }))
                .sort((a, b) => b.total - a.total),

            // Nueva lógica de alertas críticas (Sincronizado con Reporte Automático)
            alerts: {
                expiring: policies.filter(p => {
                    if (!p.endDate || p.isCancelled || isAutoExpired(p)) return false;
                    const end = new Date(p.endDate);
                    const diffTime = end - new Date();
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    return diffDays >= 0 && diffDays <= 7;
                }).sort((a, b) => new Date(a.endDate) - new Date(b.endDate)),

                pendingInvoices: companies.filter(comp => {
                    // Usamos la misma lógica de coverage ya calculada arriba
                    const hasInv = loadedThisMonthSet.has(comp._normalizedName) || loadedThisMonthSet.has(getCanon(comp.name));
                    return !hasInv;
                }),

                missingFiles: policies.filter(p =>
                    !p.isCancelled &&
                    !p.fileUrl &&
                    !p.fileBase64 &&
                    !(p.attachments && p.attachments.length > 0) &&
                    !isAutoExpired(p)
                )
            }
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

                    {(() => {
                        const usage = getGeminiUsage?.() || {};
                        const tokensByEngine = usage.tokensByEngine || { Claude: { total: 0 }, Gemini: { total: 0 } };
                        const claudeTotal = tokensByEngine.Claude?.total || 0;
                        const geminiTotal = tokensByEngine.Gemini?.total || 0;
                        const totalTokens = claudeTotal + geminiTotal;

                        return (
                            <StatCard
                                title="Fondo de IA (Tokens)"
                                value={(totalTokens / 1000).toFixed(1) + "K"}
                                icon={Zap}
                                color="amber"
                                subtitle={`Claude: ${(claudeTotal / 1000).toFixed(1)}K | Gemini: ${(geminiTotal / 1000).toFixed(1)}K`}
                            />
                        );
                    })()}
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
                {/* Widgets de Alertas y Notificaciones (Columna Derecha) */}
                <div className="flex flex-col gap-6">
                    <StatCard
                        title="Balance Neto Anual"
                        value={`$${stats.totalYear2026.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                        icon={TrendingUp}
                        color="purple"
                        trend={stats.yearEvolution}
                        subtitle={`Vs Total 2025: $${stats.totalYear2025.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                    />

                    {/* PANEL DE ALERTAS CRÍTICAS (Estilo Reporte Automático) */}
                    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] backdrop-blur-3xl rounded-[2.5rem] p-6 flex-1 flex flex-col gap-6 shadow-[var(--card-shadow)] overflow-hidden min-h-[500px]">
                        <div className="flex justify-between items-center mb-2">
                            <div>
                                <h3 className="text-sm font-black text-indigo-500 uppercase tracking-[0.3em] mb-1">Alertas Críticas</h3>
                                <p className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest">Resumen de Gestión Pendiente</p>
                            </div>
                            <button
                                onClick={async () => {
                                    try {
                                        const res = await fetch('http://localhost:3002/api/test-report');
                                        const data = await res.json();
                                        if (data.success) alert("✅ Reporte de prueba enviado con éxito.");
                                    } catch (e) { alert("❌ Error: Asegúrate de que la App de escritorio esté abierta."); }
                                }}
                                className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500 hover:text-white transition-all border border-indigo-500/20 group"
                                title="Probar Envío de Mail Ahora"
                            >
                                <Mail size={18} className="group-hover:scale-110 transition-transform" />
                            </button>
                        </div>

                        <div className="flex-1 space-y-8 overflow-y-auto custom-scrollbar pr-2">
                            {/* 1. VENCIMIENTOS (Indigo) */}
                            <div className="space-y-4">
                                <div className="flex items-center justify-between border-b border-[var(--border-color)] pb-2">
                                    <div className="flex items-center gap-2">
                                        <Calendar size={14} className="text-indigo-500" />
                                        <h4 className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">Vencimientos (7 días)</h4>
                                    </div>
                                    <span className="text-[9px] font-black bg-indigo-500/10 text-indigo-500 px-2 py-0.5 rounded-full">{stats.alerts.expiring.length}</span>
                                </div>
                                <div className="space-y-2">
                                    {stats.alerts.expiring.length > 0 ? stats.alerts.expiring.slice(0, 5).map((p, i) => {
                                        const end = new Date(p.endDate);
                                        const diff = Math.ceil((end - new Date()) / (1000 * 60 * 60 * 24));
                                        return (
                                            <div key={i} className="group/item flex items-center justify-between p-3 rounded-2xl bg-[var(--bg-color)] border border-[var(--border-color)] hover:border-indigo-500/30 transition-all cursor-pointer" onClick={() => onNavigate('clientes', p.clientName)}>
                                                <div className="min-w-0">
                                                    <p className="text-[10px] font-black text-[var(--text-color)] uppercase truncate">{p.clientName}</p>
                                                    <p className="text-[8px] text-[var(--text-secondary)] font-bold uppercase truncate">{p.company} • {p.riskType}</p>
                                                </div>
                                                <span className={`text-[9px] font-black px-2 py-1 rounded-lg ${diff < 3 ? 'bg-rose-500/10 text-rose-500' : 'bg-indigo-500/10 text-indigo-500'}`}>
                                                    {diff === 0 ? 'HOY' : `${diff}d`}
                                                </span>
                                            </div>
                                        );
                                    }) : <p className="text-[9px] text-[var(--text-secondary)] font-bold uppercase italic py-2">Sin vencimientos próximos</p>}
                                </div>
                            </div>

                            {/* 2. PENDIENTES FACTURACIÓN (Amber) */}
                            <div className="space-y-4">
                                <div className="flex items-center justify-between border-b border-[var(--border-color)] pb-2">
                                    <div className="flex items-center gap-2">
                                        <DollarSign size={14} className="text-amber-500" />
                                        <h4 className="text-[10px] font-black text-amber-500 uppercase tracking-widest">Pendientes de Factura</h4>
                                    </div>
                                    <span className="text-[9px] font-black bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded-full">{stats.alerts.pendingInvoices.length}</span>
                                </div>
                                <div className="space-y-2">
                                    {stats.alerts.pendingInvoices.length > 0 ? stats.alerts.pendingInvoices.slice(0, 6).map((comp, i) => (
                                        <div key={i} className="flex items-center gap-3 p-2.5 rounded-2xl bg-amber-500/5 border border-amber-500/10">
                                            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                                            <p className="text-[10px] font-black text-[var(--text-color)] uppercase truncate">{comp.name}</p>
                                        </div>
                                    )) : <p className="text-[9px] text-emerald-500 font-black uppercase italic py-2">Facturación al día</p>}
                                </div>
                            </div>

                            {/* 3. FALTA ARCHIVO PDF (Rose) */}
                            <div className="space-y-4">
                                <div className="flex items-center justify-between border-b border-[var(--border-color)] pb-2">
                                    <div className="flex items-center gap-2">
                                        <ShieldAlert size={14} className="text-rose-500" />
                                        <h4 className="text-[10px] font-black text-rose-500 uppercase tracking-widest">Pólizas Sin PDF</h4>
                                    </div>
                                    <span className="text-[9px] font-black bg-rose-500/10 text-rose-500 px-2 py-0.5 rounded-full">{stats.alerts.missingFiles.length}</span>
                                </div>
                                <div className="space-y-2">
                                    {stats.alerts.missingFiles.length > 0 ? stats.alerts.missingFiles.slice(0, 5).map((p, i) => (
                                        <div key={i} className="p-2.5 rounded-2xl bg-rose-500/5 border border-rose-500/10 flex flex-col gap-0.5">
                                            <p className="text-[9px] font-black text-[var(--text-color)] uppercase truncate">{p.clientName}</p>
                                            <p className="text-[7px] text-rose-500/70 font-bold uppercase tracking-widest italic">Archivo faltante</p>
                                        </div>
                                    )) : <p className="text-[9px] text-emerald-500 font-black uppercase italic py-2">Documentación completa</p>}
                                </div>
                            </div>
                        </div>

                        <div className="mt-auto pt-4 border-t border-[var(--border-color)] text-center">
                            <p className="text-[8px] font-black text-[var(--text-secondary)] uppercase tracking-[0.4em] opacity-30">
                                Gustavo Rodas <span className="italic">Seguros</span> V15
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">

                {/* Gráfico de Evolución Mensual Detallado */}
                <div className="lg:col-span-4 bg-[var(--card-bg)] border border-[var(--border-color)] backdrop-blur-3xl rounded-2xl md:rounded-[2.5rem] p-4 md:p-10 shadow-[var(--card-shadow)] relative overflow-hidden">
                    <div className="flex justify-between items-center mb-12 relative z-10">
                        <div>
                            <h3 className="font-black text-[var(--text-color)] uppercase text-sm tracking-[0.2em] mb-1">Cierre Mensual e IIBB</h3>
                            <p className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-widest">Evolución de Comisiones Netas (post-deducciones)</p>
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
                                <XAxis dataKey="name" stroke="var(--text-secondary)" fontSize={10} tickLine={false} axisLine={false} dy={15} style={{ fontWeight: 'black', opacity: 0.5 }} />
                                <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(value) => `$${value / 1000}k`} style={{ fontWeight: 'black', opacity: 0.5 }} />
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
                                <Area type="monotone" dataKey="2026" stroke="#6366f1" strokeWidth={4} fillOpacity={1} fill="url(#colorTotal)" name="2026" animationDuration={2000} />
                                <Area type="monotone" dataKey="2025" stroke="#ec4899" strokeWidth={2} strokeDasharray="8 8" fillOpacity={0} name="2025" animationDuration={1500} />
                            </AreaChart>
                        </ResponsiveContainer>
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
