import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const statuses = [
    { threshold: 0, text: 'Iniciando sistema...' },
    { threshold: 20, text: 'Conectando con base de datos...' },
    { threshold: 45, text: 'Sincronizando registros...' },
    { threshold: 70, text: 'Analizando rentabilidad...' },
    { threshold: 90, text: 'Preparando entorno...' }
];

const SplashScreen = ({ loading }) => {
    const [progress, setProgress] = useState(0);
    const [status, setStatus] = useState(statuses[0].text);

    useEffect(() => {
        if (!loading) {
            const timer = setTimeout(() => {
                setProgress(100);
                setStatus('Sincronización completa');
            }, 0);
            return () => clearTimeout(timer);
        }

        const interval = setInterval(() => {
            setProgress(prev => {
                if (prev >= 92) return prev;
                const next = prev + (Math.random() * 8);

                const currentStatus = [...statuses].reverse().find(s => next >= s.threshold);
                if (currentStatus) setStatus(currentStatus.text);

                return next;
            });
        }, 150);

        return () => clearInterval(interval);
    }, [loading]);

    return (
        <AnimatePresence>
            {loading && (
                <motion.div
                    initial={{ opacity: 1 }}
                    exit={{ opacity: 0, transition: { duration: 0.5 } }}
                    className="fixed inset-0 z-[999] bg-[#020203] flex flex-col items-center justify-center"
                >
                    <div className="absolute inset-0 pointer-events-none overflow-hidden">
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-indigo-500/10 blur-[120px] rounded-full" />
                    </div>

                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex flex-col items-center gap-6"
                    >
                        <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-2xl">
                            <span className="text-white font-black italic text-3xl">GR</span>
                        </div>

                        <div className="text-center">
                            <h2 className="text-xl font-black text-white uppercase tracking-tighter">
                                Gustavo Rodas <span className="text-zinc-500">Seguros</span>
                            </h2>
                            <p className="text-[9px] font-black text-indigo-400 uppercase tracking-[0.4em] mt-1">Sincronizando datos...</p>
                        </div>

                        <div className="w-48 mt-4 flex flex-col gap-2">
                            <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                                <motion.div
                                    className="h-full bg-indigo-500"
                                    animate={{ width: `${progress}%` }}
                                />
                            </div>
                            <span className="text-[8px] font-bold text-zinc-600 uppercase tracking-widest text-center">
                                {status}
                            </span>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default SplashScreen;
