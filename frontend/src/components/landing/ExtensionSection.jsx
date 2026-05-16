import { motion } from 'framer-motion';
import { Send, Users, Building2, Briefcase } from 'lucide-react';

export default function ExtensionSection() {
    return (
        <section className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto" id="extension">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-100px' }}
                className="text-center mb-12"
            >
                <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
                    Chrome Extension
                </h2>
                <p className="text-gray-400 max-w-2xl mx-auto">
                    Capture LinkedIn profiles directly from your browser. The extension parses names, 
                    titles, and companies in real-time and streams them to your Mailivox instance.
                </p>
            </motion.div>

            <div className="max-w-4xl mx-auto">
                {/* Browser mockup */}
                <div className="glass-card rounded-2xl overflow-hidden">
                    {/* Browser chrome */}
                    <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-surface/50">
                        <div className="flex gap-1.5">
                            <div className="w-3 h-3 rounded-full bg-danger/60" />
                            <div className="w-3 h-3 rounded-full bg-warning/60" />
                            <div className="w-3 h-3 rounded-full bg-success/60" />
                        </div>
                        <div className="flex-1 mx-4">
                            <div className="bg-background/60 rounded-lg px-4 py-1.5 text-xs text-gray-500 font-mono">
                                linkedin.com/search/results/people/?keywords=...
                            </div>
                        </div>
                    </div>

                    {/* Content area */}
                    <div className="relative p-6 min-h-[280px]">
                        {/* Simulated LinkedIn-like layout */}
                        <div className="space-y-3 opacity-40">
                            {[1, 2, 3, 4].map((i) => (
                                <div key={i} className="flex items-center gap-4 p-3 rounded-lg bg-white/5">
                                    <div className="w-12 h-12 rounded-full bg-white/10" />
                                    <div className="flex-1 space-y-2">
                                        <div className="h-3 w-32 bg-white/10 rounded" />
                                        <div className="h-2 w-48 bg-white/5 rounded" />
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Floating extension overlay */}
                        <motion.div
                            initial={{ opacity: 0, x: 20 }}
                            whileInView={{ opacity: 1, x: 0 }}
                            viewport={{ once: true }}
                            transition={{ delay: 0.3 }}
                            className="absolute top-4 right-4 w-56 glass-panel rounded-xl p-4 shadow-2xl border border-primary/20"
                        >
                            {/* Extension header */}
                            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-white/5">
                                <div className="w-5 h-5 rounded bg-gradient-to-br from-primary to-indigo-500 flex items-center justify-center">
                                    <Send className="w-3 h-3 text-white" />
                                </div>
                                <span className="text-xs font-bold">MAILI<span className="text-primary">VOX</span></span>
                            </div>

                            {/* Telemetry */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Users className="w-3.5 h-3.5 text-primary" />
                                        <span className="text-xs text-gray-400">Profiles parsed</span>
                                    </div>
                                    <span className="text-xs font-mono text-primary">47</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Briefcase className="w-3.5 h-3.5 text-success" />
                                        <span className="text-xs text-gray-400">Names extracted</span>
                                    </div>
                                    <span className="text-xs font-mono text-success">47</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Building2 className="w-3.5 h-3.5 text-warning" />
                                        <span className="text-xs text-gray-400">Companies detected</span>
                                    </div>
                                    <span className="text-xs font-mono text-warning">12</span>
                                </div>
                            </div>

                            <div className="mt-4 pt-3 border-t border-white/5">
                                <div className="flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
                                    <span className="text-[10px] text-gray-500">Streaming to backend</span>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                </div>
            </div>
        </section>
    );
}
