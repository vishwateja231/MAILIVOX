import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

const STAGES = ['LinkedIn', 'Parse', 'Filter', 'Enrich', 'Generate', 'Validate', 'Outreach'];

const STAGE_DETAILS = [
    { items: 342, rate: '100%' },
    { items: 342, rate: '99.7%' },
    { items: 298, rate: '87.1%' },
    { items: 298, rate: '94.2%' },
    { items: 894, rate: '98.6%' },
    { items: 847, rate: '94.7%' },
    { items: 803, rate: '100%' },
];

export default function IntelligenceEngine({ reducedMotion }) {
    const [activeStage, setActiveStage] = useState(0);

    useEffect(() => {
        if (reducedMotion) return;
        const interval = setInterval(() => {
            setActiveStage((s) => (s + 1) % STAGES.length);
        }, 1500);
        return () => clearInterval(interval);
    }, [reducedMotion]);

    return (
        <section className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto" id="intelligence">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-100px' }}
                className="text-center mb-12"
            >
                <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
                    Intelligence Pipeline
                </h2>
                <p className="text-gray-400 max-w-2xl mx-auto">
                    Every lead flows through a multi-stage pipeline that parses, filters, enriches, generates, 
                    validates, and orchestrates — all in a single automated pass.
                </p>
            </motion.div>

            <div className="grid lg:grid-cols-3 gap-6">
                {/* Pipeline visualization */}
                <div className="lg:col-span-2 glass-card p-6 rounded-2xl">
                    <div className="flex items-center gap-2 overflow-x-auto pb-4">
                        {STAGES.map((stage, i) => (
                            <div key={stage} className="flex items-center shrink-0">
                                <div
                                    className={`px-4 py-2 rounded-lg text-xs font-medium transition-all duration-300 ${
                                        i === activeStage
                                            ? 'bg-primary/20 text-primary border border-primary/40 shadow-[0_0_12px_rgba(56,189,248,0.3)]'
                                            : i < activeStage
                                            ? 'bg-success/10 text-success border border-success/20'
                                            : 'bg-surface/50 text-gray-500 border border-white/5'
                                    }`}
                                >
                                    {stage}
                                </div>
                                {i < STAGES.length - 1 && (
                                    <div className={`w-6 h-0.5 mx-1 transition-colors duration-300 ${
                                        i < activeStage ? 'bg-success/50' : 'bg-white/10'
                                    }`} />
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Moving token indicator */}
                    {!reducedMotion && (
                        <div className="relative h-2 mt-4 bg-surface/50 rounded-full overflow-hidden">
                            <motion.div
                                className="absolute top-0 left-0 h-full bg-gradient-to-r from-primary to-indigo-500 rounded-full"
                                animate={{ width: `${((activeStage + 1) / STAGES.length) * 100}%` }}
                                transition={{ duration: 0.5, ease: 'easeInOut' }}
                            />
                        </div>
                    )}
                </div>

                {/* Stage details panel */}
                <div className="glass-panel rounded-2xl p-6">
                    <p className="text-[10px] uppercase tracking-wider text-gray-500 font-mono mb-4">Stage Details</p>
                    <div className="space-y-4">
                        <div>
                            <p className="text-xs text-gray-500">Current Stage</p>
                            <p className="text-lg font-semibold text-primary">{STAGES[activeStage]}</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-500">Items Processed</p>
                            <p className="text-lg font-mono text-white">{STAGE_DETAILS[activeStage].items}</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-500">Success Rate</p>
                            <p className="text-lg font-mono text-success">{STAGE_DETAILS[activeStage].rate}</p>
                        </div>
                        <div className="pt-2 border-t border-white/5">
                            <p className="text-xs text-gray-500">Pipeline Status</p>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
                                <span className="text-sm text-success">Active</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
