import { useState, useCallback } from 'react';
import { Upload, FileText, FileSpreadsheet, File, CheckCircle2, AlertCircle, Loader2, Users, Mail, Building2, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { importFile } from '../api';

const ACCEPTED_TYPES = {
    'application/pdf': '.pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-excel': '.xls',
    'text/csv': '.csv',
    'text/plain': '.txt',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};

const ACCEPTED_EXTENSIONS = ['.pdf', '.xlsx', '.xls', '.csv', '.txt', '.doc', '.docx'];

function getFileIcon(filename) {
    const ext = filename?.split('.').pop()?.toLowerCase();
    if (['xlsx', 'xls', 'csv'].includes(ext)) return FileSpreadsheet;
    if (ext === 'pdf') return FileText;
    return File;
}

export default function ImportPage() {
    const navigate = useNavigate();
    const [dragOver, setDragOver] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    const [selectedFile, setSelectedFile] = useState(null);

    const handleFile = useCallback(async (file) => {
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        if (!ACCEPTED_EXTENSIONS.includes(ext)) {
            setError(`Unsupported file type: ${ext}. Accepted: ${ACCEPTED_EXTENSIONS.join(', ')}`);
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            setError('File too large. Maximum size is 10MB.');
            return;
        }

        setSelectedFile(file);
        setError(null);
        setResult(null);
        setUploading(true);

        try {
            const res = await importFile(file);
            setResult(res.data);
            toast.success(`Imported ${res.data.processed} contacts from ${file.name}`);
        } catch (e) {
            const msg = e.response?.data?.error || e.message || 'Upload failed';
            setError(msg);
            toast.error(msg);
        } finally {
            setUploading(false);
        }
    }, []);

    const onDrop = useCallback((e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer?.files?.[0];
        if (file) handleFile(file);
    }, [handleFile]);

    const onDragOver = useCallback((e) => {
        e.preventDefault();
        setDragOver(true);
    }, []);

    const onDragLeave = useCallback(() => setDragOver(false), []);

    const onFileSelect = useCallback((e) => {
        const file = e.target.files?.[0];
        if (file) handleFile(file);
    }, [handleFile]);

    const reset = () => {
        setSelectedFile(null);
        setResult(null);
        setError(null);
    };

    return (
        <div className="space-y-8">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold">Import Data</h1>
                <p className="text-gray-400 mt-1">Upload CSV, Excel, PDF, or Word files to import contacts and generate emails.</p>
            </div>

            {/* Upload Area */}
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative"
            >
                <div
                    onDrop={onDrop}
                    onDragOver={onDragOver}
                    onDragLeave={onDragLeave}
                    className={`
                        relative border-2 border-dashed rounded-2xl p-12 text-center transition-all cursor-pointer
                        ${dragOver
                            ? 'border-primary bg-primary/10 scale-[1.01]'
                            : 'border-white/10 hover:border-white/20 hover:bg-white/[0.02]'
                        }
                        ${uploading ? 'pointer-events-none opacity-60' : ''}
                    `}
                    onClick={() => !uploading && document.getElementById('file-input').click()}
                    role="button"
                    tabIndex={0}
                    aria-label="Upload file area. Click or drag and drop a file."
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') document.getElementById('file-input').click(); }}
                >
                    <input
                        id="file-input"
                        type="file"
                        accept={ACCEPTED_EXTENSIONS.join(',')}
                        onChange={onFileSelect}
                        className="hidden"
                        aria-hidden="true"
                    />

                    <div className="flex flex-col items-center gap-4">
                        {uploading ? (
                            <Loader2 className="w-12 h-12 text-primary animate-spin" />
                        ) : (
                            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                                <Upload className="w-8 h-8 text-primary" />
                            </div>
                        )}

                        <div>
                            <p className="text-lg font-medium">
                                {uploading ? 'Processing file...' : 'Drop your file here or click to browse'}
                            </p>
                            <p className="text-sm text-gray-400 mt-1">
                                Supports CSV, Excel (.xlsx), PDF, Word (.docx) — Max 10MB
                            </p>
                        </div>

                        {selectedFile && !uploading && !result && (
                            <div className="flex items-center gap-2 px-4 py-2 bg-white/5 rounded-lg">
                                {(() => { const Icon = getFileIcon(selectedFile.name); return <Icon className="w-4 h-4 text-gray-400" />; })()}
                                <span className="text-sm text-gray-300">{selectedFile.name}</span>
                                <span className="text-xs text-gray-500">({(selectedFile.size / 1024).toFixed(1)} KB)</span>
                            </div>
                        )}
                    </div>
                </div>
            </motion.div>

            {/* Error */}
            <AnimatePresence>
                {error && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl"
                    >
                        <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
                        <p className="text-sm text-red-300">{error}</p>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Results */}
            <AnimatePresence>
                {result && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="space-y-6"
                    >
                        {/* Success Banner */}
                        <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                            <div>
                                <p className="text-sm font-medium text-emerald-300">Import successful</p>
                                <p className="text-xs text-gray-400 mt-0.5">Session: {result.sessionName}</p>
                            </div>
                        </div>

                        {/* Stats Grid */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <StatCard icon={Users} label="Contacts Found" value={result.totalContacts} color="primary" />
                            <StatCard icon={CheckCircle2} label="Processed" value={result.processed} color="emerald" />
                            <StatCard icon={Mail} label="Emails Generated" value={result.emailsGenerated} color="violet" />
                            <StatCard icon={Building2} label="Companies Created" value={result.companiesCreated} color="amber" />
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => navigate('/outreach')}
                                className="flex items-center gap-2 px-4 py-2.5 bg-primary/10 hover:bg-primary/20 text-primary rounded-xl text-sm font-medium transition-colors"
                            >
                                View in Outreach <ArrowRight className="w-4 h-4" />
                            </button>
                            <button
                                onClick={reset}
                                className="px-4 py-2.5 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl text-sm font-medium transition-colors"
                            >
                                Import Another File
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Supported Formats */}
            {!result && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <FormatCard ext="CSV" desc="Comma-separated values with headers" icon={FileSpreadsheet} />
                    <FormatCard ext="XLSX" desc="Excel spreadsheets with contact data" icon={FileSpreadsheet} />
                    <FormatCard ext="PDF" desc="Documents with emails and names" icon={FileText} />
                    <FormatCard ext="DOCX" desc="Word documents with contact info" icon={File} />
                </div>
            )}
        </div>
    );
}

function StatCard({ icon: Icon, label, value, color }) {
    const colorMap = {
        primary: 'text-primary bg-primary/10',
        emerald: 'text-emerald-400 bg-emerald-500/10',
        violet: 'text-violet-400 bg-violet-500/10',
        amber: 'text-amber-400 bg-amber-500/10',
    };
    return (
        <div className="p-4 bg-surface/50 border border-white/5 rounded-xl">
            <div className={`w-8 h-8 rounded-lg ${colorMap[color]} flex items-center justify-center mb-3`}>
                <Icon className="w-4 h-4" />
            </div>
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{label}</p>
        </div>
    );
}

function FormatCard({ ext, desc, icon: Icon }) {
    return (
        <div className="p-4 bg-surface/30 border border-white/5 rounded-xl">
            <div className="flex items-center gap-2 mb-2">
                <Icon className="w-4 h-4 text-gray-400" />
                <span className="text-sm font-medium">.{ext.toLowerCase()}</span>
            </div>
            <p className="text-xs text-gray-500">{desc}</p>
        </div>
    );
}
