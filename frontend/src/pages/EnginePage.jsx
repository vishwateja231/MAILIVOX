import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Terminal, Zap, RefreshCw, UploadCloud, Building2, Eye, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import clsx from 'clsx';
import { runIntelligencePipeline } from '../api';

function LiveFeed({ logs }) {
    const endRef = useRef(null);
    return (
        <div className="bg-black/60 border border-white/10 rounded-xl h-full overflow-y-auto font-mono text-[11px] p-4 space-y-1 custom-scrollbar">
            {logs.length === 0 ? (
                <div className="text-gray-600 flex h-full items-center justify-center text-xs">System idle. Paste LinkedIn data and run the engine.</div>
            ) : (
                <AnimatePresence initial={false}>
                    {logs.map((log, i) => (
                        <motion.div
                            key={i}
                            initial={{ opacity: 0, x: -5 }}
                            animate={{ opacity: 1, x: 0 }}
                            className={clsx("flex gap-2 leading-relaxed",
                                log.level === 'success' && 'text-emerald-400',
                                log.level === 'error' && 'text-red-400',
                                log.level === 'warn' && 'text-amber-400',
                                log.level === 'stage' && 'text-primary font-semibold',
                                (!log.level || log.level === 'info') && 'text-gray-400',
                            )}
                        >
                            <span className="text-gray-700 shrink-0 w-16">{log.time}</span>
                            <span>{log.message}</span>
                        </motion.div>
                    ))}
                    <div ref={endRef} />
                </AnimatePresence>
            )}
        </div>
    );
}

