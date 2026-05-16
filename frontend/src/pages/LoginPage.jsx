import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import clsx from 'clsx';

export default function LoginPage({ onLogin }) {
    const navigate = useNavigate();
    const [tab, setTab] = useState('signin');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [loadingMsg, setLoadingMsg] = useState('');
    const [signupSuccess, setSignupSuccess] = useState(false);

    const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

    const handleSignIn = async () => {
        if (!username.trim() || !password) return toast.error('Fill in all fields');
        setLoading(true);
        setLoadingMsg('');

        // Show "waking up" message if request takes > 5s (Render cold start)
        const slowTimer = setTimeout(() => setLoadingMsg('Server is waking up, hang tight...'), 5000);

        try {
            const res = await fetch(`${API}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: username.trim(), password }),
            });
            const data = await res.json();
            if (!res.ok) { toast.error(data.error || 'Login failed'); return; }
            toast.success('Welcome back!');
            onLogin(data.user, data.token);
        } catch (e) { toast.error('Connection failed — server may be starting up. Try again in 30s.'); }
        finally { clearTimeout(slowTimer); setLoading(false); setLoadingMsg(''); }
    };

    const handleSignUp = async () => {
        if (!username.trim() || !password || !confirmPassword) return toast.error('Fill in all fields');
        if (password !== confirmPassword) return toast.error('Passwords do not match');
        if (password.length < 6) return toast.error('Password must be at least 6 characters');
        setLoading(true);
        setLoadingMsg('');
        const slowTimer = setTimeout(() => setLoadingMsg('Server is waking up, hang tight...'), 5000);
        try {
            const res = await fetch(`${API}/api/auth/signup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: username.trim(), password }),
            });
            const data = await res.json();
            if (!res.ok) { toast.error(data.error || 'Signup failed'); return; }
            setSignupSuccess(true);
            toast.success('Account created!');
        } catch (e) { toast.error('Connection failed — server may be starting up. Try again in 30s.'); }
        finally { clearTimeout(slowTimer); setLoading(false); setLoadingMsg(''); }
    };

    return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
            {/* Background effects */}
            <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-primary/20 blur-[120px] animate-blob" />
                <div className="absolute bottom-[-20%] right-[-10%] w-[40%] h-[40%] rounded-full bg-indigo-500/20 blur-[120px] animate-blob animation-delay-2000" />
            </div>

            {/* Back to home */}
            <button
                onClick={() => navigate('/')}
                className="fixed top-6 left-6 z-20 flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
            >
                <ArrowLeft className="w-4 h-4" />
                Back to Home
            </button>

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative z-10 w-full max-w-md"
            >
                {/* Logo */}
                <div className="text-center mb-8">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-indigo-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-primary/30">
                        <Send className="w-6 h-6 text-white" />
                    </div>
                    <h1 className="text-2xl font-bold text-white">MAILI<span className="text-primary">VOX</span></h1>
                    <p className="text-gray-500 text-sm mt-1">Outreach Intelligence Platform</p>
                </div>

                {/* Card */}
                <div className="bg-surface/50 backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-2xl">
                    {signupSuccess ? (
                        <div className="text-center py-8 space-y-4">
                            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto">
                                <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                            </div>
                            <h3 className="text-lg font-bold text-white">Account Created!</h3>
                            <p className="text-sm text-gray-400">Your account is pending admin approval. You&apos;ll be able to sign in once approved.</p>
                            <button onClick={() => { setSignupSuccess(false); setTab('signin'); }} className="text-primary text-sm hover:underline">
                                Back to Sign In
                            </button>
                        </div>
                    ) : (
                        <>
                            {/* Tabs */}
                            <div className="flex gap-1 bg-background/50 p-1 rounded-xl mb-6">
                                <button
                                    onClick={() => setTab('signin')}
                                    className={clsx('flex-1 py-2 rounded-lg text-sm font-medium transition-all', tab === 'signin' ? 'bg-primary/20 text-primary' : 'text-gray-400 hover:text-white')}
                                >
                                    Sign In
                                </button>
                                <button
                                    onClick={() => setTab('signup')}
                                    className={clsx('flex-1 py-2 rounded-lg text-sm font-medium transition-all', tab === 'signup' ? 'bg-primary/20 text-primary' : 'text-gray-400 hover:text-white')}
                                >
                                    Sign Up
                                </button>
                            </div>

                            {/* Form */}
                            <div className="space-y-4">
                                <div>
                                    <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1.5 block">Username</label>
                                    <input
                                        value={username}
                                        onChange={e => setUsername(e.target.value)}
                                        placeholder="Enter username"
                                        className="w-full bg-background border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30"
                                        onKeyDown={e => e.key === 'Enter' && (tab === 'signin' ? handleSignIn() : handleSignUp())}
                                    />
                                </div>
                                <div className="relative">
                                    <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1.5 block">Password</label>
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        value={password}
                                        onChange={e => setPassword(e.target.value)}
                                        placeholder="Enter password"
                                        className="w-full bg-background border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 pr-10"
                                        onKeyDown={e => e.key === 'Enter' && (tab === 'signin' ? handleSignIn() : handleSignUp())}
                                    />
                                    <button onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-[34px] text-gray-500 hover:text-white">
                                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                                {tab === 'signup' && (
                                    <div>
                                        <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1.5 block">Confirm Password</label>
                                        <input
                                            type="password"
                                            value={confirmPassword}
                                            onChange={e => setConfirmPassword(e.target.value)}
                                            placeholder="Confirm password"
                                            className="w-full bg-background border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30"
                                            onKeyDown={e => e.key === 'Enter' && handleSignUp()}
                                        />
                                    </div>
                                )}
                                <button
                                    onClick={tab === 'signin' ? handleSignIn : handleSignUp}
                                    disabled={loading}
                                    className="w-full py-3 rounded-xl font-semibold text-sm bg-gradient-to-r from-primary to-indigo-500 text-white shadow-lg shadow-primary/20 hover:shadow-primary/40 disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
                                >
                                    {loading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : null}
                                    {tab === 'signin' ? 'Sign In' : 'Create Account'}
                                </button>
                                {loadingMsg && (
                                    <p className="text-xs text-center text-gray-500 mt-2 animate-pulse">{loadingMsg}</p>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </motion.div>
        </div>
    );
}
