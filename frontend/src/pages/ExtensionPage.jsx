import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, CheckCircle2, ChevronDown, Copy, ExternalLink, Mail, RefreshCw, TerminalSquare, Users, Zap, ShieldCheck, Puzzle, Inbox, OctagonX } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import clsx from 'clsx';
import { getLeads, getSessions, pingExtensionBackend, stopAllExtensionActivity } from '../api';
import { useRealtimeEvents } from '../hooks/useRealtimeEvents';

const MODES = {
    generator: {
        label: 'Mail Generator',
        short: 'Lead Intelligence',
        icon: Zap,
        accent: 'text-primary',
        border: 'border-primary/30',
        bg: 'bg-primary/10',
    },
    firstDegree: {
        label: '1st-Degree Email',
        short: 'Contact Info',
        icon: ShieldCheck,
        accent: 'text-emerald-300',
        border: 'border-emerald-500/30',
        bg: 'bg-emerald-500/10',
    },
};

function classifySession(session) {
    const name = (session?.sessionName || '').toLowerCase();
    if (name.includes('deep') || name.includes('1st') || name.includes('connection')) return 'firstDegree';
    if (name.includes('quick') || name.includes('chrome') || name.includes('intel') || name.includes('pipeline')) return 'generator';
    return 'generator';
}

function classifyEvent(event) {
    const type = event?.type || '';
    const mode = event?.data?.mode;
    if (mode === 2 || type.includes('extension:batch') || type.includes('extension:profile')) return 'firstDegree';
    return 'generator';
}

function eventMessage(event) {
    const type = event?.type || 'event';
    const data = event?.data || {};

    if (type === 'connected') return 'Realtime feed connected';
    if (type === 'pipeline:started') return `Lead Intelligence started: ${data.sessionName || data.sessionId || ''}`;
    if (type === 'pipeline:complete') return `Lead Intelligence complete: ${data.processed || 0} profiles, ${data.emailsGenerated || 0} emails`;
    if (type === 'validation:auto_started') return `Validation started for ${data.totalLeads || 0} leads`;
    if (type === 'validation:auto_complete') return 'Validation complete';
    if (type === 'extension:batch_start') return `1st-degree batch started: ${data.total || 0} contacts`;
    if (type === 'extension:batch_progress') return `1st-degree progress: ${data.processed || 0}/${data.total || 0}, ${data.emailsFound || 0} emails`;
    if (type === 'extension:batch_complete') return `1st-degree complete: ${data.totalProcessed || 0} contacts, ${data.totalVerified || 0} verified`;
    if (type === 'extension:profile_done') return `${data.fullName || 'Profile'} saved${data.email ? ` - ${data.email}` : ''}`;
    if (type === 'extension:profile_error') return `${data.fullName || data.email || 'Profile'} failed: ${data.error || 'unknown error'}`;
    return `${type}${data.fullName ? `: ${data.fullName}` : ''}`;
}

function isExtensionSession(session) {
    const name = (session?.sessionName || '').toLowerCase();
    return name.includes('chrome') || name.includes('extension') || name.includes('linkedin') || name.includes('quick extract') || name.includes('deep extract');
}