export default function EnginePage() {
    const navigate = useNavigate();
    const [rawText, setRawText] = useState('');
    const [status, setStatus] = useState('idle'); // idle | running | done | error
    const [sessionName, setSessionName] = useState('');
    const [companyOverride, setCompanyOverride] = useState('');
    const [domainOverride, setDomainOverride] = useState('');
    const [excludeInterns, setExcludeInterns] = useState(() => {
        const saved = localStorage.getItem('nexus_excludeInterns');
        return saved !== null ? saved === 'true' : true; // default ON
    });
    const [excludeFreshers, setExcludeFreshers] = useState(() => {
        const saved = localStorage.getItem('nexus_excludeFreshers');
        return saved !== null ? saved === 'true' : false; // default OFF
    });
    const [logs, setLogs] = useState([]);
    const [progress, setProgress] = useState({ current: 0, total: 0 });
    const [result, setResult] = useState(null);
    const [sessionId, setSessionId] = useState(null);
    const cancelRef = useRef(null);
    const [queue, setQueue] = useState([]); // Array of queued text batches
    const [queueProcessing, setQueueProcessing] = useState(false);
    const [totalStats, setTotalStats] = useState({ processed: 0, emails: 0, rejected: 0 });

    const addLog = (message, level = 'info') => {
        const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setLogs(prev => [...prev, { message, level, time }]);
    };

    const handleRun = () => {
        if (!rawText.trim()) return toast.error('Paste LinkedIn data first.');
        setStatus('running');
        if (!sessionId) {
            // First run — clear logs and start fresh
            setLogs([]);
            setProgress({ current: 0, total: 0 });
            setResult(null);
        }

        const generatedName = sessionName.trim() || `session_${Date.now().toString().slice(-6)}`;
        addLog(`Intelligence Engine started — batch processing`, 'stage');
        if (companyOverride.trim()) {
            addLog(`Company override: "${companyOverride.trim()}"`, 'info');
        }

        const currentSessionName = sessionId ? undefined : generatedName;

        cancelRef.current = runIntelligencePipeline(
            rawText,
            (event) => {
                switch (event.type) {
                    case 'stage':
                        addLog(event.data.message, 'stage');
                        break;
                    case 'log':
                        addLog(event.data.message, event.data.level);
                        break;
                    case 'session':
                        if (!sessionId) setSessionId(event.data.sessionId);
                        addLog(`Session: ${event.data.sessionName}`, 'info');
                        break;
                    case 'progress':
                        setProgress({ current: event.data.current, total: event.data.total });
                        break;
                    case 'profile_done':
                        addLog(`✓ ${event.data.fullName} → ${event.data.domain || 'no domain'} (${event.data.emailCount} emails, source: ${event.data.companySource})`, 'success');
                        break;
                    case 'profile_error':
                        addLog(`✗ ${event.data.fullName}: ${event.data.error}`, 'error');
                        break;
                    case 'complete':
                        setTotalStats(prev => ({
                            processed: prev.processed + (event.data.processed || 0),
                            emails: prev.emails + (event.data.emailsGenerated || 0),
                            rejected: prev.rejected + (event.data.rejected || 0),
                        }));
                        setResult(event.data);
                        addLog(event.data.message, 'stage');
                        
                        // Check if there are queued batches
                        if (queue.length > 0) {
                            addLog(`Batch complete. ${queue.length} more in queue — starting next...`, 'stage');
                            processNextInQueue();
                        } else {
                            setStatus('done');
                            setQueueProcessing(false);
                            toast.success('All batches complete!');
                        }
                        break;
                    case 'error':
                        setStatus('error');
                        addLog(`Fatal: ${event.data.message}`, 'error');
                        toast.error('Pipeline failed');
                        break;
                }
            },
            currentSessionName || generatedName,
            companyOverride.trim() || null,
            { excludeInterns, excludeFreshers, domainOverride: domainOverride.trim() || null },
        );
        
        // Clear input after starting
        setRawText('');
    };

    const handleAddToQueue = () => {
        if (!rawText.trim()) return toast.error('Paste data first');
        setQueue(prev => [...prev, rawText.trim()]);
        setRawText('');
        toast.success(`Added to queue (${queue.length + 1} batches waiting)`);
    };

    const processNextInQueue = () => {
        setQueue(prev => {
            if (prev.length === 0) return prev;
            const [next, ...rest] = prev;
            // Run the next batch
            setTimeout(() => {
                setRawText(next);
                setTimeout(() => {
                    // Trigger run with the queued text
                    const generatedName = sessionName.trim() || `session_${Date.now().toString().slice(-6)}`;
                    cancelRef.current = runIntelligencePipeline(
                        next,
                        (event) => {
                            switch (event.type) {
                                case 'stage': addLog(event.data.message, 'stage'); break;
                                case 'log': addLog(event.data.message, event.data.level); break;
                                case 'progress': setProgress({ current: event.data.current, total: event.data.total }); break;
                                case 'profile_done': addLog(`✓ ${event.data.fullName} → ${event.data.domain || 'no domain'} (${event.data.emailCount} emails)`, 'success'); break;
                                case 'profile_error': addLog(`✗ ${event.data.fullName}: ${event.data.error}`, 'error'); break;
                                case 'complete':
                                    setTotalStats(p => ({ processed: p.processed + (event.data.processed || 0), emails: p.emails + (event.data.emailsGenerated || 0), rejected: p.rejected + (event.data.rejected || 0) }));
                                    setResult(event.data);
                                    addLog(event.data.message, 'stage');
                                    setQueue(q => {
                                        if (q.length > 0) {
                                            addLog(`Batch done. ${q.length} more queued...`, 'stage');
                                            processNextInQueue();
                                        } else {
                                            setStatus('done');
                                            setQueueProcessing(false);
                                            toast.success('All batches complete!');
                                        }
                                        return q;
                                    });
                                    break;
                                case 'error': setStatus('error'); addLog(`Fatal: ${event.data.message}`, 'error'); break;
                            }
                        },
                        generatedName,
                        companyOverride.trim() || null,
                        { excludeInterns, excludeFreshers, domainOverride: domainOverride.trim() || null },
                    );
                }, 100);
            }, 500);
            return rest;
        });
    };

    const handleCancel = () => {
        if (cancelRef.current) cancelRef.current();
        setStatus('idle');
        addLog('Pipeline cancelled by user.', 'warn');
    };

    const handleViewLeads = () => {
        if (sessionId) {
            navigate(`/leads?sessionId=${sessionId}`);
        } else {
            navigate('/leads');
        }
    };

    const progressPct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                        <Zap className="w-8 h-8 text-primary" /> Lead Intelligence
                    </h1>
                    <p className="text-gray-400 text-sm mt-1">Paste LinkedIn data → one click → fully enriched contacts in your pipeline.</p>
                </div>
                {(status === 'done' || sessionId) && (
                    <button onClick={handleViewLeads} className="btn-secondary flex items-center gap-2">
                        <Eye className="w-4 h-4" /> View Extracted Leads
                    </button>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* Left: Input */}
                <div className="glass-panel p-6 rounded-2xl flex flex-col h-[620px] relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full blur-[80px] -mr-20 -mt-20 group-focus-within:bg-primary/20 transition-all duration-500 pointer-events-none" />

                    <div className="flex justify-between items-center mb-3 relative z-10">
                        <h3 className="font-semibold flex items-center gap-2"><UploadCloud className="w-4 h-4 text-primary" /> Data Input</h3>
                        <button onClick={() => { setRawText(''); setLogs([]); setStatus('idle'); setResult(null); }} className="text-xs text-gray-500 hover:text-white transition-colors">Clear All</button>
                    </div>

                    {/* Config row */}
                    <div className="flex gap-2 mb-3 relative z-10">
                        <input
                            type="text"
                            placeholder="Session name (auto-generated)"
                            value={sessionName}
                            onChange={e => setSessionName(e.target.value)}
                            className="flex-1 bg-black/30 border border-white/10 rounded-lg px-3 py-1.5 text-xs focus:border-primary/50 focus:outline-none"
                        />
                        <div className="relative flex-1">
                            <Building2 className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                            <input
                                type="text"
                                placeholder="Target Company (override)"
                                value={companyOverride}
                                onChange={e => setCompanyOverride(e.target.value)}
                                className="w-full bg-black/30 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-xs focus:border-primary/50 focus:outline-none"
                            />
                        </div>
                    </div>
                    <div className="flex gap-2 mb-3 relative z-10">
                        <input
                            type="text"
                            placeholder="Domain override (e.g. apple.com, cursor.so)"
                            value={domainOverride}
                            onChange={e => setDomainOverride(e.target.value)}
                            className="flex-1 bg-black/30 border border-white/10 rounded-lg px-3 py-1.5 text-xs focus:border-primary/50 focus:outline-none font-mono"
                        />
                    </div>

                    {/* Filter Toggles */}
                    <div className="flex gap-4 mb-3 relative z-10">
                        <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={excludeInterns}
                                onChange={e => { setExcludeInterns(e.target.checked); localStorage.setItem('nexus_excludeInterns', e.target.checked); }}
                            />
                            <span>Exclude Interns/Trainees</span>
                        </label>
                        <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={excludeFreshers}
                                onChange={e => { setExcludeFreshers(e.target.checked); localStorage.setItem('nexus_excludeFreshers', e.target.checked); }}
                            />
                            <span>Exclude Freshers</span>
                        </label>
                    </div>

                    <textarea
                        value={rawText}
                        onChange={(e) => setRawText(e.target.value)}
                        placeholder={"Paste LinkedIn search results, recruiter lists, or connection data here...\n\nThe engine will automatically:\n• Parse profiles\n• Filter junk\n• Deduplicate\n• Normalize companies\n• Resolve domains\n• Generate email combinations\n• Save to your CRM"}
                        className="w-full flex-1 bg-black/40 border border-white/10 rounded-xl p-4 text-sm font-mono text-gray-300 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all resize-none relative z-10 custom-scrollbar"
                    />

                    <div className="mt-4 relative z-10 space-y-2">
                        {status === 'running' ? (
                            <div className="flex gap-2">
                                <button
                                    onClick={handleAddToQueue}
                                    disabled={!rawText.trim()}
                                    className="flex-1 py-3 rounded-xl font-semibold text-sm bg-primary/20 border border-primary/30 text-primary hover:bg-primary/30 disabled:opacity-40 flex items-center justify-center gap-2 transition-all"
                                >
                                    <Zap className="w-4 h-4" /> Add to Queue {queue.length > 0 && `(${queue.length})`}
                                </button>
                                <button onClick={handleCancel} className="px-4 py-3 rounded-xl font-semibold text-sm bg-danger/20 border border-danger/30 text-danger hover:bg-danger/30 flex items-center justify-center gap-2 transition-all">
                                    <XCircle className="w-4 h-4" />
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={handleRun}
                                disabled={!rawText.trim()}
                                className="w-full py-3 rounded-xl font-semibold text-sm bg-gradient-to-r from-primary to-indigo-500 text-white shadow-lg shadow-primary/20 hover:shadow-primary/40 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all"
                            >
                                <Zap className="w-4 h-4" /> Run Intelligence Engine
                            </button>
                        )}
                        {/* Queue indicator */}
                        {queue.length > 0 && (
                            <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/20 rounded-lg">
                                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                                <span className="text-[11px] text-primary font-medium">{queue.length} batch{queue.length > 1 ? 'es' : ''} queued — will process after current batch</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right: Terminal + Stats */}
                <div className="flex flex-col gap-4 h-[620px]">
                    <div className="glass-panel p-5 rounded-2xl flex-1 flex flex-col relative overflow-hidden">
                        <div className="flex justify-between items-center mb-3 relative z-10">
                            <h3 className="font-semibold flex items-center gap-2">
                                <Terminal className="w-4 h-4 text-indigo-400" /> Pipeline Log
                            </h3>
                            {status === 'running' && (
                                <span className="flex h-2 w-2 relative">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                                </span>
                            )}
                        </div>
                        <div className="flex-1 min-h-0">
                            <LiveFeed logs={logs} />
                        </div>

                        {/* Progress */}
                        <div className="mt-3 relative z-10">
                            <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                                <span>{status === 'running' ? 'Processing...' : status === 'done' ? 'Complete' : 'Ready'}</span>
                                <span>{progress.current}/{progress.total} ({progressPct}%)</span>
                            </div>
                            <div className="h-1.5 w-full bg-black/50 rounded-full overflow-hidden border border-white/5">
                                <motion.div
                                    className={clsx("h-full rounded-full", status === 'done' ? 'bg-success' : 'bg-gradient-to-r from-primary to-indigo-500')}
                                    initial={{ width: 0 }}
                                    animate={{ width: `${progressPct}%` }}
                                    transition={{ duration: 0.3 }}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Stats Panel */}
                    <div className="glass-panel p-5 rounded-2xl shrink-0">
                        <div className="grid grid-cols-3 gap-4 text-center">
                            <div>
                                <p className="text-xl font-bold text-white">{totalStats.processed || result?.processed || progress.current || 0}</p>
                                <p className="text-[9px] text-gray-500 uppercase tracking-wider">Processed</p>
                            </div>
                            <div>
                                <p className="text-xl font-bold text-emerald-400">{totalStats.emails || result?.emailsGenerated || 0}</p>
                                <p className="text-[9px] text-gray-500 uppercase tracking-wider">Emails</p>
                            </div>
                            <div>
                                <p className="text-xl font-bold text-amber-400">{totalStats.rejected || result?.rejected || 0}</p>
                                <p className="text-[9px] text-gray-500 uppercase tracking-wider">Rejected</p>
                            </div>
                        </div>
                        {(result || queue.length > 0) && (
                            <div className="mt-3 pt-3 border-t border-white/5 grid grid-cols-3 gap-4 text-center text-[10px]">
                                <div>
                                    <span className="text-gray-500">Duplicates: </span>
                                    <span className="text-white font-medium">{result?.duplicates || 0}</span>
                                </div>
                                <div>
                                    <span className="text-gray-500">Companies: </span>
                                    <span className="text-white font-medium">{result?.companiesCreated || 0}</span>
                                </div>
                                <div>
                                    <span className="text-gray-500">Queue: </span>
                                    <span className="text-primary font-medium">{queue.length} pending</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
