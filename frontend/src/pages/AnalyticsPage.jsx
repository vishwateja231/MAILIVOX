import { useState, useEffect } from 'react';
import { getVerificationStats, getSessionTrends, getRecruiterInsights, getCompanyBreakdown } from '../api';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, AreaChart, Area } from 'recharts';
import { Users, Shield, Building2, BarChart3, Zap } from 'lucide-react';
import { motion } from 'framer-motion';

const PIE_COLORS = { VALID: '#10b981', INVALID: '#ef4444', RISKY: '#f59e0b', CATCH_ALL: '#f97316', PENDING: '#6b7280' };

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

export default function AnalyticsPage() {
    const [verification, setVerification] = useState([]);
    const [sessions, setSessions] = useState([]);
    const [recruiters, setRecruiters] = useState(null);
    const [companies, setCompanies] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all([
            getVerificationStats().then(r => setVerification(r.data)),
            getSessionTrends().then(r => setSessions(r.data)),
            getRecruiterInsights().then(r => setRecruiters(r.data)),
            getCompanyBreakdown().then(r => setCompanies(r.data)),
        ]).finally(() => setLoading(false));
    }, []);

    if (loading) return (
        <div className="flex items-center justify-center h-64">
            <div className="w-10 h-10 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
    );

    const hasAny = verification.length > 0 || sessions.length > 0;

    if (!hasAny) return (
        <div>
            <h1 className="text-3xl font-bold tracking-tight mb-2">Analytics</h1>
            <EmptyState icon={BarChart3} title="No analytics data yet" subtitle="Process some LinkedIn profiles from the Email Engine to see verification charts, company breakdowns, and recruiter intelligence." />
        </div>
    );

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
                <p className="text-gray-400 text-sm mt-1">Real-time verification and intelligence metrics from PostgreSQL.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Verification Pie */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6">
                    <h3 className="font-semibold mb-4 flex items-center gap-2"><Shield className="w-4 h-4 text-primary" /> Verification Breakdown</h3>
                    {verification.length > 0 ? (
                        <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie data={verification} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={90} innerRadius={50} paddingAngle={3} label={({ status, count }) => `${status}: ${count}`}>
                                        {verification.map((v, i) => <Cell key={i} fill={PIE_COLORS[v.status] || '#6b7280'} />)}
                                    </Pie>
                                    <Tooltip contentStyle={{ backgroundColor: 'rgba(15,23,42,0.9)', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '12px', color: '#fff' }} />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    ) : <p className="text-gray-500 text-sm text-center py-10">No verification data</p>}
                    <div className="flex flex-wrap gap-3 mt-4">
                        {verification.map(v => (
                            <span key={v.status} className="text-xs flex items-center gap-1.5">
                                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PIE_COLORS[v.status] || '#6b7280' }} />
                                {v.status}: {v.count}
                            </span>
                        ))}
                    </div>
                </motion.div>

                {/* Companies Bar Chart */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-card p-6">
                    <h3 className="font-semibold mb-4 flex items-center gap-2"><Building2 className="w-4 h-4 text-violet-400" /> Leads by Company</h3>
                    {companies.length > 0 ? (
                        <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={companies.slice(0, 8)} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                                    <XAxis dataKey="name" stroke="rgba(255,255,255,0.3)" fontSize={10} tickLine={false} axisLine={false} angle={-20} textAnchor="end" height={50} />
                                    <YAxis stroke="rgba(255,255,255,0.3)" fontSize={11} tickLine={false} axisLine={false} />
                                    <Tooltip contentStyle={{ backgroundColor: 'rgba(15,23,42,0.9)', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '12px', color: '#fff' }} />
                                    <Bar dataKey="leadCount" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="Leads" />
                                    <Bar dataKey="verifiedCount" fill="#10b981" radius={[4, 4, 0, 0]} name="Verified" />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    ) : <p className="text-gray-500 text-sm text-center py-10">No company data</p>}
                </motion.div>
            </div>

            {/* Session Timeline */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-card p-6">
                <h3 className="font-semibold mb-4 flex items-center gap-2"><Zap className="w-4 h-4 text-amber-400" /> Session Activity Timeline</h3>
                {sessions.length > 0 ? (
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={sessions} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="agProfiles" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="agEmails" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                                <XAxis dataKey="name" stroke="rgba(255,255,255,0.3)" fontSize={10} tickLine={false} axisLine={false} />
                                <YAxis stroke="rgba(255,255,255,0.3)" fontSize={11} tickLine={false} axisLine={false} />
                                <Tooltip contentStyle={{ backgroundColor: 'rgba(15,23,42,0.9)', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '12px', color: '#fff' }} />
                                <Area type="monotone" dataKey="profiles" stroke="#38bdf8" strokeWidth={2} fill="url(#agProfiles)" name="Profiles" />
                                <Area type="monotone" dataKey="emails" stroke="#10b981" strokeWidth={2} fill="url(#agEmails)" name="Emails" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                ) : <p className="text-gray-500 text-sm text-center py-10">No session trends yet</p>}
            </motion.div>

            {/* Recruiter Intelligence */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="glass-card p-6">
                <h3 className="font-semibold mb-4 flex items-center gap-2"><Users className="w-4 h-4 text-pink-400" /> Recruiter Intelligence</h3>
                {recruiters && recruiters.totalRecruiters > 0 ? (
                    <div>
                        <p className="text-sm text-gray-400 mb-4">{recruiters.totalRecruiters} recruiter-tagged profiles detected</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                            {recruiters.byCompany.slice(0, 6).map((rc, i) => (
                                <div key={i} className="bg-surface/30 border border-white/5 rounded-xl p-4">
                                    <p className="font-medium text-white">{rc.company}</p>
                                    <p className="text-xs text-gray-500">{rc.domain}</p>
                                    <div className="flex justify-between mt-2 text-sm">
                                        <span className="text-gray-400">{rc.count} recruiters</span>
                                        <span className="text-emerald-400">{rc.verified} verified</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-white/5 text-gray-500 text-xs uppercase">
                                        <th className="py-2 text-left">Name</th>
                                        <th className="py-2 text-left">Role</th>
                                        <th className="py-2 text-left">Company</th>
                                        <th className="py-2 text-left">Verified Emails</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {recruiters.recruiters.slice(0, 15).map(r => (
                                        <tr key={r.id} className="border-b border-white/5 hover:bg-white/5">
                                            <td className="py-2 font-medium">{r.fullName}</td>
                                            <td className="py-2 text-gray-400">{r.role}</td>
                                            <td className="py-2 text-primary">{r.company}</td>
                                            <td className="py-2 font-mono text-xs text-emerald-400">{r.verifiedEmails.join(', ') || '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ) : (
                    <p className="text-gray-500 text-sm text-center py-10">No recruiter profiles detected yet. Process LinkedIn data containing recruiting roles to see intelligence here.</p>
                )}
            </motion.div>
        </div>
    );
}
