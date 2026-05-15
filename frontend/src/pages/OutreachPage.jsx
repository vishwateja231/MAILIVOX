import { useState, useEffect, useCallback } from 'react';
import { Send, Play, Pause, RotateCcw, Mail, CheckCircle2, XCircle, Clock, Zap, Layers, RefreshCw, Users, Eye, ChevronDown, Copy, FileText, Trash2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import clsx from 'clsx';
import {
    getOutreachStats, getSessions, getSessionLeads, bulkSendTemplate,
    sendOutreachEmail, generateAIEmail, generateEmails,
    getQueueStats, startQueue, pauseQueue, resumeQueue, retryDeadQueue,
    getSentEmails, getResumes, getProfiles, createResume, createProfile,
    deleteResume, deleteProfile, getDefaultAssets,
} from '../api';

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function OutreachPage() {
    const [sessions, setSessions] = useState([]);
    const [selectedSessionId, setSelectedSessionId] = useState('');
    const [leads, setLeads] = useState([]);
    const [selectedLeadIds, setSelectedLeadIds] = useState(new Set());
    const [stats, setStats] = useState(null);
    const [queueStats, setQueueStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadingLeads, setLoadingLeads] = useState(false);
    const [mode, setMode] = useState('template'); // template | ai
    const [sending, setSending] = useState(false);
    const [sortBy, setSortBy] = useState('default'); // default | confidence | name
    const [emailFilter, setEmailFilter] = useState('top1'); // top1 | top3 | all | verified
    const [testPreview, setTestPreview] = useState(null); // { to, subject, body }
    const [showAddLead, setShowAddLead] = useState(false);
    const [showCompose, setShowCompose] = useState(false);

    // Template state — clean, minimal variables only
    const [subject, setSubject] = useState('Regarding opportunities at {{company}}');
    const [body, setBody] = useState(`Hi {{first_name}},

I came across your profile and wanted to connect regarding opportunities at {{company}}.

I'm currently exploring Software Engineering and AI-focused opportunities and would love to connect or learn more if relevant.

Resume: {{resume_link}}

Best regards,
Vishwa Teja`);

    // Campaign variables (loaded from persistent assets)
    const [resumes, setResumes] = useState([]);
    const [profiles, setProfiles] = useState([]);
    const [selectedResumeId, setSelectedResumeId] = useState('');
    const [campaignVars, setCampaignVars] = useState({
        resume_link: '', github: '', linkedin: '', portfolio: '',
    });
    const [showAddResume, setShowAddResume] = useState(false);
    const [showAddProfile, setShowAddProfile] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState(null); // { type: 'resume'|'profile', id, label }

    // AI state
    const [aiResult, setAiResult] = useState(null);
    const [aiGenerating, setAiGenerating] = useState(false);
    const [aiTone, setAiTone] = useState('professional');
    const [aiType, setAiType] = useState('cold_outreach');

    const loadData = useCallback(async () => {
        try {
            const [sessRes, statsRes, queueRes, resumesRes, profilesRes, defaultsRes] = await Promise.all([
                getSessions().catch(() => ({ data: [] })),
                getOutreachStats().catch(() => ({ data: {} })),
                getQueueStats().catch(() => ({ data: {} })),
                getResumes().catch(() => ({ data: [] })),
                getProfiles().catch(() => ({ data: [] })),
                getDefaultAssets().catch(() => ({ data: {} })),
            ]);
            setSessions(sessRes.data || []);
            setStats(statsRes.data);
            setQueueStats(queueRes.data);
            setResumes(resumesRes.data || []);
            setProfiles(profilesRes.data || []);

            // Auto-populate campaign vars from defaults
            const defaults = defaultsRes.data || {};
            setCampaignVars(prev => ({
                ...prev,
                resume_link: defaults.resume_link || prev.resume_link,
                github: defaults.github || prev.github,
                linkedin: defaults.linkedin || prev.linkedin,
                portfolio: defaults.portfolio || prev.portfolio,
            }));

            // Auto-select default resume
            const defaultResume = (resumesRes.data || []).find(r => r.isDefault);
            if (defaultResume) setSelectedResumeId(defaultResume.id);

            // Auto-select latest session (use functional update to avoid stale closure)
            if (sessRes.data?.length > 0) {
                setSelectedSessionId(prev => prev || sessRes.data[0].id);
            }
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { loadData(); }, [loadData]);

    // Load leads when session changes
    useEffect(() => {
        if (!selectedSessionId) { setLeads([]); return; }
        setLoadingLeads(true);
        setSelectedLeadIds(new Set());
        getSessionLeads(selectedSessionId)
            .then(res => setLeads(res.data || []))
            .catch(() => setLeads([]))
            .finally(() => setLoadingLeads(false));
    }, [selectedSessionId]);

    const leadsWithEmail = leads.filter(l => l.emails?.length > 0);

    // Derive a display name from the email local part
    // e.g. "himanshu.khandelwal@x.com" → "Himanshu Khandelwal"
    //      "hkhandelwal@x.com" → "H Khandelwal" (if full name is "Himanshu Khandelwal")
    //      "v.teja@x.com" → "V Teja" (not "Vishwa Teja")
    function getDisplayNameFromEmail(email, originalName) {
        if (!email) return originalName;
        const local = email.split('@')[0];
        if (!local) return originalName;
        
        // Split local part by separators
        const parts = local.split(/[._\-]/).filter(Boolean);
        
        if (parts.length === 0) return originalName;
        
        // Capitalize each part intelligently
        const capitalize = (s) => {
            if (!s) return '';
            if (s.length === 1) return s.toUpperCase(); // Single letter = initial
            return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
        };
        
        // If it's a single concatenated string (no separators), try to match against original name parts
        if (parts.length === 1 && originalName) {
            const nameParts = originalName.toLowerCase().split(/\s+/);
            const localLower = parts[0].toLowerCase();
            
            // Check if it's just firstname
            if (nameParts[0] && localLower === nameParts[0]) return capitalize(nameParts[0]);
            // Check if it's just lastname
            if (nameParts[1] && localLower === nameParts[1]) return capitalize(nameParts[1]);
            // Check if it's firstnamelastname concatenated
            if (nameParts.length >= 2 && localLower === nameParts.join('')) return originalName;
            // Check if it's firstinitiallastname (e.g. "hkhandelwal")
            if (nameParts.length >= 2 && nameParts[0][0] && localLower === nameParts[0][0] + nameParts[1]) {
                return nameParts[0][0].toUpperCase() + ' ' + capitalize(nameParts[1]);
            }
            // Check if it's firstnamelastinitial (e.g. "himanshuk")
            if (nameParts.length >= 2 && nameParts[1][0] && localLower === nameParts[0] + nameParts[1][0]) {
                return capitalize(nameParts[0]) + ' ' + nameParts[1][0].toUpperCase();
            }
            // Fallback: just capitalize the whole thing
            return capitalize(localLower);
        }
        
        // Multiple parts separated by . _ - → capitalize each
        return parts.map(capitalize).join(' ');
    }

    // Flatten leads into individual email rows
    const flatEmails = (() => {
        const items = [];
        const sorted = [...leads].sort((a, b) => {
            if (sortBy === 'name') return (a.fullName || '').localeCompare(b.fullName || '');
            return 0;
        });

        for (const lead of sorted) {
            if (!lead.emails || lead.emails.length === 0) continue;
            
            let emails = lead.emails;
            
            // Apply filter
            if (emailFilter === 'top1') emails = emails.slice(0, 1);
            else if (emailFilter === 'top3') emails = emails.slice(0, 3);
            else if (emailFilter === 'verified') emails = emails.filter(e => e.verificationStatus === 'VALID' || e.confidence === 'HIGH');
            // 'all' = no filter

            for (const em of emails) {
                // Derive smart display name from the email local part
                const displayName = getDisplayNameFromEmail(em.email, lead.fullName);
                items.push({
                    key: `${lead.id}_${em.id || em.email}`,
                    leadId: lead.id,
                    fullName: displayName,
                    company: lead.company?.companyName || lead.companyName || '',
                    role: lead.role || '',
                    email: em.email,
                    confidence: em.confidence,
                    status: em.verificationStatus,
                    emailId: em.id,
                });
            }
        }

        // Sort by confidence if requested
        if (sortBy === 'confidence') {
            const confOrder = { HIGH: 0, MEDIUM: 1, LOW: 2, PENDING: 3, INVALID: 4 };
            items.sort((a, b) => (confOrder[a.confidence] ?? 5) - (confOrder[b.confidence] ?? 5));
        }

        return items;
    })();

    const toggleLead = (id) => {
        setSelectedLeadIds(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const toggleAll = () => {
        if (selectedLeadIds.size === flatEmails.length) setSelectedLeadIds(new Set());
        else setSelectedLeadIds(new Set(flatEmails.map(e => e.key)));
    };
    const handleBulkSend = async () => {
        if (selectedLeadIds.size === 0) return toast.error('Select emails to send to');
        if (!subject.trim() || !body.trim()) return toast.error('Subject and body required');
        setSending(true);
        const tid = toast.loading(`Queuing ${selectedLeadIds.size} emails...`);
        try {
            // Extract unique lead IDs from selected email keys
            const selectedItems = flatEmails.filter(e => selectedLeadIds.has(e.key));
            const uniqueLeadIds = [...new Set(selectedItems.map(e => e.leadId))];
            
            const res = await bulkSendTemplate({
                leadIds: uniqueLeadIds,
                subject,
                body,
                variables: campaignVars,
            });
            toast.success(`Queued ${res.data.queued} emails for sending`, { id: tid });
            setSelectedLeadIds(new Set());
            getQueueStats().then(r => setQueueStats(r.data)).catch(() => {});
        } catch (e) {
            toast.error(e.response?.data?.error || 'Bulk send failed', { id: tid });
        } finally {
            setSending(false);
        }
    };

    const handleTestSend = async () => {
        if (!subject.trim() || !body.trim()) return toast.error('Subject and body required');
        setSending(true);
        const tid = toast.loading('Sending test email to you...');
        try {
            // Use the first selected lead's data for variable replacement, or a sample
            const sampleLead = flatEmails.find(e => selectedLeadIds.has(e.key)) || flatEmails[0] || {};
            const testVars = {
                ...campaignVars,
                first_name: sampleLead.fullName?.split(' ')[0] || 'Test',
                company: sampleLead.company || 'TestCompany',
                role: sampleLead.role || 'Engineer',
            };
            
            // Replace variables in subject and body for preview
            let renderedSubject = subject;
            let renderedBody = body;
            for (const [key, val] of Object.entries(testVars)) {
                renderedSubject = renderedSubject.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), val || '');
                renderedBody = renderedBody.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), val || '');
            }

            // Send test to yourself
            const myEmail = 'reply@vishwateja.online';
            await sendOutreachEmail({
                to: myEmail,
                toName: 'Test',
                subject: `[TEST] ${renderedSubject}`,
                html: renderedBody.replace(/\n/g, '<br>'),
                text: renderedBody,
            });
            
            toast.success('Test email sent! Check your inbox.', { id: tid });
            setTestPreview({ to: myEmail, subject: `[TEST] ${renderedSubject}`, body: renderedBody });
        } catch (e) {
            toast.error(e.response?.data?.error || 'Test send failed', { id: tid });
        } finally {
            setSending(false);
        }
    };

    const handleAIGenerate = async () => {
        const firstLead = leads.find(l => selectedLeadIds.has(l.id)) || leads[0];
        if (!firstLead) return toast.error('No lead selected for AI generation');
        setAiGenerating(true);
        try {
            const res = await generateAIEmail({
                recruiterName: firstLead.fullName,
                company: firstLead.company?.companyName || '',
                targetRole: firstLead.role || 'Software Engineer',
                tone: aiTone,
                type: aiType,
            });
            setAiResult(res.data);
            // Auto-fill template with AI result
            if (res.data.subject) setSubject(res.data.subject);
            if (res.data.text) setBody(res.data.text);
            toast.success('AI email generated — template updated');
        } catch (e) {
            toast.error(e.response?.data?.error || 'AI generation failed');
        } finally {
            setAiGenerating(false);
        }
    };

    if (loading) return (
        <div className="flex items-center justify-center h-64">
            <div className="w-10 h-10 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
    );

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Outreach Campaign</h1>
                    <p className="text-gray-400 text-sm mt-1">Session-aware outreach via Resend.</p>
                </div>
                <div className="flex gap-2">
                    <button onClick={() => setShowCompose(true)} className="px-4 py-2 rounded-xl text-sm font-medium bg-gradient-to-r from-primary to-blue-600 text-white flex items-center gap-2 hover:shadow-lg hover:shadow-primary/20 transition-all">
                        <Mail className="w-4 h-4" /> Compose
                    </button>
                    <QueueControls queueStats={queueStats} onRefresh={() => getQueueStats().then(r => setQueueStats(r.data))} />
                </div>
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-5 gap-3">
                <MiniStat label="Sent" value={stats?.sent || 0} color="text-primary" />
                <MiniStat label="Replied" value={stats?.replied || 0} color="text-emerald-400" />
                <MiniStat label="Bounced" value={stats?.bounced || 0} color="text-amber-400" />
                <MiniStat label="Failed" value={stats?.failed || 0} color="text-red-400" />
                <MiniStat label="In Queue" value={queueStats?.pending || 0} color="text-violet-400" />
            </div>

            {/* Session Selector — Simple dropdown */}
            <div className="glass-card p-4 flex items-center gap-4">
                <Layers className="w-5 h-5 text-primary shrink-0" />
                <div className="flex-1">
                    <select
                        value={selectedSessionId}
                        onChange={e => setSelectedSessionId(e.target.value)}
                        className="w-full bg-background border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary/50"
                    >
                        <option value="">Select session...</option>
                        {sessions.map(s => (
                            <option key={s.id} value={s.id}>
                                {s.sessionName} — {s._count?.leads || s.totalProfiles || 0} leads, {s.totalEmails || 0} emails
                            </option>
                        ))}
                    </select>
                </div>
                {selectedSessionId && (
                    <div className="flex items-center gap-3 shrink-0">
                        <div className="flex gap-4 text-xs text-gray-400">
                            <span><Users className="w-3 h-3 inline mr-1" />{leads.length} leads</span>
                            <span><Mail className="w-3 h-3 inline mr-1" />{flatEmails.length} emails</span>
                        </div>
                        <button
                            onClick={() => setShowAddLead(true)}
                            className="px-3 py-1.5 rounded-lg text-[10px] font-medium bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors"
                        >
                            + Add Lead
                        </button>
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
                {/* Left: Leads List (3 cols) */}
                <div className="lg:col-span-3 glass-panel rounded-2xl overflow-hidden flex flex-col max-h-[600px]">
                    <div className="px-4 py-3 border-b border-white/5 bg-surface/30 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <input type="checkbox" checked={selectedLeadIds.size === flatEmails.length && flatEmails.length > 0} onChange={toggleAll} />
                            <h3 className="text-sm font-semibold">Emails ({flatEmails.length})</h3>
                        </div>
                        <div className="flex items-center gap-2">
                            {selectedLeadIds.size > 0 && (
                                <span className="text-xs text-primary font-medium">{selectedLeadIds.size} selected</span>
                            )}
                            <select
                                value={emailFilter}
                                onChange={e => setEmailFilter(e.target.value)}
                                className="bg-background border border-white/10 rounded-lg px-2 py-1 text-[10px] text-gray-300 focus:outline-none focus:border-primary/50"
                            >
                                <option value="top1">Top 1 per lead</option>
                                <option value="top3">Top 3 per lead</option>
                                <option value="all">All combinations</option>
                                <option value="verified">Verified only</option>
                            </select>
                            <select
                                value={sortBy}
                                onChange={e => setSortBy(e.target.value)}
                                className="bg-background border border-white/10 rounded-lg px-2 py-1 text-[10px] text-gray-300 focus:outline-none focus:border-primary/50"
                            >
                                <option value="default">Sort: Default</option>
                                <option value="confidence">Sort: Confidence</option>
                                <option value="name">Sort: Name</option>
                            </select>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                        {loadingLeads ? (
                            <div className="flex items-center justify-center py-12"><RefreshCw className="w-5 h-5 animate-spin text-gray-500" /></div>
                        ) : flatEmails.length === 0 ? (
                            <div className="text-center py-12 text-gray-500 text-sm">
                                {selectedSessionId ? 'No emails in this session.' : 'Select a session to load leads.'}
                            </div>
                        ) : (
                            flatEmails.map(item => {
                                const isSelected = selectedLeadIds.has(item.key);
                                return (
                                    <div
                                        key={item.key}
                                        onClick={() => toggleLead(item.key)}
                                        className={clsx(
                                            'flex items-center gap-3 px-4 py-2.5 border-b border-white/5 cursor-pointer transition-colors',
                                            isSelected ? 'bg-primary/8' : 'hover:bg-white/[0.03]'
                                        )}
                                    >
                                        <input type="checkbox" checked={isSelected} readOnly className="shrink-0" />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-medium text-white truncate">{item.fullName}</p>
                                            <p className="text-[10px] text-gray-500 truncate">{item.company} • {item.role || 'No role'}</p>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <p className="text-[11px] font-mono text-gray-200">{item.email}</p>
                                            <span className={clsx('text-[8px] uppercase font-bold px-1.5 py-0.5 rounded',
                                                item.status === 'VALID' ? 'text-emerald-400 bg-emerald-500/10' :
                                                item.confidence === 'HIGH' ? 'text-emerald-400 bg-emerald-500/10' :
                                                item.confidence === 'MEDIUM' ? 'text-blue-400 bg-blue-500/10' :
                                                'text-gray-500 bg-gray-500/10'
                                            )}>{item.status === 'VALID' ? '✓' : item.confidence?.[0] || 'P'}</span>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* Right: Template Editor (2 cols) */}
                <div className="lg:col-span-2 space-y-4">
                    {/* Mode Tabs */}
                    <div className="flex gap-1 bg-surface/30 p-1 rounded-xl border border-white/5">
                        <button onClick={() => setMode('template')} className={clsx('flex-1 px-4 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-2', mode === 'template' ? 'bg-primary/20 text-primary border border-primary/30' : 'text-gray-400 hover:text-white')}>
                            <FileText className="w-3.5 h-3.5" /> Template
                        </button>
                        <button onClick={() => setMode('ai')} className={clsx('flex-1 px-4 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-2', mode === 'ai' ? 'bg-primary/20 text-primary border border-primary/30' : 'text-gray-400 hover:text-white')}>
                            <Zap className="w-3.5 h-3.5" /> AI Generate
                        </button>
                    </div>

                    {/* AI Controls */}
                    {mode === 'ai' && (
                        <div className="glass-card p-4 space-y-3">
                            <div className="grid grid-cols-2 gap-2">
                                <select value={aiTone} onChange={e => setAiTone(e.target.value)} className="bg-background border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-primary/50">
                                    <option value="professional">Professional</option>
                                    <option value="aggressive">Aggressive</option>
                                    <option value="startup">Startup</option>
                                    <option value="enterprise">Enterprise</option>
                                    <option value="concise">Concise</option>
                                </select>
                                <select value={aiType} onChange={e => setAiType(e.target.value)} className="bg-background border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-primary/50">
                                    <option value="cold_outreach">Cold Outreach</option>
                                    <option value="referral_request">Referral</option>
                                    <option value="follow_up">Follow Up</option>
                                    <option value="networking">Networking</option>
                                </select>
                            </div>
                            <button onClick={handleAIGenerate} disabled={aiGenerating} className="w-full py-2 rounded-lg text-xs font-semibold bg-gradient-to-r from-violet-500/20 to-primary/20 border border-primary/30 text-primary hover:border-primary/50 flex items-center justify-center gap-2 transition-all disabled:opacity-50">
                                {aiGenerating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                                {aiGenerating ? 'Generating...' : 'Generate & Fill Template'}
                            </button>
                        </div>
                    )}

                    {/* Template Editor */}
                    <div className="glass-card p-4 space-y-3">
                        <div>
                            <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1 block">Subject</label>
                            <input
                                value={subject}
                                onChange={e => setSubject(e.target.value)}
                                placeholder="Email subject with {{variables}}"
                                className="w-full bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1 block">Body</label>
                            <textarea
                                value={body}
                                onChange={e => setBody(e.target.value)}
                                rows={10}
                                placeholder="Email body with {{name}}, {{company}}, {{role}} variables..."
                                className="w-full bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono leading-relaxed focus:outline-none focus:border-primary/50 resize-none custom-scrollbar"
                            />
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {['{{first_name}}', '{{company}}', '{{resume_link}}'].map(v => (
                                <button key={v} onClick={() => setBody(prev => prev + v)} className="px-2 py-0.5 rounded bg-surface border border-white/10 text-[10px] text-gray-400 hover:text-primary hover:border-primary/30 transition-colors font-mono">
                                    {v}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Persistent Assets Panel */}
                    <div className="glass-card p-4 space-y-3">
                        <h4 className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Identity Assets</h4>

                        {/* Resume Selector */}
                        <div>
                            <label className="text-[10px] text-gray-400 mb-1 block">Resume</label>
                            <div className="flex gap-1.5">
                                <select
                                    value={selectedResumeId}
                                    onChange={e => {
                                        setSelectedResumeId(e.target.value);
                                        const r = resumes.find(x => x.id === e.target.value);
                                        if (r) setCampaignVars(prev => ({ ...prev, resume_link: r.url }));
                                    }}
                                    className="flex-1 bg-background border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-primary/50"
                                >
                                    <option value="">Select resume...</option>
                                    {resumes.map(r => (
                                        <option key={r.id} value={r.id}>{r.name}{r.isDefault ? ' ★' : ''}</option>
                                    ))}
                                </select>
                                <button onClick={() => setShowAddResume(true)} title="Add resume" className="px-2 py-1 rounded-lg bg-surface border border-white/10 text-[10px] text-gray-400 hover:text-primary hover:border-primary/30 transition-colors">+</button>
                                {selectedResumeId && (
                                    <button
                                        onClick={() => {
                                            const r = resumes.find(x => x.id === selectedResumeId);
                                            setDeleteConfirm({ type: 'resume', id: selectedResumeId, label: r?.name || 'this resume' });
                                        }}
                                        title="Delete selected resume"
                                        className="px-2 py-1 rounded-lg bg-surface border border-white/10 text-[10px] text-gray-400 hover:text-danger hover:border-danger/30 transition-colors"
                                    >
                                        <Trash2 className="w-3 h-3" />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Profile Links */}
                        {['github', 'linkedin', 'portfolio'].map(type => {
                            const items = profiles.filter(p => p.type === type);
                            const selectedUrl = campaignVars[type] || '';
                            const selectedProfile = items.find(p => p.url === selectedUrl);
                            return (
                                <div key={type}>
                                    <label className="text-[10px] text-gray-400 mb-1 block capitalize">{type}</label>
                                    <div className="flex gap-1.5">
                                        {items.length > 0 ? (
                                            <select
                                                value={selectedUrl}
                                                onChange={e => setCampaignVars(prev => ({ ...prev, [type]: e.target.value }))}
                                                className="flex-1 bg-background border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-primary/50"
                                            >
                                                {items.map(p => (
                                                    <option key={p.id} value={p.url}>{p.label}{p.isDefault ? ' ★' : ''}</option>
                                                ))}
                                            </select>
                                        ) : (
                                            <input
                                                value={selectedUrl}
                                                onChange={e => setCampaignVars(prev => ({ ...prev, [type]: e.target.value }))}
                                                placeholder={`${type} URL`}
                                                className="flex-1 bg-background border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-primary/50"
                                            />
                                        )}
                                        <button onClick={() => setShowAddProfile(type)} title={`Add ${type}`} className="px-2 py-1 rounded-lg bg-surface border border-white/10 text-[10px] text-gray-400 hover:text-primary hover:border-primary/30 transition-colors">+</button>
                                        {selectedProfile && (
                                            <button
                                                onClick={() => {
                                                    setDeleteConfirm({ type: 'profile', id: selectedProfile.id, label: `${type} — ${selectedProfile.label}` });
                                                }}
                                                title={`Delete selected ${type}`}
                                                className="px-2 py-1 rounded-lg bg-surface border border-white/10 text-[10px] text-gray-400 hover:text-danger hover:border-danger/30 transition-colors"
                                            >
                                                <Trash2 className="w-3 h-3" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}

                        {/* Job-specific (still manual per campaign) */}
                    </div>

                    {/* Send Actions */}
                    <div className="space-y-2">
                        {/* Test Email First */}
                        <button
                            onClick={handleTestSend}
                            disabled={sending || !subject.trim() || !body.trim()}
                            className="w-full py-2.5 rounded-xl font-medium text-xs bg-surface border border-white/10 text-gray-300 hover:bg-white/5 hover:border-primary/30 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all"
                        >
                            <Eye className="w-3.5 h-3.5" />
                            Send Test to Me First
                        </button>

                        {/* Send to All Selected */}
                        <button
                            onClick={handleBulkSend}
                            disabled={sending || selectedLeadIds.size === 0 || !subject.trim() || !body.trim()}
                            className="w-full py-3.5 rounded-xl font-semibold text-sm bg-gradient-to-r from-primary to-blue-600 text-white shadow-lg shadow-primary/20 hover:shadow-primary/40 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all"
                        >
                            {sending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                            {sending ? 'Queuing...' : `Send to ${selectedLeadIds.size} Email${selectedLeadIds.size !== 1 ? 's' : ''}`}
                        </button>
                    </div>

                    {/* Reply-To Info */}
                    <div className="text-[10px] text-gray-600 text-center">
                        From: <span className="text-gray-400">jobs@vishwateja.online</span> • Reply-To: <span className="text-gray-400">reply@vishwateja.online</span>
                    </div>

                    {/* Test Email Preview Modal */}
                    {testPreview && (
                        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setTestPreview(null)}>
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="bg-surface border border-white/10 rounded-2xl p-6 w-full max-w-lg space-y-4"
                                onClick={e => e.stopPropagation()}
                            >
                                <div className="flex items-center justify-between">
                                    <h3 className="text-base font-bold flex items-center gap-2">
                                        <CheckCircle2 className="w-5 h-5 text-emerald-400" /> Test Email Sent
                                    </h3>
                                    <button onClick={() => setTestPreview(null)} className="text-gray-500 hover:text-white">✕</button>
                                </div>
                                <div className="bg-background rounded-xl p-4 space-y-2 border border-white/5">
                                    <p className="text-[10px] text-gray-500">TO: <span className="text-gray-300">{testPreview.to}</span></p>
                                    <p className="text-[10px] text-gray-500">SUBJECT: <span className="text-white font-medium">{testPreview.subject}</span></p>
                                    <hr className="border-white/5" />
                                    <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono leading-relaxed">{testPreview.body}</pre>
                                </div>
                                <p className="text-[11px] text-gray-400">Check your inbox. If it looks good, click "Send to {selectedLeadIds.size} Emails" to send to all selected leads.</p>
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => { setTestPreview(null); handleBulkSend(); }}
                                        disabled={selectedLeadIds.size === 0}
                                        className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-primary/20 hover:bg-primary/30 border border-primary/40 text-primary flex items-center justify-center gap-2 transition-all"
                                    >
                                        <Send className="w-4 h-4" /> Confirm & Send All
                                    </button>
                                    <button onClick={() => setTestPreview(null)} className="px-5 py-2.5 rounded-xl text-sm bg-surface border border-white/10 text-gray-300 hover:bg-white/5">
                                        Edit Template
                                    </button>
                                </div>
                            </motion.div>
                        </div>
                    )}
                </div>
            </div>

            {/* Delete Confirmation Modal */}
            {deleteConfirm && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setDeleteConfirm(null)}>
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-surface border border-danger/30 rounded-2xl p-6 max-w-sm w-full shadow-2xl"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-start gap-4 mb-5">
                            <div className="p-3 rounded-xl bg-danger/15 border border-danger/30">
                                <Trash2 className="w-5 h-5 text-danger" />
                            </div>
                            <div>
                                <h3 className="text-base font-bold text-white mb-1">Delete Asset</h3>
                                <p className="text-sm text-gray-400">
                                    Are you sure you want to delete <span className="text-white font-medium">"{deleteConfirm.label}"</span>? This cannot be undone.
                                </p>
                            </div>
                        </div>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setDeleteConfirm(null)}
                                className="px-4 py-2 rounded-xl text-sm font-medium bg-surface border border-white/10 text-gray-300 hover:bg-white/5 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={async () => {
                                    const { type, id } = deleteConfirm;
                                    try {
                                        if (type === 'resume') {
                                            await deleteResume(id);
                                            setSelectedResumeId('');
                                            setCampaignVars(prev => ({ ...prev, resume_link: '' }));
                                            const r = await getResumes();
                                            setResumes(r.data || []);
                                        } else {
                                            await deleteProfile(id);
                                            // Find which type this profile was
                                            const prof = profiles.find(p => p.id === id);
                                            if (prof) setCampaignVars(prev => ({ ...prev, [prof.type]: '' }));
                                            const r = await getProfiles();
                                            setProfiles(r.data || []);
                                        }
                                        toast.success('Deleted successfully');
                                    } catch {
                                        toast.error('Delete failed');
                                    }
                                    setDeleteConfirm(null);
                                }}
                                className="px-4 py-2 rounded-xl text-sm font-semibold bg-danger/20 hover:bg-danger/30 border border-danger/40 text-danger flex items-center gap-2 transition-all"
                            >
                                <Trash2 className="w-3.5 h-3.5" /> Delete
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}

            {/* Add Resume Modal */}
            {showAddResume && <AddResumeModal onClose={() => setShowAddResume(false)} onSaved={() => { setShowAddResume(false); getResumes().then(r => setResumes(r.data || [])); }} />}

            {/* Add Profile Modal */}
            {showAddProfile && <AddProfileModal type={showAddProfile} onClose={() => setShowAddProfile(false)} onSaved={() => { setShowAddProfile(false); getProfiles().then(r => setProfiles(r.data || [])); }} />}

            {/* Add Lead Modal */}
            {showAddLead && selectedSessionId && (
                <AddLeadModal
                    sessionId={selectedSessionId}
                    onClose={() => setShowAddLead(false)}
                    onSaved={() => {
                        setShowAddLead(false);
                        // Reload leads
                        getSessionLeads(selectedSessionId).then(res => setLeads(res.data || [])).catch(() => {});
                    }}
                />
            )}

            {/* Compose Email Modal */}
            {showCompose && <ComposeModal onClose={() => setShowCompose(false)} />}
        </div>
    );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function MiniStat({ label, value, color }) {
    return (
        <div className="glass-card p-3 text-center">
            <p className={clsx('text-xl font-bold', color)}>{value}</p>
            <p className="text-[9px] text-gray-500 uppercase tracking-wider mt-0.5">{label}</p>
        </div>
    );
}

function QueueControls({ queueStats, onRefresh }) {
    return (
        <div className="flex items-center gap-2">
            <span className={clsx('text-[10px] font-medium px-2 py-1 rounded-full',
                queueStats?.isRunning && !queueStats?.isPaused ? 'bg-success/15 text-success' :
                queueStats?.isPaused ? 'bg-warning/15 text-warning' : 'bg-gray-500/15 text-gray-400'
            )}>
                {queueStats?.isRunning ? (queueStats?.isPaused ? '⏸ Paused' : '● Running') : '○ Stopped'}
            </span>
            <button onClick={async () => { await startQueue(); onRefresh(); }} title="Start" className="p-1.5 rounded-lg hover:bg-success/10 text-gray-500 hover:text-success transition-colors">
                <Play className="w-3.5 h-3.5" />
            </button>
            <button onClick={async () => { await pauseQueue(); onRefresh(); }} title="Pause" className="p-1.5 rounded-lg hover:bg-warning/10 text-gray-500 hover:text-warning transition-colors">
                <Pause className="w-3.5 h-3.5" />
            </button>
            <button onClick={async () => { await resumeQueue(); onRefresh(); }} title="Resume" className="p-1.5 rounded-lg hover:bg-primary/10 text-gray-500 hover:text-primary transition-colors">
                <RefreshCw className="w-3.5 h-3.5" />
            </button>
        </div>
    );
}

function AddResumeModal({ onClose, onSaved }) {
    const [name, setName] = useState('');
    const [url, setUrl] = useState('');
    const [tags, setTags] = useState('');
    const [isDefault, setIsDefault] = useState(false);
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        if (!name.trim() || !url.trim()) return toast.error('Name and URL required');
        setSaving(true);
        try {
            await createResume({ name: name.trim(), url: url.trim(), tags: tags.trim() || null, isDefault });
            toast.success('Resume saved');
            onSaved();
        } catch (e) {
            toast.error(e.response?.data?.error || 'Failed to save');
        } finally { setSaving(false); }
    };

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-surface border border-white/10 rounded-2xl p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-bold">Add Resume</h3>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Resume name (e.g. SDE Resume)" className="w-full bg-background border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary/50" />
                <input value={url} onChange={e => setUrl(e.target.value)} placeholder="Resume URL (Google Drive, Dropbox, etc.)" className="w-full bg-background border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary/50" />
                <input value={tags} onChange={e => setTags(e.target.value)} placeholder="Tags (comma-separated, e.g. sde, fullstack)" className="w-full bg-background border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary/50" />
                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                    <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} />
                    Set as default resume
                </label>
                <div className="flex gap-3">
                    <button onClick={handleSave} disabled={saving} className="btn-primary flex-1 flex items-center justify-center gap-2">
                        {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                        {saving ? 'Saving...' : 'Save Resume'}
                    </button>
                    <button onClick={onClose} className="btn-secondary">Cancel</button>
                </div>
            </motion.div>
        </div>
    );
}

function AddProfileModal({ type, onClose, onSaved }) {
    const [label, setLabel] = useState('');
    const [url, setUrl] = useState('');
    const [isDefault, setIsDefault] = useState(true);
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        if (!url.trim()) return toast.error('URL required');
        setSaving(true);
        try {
            await createProfile({ type, label: label.trim() || `${type} profile`, url: url.trim(), isDefault });
            toast.success(`${type} profile saved`);
            onSaved();
        } catch (e) {
            toast.error(e.response?.data?.error || 'Failed to save');
        } finally { setSaving(false); }
    };

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-surface border border-white/10 rounded-2xl p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-bold capitalize">Add {type} Profile</h3>
                <input value={label} onChange={e => setLabel(e.target.value)} placeholder={`Label (e.g. Primary ${type})`} className="w-full bg-background border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary/50" />
                <input value={url} onChange={e => setUrl(e.target.value)} placeholder={`${type} URL`} className="w-full bg-background border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary/50" />
                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                    <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} />
                    Set as default
                </label>
                <div className="flex gap-3">
                    <button onClick={handleSave} disabled={saving} className="btn-primary flex-1 flex items-center justify-center gap-2">
                        {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                        {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button onClick={onClose} className="btn-secondary">Cancel</button>
                </div>
            </motion.div>
        </div>
    );
}

function AddLeadModal({ sessionId, onClose, onSaved }) {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [role, setRole] = useState('');
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        if (!email.trim()) return toast.error('Email is required');
        setSaving(true);
        try {
            const { default: axios } = await import('axios');
            const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';
            await axios.post(`${API}/api/add-lead`, {
                sessionId,
                fullName: name.trim() || email.split('@')[0].replace(/[._\-]/g, ' '),
                email: email.trim(),
                role: role.trim() || null,
            });
            toast.success('Lead added');
            onSaved();
        } catch (e) {
            toast.error(e.response?.data?.error || 'Failed to add lead');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-surface border border-white/10 rounded-2xl p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-bold">Add Lead</h3>
                <div className="space-y-3">
                    <div>
                        <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1 block">Name</label>
                        <input value={name} onChange={e => setName(e.target.value)} placeholder="John Smith" className="w-full bg-background border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary/50" />
                    </div>
                    <div>
                        <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1 block">Email *</label>
                        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="john@company.com" className="w-full bg-background border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary/50" />
                    </div>
                    <div>
                        <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1 block">Role (optional)</label>
                        <input value={role} onChange={e => setRole(e.target.value)} placeholder="HR Manager" className="w-full bg-background border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary/50" />
                    </div>
                </div>
                <div className="flex gap-3">
                    <button onClick={handleSave} disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-primary to-blue-600 text-white disabled:opacity-50 flex items-center justify-center gap-2 transition-all">
                        {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                        {saving ? 'Adding...' : 'Add'}
                    </button>
                    <button onClick={onClose} className="btn-secondary px-5">Cancel</button>
                </div>
            </motion.div>
        </div>
    );
}

function ComposeModal({ onClose }) {
    const [to, setTo] = useState('');
    const [cc, setCc] = useState('');
    const [bcc, setBcc] = useState('');
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [files, setFiles] = useState([]);
    const [showCcBcc, setShowCcBcc] = useState(false);
    const [sending, setSending] = useState(false);

    const handleFileAdd = (e) => {
        const newFiles = Array.from(e.target.files || []);
        setFiles(prev => [...prev, ...newFiles]);
    };

    const removeFile = (idx) => {
        setFiles(prev => prev.filter((_, i) => i !== idx));
    };

    const handleSend = async () => {
        if (!to.trim()) return toast.error('Recipient (To) is required');
        if (!subject.trim()) return toast.error('Subject is required');
        if (!body.trim()) return toast.error('Body is required');
        
        setSending(true);
        const tid = toast.loading('Sending email...');
        try {
            const formData = new FormData();
            formData.append('to', to.trim());
            if (cc.trim()) formData.append('cc', cc.trim());
            if (bcc.trim()) formData.append('bcc', bcc.trim());
            formData.append('subject', subject.trim());
            formData.append('body', body);
            files.forEach(f => formData.append('attachments', f));

            const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';
            const { default: axios } = await import('axios');
            await axios.post(`${API}/api/outreach/compose-send`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            
            toast.success('Email sent!', { id: tid });
            onClose();
        } catch (e) {
            toast.error(e.response?.data?.error || 'Failed to send', { id: tid });
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-background z-50 flex flex-col">
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex-1 flex flex-col max-w-4xl mx-auto w-full"
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
                    <h3 className="text-lg font-bold">Compose Email</h3>
                    <button onClick={onClose} className="text-gray-500 hover:text-white text-xl">✕</button>
                </div>

                {/* Fields */}
                <div className="px-6 py-3 space-y-3 border-b border-white/5">
                    <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-500 w-10">To</span>
                        <input value={to} onChange={e => setTo(e.target.value)} placeholder="recipient@email.com (comma-separated for multiple)" className="flex-1 bg-surface/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50" />
                        {!showCcBcc && <button onClick={() => setShowCcBcc(true)} className="text-xs text-gray-500 hover:text-primary">Cc/Bcc</button>}
                    </div>
                    {showCcBcc && (
                        <>
                            <div className="flex items-center gap-3">
                                <span className="text-xs text-gray-500 w-10">Cc</span>
                                <input value={cc} onChange={e => setCc(e.target.value)} placeholder="cc@email.com" className="flex-1 bg-surface/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50" />
                            </div>
                            <div className="flex items-center gap-3">
                                <span className="text-xs text-gray-500 w-10">Bcc</span>
                                <input value={bcc} onChange={e => setBcc(e.target.value)} placeholder="bcc@email.com" className="flex-1 bg-surface/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50" />
                            </div>
                        </>
                    )}
                    <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-500 w-10">Subject</span>
                        <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Email subject" className="flex-1 bg-surface/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-medium focus:outline-none focus:border-primary/50" />
                    </div>
                </div>

                {/* Body */}
                <div className="flex-1 px-6 py-4 overflow-y-auto">
                    <textarea
                        value={body}
                        onChange={e => setBody(e.target.value)}
                        placeholder="Write your email..."
                        className="w-full h-full min-h-[200px] bg-transparent text-sm text-white leading-relaxed focus:outline-none resize-none"
                    />
                </div>

                {/* Attachments */}
                {files.length > 0 && (
                    <div className="px-6 py-2 border-t border-white/5">
                        <div className="flex flex-wrap gap-2">
                            {files.map((f, i) => (
                                <div key={i} className="flex items-center gap-2 bg-surface/50 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-gray-300">
                                    <span className="truncate max-w-[200px]">{f.name}</span>
                                    <span className="text-gray-500">({(f.size / 1024).toFixed(0)}KB)</span>
                                    <button onClick={() => removeFile(i)} className="text-gray-500 hover:text-red-400 ml-1">✕</button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between px-6 py-4 border-t border-white/5">
                    <div className="flex items-center gap-3">
                        <label className="cursor-pointer flex items-center gap-2 text-gray-400 hover:text-primary transition-colors text-sm">
                            <input type="file" multiple onChange={handleFileAdd} className="hidden" />
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                            Attach files
                        </label>
                    </div>
                    <div className="flex items-center gap-3">
                        <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-gray-400 hover:text-white transition-colors">Discard</button>
                        <button
                            onClick={handleSend}
                            disabled={sending}
                            className="px-6 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-primary to-blue-600 text-white disabled:opacity-50 flex items-center gap-2 transition-all hover:shadow-lg hover:shadow-primary/20"
                        >
                            {sending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                            {sending ? 'Sending...' : 'Send Email'}
                        </button>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}
