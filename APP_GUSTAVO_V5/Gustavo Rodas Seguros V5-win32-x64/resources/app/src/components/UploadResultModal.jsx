import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, AlertCircle, X } from 'lucide-react';

/**
 * UploadResultModal
 * @param {boolean} isOpen
 * @param {function} onClose
 * @param {string} status - 'success' | 'error' | 'partial'
 * @param {string} message - Main title
 * @param {Array<string>} details - List of specific messages
 */
const UploadResultModal = ({ isOpen, onClose, status, message, details = [] }) => {
    // Close on ESC
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && isOpen) onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const getIcon = () => {
        switch (status) {
            case 'success': return <CheckCircle2 size={40} className="text-emerald-500" />;
            case 'error': return <XCircle size={40} className="text-red-500" />;
            case 'partial': return <AlertCircle size={40} className="text-orange-500" />;
            default: return <AlertCircle size={40} className="text-indigo-500" />;
        }
    };

    const getThemeColors = () => {
        switch (status) {
            case 'success':
                return {
                    bg: 'bg-emerald-500/10',
                    border: 'border-emerald-500/20',
                    buttonBg: 'bg-emerald-500',
                    buttonHover: 'hover:bg-emerald-600',
                    shadow: 'shadow-emerald-500/20'
                };
            case 'error':
                return {
                    bg: 'bg-red-500/10',
                    border: 'border-red-500/20',
                    buttonBg: 'bg-red-500',
                    buttonHover: 'hover:bg-red-600',
                    shadow: 'shadow-red-500/20'
                };
            case 'partial':
                return {
                    bg: 'bg-orange-500/10',
                    border: 'border-orange-500/20',
                    buttonBg: 'bg-orange-500',
                    buttonHover: 'hover:bg-orange-600',
                    shadow: 'shadow-orange-500/20'
                };
            default:
                return {
                    bg: 'bg-[var(--text-color)]/5',
                    border: 'border-[var(--border-color)]',
                    buttonBg: 'bg-indigo-500',
                    buttonHover: 'hover:bg-indigo-600',
                    shadow: 'shadow-indigo-500/20'
                };
        }
    };

    const theme = getThemeColors();

    return (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4">
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />
            <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                className={`w-full max-w-lg bg-[var(--card-bg)] border ${theme.border} rounded-3xl shadow-2xl relative overflow-hidden backdrop-blur-xl flex flex-col`}
            >
                {/* Header Pattern Background */}
                <div className={`absolute top-0 left-0 w-full h-32 ${theme.bg} blur-3xl opacity-50 pointer-events-none`} />

                <div className="p-6 relative z-10 flex flex-col items-center text-center">
                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 p-2 text-[var(--text-secondary)] hover:text-[var(--text-color)] hover:bg-[var(--bg-color)] rounded-full transition-colors"
                    >
                        <X size={20} />
                    </button>

                    <div className={`w-20 h-20 rounded-2xl ${theme.bg} border ${theme.border} flex items-center justify-center mb-6 shadow-inner`}>
                        {getIcon()}
                    </div>

                    <h2 className="text-xml md:text-2xl font-black uppercase tracking-tight text-[var(--text-color)] mb-2">
                        {message}
                    </h2>

                    {details && details.length > 0 && (
                        <div className="w-full mt-4 bg-[var(--bg-color)]/50 border border-[var(--border-color)] rounded-2xl p-4 text-left max-h-[250px] overflow-y-auto custom-scrollbar">
                            <span className="text-[10px] font-black uppercase text-[var(--text-secondary)] tracking-widest block mb-2 px-1">Detalles del Proceso:</span>
                            <ul className="space-y-2">
                                {details.map((detail, index) => {
                                    const isErrorLine = detail.toLowerCase().includes('error');
                                    return (
                                        <li key={index} className={`text-xs p-2 rounded-lg font-mono ${isErrorLine ? 'bg-red-500/10 text-red-400 border border-red-500/10' : 'bg-white/5 text-[var(--text-color)] border border-white/5'}`}>
                                            {detail}
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    )}
                </div>

                <div className="p-4 bg-[var(--bg-color)]/50 border-t border-[var(--border-color)]">
                    <button
                        onClick={onClose}
                        className={`w-full py-3.5 rounded-xl ${theme.buttonBg} text-white ${theme.buttonHover} shadow-lg ${theme.shadow} transition-all font-black uppercase tracking-widest text-[11px]`}
                    >
                        Aceptar
                    </button>
                </div>
            </motion.div>
        </div>
    );
};

export default UploadResultModal;
