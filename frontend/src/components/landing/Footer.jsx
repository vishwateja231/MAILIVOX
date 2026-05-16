import { Send } from 'lucide-react';

const GITHUB_URL = import.meta.env.VITE_GITHUB_URL || 'https://github.com/vishwateja231/MAILIVOX';
const DOCS_URL = import.meta.env.VITE_DOCS_URL || 'https://github.com/vishwateja231/MAILIVOX#readme';

const LINK_GROUPS = [
    {
        title: 'Product',
        links: [
            { label: 'Features', href: '#features' },
            { label: 'Infrastructure', href: '#architecture' },
            { label: 'Validation Engine', href: '#smtp' },
            { label: 'Self Host', href: '#deploy' },
        ],
    },
    {
        title: 'Resources',
        links: [
            { label: 'Documentation', href: DOCS_URL },
            { label: 'GitHub', href: GITHUB_URL, external: true },
            { label: 'API Reference', href: DOCS_URL },
        ],
    },
    {
        title: 'Legal',
        links: [
            { label: 'Privacy Policy', href: '/privacy' },
            { label: 'Terms of Service', href: '/terms' },
        ],
    },
];

export default function Footer() {
    const year = new Date().getFullYear();

    const handleClick = (link, e) => {
        if (link.external) return; // let default behavior handle it
        if (link.href.startsWith('#')) {
            e.preventDefault();
            const el = document.querySelector(link.href);
            if (el) el.scrollIntoView({ behavior: 'smooth' });
        }
    };

    return (
        <footer className="border-t border-white/5 py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-7xl mx-auto">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
                    {/* Brand */}
                    <div className="col-span-2 md:col-span-1">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-indigo-500 flex items-center justify-center shadow-[0_0_15px_rgba(56,189,248,0.4)]">
                                <Send className="w-3.5 h-3.5 text-white" />
                            </div>
                            <span className="font-bold tracking-wide text-sm">
                                MAILI<span className="text-primary">VOX</span>
                            </span>
                        </div>
                        <p className="text-xs text-gray-500 leading-relaxed">
                            Self-hosted outreach intelligence infrastructure.
                        </p>
                    </div>

                    {/* Link groups */}
                    {LINK_GROUPS.map((group) => (
                        <div key={group.title}>
                            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                                {group.title}
                            </p>
                            <ul className="space-y-2">
                                {group.links.map((link) => (
                                    <li key={link.label}>
                                        <a
                                            href={link.href}
                                            onClick={(e) => handleClick(link, e)}
                                            target={link.external ? '_blank' : undefined}
                                            rel={link.external ? 'noopener noreferrer' : undefined}
                                            className="text-sm text-gray-500 hover:text-white transition-colors"
                                        >
                                            {link.label}
                                        </a>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>

                {/* Copyright */}
                <div className="pt-8 border-t border-white/5 text-center">
                    <p className="text-xs text-gray-600">
                        © {year} Mailivox. All rights reserved.
                    </p>
                </div>
            </div>
        </footer>
    );
}
