import { useState, useEffect, useCallback } from 'react';
import { CalendarClock, Send, XCircle, Clock, CheckCircle2, RefreshCw, Play, Trash2, Edit3, Mail } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import clsx from 'clsx';
import { getFollowUps, cancelFollowUp, sendFollowUpNow, getScheduledSends, getSentEmails, scheduleManualFollowUp } from '../api';

const STATUS_COLORS = {
    SCHEDULED: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-300', icon: Clock },
    SENT: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-300', icon: CheckCircle2 },
    CANCELLED: { bg: 'bg-gray-500/10', border: 'border-gray-500/30', text: 'text-gray-400', icon: XCircle },
    SKIPPED: { bg: 'bg-gray-500/10', border: 'border-gray-500/30', text: 'text-gray-400', icon: XCircle },
};

const SCHEDULE_OPTIONS = [
    { value: '1h', label: '1 hour' },
    { value: '6h', label: '6 hours' },
    { value: '1d', label: '1 day' },
    { value: '2d', label: '2 days' },
    { value: '3d', label: '3 days' },
    { value: '5d', label: '5 days' },
    { value: '1w', label: '1 week' },
    { value: '2w', label: '2 weeks' },
    { value: '15d', label: '15 days' },
    { value: '1m', label: '1 month' },
];

