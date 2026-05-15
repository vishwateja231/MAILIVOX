import { useState } from 'react';
import { Copy, Download, Check, AlertCircle, HelpCircle, MailQuestion } from 'lucide-react';
import Papa from 'papaparse';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export default function ResultsTable({ emails, domain, loading }) {
  const [copiedIndex, setCopiedIndex] = useState(null);

  const handleCopy = (email, index) => {
    navigator.clipboard.writeText(email);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleExport = () => {
    const csvData = emails.map(e => ({
      Email: e.email,
      Pattern: e.pattern,
      Confidence: e.confidence,
      Status: e.status
    }));
    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `emails_${domain}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) {
    return (
      <div className="glass-card p-12 flex flex-col items-center justify-center text-gray-400 h-full min-h-[400px]">
        <div className="w-12 h-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin mb-4" />
        <p className="animate-pulse">Discovering domain and generating permutations...</p>
      </div>
    );
  }

  if (!emails || emails.length === 0) {
    return (
      <div className="glass-card p-12 flex flex-col items-center justify-center text-gray-500 h-full min-h-[400px]">
        <MailQuestion className="w-16 h-16 mb-4 opacity-50" />
        <p className="text-lg">Enter a name and company to generate emails.</p>
      </div>
    );
  }

  const getStatusBadge = (status) => {
    if (status === 'VALID') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-success/20 text-success border border-success/30">
          <Check className="w-3.5 h-3.5" /> Valid
        </span>
      );
    }
    if (status.includes('INVALID')) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-danger/20 text-danger border border-danger/30">
          <AlertCircle className="w-3.5 h-3.5" /> Invalid
        </span>
      );
    }
    if (status.includes('RISKY') || status.includes('CATCH-ALL')) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-warning/20 text-warning border border-warning/30">
          <AlertCircle className="w-3.5 h-3.5" /> Catch-All
        </span>
      );
    }
    if (status === 'VERIFYING...') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-primary/20 text-primary border border-primary/30">
          <div className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" /> Verifying
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-500/20 text-gray-400 border border-gray-500/30">
        <HelpCircle className="w-3.5 h-3.5" /> Unverified
      </span>
    );
  };

  return (
    <div className="glass-card overflow-hidden flex flex-col h-full">
      <div className="p-6 border-b border-white/10 flex items-center justify-between bg-surface/30">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            Results
            <span className="bg-primary/20 text-primary text-xs px-2 py-1 rounded-full font-medium">
              {emails.length} Found
            </span>
          </h2>
          {domain && (
            <p className="text-sm text-gray-400 mt-1">
              Domain discovered: <strong className="text-white">{domain}</strong>
            </p>
          )}
        </div>
        
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 bg-surface hover:bg-surface/80 border border-white/10 rounded-lg text-sm transition-colors"
        >
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-surface/50 border-b border-white/10 text-xs uppercase tracking-wider text-gray-400">
              <th className="px-6 py-4 font-medium">Email Address</th>
              <th className="px-6 py-4 font-medium">Pattern</th>
              <th className="px-6 py-4 font-medium">Confidence</th>
              <th className="px-6 py-4 font-medium">Status</th>
              <th className="px-6 py-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {emails.map((item, i) => (
              <tr 
                key={i} 
                className={cn(
                  "hover:bg-white/5 transition-colors",
                  item.status === 'VALID' && "bg-success/5"
                )}
              >
                <td className="px-6 py-4">
                  <div className="font-medium text-white">{item.email}</div>
                </td>
                <td className="px-6 py-4 text-sm text-gray-400">
                  {item.pattern}
                </td>
                <td className="px-6 py-4">
                  <span className={cn(
                    "text-xs font-bold",
                    item.confidence === 'HIGH' ? "text-primary" : 
                    item.confidence === 'MEDIUM' ? "text-gray-300" : "text-gray-500"
                  )}>
                    {item.confidence}
                  </span>
                </td>
                <td className="px-6 py-4">
                  {getStatusBadge(item.status)}
                </td>
                <td className="px-6 py-4 text-right">
                  <button
                    onClick={() => handleCopy(item.email, i)}
                    className="p-2 hover:bg-white/10 rounded-lg transition-colors text-gray-400 hover:text-white"
                    title="Copy to clipboard"
                  >
                    {copiedIndex === i ? (
                      <Check className="w-4 h-4 text-success" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
