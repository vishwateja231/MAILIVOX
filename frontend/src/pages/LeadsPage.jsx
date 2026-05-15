import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Download, RefreshCw, Copy, CheckCircle2, AlertTriangle, XCircle, Clock, ChevronDown, Filter, ExternalLink, Send, Trash2, Mail, Pencil } from 'lucide-react';
import { getLeads, exportLeads, deleteLead, bulkDeleteLeads, patchLeadStatus, validateAllEmails, updateLead } from '../api';
import clsx from 'clsx';
import { motion } from 'framer-motion';
import { toast } from 'sonner';

const STATUS_CONFIG = {
    VALID: { label: 'Verified', color: 'text-emerald-300', bg: 'bg-emerald-500/15', border: 'border-emerald-500/40' },
    INVALID: { label: 'Invalid', color: 'text-red-300', bg: 'bg-red-500/15', border: 'border-red-500/40' },
    RISKY: { label: 'Risky', color: 'text-amber-300', bg: 'bg-amber-500/15', border: 'border-amber-500/40' },
    CATCH_ALL: { label: 'Catch-All', color: 'text-orange-300', bg: 'bg-orange-500/15', border: 'border-orange-500/40' },
    PENDING: { label: 'Pending', color: 'text-slate-300', bg: 'bg-slate-500/15', border: 'border-slate-500/40' },
    NOT_VERIFIED: { label: 'Pending', color: 'text-slate-300', bg: 'bg-slate-500/15', border: 'border-slate-500/40' },
};