export default function FollowUpsPage() {
    const [followUps, setFollowUps] = useState([]);
    const [sentEmails, setSentEmails] = useState([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState('scheduled');
    const [showCompose, setShowCompose] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [fuRes, sentRes] = await Promise.all([
                getFollowUps({ limit: 100 }),
                getSentEmails({ limit: 50 }),
            ]);
            setFollowUps(fuRes.data || []);
            setSentEmails(sentRes.data?.emails || sentRes.data || []);
        } catch (e) {
            toast.error('Failed to load follow-ups');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const scheduled = followUps.filter(f => f.status === 'SCHEDULED');
    const sent = followUps.filter(f => f.status === 'SENT');
    const cancelled = followUps.filter(f => f.status === 'CANCELLED' || f.status === 'SKIPPED');

    const displayed = tab === 'scheduled' ? scheduled : tab === 'sent' ? sent : cancelled;

    const handleCancel = async (id) => {
        try {
            await cancelFollowUp(id);
            toast.success('Follow-up cancelled');
            load();
        } catch (e) {
            toast.error('Cancel failed');
        }
    };

    const handleSendNow = async (id) => {
        try {
            await sendFollowUpNow(id);
            toast.success('Sending now...');
            load();
        } catch (e) {
            toast.error('Send failed');
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                        <CalendarClock className="w-8 h-8 text-amber-400" /> Follow-ups & Scheduling
                    </h1>
                    <p className="text-gray-400 text-sm mt-1">
                        Manage scheduled follow-ups, threaded replies, and delayed sends. Auto-cancelled when recipient replies.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowCompose(!showCompose)}
                        className="btn-primary flex items-center gap-2 text-sm"
                    >
                        <Mail className="w-4 h-4" />
                        Schedule Follow-up
                    </button>
                    <button onClick={load} className="p-2.5 rounded-xl border border-white/10 hover:bg-white/5 transition-colors">
                        <RefreshCw className={clsx('w-4 h-4 text-gray-400', loading && 'animate-spin')} />
                    </button>
                </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard icon={Clock} label="Scheduled" value={scheduled.length} color="text-amber-400" />
                <StatCard icon={CheckCircle2} label="Sent" value={sent.length} color="text-emerald-400" />
                <StatCard icon={XCircle} label="Cancelled" value={cancelled.length} color="text-gray-400" />
                <StatCard icon={Send} label="Total Outbound" value={sentEmails.length} color="text-sky-400" />
            </div>

            {/* Compose panel */}
            {showCompose && (
                <ComposeFollowUp
                    sentEmails={sentEmails}
                    onClose={() => setShowCompose(false)}
                    onScheduled={() => { setShowCompose(false); load(); }}
                />
            )}

            {/* Tabs */}
            <div className="flex gap-1 bg-surface/30 p-1 rounded-xl w-fit border border-white/5">
                {[
                    { key: 'scheduled', label: 'Scheduled', count: scheduled.length },
                    { key: 'sent', label: 'Sent', count: sent.length },
                    { key: 'cancelled', label: 'Cancelled', count: cancelled.length },
                ].map(t => (
                    <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        className={clsx('px-4 py-2 rounded-lg text-xs font-medium transition-all',
                            tab === t.key ? 'bg-primary/20 text-primary border border-primary/30' : 'text-gray-400 hover:text-white hover:bg-white/5'
                        )}
                    >
                        {t.label} ({t.count})
                    </button>
                ))}
            </div>

            {/* Follow-up list */}
            <div className="space-y-3">
                {loading ? (
                    <div className="text-center py-16 text-gray-500">Loading...</div>
                ) : displayed.length === 0 ? (
                    <div className="text-center py-16 text-gray-500">
                        <CalendarClock className="w-10 h-10 mx-auto mb-3 opacity-40" />
                        <p>No {tab} follow-ups.</p>
                        {tab === 'scheduled' && <p className="text-xs mt-1">Schedule a follow-up from the Outreach page or use the button above.</p>}
                    </div>
                ) : (
                    displayed.map((fu, i) => (
                        <FollowUpCard
                            key={fu.id}
                            followUp={fu}
                            index={i}
                            onCancel={() => handleCancel(fu.id)}
                            onSendNow={() => handleSendNow(fu.id)}
                        />
                    ))
                )}
            </div>
        </div>
    );
}

function StatCard({ icon: Icon, label, value, color }) {
    return (
        <div className="glass-panel rounded-2xl p-4">
            <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-gray-500">{label}</span>
                <Icon className={`w-4 h-4 ${color}`} />
            </div>
            <p className="text-2xl font-bold mt-2">{value}</p>
        </div>
    );
}

function FollowUpCard({ followUp, index, onCancel, onSendNow }) {
    const status = STATUS_COLORS[followUp.status] || STATUS_COLORS.SCHEDULED;
    const StatusIcon = status.icon;
    const isScheduled = followUp.status === 'SCHEDULED';

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.03 }}
            className="glass-panel rounded-xl p-4"
        >
            <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                        <span className={clsx('inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-semibold uppercase', status.bg, status.border, status.text)}>
                            <StatusIcon className="w-3 h-3" />
                            {followUp.status}
                        </span>
                        <span className="text-xs text-gray-500">
                            {isScheduled ? 'Scheduled for ' : 'Processed '}
                            {new Date(followUp.scheduledFor).toLocaleString()}
                        </span>
                    </div>
                    <p className="font-semibold text-white truncate">{followUp.subject}</p>
                    <p className="text-sm text-gray-400 mt-1 line-clamp-2">{followUp.body?.slice(0, 150)}...</p>
                </div>
                {isScheduled && (
                    <div className="flex items-center gap-1 shrink-0">
                        <button
                            onClick={onSendNow}
                            title="Send now"
                            className="p-2 rounded-lg text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                        >
                            <Play className="w-4 h-4" />
                        </button>
                        <button
                            onClick={onCancel}
                            title="Cancel"
                            className="p-2 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                )}
            </div>
        </motion.div>
    );
}

function ComposeFollowUp({ sentEmails, onClose, onScheduled }) {
    const [selectedIds, setSelectedIds] = useState([]);
    const [body, setBody] = useState('Hi,\n\nJust following up on my previous message. Would love to connect if you have a moment.\n\nBest regards');
    const [subject, setSubject] = useState('');
    const [scheduleType, setScheduleType] = useState('2d');
    const [sending, setSending] = useState(false);
    const [sessions, setSessions] = useState([]);
    const [selectedSession, setSelectedSession] = useState('');

    // Load sessions that have sent emails
    useEffect(() => {
        getSentEmails({ limit: 200 }).then(res => {
            const emails = res.data?.emails || res.data || [];
            // Group by campaign to build pseudo-sessions
            const campaignMap = new Map();
            for (const e of emails) {
                if (!['SENT', 'DELIVERED'].includes(e.status)) continue;
                const key = e.campaignId || 'no-campaign';
                if (!campaignMap.has(key)) campaignMap.set(key, []);
                campaignMap.get(key).push(e);
            }
            const sessionList = Array.from(campaignMap.entries()).map(([id, emails]) => ({
                id,
                label: emails[0]?.subject?.slice(0, 40) || `Campaign ${id.slice(0, 8)}`,
                count: emails.length,
                emails,
            }));
            setSessions(sessionList);
        }).catch(() => {});
    }, []);

    // Only show delivered/sent emails (not bounced/failed)
    const eligible = sentEmails.filter(e => ['SENT', 'DELIVERED'].includes(e.status));

    const toggleSelect = (id) => {
        setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const selectAll = () => {
        if (selectedIds.length === eligible.length) setSelectedIds([]);
        else setSelectedIds(eligible.map(e => e.id));
    };

    const selectSession = (sessionId) => {
        setSelectedSession(sessionId);
        if (!sessionId) return;
        const session = sessions.find(s => s.id === sessionId);
        if (session) {
            setSelectedIds(session.emails.map(e => e.id));
        }
    };

    const handleSchedule = async () => {
        if (selectedIds.length === 0) return toast.error('Select at least one email to follow up');
        if (!body.trim()) return toast.error('Follow-up body is required');
        setSending(true);
        try {
            await scheduleManualFollowUp({
                sentEmailIds: selectedIds,
                subject: subject.trim() || undefined,
                body: body.trim(),
                scheduleType,
                threaded: true,
            });
            toast.success(`Scheduled ${selectedIds.length} follow-up(s)`);
            onScheduled();
        } catch (e) {
            toast.error(e.response?.data?.error || 'Failed to schedule');
        } finally {
            setSending(false);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="glass-card p-6 rounded-2xl overflow-hidden"
        >
            <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-white">Schedule Threaded Follow-up</h3>
                <button onClick={onClose} className="text-gray-500 hover:text-white">✕</button>
            </div>

            {/* Session selector */}
            {sessions.length > 0 && (
                <div className="mb-4">
                    <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1">Quick select: whole session</label>
                    <select
                        value={selectedSession}
                        onChange={e => selectSession(e.target.value)}
                        className="w-full bg-background border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary/50"
                    >
                        <option value="">— Select a session to follow up all recipients —</option>
                        {sessions.map(s => (
                            <option key={s.id} value={s.id}>
                                {s.label} ({s.count} emails)
                            </option>
                        ))}
                    </select>
                </div>
            )}

            {/* Select emails to follow up */}
            <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                    <label className="text-xs text-gray-500 uppercase tracking-wider">Select sent emails to follow up ({selectedIds.length}/{eligible.length})</label>
                    <button onClick={selectAll} className="text-xs text-primary hover:underline">
                        {selectedIds.length === eligible.length ? 'Deselect all' : 'Select all'}
                    </button>
                </div>
                <div className="max-h-40 overflow-y-auto space-y-1 border border-white/5 rounded-xl p-2">
                    {eligible.length === 0 ? (
                        <p className="text-xs text-gray-500 text-center py-4">No sent emails found. Send emails from the Outreach page first.</p>
                    ) : (
                        eligible.slice(0, 50).map(e => (
                            <label key={e.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={selectedIds.includes(e.id)}
                                    onChange={() => toggleSelect(e.id)}
                                />
                                <span className="text-sm text-white truncate">{e.toEmail}</span>
                                <span className="text-[10px] text-gray-500 ml-auto shrink-0">{e.subject?.slice(0, 30)}</span>
                            </label>
                        ))
                    )}
                </div>
            </div>

            {/* Subject (optional) */}
            <div className="mb-3">
                <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1">Subject (leave blank for "Re: original")</label>
                <input
                    value={subject}
                    onChange={e => setSubject(e.target.value)}
                    placeholder="Re: Regarding opportunities..."
                    className="w-full bg-background border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary/50"
                />
            </div>

            {/* Body */}
            <div className="mb-3">
                <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1">Follow-up message</label>
                <textarea
                    value={body}
                    onChange={e => setBody(e.target.value)}
                    rows={5}
                    className="w-full bg-background border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary/50 resize-none"
                />
            </div>

            {/* Schedule picker */}
            <div className="mb-4">
                <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1">Send after</label>
                <div className="flex flex-wrap gap-2">
                    {SCHEDULE_OPTIONS.map(opt => (
                        <button
                            key={opt.value}
                            onClick={() => setScheduleType(opt.value)}
                            className={clsx(
                                'px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                                scheduleType === opt.value
                                    ? 'bg-primary/20 border-primary/40 text-primary'
                                    : 'border-white/10 text-gray-400 hover:text-white hover:border-white/20'
                            )}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
                <button
                    onClick={handleSchedule}
                    disabled={sending || selectedIds.length === 0}
                    className="btn-primary flex items-center gap-2 text-sm"
                >
                    {sending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CalendarClock className="w-4 h-4" />}
                    Schedule {selectedIds.length} Follow-up{selectedIds.length !== 1 ? 's' : ''}
                </button>
                <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
                <p className="text-xs text-gray-500 ml-auto">Threaded replies (same Gmail conversation). Auto-cancelled if they reply.</p>
            </div>
        </motion.div>
    );
}
