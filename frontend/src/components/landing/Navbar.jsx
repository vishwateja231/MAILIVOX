import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, Menu, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';

const GITHUB_URL = import.meta.env.VITE_GITHUB_URL || '#';
const DOCS_URL = import.meta.env.VITE_DOCS_URL || '/docs';

const NAV_LINKS = [
    { label: 'Features', href: '#features' },
    { label: 'Infrastructure', href: '#architecture' },
    { label: 'Validation Engine', href: '#smtp' },
    { label: 'Self Host', href: '#deploy' },
    { label: 'Docs', href: DOCS_URL, external: false },
    { label: 'GitHub', href: GITHUB_URL, external: true },
];

export default function Navbar() {
    const navigate = useNavigate();
    const [scrolled, setScrolled] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);

    useEffect(() => {
        const handler = () => setScrolled(window.scrollY > 16);
        window.addEventListener('scroll', handler, { passive: true });
        return () => window.removeEventListener('scroll', handler);
    }, []);

    const handleNavClick = (link) => {
        setMobileOpen(false);
        if (link.external) {
            window.open(link.href, '_blank', 'noopener,noreferrer');
        } else if (link.href.startsWith('#')) {
            const el = document.querySelector(link.href);
            if (el) el.scrollIntoView({ behavior: 'smooth' });
        } else {
            window.location.href = link.href;
        }
    };

    return (
        <header
            className={clsx(
                'fixed top-0 left-0 right-0 z-50 transition-all duration-300',
                scrolled ? 'glass border-b border-white/5' : 'bg-transparent'
            )}
        >
            <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
                {/* Wordmark */}
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-indigo-500 flex items-center justify-center shadow-[0_0_15px_rgba(56,189,248,0.4)]">
                        <Send className="w-4 h-4 text-white" />
                    </div>
                    <span className="font-bold tracking-wide text-sm">
                        MAILI<span className="text-primary">VOX</span>
                    </span>
                </div>

                {/* Desktop Links */}
                <div className="hidden md:flex items-center gap-6">
                    {NAV_LINKS.map((link) => (
                        <button
                            key={link.label}
                            onClick={() => handleNavClick(link)}
                            className="text-sm text-gray-400 hover:text-white tracking-wide transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 rounded px-1"
                        >
                            {link.label}
                        </button>
                    ))}
                </div>

                {/* Login Button */}
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => navigate('/login')}
                        className="px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-primary to-indigo-500 text-white shadow-lg shadow-primary/20 hover:shadow-primary/40 transition-all focus-visible:ring-2 focus-visible:ring-primary/50"
                    >
                        Login
                    </button>
                    {/* Mobile menu toggle */}
                    <button
                        onClick={() => setMobileOpen(!mobileOpen)}
                        className="md:hidden p-2 text-gray-400 hover:text-white transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 rounded"
                        aria-label="Toggle navigation menu"
                    >
                        {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                    </button>
                </div>
            </nav>

            {/* Mobile Menu */}
            <AnimatePresence>
                {mobileOpen && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="md:hidden glass border-t border-white/5 overflow-hidden"
                    >
                        <div className="px-4 py-4 space-y-2">
                            {NAV_LINKS.map((link) => (
                                <button
                                    key={link.label}
                                    onClick={() => handleNavClick(link)}
                                    className="block w-full text-left px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                                >
                                    {link.label}
                                </button>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </header>
    );
}
