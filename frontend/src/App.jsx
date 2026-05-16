import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useLocation, Navigate } from 'react-router-dom';
import { Brain, Users, BarChart3, Zap, LayoutDashboard, Building2, HardDrive, Layers, Bell, Search, Settings, PanelLeftClose, PanelLeft, Database, TerminalSquare, Send, Upload, LogOut } from 'lucide-react';
import { Toaster } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';

// Import Pages
import CRMDashboard from './pages/CRMDashboard';
import LeadsPage from './pages/LeadsPage';
import EnginePage from './pages/EnginePage';
import CompaniesPage from './pages/CompaniesPage';
import SessionsPage from './pages/SessionsPage';
import SheetsPage from './pages/SheetsPage';
import AnalyticsPage from './pages/AnalyticsPage';
import OutreachPage from './pages/OutreachPage';
import ImportPage from './pages/ImportPage';
import SettingsPage from './pages/SettingsPage';
import LoginPage from './pages/LoginPage';
import LandingPage from './pages/landing/LandingPage';

// Auth utilities
import { restoreSession, validateSession, clearAuth, saveAuth } from './utils/auth';

// ─── Animated Background ────────────────────────────────────────────────────────
function Background() {
    return (
        <div className="fixed inset-0 z-[-1] overflow-hidden bg-background pointer-events-none">
            {/* Grid Pattern */}
            <div className="absolute inset-0 bg-grid-pattern opacity-30" />
            
            {/* Glowing Blobs */}
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-primary/20 blur-[120px] animate-blob" />
            <div className="absolute top-[20%] right-[-10%] w-[40%] h-[40%] rounded-full bg-indigo-500/20 blur-[120px] animate-blob animation-delay-2000" />
            <div className="absolute bottom-[-20%] left-[20%] w-[40%] h-[40%] rounded-full bg-violet-600/20 blur-[120px] animate-blob animation-delay-4000" />
        </div>
    );
}

