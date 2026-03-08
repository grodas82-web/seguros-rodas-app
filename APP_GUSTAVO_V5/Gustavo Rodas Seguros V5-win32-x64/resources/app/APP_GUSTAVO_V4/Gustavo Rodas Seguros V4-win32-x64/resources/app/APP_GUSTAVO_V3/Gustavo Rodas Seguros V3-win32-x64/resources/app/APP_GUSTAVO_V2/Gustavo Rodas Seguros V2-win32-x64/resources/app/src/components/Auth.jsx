import React, { useState } from 'react';
import { Shield, Mail, Lock, Loader2, ArrowRight, User } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppContext } from '../context/AppContext';

const Auth = () => {
    const { login } = useAppContext();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            await login(email, password);
        } catch (err) {
            console.error("Login error:", err);
            setError('Credenciales inválidas. Verificá tu email y contraseña.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[var(--bg-color)] flex items-center justify-center p-6 relative overflow-hidden text-[var(--text-color)]">
            {/* Background Orbs */}
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-500/10 blur-[120px] rounded-full animate-pulse" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500/10 blur-[120px] rounded-full animate-pulse delay-700" />

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                className="w-full max-w-md relative z-10"
            >
                <div className="text-center mb-10">
                    <motion.div
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: 0.2 }}
                        className="w-20 h-20 rounded-[2.5rem] bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mx-auto mb-8 shadow-2xl shadow-indigo-500/20 group"
                    >
                        <Shield size={40} className="text-white group-hover:scale-110 transition-transform duration-500" />
                    </motion.div>
                    <motion.h1
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.3 }}
                        className="text-3xl font-black text-[var(--text-color)] uppercase tracking-tighter italic mb-2"
                    >
                        Gustavo Rodas <span className="text-indigo-500">Seguros</span>
                    </motion.h1>
                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.4 }}
                        className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.4em]"
                    >
                        Portal de Gestión Premium
                    </motion.p>
                </div>

                <div className="bg-[var(--card-bg)] backdrop-blur-2xl border border-[var(--border-color)] p-10 rounded-[3rem] shadow-2xl relative group overflow-hidden">
                    {/* Inner Glass Glow */}
                    <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />

                    <form onSubmit={handleSubmit} className="space-y-6 relative z-10">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Email Profesional</label>
                            <div className="relative group/input">
                                <div className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within/input:text-indigo-400 transition-colors">
                                    <Mail size={18} />
                                </div>
                                <input
                                    type="email"
                                    required
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="admin@gustavorodas.com"
                                    className="w-full bg-[var(--bg-color)] border border-[var(--border-color)] rounded-2xl py-4 pl-14 pr-6 text-sm text-[var(--text-color)] placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:bg-[var(--card-bg)] transition-all"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Contraseña</label>
                            <div className="relative group/input">
                                <div className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within/input:text-indigo-400 transition-colors">
                                    <Lock size={18} />
                                </div>
                                <input
                                    type="password"
                                    required
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••••••"
                                    className="w-full bg-[var(--bg-color)] border border-[var(--border-color)] rounded-2xl py-4 pl-14 pr-6 text-sm text-[var(--text-color)] placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:bg-[var(--card-bg)] transition-all"
                                />
                            </div>
                        </div>

                        <AnimatePresence>
                            {error && (
                                <motion.p
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    className="text-rose-500 text-[10px] font-black uppercase tracking-widest text-center"
                                >
                                    {error}
                                </motion.p>
                            )}
                        </AnimatePresence>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-indigo-500 hover:bg-indigo-400 text-white font-black uppercase tracking-widest text-[11px] py-5 rounded-2xl shadow-xl shadow-indigo-500/20 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-3 group/btn"
                        >
                            {loading ? (
                                <Loader2 className="animate-spin" size={18} />
                            ) : (
                                <>
                                    Acceder al Sistema
                                    <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                                </>
                            )}
                        </button>
                    </form>
                </div>

                <div className="mt-12 text-center space-y-4">
                    <p className="text-zinc-600 text-[9px] font-black uppercase tracking-[0.2em]">
                        © 2026 Gustavo Rodas Seguros • Protección de Datos Nivel Bancario
                    </p>
                    <div className="flex items-center justify-center gap-6">
                        <div className="flex items-center gap-2 text-zinc-500 text-[8px] font-bold uppercase">
                            <Shield size={12} className="text-emerald-500" />
                            Firestore Encrypted
                        </div>
                        <div className="flex items-center gap-2 text-zinc-500 text-[8px] font-bold uppercase">
                            <Shield size={12} className="text-indigo-500" />
                            Firebase SSL
                        </div>
                    </div>
                </div>
            </motion.div>
        </div>
    );
};

export default Auth;
