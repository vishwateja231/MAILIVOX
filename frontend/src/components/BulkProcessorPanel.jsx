import { useState, useRef, useCallback } from 'react';
import {
    Users, Play, Download, X, AlertCircle, CheckCircle2,
    Clock, Loader2, FileJson, FileSpreadsheet, FileText
} from 'lucide-react';
import { parseBulkLinkedIn, processBulkStream } from '../api';
import Papa from 'papaparse';
import clsx from 'clsx';

/**
 * BulkProcessorPanel
 * Full bulk LinkedIn paste → parse → process → export workflow.
 * Shows a live progress log and a results preview table.
 */
export default function BulkProcessorPanel() {
    const [rawText, setRawText] = useState('');
    const [phase, setPhase] = useState('idle'); // idle | parsing | previewing | processing | done
    const [parsedProfiles, setParsedProfiles] = useState([]);
    const [results, setResults] = useState([]);
    const [progress, setProgress] = useState({ current: 0, total: 0, currentName: '', emailsGenerated: 0 });
    const [logs, setLogs] = useState([]);
    const [error, setError] = useState(null);
    const stopStreamRef = useRef(null);
    const logsEndRef = useRef(null);

    const pushLog = useCallback((msg, type = 'info') => {
        const timestamp = new Date().toLocaleTimeString();
        setLogs(prev => [...prev.slice(-199), { msg, type, timestamp }]); // keep last 200
        setTimeout(() => logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }, []);

    // ── Phase 1: Parse preview ─────────────────────────────────────────────────
    const handleParse = async () => {
        if (!rawText.trim()) return;
        setPhase('parsing');
        setError(null);
        setResults([]);
        setLogs([]);
        setParsedProfiles([]);

        try {
            pushLog('Sending bulk text to parser...', 'info');
            const res = await parseBulkLinkedIn(rawText);
            const { profiles, totalFound, totalValid } = res.data;
            setParsedProfiles(profiles);
            setPhase('previewing');
            pushLog(`✓ Detected ${totalFound} blocks → ${totalValid} valid profiles after deduplication.`, 'success');
        } catch (err) {
            setError(err.response?.data?.error || 'Parsing failed.');
            setPhase('idle');
        }
    };

    // ── Phase 2: Process profiles via SSE ─────────────────────────────────────
    const handleProcess = () => {
        if (parsedProfiles.length === 0) return;
        setPhase('processing');
        setResults([]);
        setProgress({ current: 0, total: parsedProfiles.length, currentName: '', emailsGenerated: 0 });

        pushLog(`Starting processing of ${parsedProfiles.length} profiles...`, 'info');

        const cleanup = processBulkStream(parsedProfiles, (event) => {
            if (event.type === 'progress') {
                const d = event.data;
                setProgress(d);
                pushLog(`[${d.current}/${d.total}] Processing: ${d.currentName}`, 'info');
            } else if (event.type === 'profile_done') {
                const p = event.data.profile;
                const emailCount = p.emails?.length || 0;
                const status = p.error ? '✗ Error' : `✓ ${emailCount} emails`;
                pushLog(`${p.fullName} (${p.company || 'no company'}) → ${status}`, p.error ? 'error' : 'success');
                setResults(prev => [...prev, p]);
                setProgress(prev => ({ ...prev, emailsGenerated: prev.emailsGenerated + emailCount }));
            } else if (event.type === 'complete') {
                setPhase('done');
                pushLog(`🎉 Processing complete! ${event.data.total} profiles processed.`, 'success');
            } else if (event.type === 'error') {
                setError(event.data.message);
                setPhase('previewing');
                pushLog(`Error: ${event.data.message}`, 'error');
            }
        }, false);

        stopStreamRef.current = cleanup;
    };

    const handleStop = () => {
        stopStreamRef.current?.();
        setPhase('previewing');
        pushLog('Processing stopped by user.', 'warn');
    };

    const handleReset = () => {
        stopStreamRef.current?.();
        setPhase('idle');
        setRawText('');
        setParsedProfiles([]);
        setResults([]);
        setLogs([]);
        setError(null);
        setProgress({ current: 0, total: 0, currentName: '', emailsGenerated: 0 });
    };

    // ── Exports ────────────────────────────────────────────────────────────────
    const exportCSV = () => {
        const rows = results.flatMap(p =>
            (p.emails || [{ email: 'N/A', pattern: '', confidence: '', status: '' }]).map(e => ({
                'Full Name': p.fullName,
                'Company': p.company,
                'Role': p.role,
                'Domain': p.domain || '',
                'Email': e.email,
                'Pattern': e.pattern,
                'Confidence': e.confidence,
                'Status': e.status,
            }))
        );
        const csv = Papa.unparse(rows);
        triggerDownload(csv, 'bulk_emails.csv', 'text/csv');
    };

    const exportJSON = () => {
        triggerDownload(JSON.stringify(results, null, 2), 'bulk_emails.json', 'application/json');
    };

    const triggerDownload = (content, filename, type) => {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const progressPct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

    return (
        <div className="glass-card overflow-hidden flex flex-col">
            {/* Header */}
            <div className="p-6 border-b border-white/10 bg-gradient-to-r from-surface/80 to-background/60 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-500/20 rounded-lg">
                        <Users className="w-5 h-5 text-blue-400" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold">Bulk LinkedIn Processor</h2>
                        <p className="text-xs text-gray-400">Paste 100–1000 profiles and generate emails for all</p>
                    </div>
                </div>
                {phase !== 'idle' && (
                    <button onClick={handleReset} className="text-xs text-gray-400 hover:text-white flex items-center gap-1">
                        <X className="w-3.5 h-3.5" /> Reset
                    </button>
                )}
            </div>

            <div className="p-6 space-y-6">
                {/* ── Paste Area ── */}
                {(phase === 'idle') && (
                    <div className="space-y-4">
                        <textarea
                            className="input-glowing w-full h-52 resize-none text-sm font-mono leading-relaxed"
                            placeholder={`Paste bulk LinkedIn search results here...\n\nExample:\nMahendranath Jinkathoti • 2nd\nData Scientist at Honeywell | NITK'25\nIndia\nPending\n\nShamita Singh\n· 2nd\nRecruitment Specialist || Honeywell\nGurugram, Haryana, India`}
                            value={rawText}
                            onChange={(e) => setRawText(e.target.value)}
                        />
                        <button
                            onClick={handleParse}
                            disabled={!rawText.trim()}
                            className="w-full py-3 flex items-center justify-center gap-2 bg-blue-600/30 hover:bg-blue-600/50 border border-blue-500/40 text-blue-300 rounded-lg font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <Users className="w-4 h-4" /> Parse & Preview Profiles
                        </button>
                    </div>
                )}

                {/* ── Parsing spinner ── */}
                {phase === 'parsing' && (
                    <div className="flex flex-col items-center justify-center py-12 text-gray-400 gap-3">
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                        <p>Parsing bulk text...</p>
                    </div>
                )}

                {/* ── Preview Table ── */}
                {(phase === 'previewing' || phase === 'processing' || phase === 'done') && (
                    <div className="space-y-4">
                        {/* Stats bar */}
                        <div className="flex flex-wrap gap-4 text-sm">
                            <StatBadge label="Profiles" value={parsedProfiles.length} color="text-primary" />
                            <StatBadge label="Processed" value={results.length} color="text-success" />
                            <StatBadge label="Emails Generated" value={progress.emailsGenerated} color="text-purple-400" />
                        </div>

                        {/* Progress bar */}
                        {(phase === 'processing') && (
                            <div className="space-y-2">
                                <div className="flex justify-between text-xs text-gray-400">
                                    <span>Processing: <strong className="text-white">{progress.currentName}</strong></span>
                                    <span>{progressPct}%</span>
                                </div>
                                <div className="h-2 bg-surface rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-gradient-to-r from-primary to-purple-500 transition-all duration-500 rounded-full"
                                        style={{ width: `${progressPct}%` }}
                                    />
                                </div>
                            </div>
                        )}

                        {/* Action buttons */}
                        <div className="flex gap-3">
                            {phase === 'previewing' && (
                                <button
                                    onClick={handleProcess}
                                    className="flex-1 py-2.5 flex items-center justify-center gap-2 bg-success/20 hover:bg-success/30 border border-success/40 text-success rounded-lg text-sm font-semibold transition-all"
                                >
                                    <Play className="w-4 h-4" /> Generate Emails for All
                                </button>
                            )}
                            {phase === 'processing' && (
                                <button
                                    onClick={handleStop}
                                    className="flex-1 py-2.5 flex items-center justify-center gap-2 bg-danger/20 hover:bg-danger/30 border border-danger/40 text-danger rounded-lg text-sm font-semibold transition-all"
                                >
                                    <X className="w-4 h-4" /> Stop Processing
                                </button>
                            )}
                            {phase === 'done' && (
                                <div className="flex gap-2 flex-1">
                                    <button onClick={exportCSV} className="flex-1 py-2 flex items-center justify-center gap-1.5 bg-surface hover:bg-surface/60 border border-white/10 rounded-lg text-xs text-gray-300 transition-colors">
                                        <FileText className="w-3.5 h-3.5 text-success" /> CSV
                                    </button>
                                    <button onClick={exportJSON} className="flex-1 py-2 flex items-center justify-center gap-1.5 bg-surface hover:bg-surface/60 border border-white/10 rounded-lg text-xs text-gray-300 transition-colors">
                                        <FileJson className="w-3.5 h-3.5 text-primary" /> JSON
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Preview profiles table */}
                        <div className="overflow-auto max-h-48 rounded-lg border border-white/10">
                            <table className="w-full text-xs text-left">
                                <thead className="sticky top-0 bg-surface text-gray-400 uppercase tracking-wider">
                                    <tr>
                                        <th className="px-3 py-2">Name</th>
                                        <th className="px-3 py-2">Company</th>
                                        <th className="px-3 py-2">Role</th>
                                        <th className="px-3 py-2">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {parsedProfiles.map((p, i) => {
                                        const result = results.find(r => r.fullName === p.fullName && r.company === p.company);
                                        return (
                                            <tr key={i} className="hover:bg-white/5 transition-colors">
                                                <td className="px-3 py-2 font-medium text-white">{p.fullName}</td>
                                                <td className="px-3 py-2 text-gray-400">{p.company || <span className="text-danger/70 italic">unknown</span>}</td>
                                                <td className="px-3 py-2 text-gray-500 max-w-[140px] truncate">{p.role}</td>
                                                <td className="px-3 py-2">
                                                    {result ? (
                                                        <span className="text-success flex items-center gap-1">
                                                            <CheckCircle2 className="w-3 h-3" /> {result.emails?.length || 0} emails
                                                        </span>
                                                    ) : phase === 'processing' && i < progress.current ? (
                                                        <span className="text-primary flex items-center gap-1">
                                                            <Loader2 className="w-3 h-3 animate-spin" /> Processing
                                                        </span>
                                                    ) : (
                                                        <span className="text-gray-600 flex items-center gap-1">
                                                            <Clock className="w-3 h-3" /> Queued
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* ── Live Logs Panel ── */}
                {logs.length > 0 && (
                    <div className="space-y-2">
                        <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">Live Logs</p>
                        <div className="h-36 overflow-y-auto bg-black/30 rounded-lg border border-white/5 p-3 font-mono text-xs space-y-1">
                            {logs.map((log, i) => (
                                <div key={i} className={clsx('flex gap-2',
                                    log.type === 'success' && 'text-success',
                                    log.type === 'error' && 'text-danger',
                                    log.type === 'warn' && 'text-warning',
                                    log.type === 'info' && 'text-gray-400',
                                )}>
                                    <span className="text-gray-600 flex-shrink-0">{log.timestamp}</span>
                                    <span>{log.msg}</span>
                                </div>
                            ))}
                            <div ref={logsEndRef} />
                        </div>
                    </div>
                )}

                {error && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-danger/10 border border-danger/30 text-danger text-sm">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
                    </div>
                )}
            </div>
        </div>
    );
}

function StatBadge({ label, value, color }) {
    return (
        <div className="flex items-center gap-2 px-3 py-1.5 glass rounded-lg">
            <span className="text-gray-500 text-xs">{label}:</span>
            <span className={clsx('font-bold text-base', color)}>{value}</span>
        </div>
    );
}