// ─── Sidebar ────────────────────────────────────────────────────────────────
const NAV_ITEMS = [
    { section: 'Overview', items: [
        { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
        { to: '/analytics', icon: BarChart3, label: 'Analytics' },
    ]},
    { section: 'Workspace', items: [
        { to: '/engine', icon: TerminalSquare, label: 'Lead Intelligence' },
        { to: '/outreach', icon: Send, label: 'Outreach' },
        { to: '/import', icon: Upload, label: 'Import Data' },
        { to: '/sheets', icon: Database, label: 'Google Sheets' },
    ]},
    { section: 'Data', items: [
        { to: '/leads', icon: Users, label: 'Contacts' },
        { to: '/companies', icon: Building2, label: 'Company Insights' },
        { to: '/sessions', icon: Layers, label: 'Pipelines' },
    ]},
];

function Sidebar({ collapsed, setCollapsed }) {
    return (
        <motion.aside 
            initial={false}
            animate={{ width: collapsed ? 80 : 260 }}
            className="flex-shrink-0 bg-surface/30 backdrop-blur-xl border-r border-white/5 flex flex-col z-20"
        >
            {/* Logo Area */}
            <div className="h-16 flex items-center justify-between px-4 border-b border-white/5">
                <div className="flex items-center gap-3 overflow-hidden whitespace-nowrap">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-indigo-500 flex items-center justify-center shadow-[0_0_15px_rgba(56,189,248,0.4)] shrink-0">
                        <Send className="w-4 h-4 text-white" />
                    </div>
                    <AnimatePresence>
                        {!collapsed && (
                            <motion.span 
                                initial={{ opacity: 0, x: -10 }} 
                                animate={{ opacity: 1, x: 0 }} 
                                exit={{ opacity: 0, x: -10 }}
                                className="font-bold tracking-wide text-sm"
                            >
                                MAILI<span className="text-primary">VOX</span>
                            </motion.span>
                        )}
                    </AnimatePresence>
                </div>
                <button onClick={() => setCollapsed(!collapsed)} className="text-gray-400 hover:text-white transition-colors shrink-0">
                    {collapsed ? <PanelLeft className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
                </button>
            </div>

            {/* Nav Links */}
            <div className="flex-1 overflow-y-auto py-6 px-3 space-y-6">
                {NAV_ITEMS.map((group, i) => (
                    <div key={i}>
                        {!collapsed && <p className="px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{group.section}</p>}
                        <div className="space-y-1">
                            {group.items.map((item) => (
                                <NavLink
                                    key={item.to}
                                    to={item.to}
                                    className={({ isActive }) => clsx(
                                        'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group overflow-hidden whitespace-nowrap',
                                        isActive
                                            ? 'bg-primary/10 text-primary shadow-[inset_2px_0_0_0_rgba(56,189,248,1)]'
                                            : 'text-gray-400 hover:text-white hover:bg-white/5'
                                    )}
                                    title={collapsed ? item.label : undefined}
                                >
                                    <item.icon className={clsx("w-5 h-5 shrink-0 transition-colors group-hover:text-primary")} />
                                    <AnimatePresence>
                                        {!collapsed && (
                                            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                                {item.label}
                                            </motion.span>
                                        )}
                                    </AnimatePresence>
                                </NavLink>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            {/* Bottom Actions */}
            <div className="p-4 border-t border-white/5">
                <NavLink to="/settings" className={({ isActive }) => clsx("flex items-center gap-3 w-full px-3 py-2 rounded-xl transition-all overflow-hidden whitespace-nowrap", isActive ? "bg-primary/10 text-primary" : "text-gray-400 hover:text-white hover:bg-white/5")}>
                    <Settings className="w-5 h-5 shrink-0" />
                    {!collapsed && <span className="text-sm font-medium">Settings</span>}
                </NavLink>
            </div>
        </motion.aside>
    );
}

// ─── Topbar ──────────────────────────────────────────────────────────────────
function Topbar({ user, onLogout }) {
    const location = useLocation();
    const title = NAV_ITEMS.flatMap(g => g.items).find(i => i.to === location.pathname)?.label || 'Overview';

    return (
        <header className="h-16 flex items-center justify-between px-6 bg-surface/30 backdrop-blur-xl border-b border-white/5 sticky top-0 z-10">
            <h2 className="text-lg font-semibold tracking-wide flex items-center gap-2">
                <span className="text-primary">///</span> {title}
            </h2>
            <div className="flex items-center gap-4">
                <div className="relative group hidden md:block">
                    <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 group-focus-within:text-primary transition-colors" />
                    <input 
                        type="text" 
                        placeholder="Search leads..." 
                        className="bg-background/50 border border-white/10 rounded-full pl-10 pr-4 py-1.5 text-sm focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all w-64"
                    />
                </div>
                <button className="relative text-gray-400 hover:text-white transition-colors">
                    <Bell className="w-5 h-5" />
                    <span className="absolute top-0 right-0 w-2 h-2 bg-primary rounded-full animate-pulse shadow-[0_0_10px_rgba(56,189,248,1)]" />
                </button>
                {/* User info + Logout */}
                <div className="flex items-center gap-3">
                    <div className="hidden md:flex flex-col items-end">
                        <span className="text-xs font-medium text-white">{user?.username}</span>
                        <span className="text-[10px] text-gray-500 uppercase">{user?.role}</span>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-violet-500 to-fuchsia-500 border border-white/20 cursor-pointer shadow-lg hover:scale-105 transition-transform flex items-center justify-center text-[10px] font-bold text-white">
                        {user?.username?.charAt(0)?.toUpperCase()}
                    </div>
                    <button
                        onClick={onLogout}
                        className="p-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
                        title="Logout"
                    >
                        <LogOut className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </header>
    );
}

// ─── App Shell ────────────────────────────────────────────────────────────────
function AppShell({ user, onLogout }) {
    const [collapsed, setCollapsed] = useState(false);

    return (
        <div className="flex h-screen overflow-hidden text-white">
            <Background />
            <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />
            <div className="flex-1 flex flex-col relative">
                <Topbar user={user} onLogout={onLogout} />
                <main className="flex-1 overflow-y-auto p-6 md:p-8 scroll-smooth">
                    <motion.div 
                        key={useLocation().pathname}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2 }}
                        className="max-w-7xl mx-auto w-full h-full"
                    >
                        <Routes>
                            <Route path="/" element={<Navigate to="/dashboard" replace />} />
                            <Route path="/dashboard" element={<CRMDashboard />} />
                            <Route path="/analytics" element={<AnalyticsPage />} />
                            <Route path="/engine" element={<EnginePage />} />
                            <Route path="/outreach" element={<OutreachPage />} />
                            <Route path="/import" element={<ImportPage />} />
                            <Route path="/leads" element={<LeadsPage />} />
                            <Route path="/companies" element={<CompaniesPage />} />
                            <Route path="/sessions" element={<SessionsPage />} />
                            <Route path="/sheets" element={<SheetsPage />} />
                            <Route path="/settings" element={<SettingsPage user={user} />} />
                            <Route path="*" element={<div className="flex items-center justify-center h-full text-gray-500">Page under construction...</div>} />
                        </Routes>
                    </motion.div>
                </main>
            </div>
        </div>
    );
}

export default function App() {
    const [user, setUser] = useState(() => restoreSession());
    const [authChecked, setAuthChecked] = useState(false);

    // Background validation — confirms token is still valid server-side
    useEffect(() => {
        if (user) {
            validateSession().then((validUser) => {
                if (!validUser) {
                    setUser(null);
                } else {
                    setUser(validUser);
                }
                setAuthChecked(true);
            });
        } else {
            setAuthChecked(true);
        }
    }, []);

    const handleLogin = (userData, token) => {
        if (token) saveAuth(token, userData);
        setUser(userData);
    };

    const handleLogout = () => {
        clearAuth();
        setUser(null);
    };

    // Unauthenticated: show landing page at / and login page at /login
    if (!user) {
        return (
            <BrowserRouter>
                <Routes>
                    <Route path="/" element={<LandingPage />} />
                    <Route path="/login" element={<LoginPage onLogin={handleLogin} />} />
                    <Route path="*" element={<LoginPage onLogin={handleLogin} />} />
                </Routes>
                <Toaster theme="dark" position="bottom-right" richColors toastOptions={{ style: { background: '#1E293B', borderColor: 'rgba(255,255,255,0.1)' } }} />
            </BrowserRouter>
        );
    }

    return (
        <BrowserRouter>
            <AppShell user={user} onLogout={handleLogout} />
            <Toaster theme="dark" position="bottom-right" richColors toastOptions={{ style: { background: '#1E293B', borderColor: 'rgba(255,255,255,0.1)' } }} />
        </BrowserRouter>
    );
}