export default function ExtensionPage() {
    const [activeMode, setActiveMode] = useState('generator');
    const [sessions, setSessions] = useState([]);
    const [selectedSessionId, setSelectedSessionId] = useState('');
    const [leads, setLeads] = useState([]);
    const [loading, setLoading] = useState(true);
    const [leadsLoading, setLeadsLoading] = useState(false);
    const [health, setHealth] = useState('checking');
    const [events, setEvents] = useState([]);
    const [feedOpen, setFeedOpen] = useState(false);

    const loadSessions = useCallback(async () => {
        setLoading(true);
        try {
            const res = await getSessions({ archived: 'all' });
            const extensionSessions = (res.data || []).filter(isExtensionSession);
            setSessions(extensionSessions);
            setSelectedSessionId(prev => prev || extensionSessions[0]?.id || '');
        } catch {
            toast.error('Failed to load extension sessions');
        } finally {
            setLoading(false);
        }
    }, []);

    const checkHealth = useCallback(async () => {
        setHealth('checking');
        try {
            await pingExtensionBackend();
            setHealth('ok');
        } catch {
            setHealth('down');
        }
    }, []);

    useEffect(() => {
        loadSessions();
        checkHealth();
        // Auto-refresh sessions every 5s to catch new extractions quickly
        const interval = setInterval(() => {
            loadSessions();
        }, 5000);
        return () => clearInterval(interval);
    }, [loadSessions, checkHealth]);

    const loadLeads = useCallback(async () => {
        if (!selectedSessionId) {
            setLeads([]);
            return;
        }
        setLeadsLoading(true);
        try {
            const res = await getLeads({ sessionId: selectedSessionId, limit: 100 });
            setLeads(res.data.leads || []);
        } catch {
            toast.error('Failed to load session leads');
        } finally {
            setLeadsLoading(false);
        }
    }, [selectedSessionId]);

    useEffect(() => {
        loadLeads();
    }, [loadLeads]);

    const { connected } = useRealtimeEvents((event) => {
        const mode = classifyEvent(event);
        setEvents(prev => [
            {
                id: `${Date.now()}_${Math.random()}`,
                mode,
                type: event.type,
                message: eventMessage(event),
                ts: event.ts || Date.now(),
                data: event.data || {},
            },
            ...prev,
        ].slice(0, 80));

        // Auto-switch to the active mode based on incoming events (so user sees activity)
        if (event.type === 'extension:batch_start' || event.type === 'extension:profile_start') {
            setActiveMode(mode);
            setFeedOpen(true); // auto-open live feed when activity starts
        }

        // Refresh on ANY extension event so UI updates instantly
        if (event.type?.startsWith('extension:') || event.type?.startsWith('pipeline:')) {
            loadSessions();
            loadLeads();
        }
    });

    const sessionsByMode = useMemo(() => ({
        generator: sessions.filter(s => classifySession(s) === 'generator'),
        firstDegree: sessions.filter(s => classifySession(s) === 'firstDegree'),
    }), [sessions]);

    useEffect(() => {
        const modeSessions = sessionsByMode[activeMode] || [];
        if (!modeSessions.some(s => s.id === selectedSessionId)) {
            setSelectedSessionId(modeSessions[0]?.id || '');
        }
    }, [activeMode, selectedSessionId, sessionsByMode]);

    const modeLeads = useMemo(() => {
        if (activeMode === 'firstDegree') {
            return leads.map(lead => ({
                ...lead,
                emails: (lead.emails || []).filter(email => email.pattern === 'LINKEDIN_CONTACT_INFO' || email.verificationStatus === 'VALID'),
            }));
        }
        return leads;
    }, [activeMode, leads]);

    const selectedSession = sessions.find(s => s.id === selectedSessionId);
    const filteredEvents = events.filter(e => e.mode === activeMode);
    const ActiveModeIcon = MODES[activeMode].icon;

    const stats = useMemo(() => {
        const emails = modeLeads.reduce((sum, lead) => sum + (lead.emails?.length || 0), 0);
        const verified = modeLeads.reduce((sum, lead) => (
            sum + (lead.emails || []).filter(email => email.verificationStatus === 'VALID').length
        ), 0);

        return {
            sessions: sessionsByMode[activeMode]?.length || 0,
            leads: modeLeads.length,
            emails,
            verified,
        };
    }, [activeMode, modeLeads, sessionsByMode]);

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                        <Puzzle className="w-8 h-8 text-primary" /> Extension Management
                    </h1>
                    <p className="text-gray-400 text-sm mt-1">Live extraction feed, sessions, leads, and emails from the Chrome extension.</p>
                </div>
                <div className="flex items-center gap-2">
                    <StatusPill label={connected ? 'Live feed' : 'Feed offline'} ok={connected} />
                    <StatusPill label={health === 'ok' ? 'Backend online' : health === 'checking' ? 'Checking' : 'Backend down'} ok={health === 'ok'} />
                    <button
                        onClick={async () => {
                            try {
                                const res = await stopAllExtensionActivity();
                                toast.success(res.data.message || 'All activity stopped');
                                loadSessions();
                                loadLeads();
                            } catch {
                                toast.error('Failed to stop activity');
                            }
                        }}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 transition-all"
                        title="Stop all extension and validation activity"
                    >
                        <OctagonX className="w-4 h-4" />
                        Stop All
                    </button>
                    <button onClick={() => { loadSessions(); loadLeads(); checkHealth(); }} className="btn-primary p-2.5 rounded-xl" title="Refresh">
                        <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[300px_minmax(0,1fr)] gap-5">
                <div className="space-y-4">
                    <ModeCard mode="generator" active={activeMode === 'generator'} count={sessionsByMode.generator.length} onClick={() => setActiveMode('generator')} />
                    <ModeCard mode="firstDegree" active={activeMode === 'firstDegree'} count={sessionsByMode.firstDegree.length} onClick={() => setActiveMode('firstDegree')} />
                </div>

                <div className="space-y-5 min-w-0">
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <StatCard icon={TerminalSquare} label="Sessions" value={stats.sessions} />
                        <StatCard icon={Users} label="Leads" value={stats.leads} />
                        <StatCard icon={Mail} label={activeMode === 'firstDegree' ? 'Profile Emails' : 'Generated Emails'} value={stats.emails} />
                        <StatCard icon={CheckCircle2} label="Verified" value={stats.verified} />
                    </div>

                    <div className="glass-panel rounded-2xl p-4">
                        <div className="flex flex-col md:flex-row md:items-center gap-3 justify-between mb-4">
                            <div>
                                <h3 className="font-semibold flex items-center gap-2">
                                    <ActiveModeIcon className={clsx('w-4 h-4', MODES[activeMode].accent)} />
                                    {MODES[activeMode].label}
                                </h3>
                                <p className="text-xs text-gray-500 mt-1">
                                    {activeMode === 'generator'
                                        ? 'Quick Extract sends overview rows into Lead Intelligence and generates work emails.'
                                        : 'Deep Extract opens 1st-degree profiles and saves emails found in Contact Info.'}
                                </p>
                            </div>
                            <select
                                value={selectedSessionId}
                                onChange={e => setSelectedSessionId(e.target.value)}
                                className="bg-background/70 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-primary/50 min-w-[280px]"
                            >
                                {(sessionsByMode[activeMode] || []).length === 0 ? (
                                    <option value="">No extension sessions</option>
                                ) : (
                                    sessionsByMode[activeMode].map(session => (
                                        <option key={session.id} value={session.id}>
                                            {session.sessionName} - {session._count?.leads || session.totalProfiles || 0} leads
                                        </option>
                                    ))
                                )}
                            </select>
                        </div>

                        {selectedSession && (
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                                <SessionMeta label="Created" value={new Date(selectedSession.createdAt).toLocaleString()} />
                                <SessionMeta label="Profiles" value={selectedSession._count?.leads || selectedSession.totalProfiles || 0} />
                                <SessionMeta label="Emails" value={selectedSession.totalEmails || 0} />
                                <SessionMeta label="Verified" value={selectedSession.totalVerified || 0} />
                            </div>
                        )}

                        <LeadsTable
                            mode={activeMode}
                            leads={modeLeads}
                            loading={leadsLoading}
                        />
                    </div>
                </div>
            </div>

            <CollapsibleFeed
                activeMode={activeMode}
                events={filteredEvents}
                open={feedOpen}
                onToggle={() => setFeedOpen(open => !open)}
                onClear={() => setEvents([])}
            />
        </div>
    );
}

