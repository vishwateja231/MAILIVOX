import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCompanies } from '../api';
import { Building2, Search, Shield, Mail, Users, CheckCircle2, XCircle, TrendingUp, ArrowUpRight, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';
import clsx from 'clsx';

const HEALTH_CONFIG = {
    Excellent: { color: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/30' },
    Healthy: { color: 'text-blue-400', bg: 'bg-blue-500/15', border: 'border-blue-500/30' },
    Risky: { color: 'text-amber-400', bg: 'bg-amber-500/15', border: 'border-amber-500/30' },
    Poor: { color: 'text-red-400', bg: 'bg-red-500/15', border: 'border-red-500/30' },
    Unknown: { color: 'text-gray-400', bg: 'bg-gray-500/15', border: 'border-gray-500/30' },
};

export default function CompaniesPage() {
    const navigate = useNavigate();
    const [companies, setCompanies] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState('leads');

    useEffect(() => {
        setLoading(true);
        getCompanies()
            .then(res => setCompanies(res.data || []))
            .finally(() => setLoading(false));
    }, []);

    // Client-side search filter
    const filtered = companies.filter(c =>
        !search || c.companyName?.toLowerCase().includes(search.toLowerCase()) || c.domain?.toLowerCase().includes(search.toLowerCase())
    );

    // Client-side sort
    const sorted = [...filtered].sort((a, b) => {
        if (sort === 'delivery') return b.deliveryRate - a.deliveryRate;
        if (sort === 'replies') return b.replied - a.replied;
        if (sort === 'health') return b.health - a.health;
        return b.leadCount - a.leadCount;
    });

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Company Insights</h1>
                    <p className="text-gray-400 text-sm mt-1">{companies.length} companies with active contacts.</p>
                </div>
            </div>

            {/* Search + Sort */}
            <div className="flex gap-3 items-center">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input
                        type="text"
                        placeholder="Search companies or domains..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full bg-surface/50 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-primary/50 transition-all"
                    />
                </div>
                <select
                    value={sort}
                    onChange={e => setSort(e.target.value)}
                    className="bg-background border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary/50"
                >
                    <option value="leads">Sort: Lead Count</option>
                    <option value="delivery">Sort: Delivery Rate</option>
                    <option value="replies">Sort: Replies</option>
                    <option value="health">Sort: Health Score</option>
                </select>
            </div>

            {/* Company Grid */}
            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {Array(6).fill(0).map((_, i) => <div key={i} className="glass-card h-48 animate-pulse bg-surface/30" />)}
                </div>
            ) : sorted.length === 0 ? (
                <div className="text-center py-16 text-gray-500">
                    <Building2 className="w-10 h-10 mx-auto mb-3 opacity-40" />
                    <p>{search ? 'No companies match your search.' : 'No companies with active leads yet.'}</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {sorted.map((c, i) => (
                        <CompanyCard key={c.id} company={c} index={i} onClick={() => navigate(`/leads?companyId=${c.id}`)} />
                    ))}
                </div>
            )}
        </div>
    );
}

function CompanyCard({ company: c, index, onClick }) {
    const healthCfg = HEALTH_CONFIG[c.healthLevel] || HEALTH_CONFIG.Unknown;

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.03 }}
            onClick={onClick}
            className="glass-card p-5 cursor-pointer group relative overflow-hidden"
        >
            <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-full blur-2xl -mr-10 -mt-10 group-hover:bg-primary/15 transition-all" />

            {/* Header */}
            <div className="flex items-start justify-between mb-4 relative z-10">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-surface/80 border border-white/10 flex items-center justify-center text-primary font-bold text-sm group-hover:border-primary/30 transition-colors">
                        {c.companyName?.[0]?.toUpperCase() || '?'}
                    </div>
                    <div>
                        <h3 className="font-bold text-white group-hover:text-primary transition-colors truncate max-w-[160px]">{c.companyName}</h3>
                        <p className="text-[10px] text-gray-500 font-mono">{c.domain || 'No domain'}</p>
                    </div>
                </div>
                <span className={clsx('px-2 py-0.5 rounded text-[9px] font-semibold uppercase border', healthCfg.color, healthCfg.bg, healthCfg.border)}>
                    {c.healthLevel}
                </span>
            </div>

            {/* Status */}
            <div className="mb-4">
                <p className={clsx('text-[10px] font-medium',
                    c.status.includes('Verified') ? 'text-emerald-400' :
                    c.status.includes('Bounce') ? 'text-red-400' :
                    c.status.includes('Pattern') ? 'text-blue-400' : 'text-gray-500'
                )}>
                    {c.status}
                </p>
                {c.learnedPattern && (
                    <p className="text-[10px] text-gray-500 mt-0.5">Pattern: <span className="text-primary font-mono">{c.learnedPattern}</span></p>
                )}
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-4 gap-2 text-center">
                <Metric icon={Users} value={c.leadCount} label="Leads" />
                <Metric icon={CheckCircle2} value={c.verified} label="Verified" color="text-emerald-400" />
                <Metric icon={Mail} value={`${c.deliveryRate}%`} label="Delivery" color="text-blue-400" />
                <Metric icon={ArrowUpRight} value={c.replied} label="Replies" color="text-violet-400" />
            </div>

            {/* Health Bar */}
            <div className="mt-4 pt-3 border-t border-white/5">
                <div className="flex justify-between text-[9px] text-gray-500 mb-1">
                    <span>Health Score</span>
                    <span className={healthCfg.color}>{c.health}/100</span>
                </div>
                <div className="h-1 w-full bg-black/40 rounded-full overflow-hidden">
                    <div
                        className={clsx('h-full rounded-full transition-all',
                            c.health >= 80 ? 'bg-emerald-500' :
                            c.health >= 60 ? 'bg-blue-500' :
                            c.health >= 40 ? 'bg-amber-500' : 'bg-red-500'
                        )}
                        style={{ width: `${c.health}%` }}
                    />
                </div>
            </div>
        </motion.div>
    );
}

function Metric({ icon: Icon, value, label, color = 'text-white' }) {
    return (
        <div>
            <p className={clsx('text-sm font-bold', color)}>{value}</p>
            <p className="text-[8px] text-gray-500 uppercase tracking-wider">{label}</p>
        </div>
    );
}
