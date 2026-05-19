import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSessions, deleteSession, bulkDeleteSessions, archiveSession, renameSession, stopAllExtensionActivity } from '../api';
import { Layers, Calendar, Users, Mail, Database, ChevronRight, Trash2, Archive, RotateCcw, Pencil, Check, X, OctagonX, CheckSquare, Square } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import clsx from 'clsx';

export default function SessionsPage() {
    const navigate = useNavigate();
    const [sessions, setSessions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState('active');
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [editingId, setEditingId] = useState(null);
    const [editValue, setEditValue] = useState('');
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);

    const load = () => {
        setLoading(true);
        getSessions({ archived: tab === 'archived' ? 'true' : 'false' })
            .then(res => setSessions(res.data))
            .finally(() => setLoading(false));
    };

    useEffect(() => { load(); setSelectedIds(new Set()); }, [tab]);

    const startEdit = (id, currentName) => {
        setEditingId(id);
        setEditValue(currentName);
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditValue('');
    };

    const saveEdit = async () => {
        if (!editingId || !editValue.trim()) {
            cancelEdit();
            return;
        }
        try {
            const res = await renameSession(editingId, editValue.trim());
            setSessions(prev => prev.map(s => s.id === editingId ? { ...s, sessionName: res.data.sessionName } : s));
            toast.success('Session renamed');
            cancelEdit();
        } catch (e) {
            toast.error(e.response?.data?.error || 'Rename failed');
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        try {
            await deleteSession(deleteTarget.id);
            toast.success(`Session "${deleteTarget.name}" deleted`);
            setSessions(prev => prev.filter(s => s.id !== deleteTarget.id));
        } catch (e) {
            toast.error(e.response?.data?.error || 'Delete failed');
        }
        setDeleteTarget(null);
    };

    const handleArchive = async (id, name) => {
        try {
            await archiveSession(id, true);
            toast.success(`"${name}" archived`);
            setSessions(prev => prev.filter(s => s.id !== id));
        } catch (e) {
            toast.error(e.response?.data?.error || 'Archive failed');
        }
    };

    const handleUnarchive = async (id, name) => {
        try {
            await archiveSession(id, false);
            toast.success(`"${name}" restored`);
            setSessions(prev => prev.filter(s => s.id !== id));
        } catch (e) {
            toast.error(e.response?.data?.error || 'Restore failed');
        }
    };

    const toggleSelect = (id) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === sessions.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(sessions.map(s => s.id)));
        }
    };

    const handleBulkDelete = async () => {
        if (selectedIds.size === 0) return;
        try {
            await bulkDeleteSessions([...selectedIds]);
            toast.success(`${selectedIds.size} session${selectedIds.size > 1 ? 's' : ''} deleted`);
            setSessions(prev => prev.filter(s => !selectedIds.has(s.id)));
            setSelectedIds(new Set());
        } catch (e) {
            toast.error(e.response?.data?.error || 'Bulk delete failed');
        }
        setBulkDeleteConfirm(false);
    };

    return (
        <div className="space-y-6 max-w-5xl mx-auto">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Pipelines</h1>
                    <p className="text-gray-400 text-sm mt-1">History of all outreach intelligence runs.</p>
                </div>
                <button
                    onClick={async () => {
                        try {
                            await stopAllExtensionActivity();
                            toast.success('All processes stopped');
                            load();
                        } catch {
                            toast.error('Failed to stop');
                        }
                    }}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border-2 border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/25 transition-all"
                >
                    <OctagonX className="w-4 h-4" />
                    Stop All
                </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-surface/30 p-1 rounded-xl w-fit border border-white/5">
                <button
                    onClick={() => setTab('active')}
                    className={clsx('px-5 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-2',
                        tab === 'active' ? 'bg-primary/20 text-primary border border-primary/30' : 'text-gray-400 hover:text-white hover:bg-white/5'
                    )}
                >
                    <Layers className="w-3.5 h-3.5" /> Active
                </button>
                <button
                    onClick={() => setTab('archived')}
                    className={clsx('px-5 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-2',
                        tab === 'archived' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'text-gray-400 hover:text-white hover:bg-white/5'
                    )}
                >
                    <Archive className="w-3.5 h-3.5" /> Archived
                </button>
            </div>

            <div className="space-y-4 relative">
                {/* Bulk selection toolbar */}
                {sessions.length > 0 && !loading && (
                    <div className="flex items-center gap-3 pl-16 pr-4">
                        <button
                            onClick={toggleSelectAll}
                            className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
                            title={selectedIds.size === sessions.length ? 'Deselect all' : 'Select all'}
                        >
                            {selectedIds.size === sessions.length && sessions.length > 0 ? (
                                <CheckSquare className="w-4 h-4 text-primary" />
                            ) : (
                                <Square className="w-4 h-4" />
                            )}
                            <span>{selectedIds.size === sessions.length && sessions.length > 0 ? 'Deselect All' : 'Select All'}</span>
                        </button>
                        {selectedIds.size > 0 && (
                            <div className="flex items-center gap-3 ml-auto">
                                <span className="text-xs text-gray-400">{selectedIds.size} selected</span>
                                <button
                                    onClick={() => setBulkDeleteConfirm(true)}
                                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/25 transition-all"
                                >
                                    <Trash2 className="w-4 h-4" />
                                    Delete Selected ({selectedIds.size})
                                </button>
                            </div>
                        )}
                    </div>
                )}
                <div className="absolute left-6 top-4 bottom-4 w-px bg-white/10" />
                {loading ? (
                    <div className="text-center py-10 text-gray-500">Loading sessions...</div>
                ) : sessions.length === 0 ? (
                    <div className="text-center py-16 text-gray-500">
                        <Layers className="w-10 h-10 mx-auto mb-3 opacity-40" />
                        <p>{tab === 'archived' ? 'No archived sessions.' : 'No active sessions. Run the Intelligence Engine to create one.'}</p>
                    </div>
                ) : (
                    sessions.map((s, i) => (
                        <motion.div
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.04 }}
                            key={s.id}
                            className="relative pl-16 pr-4"
                        >
                        <button
                                onClick={(e) => { e.stopPropagation(); toggleSelect(s.id); }}
                                className="absolute left-[14px] top-5 z-10"
                                title="Select session"
                            >
                                {selectedIds.has(s.id) ? (
                                    <CheckSquare className="w-5 h-5 text-primary" />
                                ) : (
                                    <Square className="w-5 h-5 text-gray-600 hover:text-gray-400 transition-colors" />
                                )}
                            </button>
                            <div className={clsx("glass-card p-6 flex flex-col md:flex-row gap-4 justify-between items-start md:items-center hover:bg-surface/50 hover:border-primary/20 transition-all group",
                                selectedIds.has(s.id) && 'border-primary/30 bg-primary/5'
                            )}>
                                {/* Clickable main area */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-3 mb-2">
                                        <Layers className={clsx("w-5 h-5 shrink-0", tab === 'archived' ? 'text-amber-500' : 'text-primary')} />
                                        {editingId === s.id ? (
                                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                                <input
                                                    type="text"
                                                    value={editValue}
                                                    onChange={e => setEditValue(e.target.value)}
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter') saveEdit();
                                                        if (e.key === 'Escape') cancelEdit();
                                                    }}
                                                    autoFocus
                                                    className="flex-1 bg-background border border-primary/40 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-primary"
                                                />
                                                <button
                                                    onClick={saveEdit}
                                                    className="p-1.5 rounded-lg text-emerald-400 hover:bg-emerald-500/10"
                                                    title="Save"
                                                >
                                                    <Check className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={cancelEdit}
                                                    className="p-1.5 rounded-lg text-gray-400 hover:bg-white/10"
                                                    title="Cancel"
                                                >
                                                    <X className="w-4 h-4" />
                                                </button>
                                            </div>
                                        ) : (
                                            <>
                                                <h3
                                                    onClick={() => navigate(`/leads?sessionId=${s.id}`)}
                                                    className="text-lg font-bold text-white truncate hover:text-primary transition-colors cursor-pointer"
                                                >
                                                    {s.sessionName}
                                                </h3>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); startEdit(s.id, s.sessionName); }}
                                                    title="Rename session"
                                                    className="p-1 rounded text-gray-500 hover:text-primary hover:bg-primary/10 opacity-0 group-hover:opacity-100 transition-all"
                                                >
                                                    <Pencil className="w-3.5 h-3.5" />
                                                </button>
                                                {tab === 'archived' && (
                                                    <span className="text-[9px] uppercase font-semibold px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">Archived</span>
                                                )}
                                            </>
                                        )}
                                    </div>
                                    <p className="text-sm text-gray-500 flex items-center gap-2">
                                        <Calendar className="w-4 h-4" /> {new Date(s.createdAt).toLocaleString()}
                                    </p>
                                </div>

                                {/* Stats */}
                                <div className="flex items-center gap-6">
                                    <div className="flex flex-col items-center">
                                        <span className="text-xs text-gray-500 uppercase tracking-wide flex items-center gap-1"><Users className="w-3 h-3" /> Profiles</span>
                                        <span className="text-xl font-semibold mt-1">{s._count?.leads || s.totalProfiles || 0}</span>
                                    </div>
                                    <div className="flex flex-col items-center">
                                        <span className="text-xs text-gray-500 uppercase tracking-wide flex items-center gap-1"><Mail className="w-3 h-3" /> Emails</span>
                                        <span className="text-xl font-semibold mt-1 text-primary">{s.totalEmails || 0}</span>
                                    </div>
                                    <div className="flex flex-col items-center">
                                        <span className="text-xs text-gray-500 uppercase tracking-wide flex items-center gap-1"><Database className="w-3 h-3" /> Exports</span>
                                        <span className="text-xl font-semibold mt-1 text-emerald-400">{s._count?.exports || 0}</span>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex items-center gap-1 ml-2">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); navigate(`/leads?sessionId=${s.id}`); }}
                                            title="View leads"
                                            className="p-2 rounded-lg text-gray-500 hover:text-primary hover:bg-primary/10 transition-colors"
                                        >
                                            <ChevronRight className="w-4 h-4" />
                                        </button>
                                        {tab === 'active' ? (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleArchive(s.id, s.sessionName); }}
                                                title="Archive session"
                                                className="p-2 rounded-lg text-gray-500 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
                                            >
                                                <Archive className="w-4 h-4" />
                                            </button>
                                        ) : (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleUnarchive(s.id, s.sessionName); }}
                                                title="Restore session"
                                                className="p-2 rounded-lg text-gray-500 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                                            >
                                                <RotateCcw className="w-4 h-4" />
                                            </button>
                                        )}
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: s.id, name: s.sessionName }); }}
                                            title="Delete session permanently"
                                            className="p-2 rounded-lg text-gray-500 hover:text-danger hover:bg-danger/10 transition-colors"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    ))
                )}
            </div>

            {/* Delete Confirmation Modal */}
            {deleteTarget && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setDeleteTarget(null)}>
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
                                <h3 className="text-lg font-bold text-white mb-1">Delete Session</h3>
                                <p className="text-sm text-gray-400">
                                    Are you sure you want to permanently delete <span className="text-white font-medium">"{deleteTarget.name}"</span>?
                                </p>
                                <p className="text-xs text-gray-500 mt-2">
                                    All leads, emails, and logs in this session will be permanently removed. This cannot be undone.
                                </p>
                            </div>
                        </div>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setDeleteTarget(null)}
                                className="px-5 py-2 rounded-xl text-sm font-medium bg-surface border border-white/10 text-gray-300 hover:bg-white/5 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleDelete}
                                className="px-5 py-2 rounded-xl text-sm font-semibold bg-danger/20 hover:bg-danger/30 border border-danger/40 text-danger flex items-center gap-2 transition-all"
                            >
                                <Trash2 className="w-4 h-4" /> Delete
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}

            {/* Bulk Delete Confirmation Modal */}
            {bulkDeleteConfirm && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setBulkDeleteConfirm(false)}>
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
                                <h3 className="text-lg font-bold text-white mb-1">Delete {selectedIds.size} Sessions</h3>
                                <p className="text-sm text-gray-400">
                                    Are you sure you want to permanently delete <span className="text-white font-medium">{selectedIds.size} session{selectedIds.size > 1 ? 's' : ''}</span>?
                                </p>
                                <p className="text-xs text-gray-500 mt-2">
                                    All leads, emails, and logs in these sessions will be permanently removed. This cannot be undone.
                                </p>
                            </div>
                        </div>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setBulkDeleteConfirm(false)}
                                className="px-5 py-2 rounded-xl text-sm font-medium bg-surface border border-white/10 text-gray-300 hover:bg-white/5 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleBulkDelete}
                                className="px-5 py-2 rounded-xl text-sm font-semibold bg-danger/20 hover:bg-danger/30 border border-danger/40 text-danger flex items-center gap-2 transition-all"
                            >
                                <Trash2 className="w-4 h-4" /> Delete {selectedIds.size} Sessions
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </div>
    );
}