function StatusPill({ label, ok }) {
    return (
        <span className={clsx(
            'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium',
            ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
        )}>
            <span className={clsx('h-2 w-2 rounded-full', ok ? 'bg-emerald-400' : 'bg-amber-400')} />
            {label}
        </span>
    );
}

function ModeCard({ mode, active, count, onClick }) {
    const cfg = MODES[mode];
    const Icon = cfg.icon;
    return (
        <button
            onClick={onClick}
            className={clsx(
                'w-full text-left rounded-2xl border p-4 transition-all glass-panel',
                active ? `${cfg.border} ${cfg.bg}` : 'border-white/5 hover:border-white/15'
            )}
        >
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className={clsx('p-2 rounded-xl border', cfg.border, cfg.bg)}>
                        <Icon className={clsx('w-5 h-5', cfg.accent)} />
                    </div>
                    <div>
                        <h3 className="font-semibold text-white">{cfg.label}</h3>
                        <p className="text-xs text-gray-500">{cfg.short}</p>
                    </div>
                </div>
                <span className={clsx('text-2xl font-bold', cfg.accent)}>{count}</span>
            </div>
        </button>
    );
}

function StatCard({ icon: Icon, label, value }) {
    return (
        <div className="glass-panel rounded-2xl p-4">
            <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-gray-500">{label}</span>
                <Icon className="w-4 h-4 text-primary" />
            </div>
            <p className="text-2xl font-bold mt-2">{value}</p>
        </div>
    );
}

