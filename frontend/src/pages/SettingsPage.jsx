import { useState, useEffect } from 'react';
import { Key, Plus, Trash2, RefreshCw, CheckCircle2, AlertCircle, Users, Shield, ShieldCheck, Clock, UserCheck, UserX } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import clsx from 'clsx';
import { getKeyStats, addApiKey, deleteApiKey, cleanupExhaustedKeys } from '../api';

const PERMISSIONS = ['sendEmails', 'viewLeads', 'manageKeys', 'importData'];

export default function SettingsPage({ user }) {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [newKey, setNewKey] = useState('');
    const [newLabel, setNewLabel] = useState('');
    const [adding, setAdding] = useState(false);

    // User management state
    const [users, setUsers] = useState([]);
    const [usersLoading, setUsersLoading] = useState(false);

    const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    const token = localStorage.getItem('mailivox_token');

    const load = async () => {
        try {
            const res = await getKeyStats();
            setStats(res.data);
        } catch { toast.error('Failed to load key stats'); }
        finally { setLoading(false); }
    };

    const loadUsers = async () => {
        if (user?.role !== 'admin') return;
        setUsersLoading(true);
        try {
            const res = await fetch(`${API}/api/auth/users`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await res.json();
            if (Array.isArray(data)) setUsers(data);
        } catch { toast.error('Failed to load users'); }
        finally { setUsersLoading(false); }
    };

    useEffect(() => { load(); loadUsers(); }, []);

    const handleAdd = async () => {
        if (!newKey.trim()) return toast.error('Paste an API key');
        if (!newKey.startsWith('cm_live_')) return toast.error('Key must start with cm_live_');
        setAdding(true);
        try {
            const res = await addApiKey(newKey.trim(), newLabel.trim() || null, 100);
            if (res.data.error) { toast.error(res.data.error); return; }
            toast.success('Key added');
            setNewKey('');
            setNewLabel('');
            load();
        } catch (e) { toast.error(e.response?.data?.error || 'Failed to add'); }
        finally { setAdding(false); }
    };

    const handleDelete = async (id) => {
        try {
            await deleteApiKey(id);
            toast.success('Key removed');
            load();
        } catch { toast.error('Failed to remove'); }
    };

    const handleCleanup = async () => {
        try {
            const res = await cleanupExhaustedKeys();
            toast.success(`Removed ${res.data.removed} exhausted keys`);
            load();
        } catch { toast.error('Cleanup failed'); }
    };

    // User management actions
    const updateUser = async (userId, data) => {
        try {
            const res = await fetch(`${API}/api/auth/users/${userId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify(data),
            });
            if (!res.ok) { toast.error('Update failed'); return; }
            toast.success('User updated');
            loadUsers();
        } catch { toast.error('Update failed'); }
    };

    const deleteUser = async (userId) => {
        if (!confirm('Delete this user permanently?')) return;
        try {
            const res = await fetch(`${API}/api/auth/users/${userId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) { toast.error('Delete failed'); return; }
            toast.success('User deleted');
            loadUsers();
        } catch { toast.error('Delete failed'); }
    };

    const togglePermission = (userId, currentPerms, perm) => {
        const perms = currentPerms.includes(perm)
            ? currentPerms.filter(p => p !== perm)
            : [...currentPerms, perm];
        updateUser(userId, { permissions: perms });
    };

    if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="w-6 h-6 animate-spin text-gray-500" /></div>;

    return (
        <div className="space-y-8 max-w-4xl">
            <div>
                <h1 className="text-2xl font-bold">Settings</h1>
                <p className="text-gray-400 mt-1">Manage verification API keys and system configuration.</p>
            </div>

            {/* ═══ Admin: User Management ═══ */}
            {user?.role === 'admin' && (
                <div className="space-y-4">
                    <div className="flex items-center gap-2">
                        <Shield className="w-5 h-5 text-primary" />
                        <h2 className="text-lg font-bold">User Management</h2>
                    </div>

                    {usersLoading ? (
                        <div className="flex items-center justify-center h-32"><RefreshCw className="w-5 h-5 animate-spin text-gray-500" /></div>
                    ) : (
                        <div className="glass-panel rounded-2xl overflow-hidden">
                            <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
                                <h3 className="text-sm font-semibold flex items-center gap-2">
                                    <Users className="w-4 h-4 text-primary" /> All Users ({users.length})
                                </h3>
                                <button onClick={loadUsers} className="text-[10px] text-gray-500 hover:text-primary transition-colors flex items-center gap-1">
                                    <RefreshCw className="w-3 h-3" /> Refresh
                                </button>
                            </div>
                            <div className="divide-y divide-white/5">
                                {users.length === 0 ? (
                                    <div className="px-5 py-8 text-center text-gray-500 text-sm">No users found.</div>
                                ) : (
                                    users.map(u => (
                                        <div key={u.id} className="px-5 py-4 space-y-3">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className={clsx(
                                                        "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold",
                                                        u.role === 'admin' ? 'bg-primary/20 text-primary' :
                                                        u.isApproved ? 'bg-emerald-500/20 text-emerald-400' :
                                                        'bg-amber-500/20 text-amber-400'
                                                    )}>
                                                        {u.username.charAt(0).toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-medium text-white flex items-center gap-2">
                                                            {u.username}
                                                            {u.role === 'admin' && <ShieldCheck className="w-3.5 h-3.5 text-primary" />}
                                                        </p>
                                                        <div className="flex items-center gap-3 text-[10px] text-gray-500">
                                                            <span className="flex items-center gap-1">
                                                                <Clock className="w-3 h-3" />
                                                                Joined {new Date(u.createdAt).toLocaleDateString()}
                                                            </span>
                                                            {u.lastLoginAt && (
                                                                <span>Last login: {new Date(u.lastLoginAt).toLocaleDateString()}</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {/* Approval toggle */}
                                                    {u.role !== 'admin' && (
                                                        <button
                                                            onClick={() => updateUser(u.id, { isApproved: !u.isApproved })}
                                                            className={clsx(
                                                                "px-3 py-1.5 rounded-lg text-[10px] font-medium flex items-center gap-1.5 transition-all",
                                                                u.isApproved
                                                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20'
                                                                    : 'bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20'
                                                            )}
                                                        >
                                                            {u.isApproved ? <><UserCheck className="w-3 h-3" /> Approved</> : <><UserX className="w-3 h-3" /> Pending</>}
                                                        </button>
                                                    )}
                                                    {/* Role selector */}
                                                    <select
                                                        value={u.role}
                                                        onChange={e => updateUser(u.id, { role: e.target.value })}
                                                        className="bg-background border border-white/10 rounded-lg px-2 py-1.5 text-[10px] text-white focus:outline-none focus:border-primary/50"
                                                    >
                                                        <option value="admin">Admin</option>
                                                        <option value="user">User</option>
                                                        <option value="pending">Pending</option>
                                                    </select>
                                                    {/* Delete */}
                                                    {u.username !== 'vishwateja2345' && (
                                                        <button
                                                            onClick={() => deleteUser(u.id)}
                                                            className="p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                            {/* Permissions */}
                                            {u.role !== 'admin' && (
                                                <div className="flex items-center gap-2 pl-11">
                                                    <span className="text-[9px] text-gray-500 uppercase tracking-wider mr-1">Permissions:</span>
                                                    {PERMISSIONS.map(perm => (
                                                        <button
                                                            key={perm}
                                                            onClick={() => togglePermission(u.id, u.permissions || [], perm)}
                                                            className={clsx(
                                                                "px-2 py-0.5 rounded text-[9px] font-medium transition-all border",
                                                                (u.permissions || []).includes(perm)
                                                                    ? 'bg-primary/10 text-primary border-primary/30'
                                                                    : 'bg-background text-gray-500 border-white/5 hover:border-white/20'
                                                            )}
                                                        >
                                                            {perm}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ═══ API Key Stats ═══ */}
            <div className="grid grid-cols-4 gap-4">
                <StatBox label="Total Keys" value={stats?.totalKeys || 0} color="text-white" />
                <StatBox label="Active" value={stats?.activeKeys || 0} color="text-emerald-400" />
                <StatBox label="Exhausted" value={stats?.exhaustedKeys || 0} color="text-red-400" />
                <StatBox label="Credits Left" value={stats?.totalRemaining || 0} color="text-primary" />
            </div>

            {/* Keys List */}
            <div className="glass-panel rounded-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
                    <h3 className="text-sm font-semibold flex items-center gap-2"><Key className="w-4 h-4 text-primary" /> CheckMail API Keys</h3>
                    {stats?.exhaustedKeys > 0 && (
                        <button onClick={handleCleanup} className="text-[10px] text-gray-500 hover:text-red-400 transition-colors">
                            Remove exhausted
                        </button>
                    )}
                </div>
                <div className="divide-y divide-white/5">
                    {stats?.keys?.length === 0 ? (
                        <div className="px-5 py-8 text-center text-gray-500 text-sm">No keys added. Add one below.</div>
                    ) : (
                        stats?.keys?.map(k => (
                            <div key={k.id} className={clsx("px-5 py-3 flex items-center gap-4", k.isExhausted && "opacity-50")}>
                                <div className={clsx("w-2 h-2 rounded-full shrink-0", k.isActive ? "bg-emerald-400" : k.isExhausted ? "bg-red-400" : "bg-gray-500")} />
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-white">{k.label || 'Unnamed Key'}</p>
                                    <p className="text-[10px] text-gray-500 font-mono truncate">cm_live_...{k.id?.slice(-6)}</p>
                                </div>
                                <div className="text-right shrink-0">
                                    <div className="flex items-center gap-2">
                                        <div className="w-24 h-1.5 bg-black/50 rounded-full overflow-hidden">
                                            <div
                                                className={clsx("h-full rounded-full", k.isExhausted ? "bg-red-500" : k.remaining < 20 ? "bg-amber-500" : "bg-emerald-500")}
                                                style={{ width: `${Math.max(0, (k.remaining / k.creditLimit) * 100)}%` }}
                                            />
                                        </div>
                                        <span className="text-[10px] text-gray-400 w-12 text-right">{k.remaining}/{k.creditLimit}</span>
                                    </div>
                                </div>
                                <button onClick={() => handleDelete(k.id)} className="p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0">
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Add New Key */}
            <div className="glass-card p-5 space-y-3">
                <h4 className="text-sm font-semibold flex items-center gap-2"><Plus className="w-4 h-4 text-primary" /> Add New Key</h4>
                <p className="text-xs text-gray-500">Get keys from <a href="https://checkmail.dev" target="_blank" rel="noreferrer" className="text-primary hover:underline">checkmail.dev</a> (100 free credits per key)</p>
                <div className="flex gap-2">
                    <input
                        value={newKey}
                        onChange={e => setNewKey(e.target.value)}
                        placeholder="cm_live_xxxxxxxxxxxxxxxx"
                        className="flex-1 bg-background border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-primary/50"
                    />
                    <input
                        value={newLabel}
                        onChange={e => setNewLabel(e.target.value)}
                        placeholder="Label (optional)"
                        className="w-32 bg-background border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-primary/50"
                    />
                    <button onClick={handleAdd} disabled={adding} className="px-4 py-2 rounded-lg text-xs font-medium bg-primary/20 border border-primary/30 text-primary hover:bg-primary/30 disabled:opacity-50 flex items-center gap-1.5 transition-colors">
                        {adding ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                        Add
                    </button>
                </div>
            </div>

            {/* Info */}
            <div className="flex items-start gap-3 p-4 bg-primary/5 border border-primary/10 rounded-xl">
                <AlertCircle className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <div className="text-xs text-gray-400 space-y-1">
                    <p>Keys auto-rotate when credits run out. When only 1 key remains, you&apos;ll get an email alert at vishwateja2345@gmail.com.</p>
                    <p>Each verification costs 1 credit. &quot;Unknown&quot; results (rate-limited) are free and retried later.</p>
                </div>
            </div>
        </div>
    );
}

function StatBox({ label, value, color }) {
    return (
        <div className="glass-card p-4 text-center">
            <p className={clsx("text-2xl font-bold", color)}>{value}</p>
            <p className="text-[9px] text-gray-500 uppercase tracking-wider mt-1">{label}</p>
        </div>
    );
}
