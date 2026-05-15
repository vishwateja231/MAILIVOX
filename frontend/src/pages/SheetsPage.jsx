import { useState, useEffect } from 'react';
import { getGoogleSheetsStatus, getGoogleSheetsSessions, getSessions, syncToSheets, createGoogleSheet, clearGoogleSheet } from '../api';
import { Database, RefreshCw, CheckCircle2, Link as LinkIcon, XCircle, AlertTriangle, Layers, Trash2, Plus, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';

export default function SheetsPage() {
    const [status, setStatus] = useState(null);
    const [sessions, setSessions] = useState([]);
    const [exportHistory, setExportHistory] = useState([]);
    const [loading, setLoading] = useState(true);

    // Sync form state
    const [selectedSession, setSelectedSession] = useState('');
    const [sheetId, setSheetId] = useState('');
    const [sheetName, setSheetName] = useState('Leads');
    const [clearFirst, setClearFirst] = useState(false);
    const [createNew, setCreateNew] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [lastSync, setLastSync] = useState(null);

    useEffect(() => {
        Promise.all([
            getGoogleSheetsStatus().then(r => { setStatus(r.data.credentials); setExportHistory(r.data.recentExports || []); }),
            getSessions().then(r => setSessions(r.data)),
        ]).finally(() => setLoading(false));
    }, []);

    const handleSync = async () => {
        setSyncing(true);
        const tid = toast.loading('Syncing with Google Sheets...');
        try {
            const payload = {
                sessionId: selectedSession || undefined,
                spreadsheetId: createNew ? undefined : sheetId,
                sheetName,
                clearFirst,
                createNew,
            };
            const res = await syncToSheets(payload);
            setLastSync(res.data);
            toast.success(`Synced ${res.data.exportedRows} rows!`, { id: tid });
            if (createNew && res.data.sheetId) {
                setSheetId(res.data.sheetId);
                setCreateNew(false);
            }
            // Refresh status
            getGoogleSheetsStatus().then(r => setExportHistory(r.data.recentExports || []));
        } catch (e) {
            toast.error(e.response?.data?.error || e.message, { id: tid });
        } finally {
            setSyncing(false);
        }
    };

    const handleClear = async () => {
        if (!sheetId) return toast.error('Enter a Spreadsheet ID first');
        try {
            await clearGoogleSheet(sheetId, sheetName);
            toast.success('Sheet cleared');
        } catch (e) {
            toast.error(e.response?.data?.error || e.message);
        }
    };

    if (loading) return (
        <div className="flex items-center justify-center h-64">
            <div className="w-10 h-10 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
    );

    return (
        <div className="space-y-6 max-w-4xl mx-auto">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Google Sheets Sync</h1>
                <p className="text-gray-400 text-sm mt-1">Export leads directly to live Google Sheets via Service Account.</p>
            </div>

            {/* Connection Status */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className={`glass-card p-6 border ${status?.valid ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
                <div className="flex items-center gap-4">
                    {status?.valid ? (
                        <CheckCircle2 className="w-8 h-8 text-emerald-400 shrink-0" />
                    ) : (
                        <XCircle className="w-8 h-8 text-red-400 shrink-0" />
                    )}
                    <div className="flex-1">
                        <h3 className={`font-semibold ${status?.valid ? 'text-emerald-400' : 'text-red-400'}`}>
                            {status?.valid ? 'Service Account Connected' : 'Not Connected'}
                        </h3>
                        <p className="text-sm text-gray-400 mt-1">
                            {status?.valid ? status.email : (status?.error || 'Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in backend/.env')}
                        </p>
                        {status?.valid && status?.note && (
                            <p className="text-xs text-amber-400 mt-2 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" /> {status.note}
                            </p>
                        )}
                        {status?.valid && (
                            <div className="flex gap-4 mt-2 text-[10px]">
                                <span className={status?.sheetsApiEnabled !== false ? 'text-emerald-400' : 'text-red-400'}>
                                    Sheets API: {status?.sheetsApiEnabled !== false ? '✓' : '✗'}
                                </span>
                                <span className={status?.driveApiEnabled !== false ? 'text-emerald-400' : 'text-red-400'}>
                                    Drive API: {status?.driveApiEnabled !== false ? '✓' : '✗'}
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            </motion.div>

            {/* Sync Configuration */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-panel p-8 rounded-3xl">
                <div className="flex items-center gap-4 mb-8 pb-8 border-b border-white/5">
                    <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30">
                        <Database className="w-8 h-8 text-emerald-400" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold">Configure Sync</h2>
                        <p className="text-gray-400 text-sm">Select data source and destination.</p>
                    </div>
                </div>

                <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-300">Data Source (Session)</label>
                            <select
                                value={selectedSession}
                                onChange={e => setSelectedSession(e.target.value)}
                                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary/50 transition-colors text-white"
                            >
                                <option value="">All Leads (Entire Database)</option>
                                {sessions.map(s => (
                                    <option key={s.id} value={s.id}>{s.sessionName} ({s._count?.leads || 0} leads)</option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-300">Destination</label>
                            <select
                                value={createNew ? 'new' : 'existing'}
                                onChange={e => setCreateNew(e.target.value === 'new')}
                                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary/50 transition-colors text-white"
                            >
                                <option value="new">Create New Spreadsheet</option>
                                <option value="existing">Sync to Existing Spreadsheet</option>
                            </select>
                        </div>
                    </div>

                    {!createNew && (
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-300">Spreadsheet ID</label>
                            <input
                                type="text"
                                placeholder="e.g. 1BxiMVs0XRYFgwnV_v9DPP2e0E..."
                                value={sheetId}
                                onChange={e => setSheetId(e.target.value)}
                                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary/50 transition-colors font-mono"
                            />
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-300">Tab / Sheet Name</label>
                            <input
                                type="text"
                                value={sheetName}
                                onChange={e => setSheetName(e.target.value)}
                                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary/50 transition-colors"
                            />
                        </div>
                        <div className="flex items-center gap-3 pt-8">
                            <input
                                type="checkbox" id="clearFirst"
                                checked={clearFirst}
                                onChange={e => setClearFirst(e.target.checked)}
                                className="w-5 h-5 rounded bg-black border-white/10 text-primary focus:ring-primary/50"
                            />
                            <label htmlFor="clearFirst" className="text-sm text-gray-300 cursor-pointer">Clear tab before writing</label>
                        </div>
                    </div>

                    <div className="flex gap-4 mt-4">
                        <button
                            onClick={handleSync}
                            disabled={syncing || !status?.valid || (!createNew && !sheetId)}
                            className="btn-primary flex-1 py-4 text-lg flex items-center justify-center gap-3"
                            style={{ background: 'linear-gradient(to right, #10b981, #059669)', boxShadow: '0 0 20px -5px rgba(16,185,129,0.5)' }}
                        >
                            {syncing ? <RefreshCw className="w-6 h-6 animate-spin" /> : <Upload className="w-6 h-6" />}
                            {syncing ? 'Syncing...' : 'Execute Sync'}
                        </button>
                        {!createNew && sheetId && (
                            <button onClick={handleClear} className="btn-secondary px-6 flex items-center gap-2">
                                <Trash2 className="w-5 h-5" /> Clear Sheet
                            </button>
                        )}
                    </div>
                </div>
            </motion.div>

            {/* Last sync result */}
            {lastSync && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6 border border-emerald-500/30 bg-emerald-500/5">
                    <div className="flex items-start gap-4">
                        <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
                        <div>
                            <h3 className="font-semibold text-emerald-400">Sync Successful</h3>
                            <p className="text-sm text-gray-400 mt-1">Exported {lastSync.exportedRows} rows from {lastSync.totalLeads} leads.</p>
                            {lastSync.sheetUrl && (
                                <a href={lastSync.sheetUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 mt-3 text-sm text-primary hover:underline w-fit">
                                    <LinkIcon className="w-4 h-4" /> Open Google Sheet
                                </a>
                            )}
                        </div>
                    </div>
                </motion.div>
            )}

            {/* Export History — real DB data */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-panel rounded-2xl overflow-hidden">
                <div className="px-6 py-5 border-b border-white/5 bg-surface/30">
                    <h3 className="font-semibold">Export History</h3>
                </div>
                <div className="p-4">
                    {exportHistory.length > 0 ? exportHistory.map(exp => (
                        <div key={exp.id} className="flex items-center justify-between p-3 hover:bg-white/5 rounded-xl transition-colors">
                            <div className="flex items-center gap-3">
                                <Layers className="w-4 h-4 text-primary" />
                                <div>
                                    <p className="text-sm font-medium">{exp.session?.sessionName || 'All Leads'}</p>
                                    <p className="text-xs text-gray-500">{new Date(exp.createdAt).toLocaleString()}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                <span className="text-sm font-semibold">{exp.exportedRows} rows</span>
                                <span className={`badge ${exp.status === 'SUCCESS' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                                    {exp.status}
                                </span>
                                {exp.sheetUrl && (
                                    <a href={exp.sheetUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline text-xs">Open</a>
                                )}
                            </div>
                        </div>
                    )) : (
                        <div className="text-center text-gray-500 text-sm py-6">No exports yet. Sync some leads to see history here.</div>
                    )}
                </div>
            </motion.div>
        </div>
    );
}
