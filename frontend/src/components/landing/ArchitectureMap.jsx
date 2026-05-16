import { useState } from 'react';
import { motion } from 'framer-motion';

const NODES = [
    { id: 'frontend', label: 'Frontend', x: 270, y: 40, desc: 'React 19 SPA with real-time pipeline visualization and CRM interface.' },
    { id: 'backend', label: 'Backend', x: 270, y: 150, desc: 'Express.js API server handling routing, auth, and orchestration.' },
    { id: 'smtp', label: 'SMTP Engine', x: 80, y: 150, desc: 'Protocol-level email verification with MX lookup and handshake simulation.' },
    { id: 'resend', label: 'Resend', x: 460, y: 100, desc: 'Transactional email delivery with webhook tracking and bounce handling.' },
    { id: 'sheets', label: 'Google Sheets', x: 460, y: 200, desc: 'Bi-directional sync for lead export and collaborative workflows.' },
    { id: 'postgres', label: 'PostgreSQL', x: 270, y: 270, desc: 'Prisma-managed database storing leads, companies, patterns, and sessions.' },
    { id: 'extension', label: 'Chrome Extension', x: 80, y: 40, desc: 'Browser extension that captures LinkedIn profiles in real-time.' },
    { id: 'webhook', label: 'Webhook Engine', x: 80, y: 270, desc: 'Processes delivery events, bounces, and opens from email providers.' },
    { id: 'ai', label: 'AI Layer', x: 460, y: 300, desc: 'Gemini-powered email generation with context-aware personalization.' },
    { id: 'validation', label: 'Validation Pipeline', x: 120, y: 340, desc: 'Multi-key rotation system with parallel SMTP verification queue.' },
];

const EDGES = [
    ['frontend', 'backend'],
    ['backend', 'postgres'],
    ['backend', 'smtp'],
    ['backend', 'resend'],
    ['backend', 'sheets'],
    ['extension', 'backend'],
    ['ai', 'backend'],
    ['validation', 'smtp'],
    ['webhook', 'backend'],
    ['extension', 'frontend'],
];

function getNodePos(id) {
    const node = NODES.find((n) => n.id === id);
    return node ? { x: node.x, y: node.y } : { x: 0, y: 0 };
}

export default function ArchitectureMap({ reducedMotion }) {
    const [hoveredNode, setHoveredNode] = useState(null);

    return (
        <section className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto" id="architecture">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-100px' }}
                className="text-center mb-12"
            >
                <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
                    Architecture Map
                </h2>
                <p className="text-gray-400 max-w-2xl mx-auto">
                    A complete systems diagram showing how Mailivox components connect — 
                    from browser extension to database, SMTP engine to AI layer.
                </p>
            </motion.div>

            <div className="max-w-4xl mx-auto glass-card rounded-2xl p-6">
                <svg viewBox="0 0 560 380" className="w-full h-auto" role="img" aria-label="Mailivox architecture diagram">
                    {/* Edges */}
                    {EDGES.map(([from, to], i) => {
                        const p1 = getNodePos(from);
                        const p2 = getNodePos(to);
                        return (
                            <motion.line
                                key={`edge-${i}`}
                                x1={p1.x} y1={p1.y}
                                x2={p2.x} y2={p2.y}
                                stroke="rgba(56,189,248,0.2)"
                                strokeWidth="1.5"
                                initial={{ opacity: 0.2 }}
                                animate={reducedMotion ? {} : { opacity: [0.2, 0.5, 0.2] }}
                                transition={{ duration: 3, repeat: Infinity, delay: i * 0.3 }}
                            />
                        );
                    })}

                    {/* Nodes */}
                    {NODES.map((node) => (
                        <g
                            key={node.id}
                            onMouseEnter={() => setHoveredNode(node.id)}
                            onMouseLeave={() => setHoveredNode(null)}
                            className="cursor-pointer"
                        >
                            <rect
                                x={node.x - 45} y={node.y - 15}
                                width="90" height="30" rx="6"
                                fill={hoveredNode === node.id ? 'rgba(56,189,248,0.15)' : 'rgba(30,41,59,0.9)'}
                                stroke={hoveredNode === node.id ? 'rgba(56,189,248,0.6)' : 'rgba(255,255,255,0.1)'}
                                strokeWidth="1.5"
                                style={hoveredNode === node.id ? { filter: 'drop-shadow(0 0 8px rgba(56,189,248,0.4))' } : {}}
                            />
                            <text
                                x={node.x} y={node.y + 4}
                                textAnchor="middle"
                                fill={hoveredNode === node.id ? '#38BDF8' : '#94A3B8'}
                                fontSize="9"
                                fontFamily="Inter, sans-serif"
                                fontWeight="500"
                            >
                                {node.label}
                            </text>
                            <title>{node.desc}</title>
                        </g>
                    ))}
                </svg>

                {/* Tooltip */}
                {hoveredNode && (
                    <div className="mt-4 p-3 bg-surface/60 rounded-lg border border-white/5 text-sm text-gray-400">
                        <span className="text-primary font-medium">{NODES.find(n => n.id === hoveredNode)?.label}:</span>{' '}
                        {NODES.find(n => n.id === hoveredNode)?.desc}
                    </div>
                )}
            </div>
        </section>
    );
}
