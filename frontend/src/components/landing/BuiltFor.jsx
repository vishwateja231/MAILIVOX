import { motion } from 'framer-motion';
import { UserSearch, TrendingUp, Rocket, Building, Briefcase, Target } from 'lucide-react';

const AUDIENCES = [
    {
        icon: UserSearch,
        label: 'Recruiters',
        desc: 'Find verified candidate emails from LinkedIn searches. Skip the InMail queue.',
        span: 'col-span-1 sm:col-span-2 lg:col-span-1',
    },
    {
        icon: TrendingUp,
        label: 'Growth Teams',
        desc: 'Build targeted outreach lists with validated emails and personalized AI-generated messages.',
        span: 'col-span-1',
    },
    {
        icon: Rocket,
        label: 'Founders',
        desc: 'Own your outreach infrastructure. No per-seat pricing, no email limits, no vendor lock-in.',
        span: 'col-span-1 lg:col-span-2',
    },
    {
        icon: Building,
        label: 'Agencies',
        desc: 'Run multi-client campaigns from a single self-hosted instance with full data isolation.',
        span: 'col-span-1',
    },
    {
        icon: Briefcase,
        label: 'Job Seekers',
        desc: 'Reach hiring managers directly with verified emails and tailored cover-letter outreach.',
        span: 'col-span-1 sm:col-span-2 lg:col-span-1',
    },
    {
        icon: Target,
        label: 'Outbound Teams',
        desc: 'Orchestrate sequences with bounce intelligence, follow-ups, and delivery tracking built in.',
        span: 'col-span-1',
    },
];

export default function BuiltFor() {
    return (
        <section className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto" id="built-for">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-100px' }}
                className="text-center mb-12"
            >
                <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
                    Built For
                </h2>
                <p className="text-gray-400 max-w-2xl mx-auto">
                    Whether you're sourcing candidates, closing deals, or landing your next role — 
                    Mailivox adapts to your workflow.
                </p>
            </motion.div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {AUDIENCES.map((audience, i) => (
                    <motion.div
                        key={i}
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, margin: '-50px' }}
                        transition={{ delay: i * 0.08 }}
                        className={`glass-card p-6 group hover:scale-[1.02] hover:border-primary/30 transition-all duration-300 ${audience.span}`}
                    >
                        <audience.icon className="w-6 h-6 text-primary mb-3 group-hover:scale-110 transition-transform" />
                        <h3 className="text-white font-semibold mb-2">{audience.label}</h3>
                        <p className="text-sm text-gray-400 leading-relaxed">{audience.desc}</p>
                    </motion.div>
                ))}
            </div>
        </section>
    );
}
