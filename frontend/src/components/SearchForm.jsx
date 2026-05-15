import { useState, useEffect } from 'react';
import { generateEmails, verifyEmail } from '../api';
import { Search, Building2, User } from 'lucide-react';

export default function SearchForm({ setLoading, setEmails, setDomain, setError, prefill }) {
  const [fullName, setFullName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Auto-fill when parent passes prefill values from LinkedIn paste panel
  useEffect(() => {
    if (prefill?.fullName) setFullName(prefill.fullName);
    if (prefill?.companyName) setCompanyName(prefill.companyName);
  }, [prefill]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!fullName || !companyName) return;

    setLoading(true);
    setError(null);
    setEmails([]);
    setDomain(null);
    setIsSubmitting(true);

    try {
      const res = await generateEmails(fullName, companyName);
      const { domain, emails: generatedEmails } = res.data;
      setDomain(domain);
      setEmails(generatedEmails);
      
      // Verify them one by one in the background
      verifyEmailsSequentially(generatedEmails);

    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || 'Failed to generate emails. Ensure backend is running.');
    } finally {
      setIsSubmitting(false);
      setLoading(false);
    }
  };

  const verifyEmailsSequentially = async (emailList) => {
    for (const emailObj of emailList) {
      try {
        const verifyRes = await verifyEmail(emailObj.email, emailObj.pattern);
        setEmails(prev => prev.map(item => 
          item.email === emailObj.email 
            ? { ...item, status: verifyRes.data.status } 
            : item
        ));
      } catch {
        setEmails(prev => prev.map(item => 
          item.email === emailObj.email 
            ? { ...item, status: 'UNVERIFIED' } 
            : item
        ));
      }
    }
  };

  return (
    <form onSubmit={handleSubmit} className="glass-card p-6 space-y-5">
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">Full Name</label>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <User className="h-5 w-5 text-gray-500" />
          </div>
          <input
            type="text"
            className="input-glowing w-full pl-10"
            placeholder="e.g. John Michael Doe"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            disabled={isSubmitting}
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">Company Name</label>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Building2 className="h-5 w-5 text-gray-500" />
          </div>
          <input
            type="text"
            className="input-glowing w-full pl-10"
            placeholder="e.g. Google"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            required
            disabled={isSubmitting}
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={isSubmitting || !fullName || !companyName}
        className="w-full bg-primary hover:bg-primary/90 text-background font-semibold py-3 px-4 rounded-lg transition-all flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSubmitting ? (
          <div className="w-5 h-5 border-2 border-background/30 border-t-background rounded-full animate-spin" />
        ) : (
          <Search className="w-5 h-5" />
        )}
        {isSubmitting ? 'Generating...' : 'Find Emails'}
      </button>
    </form>
  );
}
