import { useState } from 'react';
import { ClipboardPaste, Wand2, X, User, Building2, Briefcase } from 'lucide-react';
import { parseLinkedIn } from '../api';
import clsx from 'clsx';

/**
 * LinkedInPastePanel
 * Allows the user to paste a single LinkedIn profile text.
 * Parses it, shows a preview of extracted fields, and auto-fills SearchForm fields.
 */
export default function LinkedInPastePanel({ onExtracted }) {
    const [rawText, setRawText] = useState('');
    const [parsing, setParsing] = useState(false);
    const [parsed, setParsed] = useState(null);
    const [error, setError] = useState(null);

    const handleParse = async () => {
        if (!rawText.trim()) return;
        setParsing(true);
        setError(null);
        setParsed(null);

        try {
            const res = await parseLinkedIn(rawText);
            setParsed(res.data);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to parse. Check backend is running.');
        } finally {
            setParsing(false);
        }
    };

    const handleUse = () => {
        if (!parsed) return;
        onExtracted({
            fullName: parsed.fullName,
            companyName: parsed.company,
        });
        // Reset
        setRawText('');
        setParsed(null);
    };

    const confidenceColor = (level) =>
        level === 'HIGH' ? 'text-success' : level === 'MEDIUM' ? 'text-warning' : 'text-gray-400';

    return (
        <div className="glass-card p-5 space-y-4">
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
                <ClipboardPaste className="w-4 h-4 text-primary" /> Paste LinkedIn Profile
            </h3>

            <div className="relative">
                <textarea
                    className="input-glowing w-full h-32 resize-none text-sm leading-relaxed"
                    placeholder={`Paste LinkedIn profile text here...\n\nExample:\nShamita Singh\n· 2nd\nRecruitment Specialist || Honeywell\nGurugram, Haryana, India`}
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                />
                {rawText && (
                    <button
                        onClick={() => { setRawText(''); setParsed(null); }}
                        className="absolute top-2 right-2 p-1 rounded-md hover:bg-white/10 text-gray-500 hover:text-white transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                )}
            </div>

            <button
                onClick={handleParse}
                disabled={!rawText.trim() || parsing}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-purple-600/30 hover:bg-purple-600/50 border border-purple-500/40 text-purple-300 text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
                {parsing ? (
                    <div className="w-4 h-4 border-2 border-purple-300/30 border-t-purple-300 rounded-full animate-spin" />
                ) : (
                    <Wand2 className="w-4 h-4" />
                )}
                {parsing ? 'Parsing...' : 'Auto-Extract Fields'}
            </button>

            {error && (
                <p className="text-danger text-xs">{error}</p>
            )}

            {parsed && parsed.fullName && (
                <div className="mt-2 space-y-3 bg-surface/60 rounded-lg p-4 border border-white/10">
                    <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-2">Extracted Fields</p>

                    <ExtractedField icon={<User className="w-3.5 h-3.5" />} label="Name" value={parsed.fullName} confidence={parsed.confidence?.name} confidenceColor={confidenceColor} />
                    <ExtractedField icon={<Building2 className="w-3.5 h-3.5" />} label="Company" value={parsed.company} confidence={parsed.confidence?.company} confidenceColor={confidenceColor} />
                    <ExtractedField icon={<Briefcase className="w-3.5 h-3.5" />} label="Role" value={parsed.role} />

                    <button
                        onClick={handleUse}
                        className="w-full mt-3 py-2 rounded-lg bg-primary/20 hover:bg-primary/30 border border-primary/40 text-primary text-sm font-semibold transition-all"
                    >
                        Use These Fields →
                    </button>
                </div>
            )}

            {parsed && !parsed.fullName && (
                <p className="text-warning text-xs">Could not detect a name. Try pasting cleaner text.</p>
            )}
        </div>
    );
}

function ExtractedField({ icon, label, value, confidence, confidenceColor }) {
    if (!value) return null;
    return (
        <div className="flex items-start gap-2 text-sm">
            <span className="text-gray-500 mt-0.5 flex-shrink-0">{icon}</span>
            <div className="flex-1 min-w-0">
                <span className="text-gray-500 text-xs">{label}: </span>
                <span className="text-white font-medium">{value}</span>
                {confidence && (
                    <span className={clsx('ml-2 text-xs font-semibold', confidenceColor(confidence))}>
                        {confidence}
                    </span>
                )}
            </div>
        </div>
    );
}