function SessionMeta({ label, value }) {
    return (
        <div className="rounded-xl border border-white/5 bg-black/20 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-gray-500">{label}</p>
            <p className="text-sm font-semibold text-white truncate mt-1">{value}</p>
        </div>
    );
}

function FeedItem({ event }) {
    const cfg = MODES[event.mode];
    const level = event.type?.includes('error') ? 'error' : event.type?.includes('complete') || event.type?.includes('done') ? 'success' : 'info';
    return (
        <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className={clsx(
                'rounded-xl border px-3 py-2 text-xs',
                level === 'error' ? 'border-red-500/30 bg-red-500/10 text-red-200' :
                level === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' :
                'border-white/10 bg-black/20 text-gray-300'
            )}
        >
            <div className="flex items-center justify-between gap-3 mb-1">
                <span className={clsx('font-semibold', cfg.accent)}>{cfg.label}</span>
                <span className="text-[10px] text-gray-500">{new Date(event.ts).toLocaleTimeString()}</span>
            </div>
            <p>{event.message}</p>
        </motion.div>
    );
}

function CollapsibleFeed({ activeMode, events, open, onToggle, onClear }) {
    return (
        <div className="glass-panel rounded-2xl overflow-hidden border border-white/5">
            <button
                onClick={onToggle}
                className="w-full px-4 py-3 flex items-center justify-between gap-4 hover:bg-white/[0.03] transition-colors"
            >
                <div className="flex items-center gap-3 min-w-0">
                    <div className={clsx('p-2 rounded-xl border', MODES[activeMode].border, MODES[activeMode].bg)}>
                        <Activity className={clsx('w-4 h-4', MODES[activeMode].accent)} />
                    </div>
                    <div className="text-left min-w-0">
                        <h3 className="font-semibold text-sm text-white">Live Feed</h3>
                        <p className="text-xs text-gray-500 truncate">
                            {events.length} event{events.length === 1 ? '' : 's'} for {MODES[activeMode].label}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {events[0] && (
                        <span className="hidden md:block text-xs text-gray-500 truncate max-w-[420px]">
                            Latest: {events[0].message}
                        </span>
                    )}
                    <ChevronDown className={clsx('w-5 h-5 text-gray-400 transition-transform', open && 'rotate-180')} />
                </div>
            </button>

            {open && (
                <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="border-t border-white/5 p-4"
                >
                    <div className="flex items-center justify-between mb-3">
                        <p className="text-xs text-gray-500">Realtime extraction and validation events</p>
                        <button onClick={onClear} className="text-[10px] text-gray-500 hover:text-white">Clear</button>
                    </div>
                    <div className="max-h-[300px] overflow-y-auto custom-scrollbar space-y-2">
                        {events.length === 0 ? (
                            <div className="py-12 text-center text-xs text-gray-600">
                                Waiting for {MODES[activeMode].label} activity.
                            </div>
                        ) : (
                            events.map(event => (
                                <FeedItem key={event.id} event={event} />
                            ))
                        )}
                    </div>
                </motion.div>
            )}
        </div>
    );
}

