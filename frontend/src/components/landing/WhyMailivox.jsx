import { motion } from 'framer-motion';
import { AlertTriangle, Zap, ShieldOff, Puzzle, Server } from 'lucide-react';

const PROBLEMS = [
    {
        icon: AlertTriangle,
        title: 'Invalid Emails Everywhere',
        desc: 'Generic email guessers produce addresses that bounce, damaging your sender reputation.',
    },
    {
        icon: Zap,
        title: 'Bouncy Systems',
        desc: 'No feedback loop between bounces and future predictions — the same mistakes repeat.',
    },
    {
        icon: ShieldOff,
        title: 'Spam-Grade Tools',
        desc: 'Most outreach tools blast templates without verification, landing in spam folders.',
    },
    {
        icon: Puzzle,
        title: 'Fragmented Workflows',
        desc: 'Parsing, generation, validation, and sending live in separate tools with no shared context.',
    },
    {
        icon: Server,
        title: 'No Infrastructure Ownership',
        desc: 'Your data, patterns, and intelligence sit on someone else\'s servers with no export path.',
    },
];

export default function WhyMailivox() {
    return (
        <section className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto" id="why">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-100px' }}
                className="text-center mb-12"
            >
                <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
                    Why Mailivox Exists
                </h2>
                <p className="text-gray-400 max-w-2xl mx-auto">
                    Outreach infrastructure is broken. Tools guess emails, ignore bounces, and lock your data 
                    behind paywalls. Mailivox is the self-hosted alternative that learns, adapts, and delivers.
                </p>
            </motion.div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {PROBLEMS.map((problem, i) => (
                    <motion.div
                        key={i}
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, margin: '-50px' }}
                        transition={{ delay: i * 0.1 }}
                        className="glass-card p-6"
                    >
                        <problem.icon className="w-6 h-6 text-danger mb-3" />
                        <h3 className="text-white font-semibold mb-2">{problem.title}</h3>
                        <p className="text-sm text-gray-400 leading-relaxed">{problem.desc}</p>
                    </motion.div>
                ))}
            </div>
        </section>
    );
}
