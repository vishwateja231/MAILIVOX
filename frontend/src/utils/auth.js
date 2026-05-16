/**
 * Auth utility — JWT token management with persistent sessions.
 * Token is stored in localStorage and validated on app startup.
 * Users stay logged in until they explicitly log out or the token expires.
 */

const TOKEN_KEY = 'mailivox_token';
const USER_KEY = 'mailivox_user';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/**
 * Decode a JWT payload without verifying signature (client-side only).
 */
export function decodeToken(token) {
    try {
        const payload = token.split('.')[1];
        return JSON.parse(atob(payload));
    } catch {
        return null;
    }
}

/**
 * Check if a token is expired based on its `exp` claim.
 */
export function isTokenExpired(token) {
    const payload = decodeToken(token);
    if (!payload || !payload.exp) return true;
    // exp is in seconds, Date.now() is in ms
    return Date.now() >= payload.exp * 1000;
}

/**
 * Get the stored token from localStorage.
 */
export function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}

/**
 * Get the stored user from localStorage.
 */
export function getStoredUser() {
    try {
        const raw = localStorage.getItem(USER_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

/**
 * Save auth data to localStorage.
 */
export function saveAuth(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
}

/**
 * Clear all auth data from localStorage.
 */
export function clearAuth() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
}

/**
 * Restore session on app startup.
 * Returns the user object if the token is still valid, null otherwise.
 * Does NOT make a network call — uses local token expiry check for instant restore.
 */
export function restoreSession() {
    const token = getToken();
    if (!token) return null;

    if (isTokenExpired(token)) {
        clearAuth();
        return null;
    }

    return getStoredUser();
}

/**
 * Validate the token against the backend (optional, for extra security).
 * Call this after initial render to confirm the session is still valid server-side.
 */
export async function validateSession() {
    const token = getToken();
    if (!token || isTokenExpired(token)) {
        clearAuth();
        return null;
    }

    try {
        const res = await fetch(`${API}/api/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
            clearAuth();
            return null;
        }
        const user = await res.json();
        // Update stored user in case role/permissions changed
        localStorage.setItem(USER_KEY, JSON.stringify(user));
        return user;
    } catch {
        // Network error — keep the session alive (offline-friendly)
        return getStoredUser();
    }
}
