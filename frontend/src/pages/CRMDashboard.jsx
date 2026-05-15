import { useState, useEffect } from 'react';
import { Users, Mail, CheckCircle2, AlertTriangle, XCircle, Building2, Layers, ArrowUpRight, Clock, Shield, BarChart3, Zap } from 'lucide-react';
import { getAnalytics } from '../api';
import clsx from 'clsx';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { motion } from 'framer-motion';

function StatCard({ label, value, icon: Icon, color, delay }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay, duration: 0.4 }}
            className="glass-card p-6 flex flex-col relative overflow-hidden group"
        >
            <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${color} opacity-10 rounded-full blur-3xl -mr-10 -mt-10 transition-opacity group-hover:opacity-30`} />
            <div className="flex items-center justify-between mb-4">
                <div className={clsx('p-3 rounded-xl backdrop-blur-md border border-white/10 shadow-inner', color.replace('from-', 'bg-').split(' ')[0] + '/20')}>
                    <Icon className="w-5 h-5 text-white" />
                </div>
            </div>
            <p className="text-gray-400 text-sm font-medium tracking-wide uppercase mb-1">{label}</p>
            <p className="text-3xl font-bold text-white tracking-tight">{value ?? '—'}</p>
        </motion.div>
    );
}

// Empty state component
function EmptyState({ icon: Icon, title, subtitle }) {
    return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="p-4 rounded-2xl bg-surface/50 border border-white/10 mb-4">
                <Icon className="w-10 h-10 text-gray-500" />
            </div>
            <h3 className="text-lg font-semibold text-gray-400 mb-2">{title}</h3>
            <p className="text-sm text-gray-500 max-w-md">{subtitle}</p>
        </div>
    );
}

export default function CRMDashboard() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        getAnalytics()
            .then(res => setData(res.data))
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, []);

    if (loading) return (
        <div className="flex items-center justify-center h-64">
            <div className="w-10 h-10 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
    );

    if (error) return (
        <EmptyState icon={XCircle} title="Connection Error" subtitle={`Could not reach the backend: ${error}`} />
    );

    const { overview, companies, sessions } = data || {};
    const hasData = overview && overview.totalLeads > 0;

    // Build chart data from real sessions — NO mock data
    const sessionChartData = (sessions || []).slice(0, 10).reverse().map(s => ({
        name: s.sessionName?.length > 12 ? s.sessionName.slice(0, 12) + '…' : s.sessionName,
        leads: s._count?.leads || 0,
        emails: s.totalEmails || 0,
    }));

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Intelligence Overview</h1>
                    <p className="text-gray-400 text-sm mt-1">Real-time metrics from your outreach pipeline.</p>
                </div>
            </div>

            {/* Top Stats — all from real DB */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard delay={0.1} label="Total Leads" value={overview?.totalLeads} icon={Users} color="from-blue-500 to-cyan-500" />
                <StatCard delay={0.2} label="Verified Emails" value={overview?.verifiedEmails} icon={CheckCircle2} color="from-emerald-500 to-teal-500" />
                <StatCard delay={0.3} label="Catch-All / Risky" value={overview?.riskyEmails} icon={AlertTriangle} color="from-orange-500 to-amber-500" />
                <StatCard delay={0.4} label="Invalid Emails" value={overview?.invalidEmails} icon={XCircle} color="from-red-500 to-rose-500" />
            </div>

            {/* Secondary row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard delay={0.5} label="Active Sessions" value={overview?.totalSessions} icon={Layers} color="from-indigo-500 to-violet-500" />
                <StatCard delay={0.55} label="Companies Parsed" value={overview?.totalCompanies} icon={Building2} color="from-violet-500 to-purple-500" />
                <StatCard delay={0.6} label="Total Emails Gen." value={overview?.totalEmails} icon={Mail} color="from-pink-500 to-rose-500" />
                <StatCard delay={0.65} label="Verification Rate" value={overview?.verificationRate !== undefined ? `${overview.verificationRate}%` : '—'} icon={Shield} color="from-cyan-500 to-blue-500" />
            </div>

            {!hasData ? (
                <EmptyState
                    icon={Zap}
                    title="No leads processed yet"
                    subtitle="Go to the Email Engine page and paste LinkedIn profile data to start extracting leads. All analytics will populate automatically from your database."
                />
            ) : (
                <>
                    {/* Charts & Activity — real session data */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }} className="glass-card p-6 lg:col-span-2">
                            <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-primary animate-pulse" /> Session Activity
                            </h3>
                            {sessionChartData.length > 0 ? (
                                <div className="h-72 w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={sessionChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                            <defs>
                                                <linearGradient id="colorLeads" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.3}/>
                                                    <stop offset="95%" stopColor="#38bdf8" stopOpacity={0}/>
                                                </linearGradient>
                                                <linearGradient id="colorEmails" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                                            <XAxis dataKey="name" stroke="rgba(255,255,255,0.3)" fontSize={11} tickLine={false} axisLine={false} />
                                            <YAxis stroke="rgba(255,255,255,0.3)" fontSize={11} tickLine={false} axisLine={false} />
                                            <Tooltip contentStyle={{ backgroundColor: 'rgba(15,23,42,0.9)', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '12px', color: '#fff' }} />
                                            <Area type="monotone" dataKey="leads" stroke="#38bdf8" strokeWidth={2} fillOpacity={1} fill="url(#colorLeads)" name="Leads" />
                                            <Area type="monotone" dataKey="emails" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorEmails)" name="Emails" />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            ) : (
                                <div className="h-72 flex items-center justify-center text-gray-500 text-sm">No session data available</div>
                            )}
                        </motion.div>

                        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }} className="flex flex-col gap-4">
                            <div className="glass-card p-6 flex-1">
                                <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Recruiters Detected</p>
                                <p className="text-3xl font-bold">{overview?.recruiterCount ?? 0}</p>
                            </div>
                            <div className="glass-card p-6 flex-1">
                                <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Pending Emails</p>
                                <p className="text-3xl font-bold text-amber-400">{overview?.pendingEmails ?? 0}</p>
                            </div>
                            <div className="glass-card p-6 flex-1">
                                <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Exports Completed</p>
                                <p className="text-3xl font-bold text-emerald-400">{overview?.totalExports ?? 0}</p>
                            </div>
                        </motion.div>
                    </div>

                    {/* Top Companies & Recent Sessions — real DB */}
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9 }} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="glass-panel rounded-2xl overflow-hidden flex flex-col">
                            <div className="px-6 py-5 border-b border-white/5 bg-surface/30">
                                <h3 className="font-semibold">Top Companies</h3>
                            </div>
                            <div className="p-2 flex-1">
                                {companies?.length > 0 ? companies.slice(0, 6).map(c => (
                                    <div key={c.id} className="flex items-center justify-between p-3 hover:bg-white/5 rounded-xl transition-colors cursor-pointer group">
                                        <div>
                                            <p className="font-medium group-hover:text-primary transition-colors">{c.name}</p>
                                            <p className="text-xs text-gray-500">{c.domain || 'Unknown'}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-sm font-semibold">{c.leadCount} leads</p>
                                            <p className="text-xs text-emerald-400">{c.verifiedCount} verified</p>
                                        </div>
                                    </div>
                                )) : (
                                    <div className="p-6 text-center text-gray-500 text-sm">No companies parsed yet</div>
                                )}
                            </div>
                        </div>

                        <div className="glass-panel rounded-2xl overflow-hidden flex flex-col">
                            <div className="px-6 py-5 border-b border-white/5 bg-surface/30">
                                <h3 className="font-semibold">Recent Sessions</h3>
                            </div>
                            <div className="p-2 flex-1">
                                {sessions?.length > 0 ? sessions.slice(0, 6).map(s => (
                                    <div key={s.id} className="flex items-center justify-between p-3 hover:bg-white/5 rounded-xl transition-colors cursor-pointer group">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center shrink-0">
                                                <Layers className="w-4 h-4" />
                                            </div>
                                            <div>
                                                <p className="font-medium group-hover:text-primary transition-colors truncate max-w-[200px]">{s.sessionName}</p>
                                                <p className="text-xs text-gray-500">{new Date(s.createdAt).toLocaleDateString()}</p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-sm font-semibold">{s._count?.leads ?? 0} leads</p>
                                            <p className="text-xs text-primary">{s.totalEmails ?? 0} emails</p>
                                        </div>
                                    </div>
                                )) : (
                                    <div className="p-6 text-center text-gray-500 text-sm">No sessions yet. Process your first batch from the Email Engine.</div>
                                )}
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </div>
    );
}
