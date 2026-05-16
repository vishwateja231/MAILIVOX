import { motion } from 'framer-motion';
import { GitBranch, BookOpen, Terminal } from 'lucide-react';

const GITHUB_URL = import.meta.env.VITE_GITHUB_URL || '#';
const DOCS_URL = import.meta.env.VITE_DOCS_URL || '/docs';

export default function GitHubCTA() {
    return (
        <section className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-100px' }}
                className="text-center"
            >
                {/* Terminal accent */}
                <div className="max-w-md mx-auto mb-8 glass-panel rounded-xl p-4 font-mono text-xs text-left">
                    <div className="flex items-center gap-2 mb-3 text-gray-500">
                        <Terminal className="w-3.5 h-3.5" />
                        <span>Get started</span>
                    </div>
                    <p className="text-gray-400">
                        <span className="text-success">$</span> npx degit mailivox/mailivox my-outreach
                    </p>
                    <p className="text-gray-400">
                        <span className="text-success">$</span> cd my-outreach && docker compose up
                    </p>
                    <p className="text-primary mt-2">→ Running at localhost:5173</p>
                </div>

                <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
                    Ready to deploy?
                </h2>
                <p className="text-gray-400 max-w-lg mx-auto mb-8">
                    Mailivox is open infrastructure. Explore the source, read the docs, and deploy 
                    your own outreach engine in minutes.
                </p>

                <div className="flex flex-wrap justify-center gap-4">
                    <a
                        href={GITHUB_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-primary flex items-center gap-2"
                        aria-label="View Mailivox on GitHub"
                    >
                        <GitBranch className="w-4 h-4" />
                        View on GitHub
                    </a>
                    <a
                        href={DOCS_URL}
                        className="btn-secondary flex items-center gap-2"
                    >
                        <BookOpen className="w-4 h-4" />
                        Read Documentation
                    </a>
                </div>
            </motion.div>
        </section>
    );
}
