import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Brain, Globe, Sparkles, ShieldCheck, Send } from 'lucide-react';
import clsx from 'clsx';

const FEATURES = [
    {
        icon: Brain,
        title: 'Lead Intelligence',
        desc: 'Parse raw LinkedIn text into structured lead data with name normalization, title extraction, and company detection.',
        capabilities: ['Bulk LinkedIn parsing', 'Name normalization (50+ formats)', 'Title & seniority detection', 'Company extraction & normalization', 'Intern/fresher filtering'],
        snippet: `// Pipeline input\nconst raw = "John Doe\\nSenior Engineer at Acme Corp";\nconst lead = await parseLead(raw);\n// → { firstName: "John", lastName: "Doe", title: "Senior Engineer", company: "Acme Corp" }`,
    },
    {
        icon: Globe,
        title: 'Domain Discovery',
        desc: 'Resolve company names to their primary email domains using web search, DNS verification, and pattern matching.',
        capabilities: ['Multi-source domain resolution', 'DNS MX record verification', 'Subdomain detection', 'Domain health scoring', 'Cached results for speed'],
        snippet: `// Domain resolution\nconst domain = await discoverDomain("Acme Corp");\n// → { domain: "acmecorp.com", mx: true, provider: "Google Workspace" }`,
    },
    {
        icon: Sparkles,
        title: 'AI Email Generation',
        desc: 'Generate personalized outreach emails using Gemini AI with context from lead data, company info, and your profile.',
        capabilities: ['Context-aware personalization', 'Multiple tone variants', 'Resume/profile integration', 'Template system', 'A/B variant generation'],
        snippet: `// AI generation\nconst email = await generateEmail({\n  lead, senderProfile, tone: "professional"\n});\n// → { subject: "...", body: "..." }`,
    },
    {
        icon: ShieldCheck,
        title: 'SMTP Validation',
        desc: 'Verify email deliverability at the protocol level with multi-key rotation, catch-all detection, and confidence scoring.',
        capabilities: ['MX lookup & SMTP handshake', 'Catch-all detection', 'Provider intelligence', 'Multi-key rotation', 'Parallel validation queue'],
        snippet: `// Validation result\n{ email: "john@acme.com", valid: true,\n  confidence: 97.3, provider: "Google",\n  catchAll: false, mxHost: "gmail-smtp-in..." }`,
    },
    {
        icon: Send,
        title: 'Outreach Orchestration',
        desc: 'Queue, send, and track personalized emails with follow-up sequences, bounce handling, and delivery webhooks.',
        capabilities: ['Campaign management', 'Follow-up sequences', 'Bounce intelligence', 'Open/click tracking', 'Rate-limited queue'],
        snippet: `// Send with tracking\nawait sendEmail({\n  to: lead.email, campaign: "Q1 Outreach",\n  template: "intro", followUp: { delay: "3d" }\n});`,
    },
];

export default function FeatureDeepDive() {
    const [openIdx, setOpenIdx] = useState(null);

    const toggle = (i) => setOpenIdx(openIdx === i ? null : i);

    return (
        <section className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto" id="features">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-100px' }}
                className="text-center mb-12"
            >
                <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
                    Feature Deep Dive
                </h2>
                <p className="text-gray-400 max-w-2xl mx-auto">
                    Infrastructure-grade capabilities, not marketing fluff. Expand each block to see 
                    what's under the hood.
                </p>
            </motion.div>

            <div className="max-w-3xl mx-auto space-y-3">
                {FEATURES.map((feature, i) => (
                    <div key={i} className="glass-panel rounded-xl overflow-hidden">
                        {/* Header */}
                        <button
                            onClick={() => toggle(i)}
                            className="w-full flex items-center gap-4 p-5 text-left hover:bg-white/5 transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-inset"
                        >
                            <feature.icon className="w-5 h-5 text-primary shrink-0" />
                            <span className="flex-1 font-semibold text-white">{feature.title}</span>
                            <ChevronDown className={clsx(
                                'w-4 h-4 text-gray-500 transition-transform duration-200',
                                openIdx === i && 'rotate-180'
                            )} />
                        </button>

                        {/* Expandable content */}
                        <AnimatePresence>
                            {openIdx === i && (
                                <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="overflow-hidden"
                                >
                                    <div className="px-5 pb-5 space-y-4 border-t border-white/5 pt-4">
                                        <p className="text-sm text-gray-400 leading-relaxed">{feature.desc}</p>
                                        
                                        <div>
                                            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Capabilities</p>
                                            <ul className="space-y-1">
                                                {feature.capabilities.map((cap, j) => (
                                                    <li key={j} className="text-sm text-gray-300 flex items-center gap-2">
                                                        <span className="w-1 h-1 rounded-full bg-primary shrink-0" />
                                                        {cap}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>

                                        <div className="bg-background/60 rounded-lg p-3 font-mono text-xs text-gray-400 overflow-x-auto">
                                            <pre className="whitespace-pre-wrap">{feature.snippet}</pre>
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                ))}
            </div>
        </section>
    );
}
