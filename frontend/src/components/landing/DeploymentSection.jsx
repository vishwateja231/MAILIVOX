import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { GitBranch, Server, Database, Globe, Box } from 'lucide-react';

const GITHUB_URL = import.meta.env.VITE_GITHUB_URL || 'https://github.com/vishwateja231/MAILIVOX';

const COMMANDS = [
    '$ git clone https://github.com/mailivox/mailivox.git',
    '$ cd mailivox',
    '$ cp .env.example .env',
    '$ # Configure DATABASE_URL, RESEND_API_KEY, JWT_SECRET',
    '$ docker compose up -d',
    '',
    '✓ PostgreSQL ........... running on :5432',
    '✓ Backend API .......... running on :3000',
    '✓ Frontend ............. running on :5173',
    '✓ SMTP Engine .......... ready',
    '',
    '🚀 Mailivox is live at http://localhost:5173',
];

const DEPLOY_NODES = [
    { id: 'source', label: 'Source', icon: GitBranch, x: 60, y: 80 },
    { id: 'container', label: 'Container', icon: Box, x: 200, y: 80 },
    { id: 'database', label: 'Database', icon: Database, x: 340, y: 80 },
    { id: 'public', label: 'Public URL', icon: Globe, x: 480, y: 80 },
];

export default function DeploymentSection({ reducedMotion }) {
    const [visibleLines, setVisibleLines] = useState(reducedMotion ? COMMANDS.length : 0);

    useEffect(() => {
        if (reducedMotion) return;
        if (visibleLines >= COMMANDS.length) return;
        const timeout = setTimeout(() => {
            setVisibleLines((v) => v + 1);
        }, 400);
        return () => clearTimeout(timeout);
    }, [visibleLines, reducedMotion]);

    // Reset animation when it completes
    useEffect(() => {
        if (reducedMotion) return;
        if (visibleLines >= COMMANDS.length) {
            const timeout = setTimeout(() => setVisibleLines(0), 5000);
            return () => clearTimeout(timeout);
        }
    }, [visibleLines, reducedMotion]);

    return (
        <section className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto" id="deploy">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-100px' }}
                className="text-center mb-12"
            >
                <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
                    Self Host in Minutes
                </h2>
                <p className="text-gray-400 max-w-2xl mx-auto">
                    Clone, configure, and deploy. Mailivox runs on your infrastructure with Docker Compose — 
                    no vendor lock-in, no usage limits, full data ownership.
                </p>
            </motion.div>

            <div className="grid lg:grid-cols-2 gap-8">
                {/* Terminal */}
                <div className="glass-panel rounded-2xl overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
                        <div className="w-3 h-3 rounded-full bg-danger/80" />
                        <div className="w-3 h-3 rounded-full bg-warning/80" />
                        <div className="w-3 h-3 rounded-full bg-success/80" />
                        <span className="ml-3 text-xs text-gray-500 font-mono">terminal — deploy</span>
                    </div>
                    <div className="p-4 font-mono text-xs leading-relaxed h-64 overflow-hidden">
                        {COMMANDS.slice(0, visibleLines).map((line, i) => (
                            <div key={i} className={`py-0.5 ${
                                line.startsWith('✓') ? 'text-success' :
                                line.startsWith('🚀') ? 'text-primary' :
                                line.startsWith('$') ? 'text-gray-300' :
                                'text-gray-500'
                            }`}>
                                {line || '\u00A0'}
                            </div>
                        ))}
                        {!reducedMotion && visibleLines < COMMANDS.length && (
                            <span className="inline-block w-2 h-4 bg-primary/80 animate-pulse" />
                        )}
                    </div>
                </div>

                {/* Deployment architecture */}
                <div className="glass-card rounded-2xl p-6 flex flex-col justify-between">
                    <div>
                        <p className="text-[10px] uppercase tracking-wider text-gray-500 font-mono mb-6">Deployment Flow</p>
                        <svg viewBox="0 0 540 160" className="w-full h-auto" aria-hidden="true">
                            {/* Edges */}
                            {DEPLOY_NODES.slice(0, -1).map((node, i) => {
                                const next = DEPLOY_NODES[i + 1];
                                return (
                                    <line
                                        key={`edge-${i}`}
                                        x1={node.x + 50} y1={node.y}
                                        x2={next.x - 10} y2={next.y}
                                        stroke="rgba(56,189,248,0.3)"
                                        strokeWidth="2"
                                        markerEnd="url(#arrowhead)"
                                    />
                                );
                            })}
                            <defs>
                                <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                                    <polygon points="0 0, 10 3.5, 0 7" fill="rgba(56,189,248,0.5)" />
                                </marker>
                            </defs>
                            {/* Nodes */}
                            {DEPLOY_NODES.map((node) => (
                                <g key={node.id}>
                                    <rect
                                        x={node.x - 10} y={node.y - 25}
                                        width="80" height="50" rx="10"
                                        fill="rgba(30,41,59,0.8)"
                                        stroke="rgba(56,189,248,0.3)"
                                        strokeWidth="1"
                                    />
                                    <text x={node.x + 30} y={node.y + 10} textAnchor="middle" fill="#94A3B8" fontSize="10">
                                        {node.label}
                                    </text>
                                </g>
                            ))}
                        </svg>
                    </div>

                    <a
                        href={GITHUB_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-primary flex items-center justify-center gap-2 mt-6"
                        aria-label="View Mailivox on GitHub"
                    >
                        <GitBranch className="w-4 h-4" />
                        View on GitHub
                    </a>
                </div>
            </div>
        </section>
    );
}
