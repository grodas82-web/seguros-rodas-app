import React, { useState, useEffect, useMemo, Component } from 'react';
import {
    LayoutDashboard, PlusCircle, History, Building2, Globe,
    Settings as SettingsIcon, Database, FlaskConical, Search,
    Command, Bell, User, ShieldAlert, Menu, X, LogOut, Sun, Moon
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Dashboard from './Dashboard';
import InvoiceEntry from './InvoiceEntry';
import InvoiceList from './InvoiceList';
import CompanyManager from './CompanyManager';
import DataMigrator from './DataMigrator';
import SequenceGapList from './SequenceGapList';
import GlobalSearch from './GlobalSearch';
import SplashScreen from './SplashScreen';
import PolicyManager from './PolicyManager';
import { useAppContext } from '../context/AppContext';

// Error Boundary para proteger las pestañas
class TabErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }
    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }
    componentDidCatch(error, errorInfo) {
        console.error("Tab Error caught by Boundary:", error, errorInfo);
    }
    render() {
        if (this.state.hasError) {
            return (
                <div className="p-20 text-center flex flex-col items-center justify-center min-h-[60vh]">
                    <div className="w-20 h-20 rounded-full bg-rose-500/10 flex items-center justify-center text-rose-500 mb-6 border border-rose-500/20">
                        <ShieldAlert size={40} />
                    </div>
                    <h3 className="text-xl font-black text-white uppercase tracking-tighter italic mb-4">Módulo en Reparación</h3>
                    <p className="text-zinc-500 text-sm max-w-md mx-auto mb-8 uppercase font-bold tracking-widest leading-relaxed">
                        Hubo un problema al cargar esta pestaña. No te preocupes, el resto de la aplicación sigue funcionando.
                    </p>
                    <button
                        onClick={() => { this.setState({ hasError: false }); window.location.reload(); }}
                        className="px-8 py-3 bg-indigo-500 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-indigo-500/20 hover:bg-indigo-400 transition-all"
                    >
                        Reintentar Carga
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

const Layout = () => {
    const context = useAppContext();
    const loading = context ? context.loading : true;
    const [activeTab, setActiveTab] = useState('dashboard');
    const [scrolled, setScrolled] = useState(false);
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [showNotifications, setShowNotifications] = useState(false);
    const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const { logout, user, theme, toggleTheme } = context || {};

    useEffect(() => {
        const handleScroll = () => setScrolled(window.scrollY > 20);
        window.addEventListener('scroll', handleScroll);

        const handleKeyDown = (e) => {
            if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                setIsSearchOpen(prev => !prev);
            }
        };
        window.addEventListener('keydown', handleKeyDown);

        return () => {
            window.removeEventListener('scroll', handleScroll);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, []);

    const menuItems = [
        { id: 'dashboard', label: 'Panel Control', icon: LayoutDashboard, color: 'indigo' },
        { id: 'entry', label: 'Ingresar Factura', icon: PlusCircle, color: 'emerald' },
        { id: 'clientes', label: 'Clientes', icon: User, color: 'purple' },
        { id: 'history', label: 'Historial', icon: History, color: 'blue' },
        { id: 'companies', label: 'Compañías', icon: Building2, color: 'amber' },
    ];

    const handleNavigate = (tab, term = '') => {
        if (context?.setGlobalSearchTerm) {
            context.setGlobalSearchTerm(term);
        }
        setActiveTab(tab);
        setShowNotifications(false);
        setIsSearchOpen(false);
    };

    const handleSearchSelect = (tab, id, term = '') => {
        handleNavigate(tab, term);
    };

    const renderContent = () => {
        switch (activeTab) {
            case 'dashboard': return <Dashboard onNavigate={handleNavigate} />;
            case 'entry': return <InvoiceEntry onFinish={() => setActiveTab('history')} />;
            case 'clientes': return <PolicyManager />;
            case 'history': return <InvoiceList />;
            case 'companies': return <CompanyManager />;
            default: return <Dashboard />;
        }
    };

    return (
        <div className="flex min-h-screen bg-[var(--bg-color)] text-[var(--text-color)] font-sans selection:bg-indigo-500/30">
            <SplashScreen loading={loading} />
            {/* Ambient Background Orbs */}
            <div className="hidden md:block fixed inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-500/10 blur-[60px] rounded-full" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500/10 blur-[60px] rounded-full" />
                <div className="absolute top-[20%] right-[10%] w-[20%] h-[20%] bg-emerald-500/5 blur-[40px] rounded-full" />
            </div>

            {/* Global Search Component */}
            <GlobalSearch
                isOpen={isSearchOpen}
                onClose={() => setIsSearchOpen(false)}
                onSelect={handleSearchSelect}
            />

            {/* Desktop Sidebar (Hidden on Mobile) */}
            <aside
                onMouseEnter={() => setIsSidebarExpanded(true)}
                onMouseLeave={() => setIsSidebarExpanded(false)}
                className={`hidden md:flex border-r border-[var(--border-color)] flex-col fixed left-0 top-0 h-full bg-[var(--card-bg)] backdrop-blur-3xl z-[60] transition-all duration-500 ease-in-out ${isSidebarExpanded ? 'w-64 shadow-2xl' : 'w-20'}`}
            >
                <div className="p-5 border-b border-white/5 flex justify-center lg:justify-start">
                    <div className="flex items-center gap-4 group cursor-pointer overflow-hidden">
                        <div className="w-10 h-10 shrink-0 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-xl shadow-indigo-500/20 group-hover:scale-110 transition-transform duration-500">
                            <span className="font-black text-white italic text-xl">GR</span>
                        </div>
                        {isSidebarExpanded && (
                            <motion.div
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                className="flex flex-col whitespace-nowrap"
                            >
                                <span className="font-black tracking-tighter text-sm uppercase leading-none">Gustavo Rodas <span className="text-zinc-500">Seguros</span></span>
                                <span className="text-[8px] font-black text-indigo-400 uppercase tracking-[0.3em] mt-1">Premium Edition</span>
                            </motion.div>
                        )}
                    </div>
                </div>

                <nav className="flex-1 p-4 space-y-2 overflow-y-auto scrollbar-none">
                    {isSidebarExpanded && (
                        <p className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-[0.2em] mb-4 ml-2 whitespace-nowrap">Menú Principal</p>
                    )}
                    {menuItems.map((item) => (
                        <button
                            key={item.id}
                            onClick={() => {
                                if (context?.setGlobalSearchTerm) {
                                    context.setGlobalSearchTerm('');
                                }
                                setActiveTab(item.id);
                                setShowNotifications(false);
                            }}
                            className={`w-full flex items-center justify-between px-3 py-3.5 rounded-2xl transition-all duration-300 group relative ${activeTab === item.id
                                ? 'bg-indigo-500/10 text-indigo-500'
                                : 'text-[var(--text-secondary)] hover:text-[var(--text-color)] hover:bg-[var(--border-color)]'
                                }`}
                        >
                            <div className="flex items-center gap-4">
                                <item.icon size={20} className={activeTab === item.id ? 'text-indigo-400' : 'text-[var(--text-secondary)] group-hover:text-indigo-400 transition-colors'} />
                                {isSidebarExpanded && (
                                    <motion.span
                                        initial={{ opacity: 0, x: -10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        className="text-[10px] font-black uppercase tracking-widest whitespace-nowrap"
                                    >
                                        {item.label}
                                    </motion.span>
                                )}
                            </div>
                            {activeTab === item.id && (
                                <motion.div layoutId="activeTab" className="absolute left-0 w-1 h-6 bg-indigo-500 rounded-r-full" />
                            )}
                        </button>
                    ))}
                </nav>

                <div className="p-4 border-t border-white/5 space-y-2">
                    <button className="w-full flex items-center gap-4 px-3 py-3 rounded-2xl text-[var(--text-secondary)] hover:text-[var(--text-color)] hover:bg-[var(--border-color)] transition-all group">
                        <SettingsIcon size={20} className="group-hover:rotate-90 transition-transform duration-500" />
                        {isSidebarExpanded && (
                            <motion.span
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                className="text-[10px] font-black uppercase tracking-widest"
                            >
                                Configuración
                            </motion.span>
                        )}
                    </button>
                    <button
                        onClick={logout}
                        className="w-full flex items-center gap-4 px-3 py-3 rounded-2xl text-rose-500/70 hover:text-rose-500 hover:bg-rose-500/10 transition-all group"
                    >
                        <LogOut size={20} />
                        {isSidebarExpanded && (
                            <motion.span
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                className="text-[10px] font-black uppercase tracking-widest"
                            >
                                Cerrar Sesión
                            </motion.span>
                        )}
                    </button>
                </div>
            </aside>

            {/* Mobile Bottom Navigation (Visible only on Mobile) */}
            <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-[var(--card-bg)] backdrop-blur-3xl border-t border-[var(--border-color)] z-[60] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex items-center justify-around">
                {menuItems.slice(0, 5).map((item) => (
                    <button
                        key={item.id}
                        onClick={() => setActiveTab(item.id)}
                        className={`p-2 transition-all ${activeTab === item.id ? 'text-indigo-500 scale-110' : 'text-[var(--text-secondary)]'}`}
                    >
                        <item.icon size={22} />
                    </button>
                ))}
                <button
                    onClick={() => setIsMobileMenuOpen(true)}
                    className="p-2 text-zinc-500"
                >
                    <Menu size={22} />
                </button>
            </nav>

            {/* Mobile Drawer (Visible when Menu clicked on Mobile) */}
            <AnimatePresence>
                {isMobileMenuOpen && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setIsMobileMenuOpen(false)}
                            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[70] md:hidden"
                        />
                        <motion.div
                            initial={{ x: '100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '100%' }}
                            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                            className="fixed right-0 top-0 bottom-0 w-72 bg-[var(--card-bg)] border-l border-[var(--border-color)] z-[80] p-8 md:hidden"
                        >
                            <div className="flex justify-between items-center mb-10">
                                <span className="font-black text-indigo-400 text-[10px] uppercase tracking-widest">Ajustes</span>
                                <button onClick={() => setIsMobileMenuOpen(false)} className="text-zinc-500 hover:text-white">
                                    <X size={24} />
                                </button>
                            </div>
                            <div className="space-y-6">
                                <button className="w-full flex items-center gap-4 text-zinc-400 hover:text-white transition-colors">
                                    <SettingsIcon size={20} />
                                    <span className="text-[11px] font-black uppercase tracking-widest">Configuración</span>
                                </button>
                                <button
                                    onClick={() => { logout(); setIsMobileMenuOpen(false); }}
                                    className="w-full flex items-center gap-4 text-rose-500 hover:text-rose-400 transition-colors"
                                >
                                    <LogOut size={20} />
                                    <span className="text-[11px] font-black uppercase tracking-widest">Cerrar Sesión</span>
                                </button>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            {/* Main Content */}
            <main className={`flex-1 min-w-0 transition-all duration-500 ${isSidebarExpanded ? 'md:ml-64' : 'ml-0 md:ml-20'} min-h-screen relative z-10 bg-[var(--bg-color)] text-[var(--text-color)]`} onClick={() => setShowNotifications(false)}>
                <TabErrorBoundary>
                    {/* Modern Header */}
                    <header className={`h-14 md:h-20 flex items-center justify-between px-4 md:px-10 sticky top-0 z-40 transition-all duration-500 border-b ${scrolled ? 'bg-[var(--bg-color)]/80 backdrop-blur-2xl border-[var(--border-color)] shadow-2xl' : 'bg-transparent border-transparent'
                        }`}>
                        <div className="flex items-center gap-6">
                            <div
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsSearchOpen(true);
                                }}
                                className="hidden md:flex items-center gap-3 px-4 py-2.5 bg-[var(--border-color)] border border-[var(--border-color)] rounded-2xl text-[var(--text-secondary)] cursor-pointer hover:bg-[var(--border-color)] transition-all group"
                            >
                                <Command size={14} className="group-hover:text-indigo-400" />
                                <span className="text-[10px] font-black uppercase tracking-widest">Buscador Inteligente</span>
                                <span className="text-[10px] bg-zinc-800 px-1.5 py-0.5 rounded border border-white/5 ml-2 font-mono">⌘K</span>
                            </div>
                        </div>

                        <div className="flex items-center gap-6 text-right">
                            <div className="flex items-center gap-2 pr-6 border-r border-white/5 relative">
                                <div
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setShowNotifications(!showNotifications);
                                    }}
                                    className="p-2 text-[var(--text-secondary)] hover:text-indigo-500 transition-colors cursor-pointer relative group/bell"
                                >
                                    <Bell size={22} className={((context?.pendingCount || 0) + (context?.expiringCount || 0) + (context?.missingFileCount || 0)) > 0 ? "animate-swing" : ""} />
                                    {((context?.pendingCount || 0) + (context?.expiringCount || 0) + (context?.missingFileCount || 0)) > 0 && (
                                        <span className="absolute -top-1 -right-1 min-w-[20px] h-[20px] px-1 bg-rose-500 text-white text-[11px] font-black rounded-full border-2 border-[var(--bg-color)] flex items-center justify-center shadow-lg shadow-rose-500/20">
                                            {(context?.pendingCount || 0) + (context?.expiringCount || 0) + (context?.missingFileCount || 0)}
                                        </span>
                                    )}
                                </div>

                                <button
                                    onClick={(e) => { e.stopPropagation(); toggleTheme(); }}
                                    className="p-2 text-[var(--text-secondary)] hover:text-indigo-500 transition-colors cursor-pointer"
                                    title="Cambiar Tema"
                                >
                                    {theme === 'dark' ? <Sun size={22} /> : <Moon size={22} />}
                                </button>
                            </div>

                            {/* Dropdown Menu */}
                            <AnimatePresence>
                                {showNotifications && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                                        className="fixed md:absolute top-16 md:top-full right-2 md:right-0 mt-0 md:mt-4 w-[calc(100vw-1rem)] md:w-[500px] max-h-[80vh] bg-[var(--card-bg)] backdrop-blur-3xl border border-[var(--border-color)] rounded-2xl md:rounded-[3rem] shadow-2xl overflow-hidden overflow-y-auto z-[100]"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <div className="p-8 border-b border-[var(--border-color)] flex justify-between items-center bg-[var(--border-color)]">
                                            <h4 className="text-[14px] font-black text-white uppercase tracking-[0.2em]">Pendientes</h4>
                                            <span className="px-3 py-1 rounded-full bg-rose-500/30 text-rose-400 text-[11px] font-black uppercase">
                                                {(context?.pendingCount || 0) + (context?.expiringCount || 0) + (context?.missingFileCount || 0)} AVISOS
                                            </span>
                                        </div>
                                        <div className="max-h-[500px] overflow-y-auto custom-scrollbar">
                                            {/* Billing Alerts */}
                                            {context?.pendingCompanies?.length > 0 && (
                                                <div className="p-6 border-b border-[var(--border-color)] bg-[var(--bg-color)]/30">
                                                    <p className="text-[11px] font-black text-rose-500 uppercase tracking-widest mb-4">Pendientes de Factura</p>
                                                    {context.pendingCompanies.map((comp) => (
                                                        <div
                                                            key={comp.id}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleNavigate('companies', comp.name);
                                                            }}
                                                            className="flex items-center justify-between group/item py-3 cursor-pointer"
                                                        >
                                                            <div className="flex items-center gap-4">
                                                                <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center text-zinc-500 group-hover/item:bg-indigo-500/20 group-hover/item:text-indigo-400 transition-all">
                                                                    <Building2 size={18} />
                                                                </div>
                                                                <p className="text-[14px] font-black text-zinc-300 uppercase tracking-tight truncate max-w-[300px]">
                                                                    {comp.name}
                                                                </p>
                                                            </div>
                                                            <span className="text-[10px] font-black text-indigo-400 opacity-0 group-hover/item:opacity-100 transition-opacity uppercase font-mono">Ver →</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Missing Files Alerts */}
                                            {context?.missingFilePolicies?.length > 0 && (
                                                <div className="p-6 border-b border-[var(--border-color)] bg-[var(--bg-color)]/30">
                                                    <p className="text-[11px] font-black text-indigo-400 uppercase tracking-widest mb-4">Pólizas sin adjunto</p>
                                                    {context.missingFilePolicies.slice(0, 5).map((pol) => (
                                                        <div
                                                            key={pol.id}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (context?.setShowOnlyMissingFiles) {
                                                                    context.setShowOnlyMissingFiles(true);
                                                                }
                                                                handleNavigate('clientes', pol.clientName);
                                                            }}
                                                            className="flex items-center justify-between group/item py-3 cursor-pointer"
                                                        >
                                                            <div className="flex items-center gap-4">
                                                                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center transition-all group-hover/item:bg-indigo-500 group-hover/item:text-black shadow-lg shadow-indigo-500/10">
                                                                    <PlusCircle size={18} />
                                                                </div>
                                                                <div className="flex flex-col gap-0.5">
                                                                    <p className="text-[14px] font-black text-zinc-200 uppercase tracking-tight truncate max-w-[280px]">
                                                                        {pol.clientName}
                                                                    </p>
                                                                    <p className="text-[10px] text-zinc-500 font-black uppercase tracking-wider">{pol.company}</p>
                                                                </div>
                                                            </div>
                                                            <span className="text-[10px] font-black text-indigo-400 opacity-0 group-hover/item:opacity-100 transition-opacity uppercase font-mono">Subir →</span>
                                                        </div>
                                                    ))}
                                                    {context.missingFilePolicies.length > 5 && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (context?.setShowOnlyMissingFiles) {
                                                                    context.setShowOnlyMissingFiles(true);
                                                                }
                                                                handleNavigate('clientes');
                                                            }}
                                                            className="text-[10px] font-black text-zinc-500 hover:text-white uppercase tracking-[0.2em] mt-4 block w-full text-center py-2 border border-white/5 rounded-full hover:bg-white/5 transition-all"
                                                        >
                                                            Y {context.missingFilePolicies.length - 5} más... Ver todas
                                                        </button>
                                                    )}
                                                </div>
                                            )}

                                            {/* Policy Alerts (Expirations) */}
                                            {context?.expiringPolicies?.length > 0 && (
                                                <div className="p-6 border-b border-[var(--border-color)] bg-[var(--bg-color)]/30">
                                                    <p className="text-[11px] font-black text-amber-500 uppercase tracking-widest mb-4">Vencimientos Próximos</p>
                                                    {context.expiringPolicies.map((pol) => {
                                                        const end = new Date(pol.endDate);
                                                        const diff = Math.ceil((end - new Date()) / (1000 * 60 * 60 * 24));
                                                        return (
                                                            <div
                                                                key={pol.id}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleNavigate('clientes', pol.clientName);
                                                                }}
                                                                className="flex items-center justify-between group/item py-3 cursor-pointer"
                                                            >
                                                                <div className="flex items-center gap-4">
                                                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${diff < 7 ? 'bg-rose-500/20 text-rose-400 border border-rose-500/20' : 'bg-amber-500/20 text-amber-400 border border-amber-500/20'}`}>
                                                                        <ShieldAlert size={18} />
                                                                    </div>
                                                                    <div className="flex flex-col gap-0.5">
                                                                        <p className="text-[14px] font-black text-zinc-200 uppercase tracking-tight truncate max-w-[280px]">
                                                                            {pol.clientName}
                                                                        </p>
                                                                        <p className="text-[10px] text-zinc-500 font-black uppercase tracking-wider">{pol.company}</p>
                                                                    </div>
                                                                </div>
                                                                <span className={`text-[12px] font-black uppercase font-mono px-3 py-1 rounded-lg ${diff < 7 ? 'bg-rose-500/10 text-rose-500' : 'bg-amber-500/10 text-amber-500'}`}>
                                                                    {diff === 0 ? 'HOY' : `${diff}D`}
                                                                </span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}

                                            {(context?.pendingCount || 0) === 0 && (context?.expiringCount || 0) === 0 && (context?.missingFileCount || 0) === 0 && (
                                                <div className="p-10 text-center">
                                                    <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">¡Todo al día!</p>
                                                </div>
                                            )}
                                        </div>
                                        {(context?.pendingCount || 0) > 0 && (
                                            <button
                                                onClick={() => {
                                                    setActiveTab('companies');
                                                    setShowNotifications(false);
                                                }}
                                                className="w-full p-4 text-[9px] font-black text-zinc-500 hover:text-white uppercase tracking-[0.2em] transition-colors bg-white/[0.02] hover:bg-white/5"
                                            >
                                                Ver Directorio Completo
                                            </button>
                                        )}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                            <div className="flex items-center gap-2 md:gap-4 group cursor-pointer p-1 rounded-2xl hover:bg-white/5 transition-all pr-2 md:pr-4">
                                <div className="text-right hidden md:block">
                                    <p className="text-[10px] font-black text-white uppercase tracking-tight leading-none mb-1">Adm. Gustavo</p>
                                    <p className="text-[8px] text-emerald-500 font-black uppercase tracking-[0.2em]">En Línea</p>
                                </div>
                                <div className="w-8 h-8 md:w-10 md:h-10 rounded-xl bg-[var(--border-color)] border border-[var(--border-color)] flex items-center justify-center text-[var(--text-secondary)] overflow-hidden relative">
                                    <User size={18} />
                                    <div className="absolute inset-0 bg-indigo-500/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                            </div>
                        </div>
                    </header>

                    <div className="p-3 md:p-8 w-full mx-auto pb-28 md:pb-12">
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={activeTab}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.15 }}
                            >
                                {renderContent()}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                </TabErrorBoundary>
            </main>
        </div >
    );
};

export default Layout;
