import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, BookOpen } from 'lucide-react';

const DOCS_URL = import.meta.env.VITE_DOCS_URL || '/docs';

const PIPELINE_NODES = [
    { id: 'linkedin', label: 'LinkedIn', x: 50, y: 140 },
    { id: 'intelligence', label: 'Lead Intelligence', x: 200, y: 80 },
    { id: 'domain', label: 'Domain Discovery', x: 370, y: 140 },
    { id: 'email', label: 'Email Generation', x: 530, y: 80 },
    { id: 'smtp', label: 'SMTP Verification', x: 680, y: 140 },
    { id: 'ai', label: 'AI Outreach', x: 830, y: 80 },
    { id: 'delivery', label: 'Delivery Tracking', x: 970, y: 140 },
];

const EDGES = [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6],
];

const TELEMETRY_LINES = [
    { event: 'lead.parsed', status: 'success', ts: '12:04:31' },
    { event: 'domain.resolved', status: 'success', ts: '12:04:32' },
    { event: 'email.generated', status: 'success', ts: '12:04:33' },
    { event: 'smtp.verified', status: 'success', ts: '12:04:34' },
    { event: 'bounce.detected', status: 'warning', ts: '12:04:35' },
    { event: 'pattern.learned', status: 'success', ts: '12:04:36' },
    { event: 'outreach.queued', status: 'success', ts: '12:04:37' },
    { event: 'delivery.confirmed', status: 'success', ts: '12:04:38' },
    { event: 'catchall.detected', status: 'warning', ts: '12:04:39' },
    { event: 'validation.passed', status: 'success', ts: '12:04:40' },
];

export default function HeroSection({ reducedMotion }) {
    const navigate = useNavigate();
    const [telemetryIdx, setTelemetryIdx] = useState(0);
    const [metrics, setMetrics] = useState({ queued: 847, verified: 12340, bounced: 23 });

    useEffect(() => {
        if (reducedMotion) return;
        const interval = setInterval(() => {
            setTelemetryIdx((i) => (i + 1) % TELEMETRY_LINES.length);
            setMetrics((m) => ({
                queued: m.queued + Math.floor(Math.random() * 3),
                verified: m.verified + Math.floor(Math.random() * 5),
                bounced: m.bounced + (Math.random() > 0.8 ? 1 : 0),
            }));
        }, 2000);
        return () => clearInterval(interval);
    }, [reducedMotion]);

    const visibleTelemetry = TELEMETRY_LINES.slice(0, reducedMotion ? TELEMETRY_LINES.length : Math.min(telemetryIdx + 5, TELEMETRY_LINES.length));

    return (
        <section className="pt-28 pb-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
                {/* Text Content */}
                <div>
                    <motion.p
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 }}
                        className="text-xs uppercase tracking-wider text-primary font-semibold mb-4"
                    >
                        Outreach Intelligence Infrastructure
                    </motion.p>
                    <motion.h1
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-tight mb-6"
                    >
                        Self-hosted email
                        <br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-indigo-400">
                            intelligence engine
                        </span>
                    </motion.h1>
                    <motion.p
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.3 }}
                        className="text-gray-400 text-lg leading-relaxed mb-8 max-w-lg"
                    >
                        Parse LinkedIn profiles, discover company email patterns, generate verified addresses, 
                        and orchestrate personalized outreach — all from your own infrastructure.
                    </motion.p>

                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.4 }}
                        className="flex flex-wrap gap-3"
                    >
                        <button
                            onClick={() => document.querySelector('#deploy')?.scrollIntoView({ behavior: 'smooth' })}
                            className="btn-primary flex items-center gap-2"
                        >
                            Deploy Your Own Infrastructure
                            <ArrowRight className="w-4 h-4" />
                        </button>
                        <a
                            href={DOCS_URL}
                            className="btn-secondary flex items-center gap-2"
                        >
                            <BookOpen className="w-4 h-4" />
                            Read Docs
                        </a>
                        <button
                            onClick={() => navigate('/login')}
                            className="px-5 py-2.5 text-sm font-medium text-gray-400 hover:text-white transition-colors"
                        >
                            Login →
                        </button>
                    </motion.div>
                </div>

                {/* Pipeline Visualization + Telemetry */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.5, duration: 0.5 }}
                    className="relative"
                >
                    {/* Pipeline SVG */}
                    <div className="glass-card p-4 rounded-2xl overflow-hidden">
                        <svg viewBox="0 0 1050 220" className="w-full h-auto" aria-hidden="true">
                            {/* Edges */}
                            {EDGES.map(([from, to], i) => {
                                const n1 = PIPELINE_NODES[from];
                                const n2 = PIPELINE_NODES[to];
                                return (
                                    <g key={`edge-${i}`}>
                                        <line
                                            x1={n1.x + 40} y1={n1.y}
                                            x2={n2.x - 10} y2={n2.y}
                                            stroke="rgba(56,189,248,0.3)"
                                            strokeWidth="2"
                                        />
                                        {!reducedMotion && (
                                            <circle r="4" fill="#38BDF8">
                                                <animateMotion
                                                    dur={`${2 + i * 0.3}s`}
                                                    repeatCount="indefinite"
                                                    path={`M${n1.x + 40},${n1.y} L${n2.x - 10},${n2.y}`}
                                                />
                                            </circle>
                                        )}
                                    </g>
                                );
                            })}
                            {/* Nodes */}
                            {PIPELINE_NODES.map((node) => (
                                <g key={node.id}>
                                    <rect
                                        x={node.x - 10} y={node.y - 18}
                                        width="100" height="36" rx="8"
                                        fill="rgba(30,41,59,0.8)"
                                        stroke="rgba(56,189,248,0.4)"
                                        strokeWidth="1"
                                        style={{ filter: 'drop-shadow(0 0 6px rgba(56,189,248,0.3))' }}
                                    />
                                    <text
                                        x={node.x + 40} y={node.y + 4}
                                        textAnchor="middle"
                                        fill="#94A3B8"
                                        fontSize="10"
                                        fontFamily="Inter, sans-serif"
                                    >
                                        {node.label}
                                    </text>
                                </g>
                            ))}
                        </svg>
                    </div>

                    {/* Telemetry Feed */}
                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="glass-panel rounded-xl p-3 font-mono text-xs max-h-36 overflow-hidden">
                            <p className="text-gray-500 mb-2 text-[10px] uppercase tracking-wider">Live Events</p>
                            {visibleTelemetry.map((line, i) => (
                                <div key={i} className="flex items-center gap-2 py-0.5">
                                    <span className={line.status === 'success' ? 'text-success' : 'text-warning'}>●</span>
                                    <span className="text-gray-500">{line.ts}</span>
                                    <span className="text-gray-300">{line.event}</span>
                                </div>
                            ))}
                        </div>
                        <div className="glass-panel rounded-xl p-3">
                            <p className="text-gray-500 mb-2 text-[10px] uppercase tracking-wider font-mono">Queue Metrics</p>
                            <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                    <span className="text-xs text-gray-400">Queued</span>
                                    <span className="text-sm font-mono text-primary">{metrics.queued.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-xs text-gray-400">Verified</span>
                                    <span className="text-sm font-mono text-success">{metrics.verified.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-xs text-gray-400">Bounced</span>
                                    <span className="text-sm font-mono text-danger">{metrics.bounced.toLocaleString()}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </motion.div>
            </div>
        </section>
    );
}