const CONFIDENCE_CONFIG = {
    HIGH: { color: 'text-emerald-300', bg: 'bg-emerald-500/15', border: 'border-emerald-500/30' },
    MEDIUM: { color: 'text-blue-300', bg: 'bg-blue-500/15', border: 'border-blue-500/30' },
    LOW: { color: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/30' },
};

function StatusBadge({ status }) {
    const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.PENDING;
    return (
        <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border', cfg.color, cfg.bg, cfg.border)}>
            {cfg.label}
        </span>
    );
}

function ConfidenceBadge({ confidence }) {
    const cfg = CONFIDENCE_CONFIG[confidence] || CONFIDENCE_CONFIG.LOW;
    return (
        <span className={clsx('inline-flex px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border', cfg.color, cfg.bg, cfg.border)}>
            {confidence}
        </span>
    );
}

export default function LeadsPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const [data, setData] = useState([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [pageSize] = useState(50);
    const [search, setSearch] = useState(searchParams.get('search') || '');
    const [selectedIds, setSelectedIds] = useState(new Set());

    const [sessionFilter_unused, _setSessionFilter_unused] = [null, null]; // placeholder
    const sessionFilter = searchParams.get('sessionId') || '';
    const [statusFilter, setStatusFilter] = useState('ALL');
    const [deleteTarget, setDeleteTarget] = useState(null); // { type: 'single'|'bulk', ids: [] }
    const [deleting, setDeleting] = useState(false);
    const [editLead, setEditLead] = useState(null); // lead object to edit
    const [emailsPerLead, setEmailsPerLead] = useState(1); // 1, 3, or 'all'

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = { page, limit: pageSize, search };
            if (sessionFilter) params.sessionId = sessionFilter;
            const res = await getLeads(params);
            let leads = res.data.leads || [];

            // Client-side status filter (fast, avoids extra API params)
            if (statusFilter !== 'ALL') {
                leads = leads.filter(l => {
                    const topStatus = l.emails?.[0]?.verificationStatus || 'PENDING';
                    if (statusFilter === 'VERIFIED') return topStatus === 'VALID';
                    if (statusFilter === 'PENDING') return topStatus === 'PENDING' || topStatus === 'NOT_VERIFIED';
                    if (statusFilter === 'INVALID') return topStatus === 'INVALID';
                    if (statusFilter === 'CONTACTED') return l.status?.outreachSent;
                    return true;
                });
            }

            setData(leads);
            setTotal(res.data.total || 0);
        } catch (e) {
            toast.error('Failed to load leads');
        } finally {
            setLoading(false);
        }
    }, [page, pageSize, search, sessionFilter, statusFilter]);

    useEffect(() => { load(); }, [load]);

    const handleExport = async (format) => {
        const tid = toast.loading(`Exporting ${format.toUpperCase()}...`);
        try {
            const res = await exportLeads(format);
            const url = URL.createObjectURL(res.data);
            const a = document.createElement('a');
            a.href = url;
            a.download = `leads.${format}`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success('Export complete', { id: tid });
        } catch (e) {
            toast.error('Export failed', { id: tid });
        }
    };

    const copyEmail = (email) => {
        navigator.clipboard.writeText(email);
        toast.success('Copied to clipboard');
    };

    const handleDelete = (id) => {
        setDeleteTarget({ type: 'single', ids: [id] });
    };

    const handleBulkDelete = () => {
        if (selectedIds.size === 0) return;
        setDeleteTarget({ type: 'bulk', ids: Array.from(selectedIds) });
    };

    const confirmDelete = async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        const tid = toast.loading(deleteTarget.ids.length > 1 ? `Deleting ${deleteTarget.ids.length} leads...` : 'Deleting lead...');
        try {
            if (deleteTarget.ids.length === 1) {
                await deleteLead(deleteTarget.ids[0]);
            } else {
                await bulkDeleteLeads(deleteTarget.ids);
            }
            // Optimistic update: remove from current view
            setData(prev => prev.filter(l => !deleteTarget.ids.includes(l.id)));
            setSelectedIds(new Set());
            setDeleteTarget(null);
            toast.success(deleteTarget.ids.length > 1 ? `Deleted ${deleteTarget.ids.length} leads` : 'Lead deleted', { id: tid });
            // Reload to sync totals
            load();
        } catch (e) {
            toast.error(e.response?.data?.error || 'Delete failed', { id: tid });
        } finally {
            setDeleting(false);
        }
    };

    const handleMarkContacted = async (id) => {
        try {
            await patchLeadStatus(id, { outreachSent: true });
            toast.success('Marked as contacted');
            load();
        } catch { toast.error('Update failed'); }
    };

    const toggleSelect = (id) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleAll = () => {
        if (selectedIds.size === data.length) setSelectedIds(new Set());
        else setSelectedIds(new Set(data.map(d => d.id)));
    };

    const clearSessionFilter = () => {
        searchParams.delete('sessionId');
        setSearchParams(searchParams);
    };

    const totalPages = Math.ceil(total / pageSize);

    return (
        <div className="space-y-5 h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Contacts</h1>
                    <p className="text-gray-400 text-sm mt-1">
                        {total.toLocaleString()} leads
                        {sessionFilter && <span className="text-primary ml-2">• Filtered by session</span>}
                    </p>
                </div>
                <div className="flex gap-2">
                    {sessionFilter && (
                        <button onClick={clearSessionFilter} className="btn-secondary text-xs flex items-center gap-1">
                            <XCircle className="w-3.5 h-3.5" /> Clear Filter
                        </button>
                    )}
                    <button
                        onClick={async () => {
                            const tid = toast.loading('Force validating all emails...');
                            try {
                                const res = await validateAllEmails(true);
                                toast.success(res.data.message || 'Validation started', { id: tid });
                            } catch (e) {
                                toast.error(e.response?.data?.error || 'Validation failed', { id: tid });
                            }
                        }}
                        className="btn-secondary flex items-center gap-2 text-xs"
                        title="Reset all emails to PENDING and re-validate with SMTP"
                    >
                        <CheckCircle2 className="w-4 h-4" /> Force Validate
                    </button>
                    <div className="relative group">
                        <button className="btn-secondary flex items-center gap-2">
                            <Download className="w-4 h-4" /> Export <ChevronDown className="w-3 h-3" />
                        </button>
                        <div className="absolute right-0 top-full mt-1 bg-surface border border-white/10 rounded-xl shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 min-w-[140px]">
                            <button onClick={() => handleExport('csv')} className="w-full text-left px-4 py-2 text-sm hover:bg-white/5 rounded-t-xl">CSV</button>
                            <button onClick={() => handleExport('xlsx')} className="w-full text-left px-4 py-2 text-sm hover:bg-white/5">Excel</button>
                            <button onClick={() => handleExport('json')} className="w-full text-left px-4 py-2 text-sm hover:bg-white/5 rounded-b-xl">JSON</button>
                        </div>
                    </div>
                    <button onClick={load} className="btn-primary p-2.5 rounded-xl">
                        <RefreshCw className={clsx("w-4 h-4", loading && "animate-spin")} />
                    </button>
                </div>
            </div>

            {/* Search + Filter Tabs */}
            <div className="space-y-3">
                <div className="flex gap-3">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                        <input
                            type="text"
                            placeholder="Search by name, company, role..."
                            value={search}
                            onChange={e => { setSearch(e.target.value); setPage(1); }}
                            className="w-full bg-surface/50 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all"
                        />
                    </div>
                    {selectedIds.size > 0 && (
                        <div className="flex items-center gap-3">
                            <span className="text-xs text-gray-400">{selectedIds.size} selected</span>
                            <button
                                onClick={handleBulkDelete}
                                title={`Delete ${selectedIds.size} selected leads`}
                                className="p-2 rounded-lg bg-danger/10 hover:bg-danger/20 border border-danger/30 text-danger transition-all flex items-center gap-2 text-xs font-medium"
                            >
                                <Trash2 className="w-4 h-4" />
                                Delete {selectedIds.size}
                            </button>
                            <button
                                onClick={() => setSelectedIds(new Set())}
                                className="text-xs text-gray-500 hover:text-white transition-colors"
                            >
                                Clear selection
                            </button>
                        </div>
                    )}
                </div>
                {/* Filter Tabs */}
                <div className="flex items-center justify-between">
                    <div className="flex gap-1 bg-surface/30 p-1 rounded-xl w-fit border border-white/5">
                        {['ALL', 'PENDING', 'VERIFIED', 'INVALID', 'CONTACTED'].map(tab => (
                            <button
                                key={tab}
                                onClick={() => { setStatusFilter(tab); setPage(1); }}
                                className={clsx(
                                    'px-4 py-1.5 rounded-lg text-xs font-medium transition-all',
                                    statusFilter === tab
                                        ? 'bg-primary/20 text-primary border border-primary/30'
                                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                                )}
                            >
                                {tab === 'ALL' ? 'All Leads' : tab.charAt(0) + tab.slice(1).toLowerCase()}
                            </button>
                        ))}
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-500">Emails:</span>
                        <div className="flex gap-0.5 bg-surface/30 p-0.5 rounded-lg border border-white/5">
                            {[{v: 1, l: 'Top 1'}, {v: 3, l: 'Top 3'}, {v: 999, l: 'All'}].map(opt => (
                                <button
                                    key={opt.v}
                                    onClick={() => setEmailsPerLead(opt.v)}
                                    className={clsx(
                                        'px-2.5 py-1 rounded text-[10px] font-medium transition-all',
                                        emailsPerLead === opt.v
                                            ? 'bg-primary/20 text-primary'
                                            : 'text-gray-500 hover:text-white'
                                    )}
                                >
                                    {opt.l}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Table */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-panel rounded-2xl flex-1 flex flex-col overflow-hidden border border-white/5">
                <div className="overflow-auto flex-1 custom-scrollbar">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 z-10">
                            <tr className="bg-surface/80 backdrop-blur-md border-b border-white/10 text-[11px] uppercase tracking-wider text-gray-400">
                                <th className="px-4 py-3 text-left w-10">
                                    <input type="checkbox" checked={selectedIds.size === data.length && data.length > 0} onChange={toggleAll} className="rounded bg-black border-white/20 text-primary focus:ring-primary/30" />
                                </th>
                                <th className="px-4 py-3 text-left">Name</th>
                                <th className="px-4 py-3 text-left">Company</th>
                                <th className="px-4 py-3 text-left">Role</th>
                                <th className="px-4 py-3 text-left">Emails</th>
                                <th className="px-4 py-3 text-left">Status</th>
                                <th className="px-4 py-3 text-left">Confidence</th>
                                <th className="px-4 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {loading && data.length === 0 ? (
                                <tr><td colSpan={8} className="text-center py-16 text-gray-500">Loading...</td></tr>
                            ) : data.length === 0 ? (
                                <tr><td colSpan={8} className="text-center py-16 text-gray-500">No leads found. Run the Intelligence Engine to extract profiles.</td></tr>
                            ) : (
                                data.map((lead, idx) => {
                                    const allEmails = lead.emails || [];
                                    const topEmail = allEmails[0];
                                    const isSelected = selectedIds.has(lead.id);
                                    return (
                                        <tr key={lead.id} className={clsx(
                                            'transition-colors',
                                            isSelected ? 'bg-primary/5' : idx % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.02]',
                                            'hover:bg-white/[0.04]'
                                        )}>
                                            <td className="px-4 py-3">
                                                <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(lead.id)} className="rounded bg-black border-white/20 text-primary focus:ring-primary/30" />
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="font-semibold text-white">{lead.fullName}</span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="text-primary font-medium text-xs">{lead.company?.companyName || '—'}</div>
                                                <div className="text-[10px] text-gray-500">{lead.company?.domain || ''}</div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="text-gray-300 text-xs">{lead.role || '—'}</span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <EmailCell emails={allEmails} limit={emailsPerLead} onCopy={copyEmail} />
                                            </td>
                                            <td className="px-4 py-3">
                                                {topEmail && <StatusBadge status={topEmail.verificationStatus} />}
                                            </td>
                                            <td className="px-4 py-3">
                                                {topEmail && <ConfidenceBadge confidence={topEmail.confidence} />}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center justify-end gap-1">
                                                    {topEmail && (
                                                        <button onClick={() => copyEmail(topEmail.email)} title="Copy email" className="p-1.5 rounded-lg hover:bg-white/10 text-gray-500 hover:text-white transition-colors">
                                                            <Mail className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                    {lead.linkedinUrl && (
                                                        <a href={lead.linkedinUrl} target="_blank" rel="noreferrer" title="Open LinkedIn" className="p-1.5 rounded-lg hover:bg-white/10 text-gray-500 hover:text-primary transition-colors">
                                                            <ExternalLink className="w-3.5 h-3.5" />
                                                        </a>
                                                    )}
                                                    <button onClick={() => handleMarkContacted(lead.id)} title="Mark contacted" className="p-1.5 rounded-lg hover:bg-white/10 text-gray-500 hover:text-success transition-colors">
                                                        <Send className="w-3.5 h-3.5" />
                                                    </button>
                                                    <button
                                                        onClick={() => setEditLead(lead)}
                                                        title="Edit lead"
                                                        className="p-1.5 rounded-lg hover:bg-white/10 text-gray-500 hover:text-primary transition-colors"
                                                    >
                                                        <Pencil className="w-3.5 h-3.5" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(lead.id)}
                                                        title="Delete lead"
                                                        className="p-1.5 rounded-lg text-gray-500 hover:text-danger hover:bg-danger/10 border border-transparent hover:border-danger/30 transition-all"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="px-4 py-3 border-t border-white/5 bg-surface/30 flex items-center justify-between text-xs text-gray-400">
                        <span>Page {page} of {totalPages} ({total} total)</span>
                        <div className="flex gap-1">
                            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 rounded bg-white/5 hover:bg-white/10 disabled:opacity-30 transition-colors">Prev</button>
                            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1 rounded bg-white/5 hover:bg-white/10 disabled:opacity-30 transition-colors">Next</button>
                        </div>
                    </div>
                )}
            </motion.div>

            {/* Delete Confirmation Modal */}
            {deleteTarget && (
                <div
                    className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
                    onClick={() => !deleting && setDeleteTarget(null)}
                >
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-surface border border-danger/30 rounded-2xl p-6 max-w-md w-full shadow-2xl"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-start gap-4 mb-6">
                            <div className="p-3 rounded-xl bg-danger/15 border border-danger/30">
                                <Trash2 className="w-6 h-6 text-danger" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white mb-1">
                                    {deleteTarget.ids.length > 1
                                        ? `Delete ${deleteTarget.ids.length} leads?`
                                        : 'Delete this lead?'}
                                </h3>
                                <p className="text-sm text-gray-400">
                                    This will permanently remove {deleteTarget.ids.length > 1 ? 'these leads' : 'this lead'} and all associated emails. This action cannot be undone.
                                </p>
                            </div>
                        </div>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setDeleteTarget(null)}
                                disabled={deleting}
                                className="btn-secondary px-5 py-2 text-sm disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmDelete}
                                disabled={deleting}
                                className="px-5 py-2 rounded-xl text-sm font-semibold bg-danger/20 hover:bg-danger/30 border border-danger/40 text-danger disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all"
                            >
                                {deleting ? (
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Trash2 className="w-4 h-4" />
                                )}
                                {deleting ? 'Deleting...' : 'Delete'}
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}

            {/* Edit Lead Modal */}
            {editLead && (
                <EditLeadModal
                    lead={editLead}
                    onClose={() => setEditLead(null)}
                    onSaved={() => { setEditLead(null); load(); }}
                />
            )}
        </div>
    );
}

function EditLeadModal({ lead, onClose, onSaved }) {
    const [fullName, setFullName] = useState(lead.fullName || '');
    const [role, setRole] = useState(lead.role || '');
    const [companyName, setCompanyName] = useState(lead.company?.companyName || '');
    const [domain, setDomain] = useState(lead.company?.domain || '');
    const [location, setLocation] = useState(lead.location || '');
    const [linkedinUrl, setLinkedinUrl] = useState(lead.linkedinUrl || '');
    const [emails, setEmails] = useState((lead.emails || []).map(e => ({ ...e, edited: false })));
    const [newEmail, setNewEmail] = useState('');
    const [regenerate, setRegenerate] = useState(false);
    const [saving, setSaving] = useState(false);

    const handleAddEmail = () => {
        if (!newEmail.trim() || !newEmail.includes('@')) return;
        setEmails(prev => [...prev, { email: newEmail.trim(), pattern: 'MANUAL', confidence: 'HIGH', verificationStatus: 'VALID', isNew: true }]);
        setNewEmail('');
    };

    const handleRemoveEmail = (idx) => {
        setEmails(prev => prev.filter((_, i) => i !== idx));
    };

    const handleEditEmail = (idx, value) => {
        setEmails(prev => prev.map((e, i) => i === idx ? { ...e, email: value, edited: true } : e));
    };

    const handleSave = async () => {
        if (!fullName.trim()) return toast.error('Name is required');
        setSaving(true);
        try {
            await updateLead(lead.id, {
                fullName: fullName.trim(),
                role: role.trim() || null,
                companyName: companyName.trim() || null,
                domain: domain.trim() || null,
                location: location.trim() || null,
                linkedinUrl: linkedinUrl.trim() || null,
                regenerateEmails: regenerate,
                emails: emails.filter(e => e.isNew), // Send only new emails to be added
            });
            toast.success('Lead updated');
            onSaved();
        } catch (e) {
            toast.error(e.response?.data?.error || 'Update failed');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-surface border border-white/10 rounded-2xl p-6 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto custom-scrollbar"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold">Edit Lead</h3>
                    <button onClick={onClose} className="text-gray-500 hover:text-white"><XCircle className="w-5 h-5" /></button>
                </div>

                <div className="space-y-3">
                    <div>
                        <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1 block">Full Name</label>
                        <input value={fullName} onChange={e => setFullName(e.target.value)} className="w-full bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1 block">Company</label>
                            <input value={companyName} onChange={e => setCompanyName(e.target.value)} className="w-full bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50" />
                        </div>
                        <div>
                            <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1 block">Domain</label>
                            <input value={domain} onChange={e => setDomain(e.target.value)} placeholder="e.g. apple.com" className="w-full bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50" />
                        </div>
                    </div>
                    <div>
                        <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1 block">Role / Title</label>
                        <input value={role} onChange={e => setRole(e.target.value)} className="w-full bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50" />
                    </div>
                    <div>
                        <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1 block">Location</label>
                        <input value={location} onChange={e => setLocation(e.target.value)} className="w-full bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50" />
                    </div>
                    <div>
                        <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1 block">LinkedIn URL</label>
                        <input value={linkedinUrl} onChange={e => setLinkedinUrl(e.target.value)} className="w-full bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50" />
                    </div>

                    {/* Emails Section */}
                    <div>
                        <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-2 block">Emails ({emails.length})</label>
                        <div className="space-y-1.5 max-h-[150px] overflow-y-auto custom-scrollbar">
                            {emails.map((em, i) => (
                                <div key={i} className="flex items-center gap-2">
                                    <input
                                        value={em.email}
                                        onChange={e => handleEditEmail(i, e.target.value)}
                                        className="flex-1 bg-background border border-white/10 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-primary/50"
                                    />
                                    <span className={clsx('text-[8px] uppercase font-bold px-1.5 py-0.5 rounded shrink-0',
                                        em.verificationStatus === 'VALID' ? 'text-emerald-400 bg-emerald-500/10' :
                                        em.confidence === 'HIGH' ? 'text-emerald-400 bg-emerald-500/10' :
                                        em.confidence === 'MEDIUM' ? 'text-blue-400 bg-blue-500/10' :
                                        'text-gray-500 bg-gray-500/10'
                                    )}>{em.verificationStatus === 'VALID' ? '✓' : em.confidence?.[0] || 'P'}</span>
                                    <button onClick={() => handleRemoveEmail(i)} className="text-gray-500 hover:text-red-400 shrink-0">
                                        <XCircle className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            ))}
                        </div>
                        <div className="flex gap-2 mt-2">
                            <input
                                value={newEmail}
                                onChange={e => setNewEmail(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleAddEmail()}
                                placeholder="Add email manually..."
                                className="flex-1 bg-background border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-primary/50"
                            />
                            <button onClick={handleAddEmail} className="px-3 py-1.5 rounded-lg text-[10px] font-medium bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20">Add</button>
                        </div>
                    </div>

                    <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer pt-1">
                        <input type="checkbox" checked={regenerate} onChange={e => setRegenerate(e.target.checked)} className="rounded bg-black border-white/20 text-primary focus:ring-primary/30" />
                        Regenerate all email permutations (replaces current)
                    </label>
                </div>

                <div className="flex gap-3 pt-2">
                    <button onClick={handleSave} disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-primary/20 hover:bg-primary/30 border border-primary/40 text-primary disabled:opacity-50 flex items-center justify-center gap-2 transition-all">
                        {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                        {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                    <button onClick={onClose} className="btn-secondary px-5 py-2.5 text-sm">Cancel</button>
                </div>
            </motion.div>
        </div>
    );
}

function EmailCell({ emails, limit, onCopy }) {
    if (!emails || emails.length === 0) return <span className="text-gray-600 text-xs">—</span>;

    const shown = limit >= 999 ? emails : emails.slice(0, limit);
    const remaining = emails.length - shown.length;

    return (
        <div className="space-y-1">
            {shown.map((em, i) => (
                <div key={i} className="flex items-center gap-1.5 group">
                    <span className="font-mono text-[11px] text-gray-200">{em.email}</span>
                    <span className={clsx('text-[8px] uppercase font-bold px-1 py-0.5 rounded',
                        em.verificationStatus === 'VALID' ? 'text-emerald-400 bg-emerald-500/10' :
                        em.confidence === 'HIGH' ? 'text-emerald-400 bg-emerald-500/10' :
                        em.confidence === 'MEDIUM' ? 'text-blue-400 bg-blue-500/10' :
                        'text-gray-500 bg-gray-500/10'
                    )}>{em.verificationStatus === 'VALID' ? '✓' : em.confidence?.[0] || 'P'}</span>
                    <button onClick={(e) => { e.stopPropagation(); onCopy(em.email); }} className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-primary transition-all">
                        <Copy className="w-3 h-3" />
                    </button>
                </div>
            ))}
            {remaining > 0 && (
                <p className="text-[9px] text-gray-600">+{remaining} more</p>
            )}
        </div>
    );
}

function EmailDropdown({ emails, onCopy }) {
    const [open, setOpen] = useState(false);
    if (!emails || emails.length === 0) return <span className="text-gray-600 text-xs">—</span>;

    const topEmail = emails[0];
    const hasMore = emails.length > 1;

    return (
        <div className="relative">
            <div className="flex items-center gap-1.5 group">
                <span className="font-mono text-xs text-gray-200 tracking-wide">{topEmail.email}</span>
                <button onClick={(e) => { e.stopPropagation(); onCopy(topEmail.email); }} className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-primary transition-all">
                    <Copy className="w-3 h-3" />
                </button>
                {hasMore && (
                    <button
                        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
                        className="text-[9px] text-primary hover:text-white bg-primary/10 px-1.5 py-0.5 rounded font-medium transition-colors"
                    >
                        +{emails.length - 1}
                    </button>
                )}
            </div>
            {open && hasMore && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                    <div className="absolute top-full left-0 mt-1 bg-surface border border-white/10 rounded-lg shadow-xl z-50 py-1 min-w-[220px]">
                        {emails.slice(1).map((em, i) => (
                            <div key={i} className="flex items-center justify-between px-3 py-1.5 hover:bg-white/5 group">
                                <span className="font-mono text-[11px] text-gray-300">{em.email}</span>
                                <div className="flex items-center gap-1.5">
                                    <span className={clsx('text-[8px] uppercase font-bold',
                                        em.verificationStatus === 'VALID' ? 'text-emerald-400' : 'text-gray-500'
                                    )}>{em.verificationStatus === 'VALID' ? '✓' : em.confidence}</span>
                                    <button onClick={(e) => { e.stopPropagation(); onCopy(em.email); }} className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-primary transition-all">
                                        <Copy className="w-3 h-3" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