function LeadsTable({ mode, leads, loading }) {
    const emptyText = mode === 'generator'
        ? 'No Mail Generator leads in this session yet.'
        : 'No 1st-degree profile emails in this session yet.';

    return (
        <div className="rounded-2xl border border-white/5 overflow-hidden">
            <div className="grid grid-cols-[1.2fr_1fr_1.5fr_1fr] gap-3 px-4 py-3 bg-black/30 text-[10px] uppercase tracking-wider text-gray-500">
                <span>Lead</span>
                <span>Company</span>
                <span>{mode === 'generator' ? 'Generated mails' : 'Profile mails'}</span>
                <span>Status</span>
            </div>
            <div className="max-h-[460px] overflow-y-auto custom-scrollbar divide-y divide-white/5">
                {loading ? (
                    <div className="py-16 text-center text-gray-500 text-sm">Loading leads...</div>
                ) : leads.length === 0 ? (
                    <div className="py-16 text-center text-gray-500 text-sm">
                        <Inbox className="w-8 h-8 mx-auto mb-3 opacity-40" />
                        {emptyText}
                    </div>
                ) : (
                    leads.map(lead => (
                        <LeadRow key={lead.id} lead={lead} mode={mode} />
                    ))
                )}
            </div>
        </div>
    );
}

function LeadRow({ lead, mode }) {
    const emails = lead.emails || [];
    const validCount = emails.filter(email => email.verificationStatus === 'VALID').length;

    return (
        <div className="grid grid-cols-[1.2fr_1fr_1.5fr_1fr] gap-3 px-4 py-3 items-start hover:bg-white/[0.03] transition-colors">
            <div className="min-w-0">
                <p className="font-semibold text-white truncate">{lead.fullName}</p>
                <p className="text-[11px] text-gray-500 truncate">{lead.role || 'No role'}</p>
                {lead.linkedinUrl && (
                    <a href={lead.linkedinUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-primary hover:text-white mt-1">
                        LinkedIn <ExternalLink className="w-3 h-3" />
                    </a>
                )}
            </div>
            <div className="min-w-0">
                <p className="text-sm text-primary truncate">{lead.company?.companyName || 'Unknown'}</p>
                {lead.company?.domain && !lead.company.domain.startsWith('linkedin-') && !lead.company.domain.startsWith('personal-') && (
                    <p className="text-[11px] text-gray-500 truncate">{lead.company.domain}</p>
                )}
            </div>
            <div className="space-y-1.5 min-w-0">
                {emails.length === 0 ? (
                    <span className="text-xs text-gray-600">No emails</span>
                ) : (
                    emails.slice(0, mode === 'firstDegree' ? 5 : 4).map(email => (
                        <EmailLine key={email.id || email.email} email={email} />
                    ))
                )}
                {emails.length > 5 && <p className="text-[10px] text-gray-500">+{emails.length - 5} more</p>}
            </div>
            <div>
                <span className={clsx(
                    'inline-flex rounded-lg border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide',
                    validCount > 0 ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-slate-500/10 border-slate-500/30 text-slate-300'
                )}>
                    {mode === 'firstDegree' ? `${validCount} verified` : `${emails.length} generated`}
                </span>
            </div>
        </div>
    );
}

function EmailLine({ email }) {
    const copy = () => {
        navigator.clipboard.writeText(email.email);
        toast.success('Email copied');
    };

    return (
        <div className="flex items-center gap-2 min-w-0 group">
            <span className="font-mono text-[11px] text-gray-200 truncate">{email.email}</span>
            <span className={clsx(
                'shrink-0 rounded px-1.5 py-0.5 text-[8px] font-bold uppercase',
                email.verificationStatus === 'VALID' ? 'bg-emerald-500/10 text-emerald-300' :
                email.confidence === 'HIGH' ? 'bg-blue-500/10 text-blue-300' :
                'bg-slate-500/10 text-slate-400'
            )}>
                {email.pattern === 'LINKEDIN_CONTACT_INFO' ? 'profile' : email.verificationStatus || email.confidence || 'pending'}
            </span>
            <button onClick={copy} className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-primary transition-all" title="Copy email">
                <Copy className="w-3 h-3" />
            </button>
        </div>
    );
}
