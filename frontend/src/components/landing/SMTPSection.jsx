import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

const SMTP_LOGS = [
    { type: 'info', text: '> MX lookup: gmail-smtp-in.l.google.com (priority 5)' },
    { type: 'info', text: '> Connecting to 142.250.115.27:25...' },
    { type: 'success', text: '220 mx.google.com ESMTP ready' },
    { type: 'info', text: '> EHLO mailivox.local' },
    { type: 'success', text: '250-mx.google.com at your service' },
    { type: 'info', text: '> MAIL FROM:<verify@mailivox.local>' },
    { type: 'success', text: '250 2.1.0 OK' },
    { type: 'info', text: '> RCPT TO:<john.doe@company.com>' },
    { type: 'success', text: '250 2.1.5 OK — mailbox exists' },
    { type: 'warning', text: '⚠ Catch-all detection: testing random@company.com' },
    { type: 'info', text: '> RCPT TO:<xk7q9m2z@company.com>' },
    { type: 'error', text: '550 5.1.1 User unknown — NOT catch-all' },
    { type: 'info', text: '> Provider: Google Workspace (G Suite)' },
    { type: 'info', text: '> SPF: pass | DKIM: configured | DMARC: reject' },
    { type: 'success', text: '✓ Confidence: 97.3% — DELIVERABLE' },
    { type: 'info', text: '> Disconnecting...' },
    { type: 'success', text: '221 2.0.0 closing connection' },
    { type: 'info', text: '─────────────────────────────────────' },
    { type: 'info', text: '> MX lookup: outlook-com.olc.protection.outlook.com' },
    { type: 'info', text: '> Connecting to 52.101.73.22:25...' },
    { type: 'success', text: '220 outlook.com Microsoft ESMTP MAIL Service ready' },
    { type: 'info', text: '> EHLO mailivox.local' },
    { type: 'success', text: '250-outlook.com Hello' },
    { type: 'info', text: '> RCPT TO:<sarah.chen@startup.io>' },
    { type: 'warning', text: '451 4.7.1 Greylisting — retrying in 60s...' },
    { type: 'info', text: '> Retry attempt 2...' },
    { type: 'success', text: '250 2.1.5 Recipient OK' },
    { type: 'success', text: '✓ Confidence: 89.1% — LIKELY VALID' },
];

const MAX_VISIBLE = 14;

export default function SMTPSection({ reducedMotion }) {
    const [lines, setLines] = useState(reducedMotion ? SMTP_LOGS.slice(0, MAX_VISIBLE) : []);
    const [logIdx, setLogIdx] = useState(0);
    const containerRef = useRef(null);
    const intervalRef = useRef(null);
    const observerRef = useRef(null);
    const [isVisible, setIsVisible] = useState(false);

    // Intersection observer to detect visibility
    useEffect(() => {
        observerRef.current = new IntersectionObserver(
            ([entry]) => setIsVisible(entry.isIntersecting),
            { threshold: 0.1 }
        );
        if (containerRef.current) observerRef.current.observe(containerRef.current);
        return () => observerRef.current?.disconnect();
    }, []);

    // Append logs on interval
    useEffect(() => {
        if (reducedMotion || !isVisible) {
            if (intervalRef.current) clearInterval(intervalRef.current);
            return;
        }

        intervalRef.current = setInterval(() => {
            setLogIdx((idx) => {
                const next = (idx + 1) % SMTP_LOGS.length;
                setLines((prev) => {
                    const updated = [...prev, SMTP_LOGS[next]];
                    return updated.slice(-MAX_VISIBLE);
                });
                return next;
            });
        }, 800);

        return () => clearInterval(intervalRef.current);
    }, [reducedMotion, isVisible]);

    const getColor = (type) => {
        switch (type) {
            case 'success': return 'text-success';
            case 'error': return 'text-danger';
            case 'warning': return 'text-warning';
            default: return 'text-gray-400';
        }
    };

    return (
        <section className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto" id="smtp" ref={containerRef}>
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-100px' }}
                className="text-center mb-12"
            >
                <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
                    SMTP Verification Engine
                </h2>
                <p className="text-gray-400 max-w-2xl mx-auto">
                    Protocol-level email verification with MX resolution, SMTP handshake simulation, 
                    catch-all detection, and provider intelligence — no third-party API required.
                </p>
            </motion.div>

            <div className="max-w-4xl mx-auto">
                <div className="glass-panel rounded-2xl overflow-hidden">
                    {/* Terminal header */}
                    <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
                        <div className="w-3 h-3 rounded-full bg-danger/80" />
                        <div className="w-3 h-3 rounded-full bg-warning/80" />
                        <div className="w-3 h-3 rounded-full bg-success/80" />
                        <span className="ml-3 text-xs text-gray-500 font-mono">smtp-engine — verification session</span>
                    </div>
                    {/* Terminal body */}
                    <div className="p-4 font-mono text-xs leading-relaxed h-72 overflow-hidden">
                        {lines.map((line, i) => (
                            <div key={i} className={`${getColor(line.type)} py-0.5`}>
                                {line.text}
                            </div>
                        ))}
                        {!reducedMotion && (
                            <span className="inline-block w-2 h-4 bg-primary/80 animate-pulse ml-1" />
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
}
