import { motion } from 'framer-motion';

const PATTERNS = [
    { label: 'first.last@', confidence: 87, x: 280, y: 60 },
    { label: 'f.last@', confidence: 72, x: 320, y: 160 },
    { label: 'first@', confidence: 45, x: 280, y: 260 },
    { label: 'flast@', confidence: 34, x: 180, y: 200 },
];

const COMPANY = { label: 'Acme Corp', health: 94, x: 120, y: 140 };

export default function CompanyIntelligence({ reducedMotion }) {
    return (
        <section className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto" id="company-intel">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-100px' }}
                className="text-center mb-12"
            >
                <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
                    Company Pattern Intelligence
                </h2>
                <p className="text-gray-400 max-w-2xl mx-auto">
                    Mailivox learns email patterns per company. Every verification result feeds back into 
                    the pattern engine, increasing confidence over time and reducing bounces.
                </p>
            </motion.div>

            <div className="grid lg:grid-cols-2 gap-8 items-center">
                {/* Network Graph */}
                <div className="glass-card p-6 rounded-2xl">
                    <svg viewBox="0 0 420 320" className="w-full h-auto" aria-hidden="true">
                        {/* Edges from company to patterns */}
                        {PATTERNS.map((p, i) => (
                            <motion.line
                                key={`edge-${i}`}
                                x1={COMPANY.x + 40} y1={COMPANY.y}
                                x2={p.x} y2={p.y}
                                stroke="rgba(56,189,248,0.3)"
                                strokeWidth="2"
                                strokeDasharray="4 4"
                                initial={{ opacity: 0.3 }}
                                animate={reducedMotion ? {} : { opacity: [0.3, 0.8, 0.3] }}
                                transition={{ duration: 2, repeat: Infinity, delay: i * 0.4 }}
                            />
                        ))}

                        {/* Company node */}
                        <g>
                            <rect
                                x={COMPANY.x - 40} y={COMPANY.y - 30}
                                width="120" height="60" rx="12"
                                fill="rgba(30,41,59,0.9)"
                                stroke="rgba(56,189,248,0.5)"
                                strokeWidth="2"
                                style={{ filter: 'drop-shadow(0 0 8px rgba(56,189,248,0.3))' }}
                            />
                            <text x={COMPANY.x + 20} y={COMPANY.y - 5} textAnchor="middle" fill="#F1F5F9" fontSize="12" fontWeight="600">
                                {COMPANY.label}
                            </text>
                            <text x={COMPANY.x + 20} y={COMPANY.y + 15} textAnchor="middle" fill="#10B981" fontSize="10">
                                Health: {COMPANY.health}%
                            </text>
                        </g>

                        {/* Pattern nodes */}
                        {PATTERNS.map((p, i) => (
                            <g key={`node-${i}`}>
                                <motion.rect
                                    x={p.x - 35} y={p.y - 20}
                                    width="90" height="40" rx="8"
                                    fill="rgba(30,41,59,0.8)"
                                    stroke={p.confidence > 70 ? 'rgba(16,185,129,0.5)' : 'rgba(245,158,11,0.5)'}
                                    strokeWidth="1.5"
                                    initial={{ scale: 1 }}
                                    animate={reducedMotion ? {} : { scale: [1, 1.02, 1] }}
                                    transition={{ duration: 3, repeat: Infinity, delay: i * 0.5 }}
                                />
                                <text x={p.x + 10} y={p.y - 3} textAnchor="middle" fill="#94A3B8" fontSize="10">
                                    {p.label}
                                </text>
                                <text x={p.x + 10} y={p.y + 12} textAnchor="middle" fill={p.confidence > 70 ? '#10B981' : '#F59E0B'} fontSize="9">
                                    {p.confidence}%
                                </text>
                            </g>
                        ))}
                    </svg>
                </div>

                {/* Explanation */}
                <div className="space-y-6">
                    <div className="glass-panel rounded-xl p-5">
                        <h3 className="text-white font-semibold mb-2">Bounce Intelligence</h3>
                        <p className="text-sm text-gray-400 leading-relaxed">
                            When an email bounces, the pattern that generated it loses confidence. 
                            Over time, the system converges on the correct format for each company domain, 
                            eliminating guesswork entirely.
                        </p>
                    </div>
                    <div className="glass-panel rounded-xl p-5">
                        <h3 className="text-white font-semibold mb-2">Pattern Confidence</h3>
                        <p className="text-sm text-gray-400 leading-relaxed">
                            Each pattern starts at a base confidence derived from industry frequency data. 
                            Successful deliveries increase confidence; bounces decrease it. The highest-confidence 
                            pattern is always used for new leads at that company.
                        </p>
                    </div>
                    <div className="glass-panel rounded-xl p-5">
                        <h3 className="text-white font-semibold mb-2">Adaptive Learning</h3>
                        <p className="text-sm text-gray-400 leading-relaxed">
                            The system adapts in real-time. If a company changes its email format, 
                            Mailivox detects the shift through bounce signals and automatically promotes 
                            the new pattern.
                        </p>
                    </div>
                </div>
            </div>
        </section>
    );
}
