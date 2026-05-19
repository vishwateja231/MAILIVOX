/**
 * keyManager.js — CheckMail API Key Rotation (Supabase-backed)
 * ─────────────────────────────────────────────────────────────────────────────
 * Stores keys in PostgreSQL via Prisma. Auto-rotates when exhausted.
 * 
 * FIXED: getCurrentKey now returns { key, id } so recordUsage can track
 * the EXACT key that was used, preventing credit count drift.
 */
const prisma = require('../db/prismaClient');

// ─── Get Current Active Key ──────────────────────────────────────────────────

/**
 * Returns { key: string, id: string } for the first available key,
 * or null if all keys are exhausted.
 */
async function getCurrentKey() {
    const keys = await prisma.apiKey.findMany({
        where: { service: 'checkmail', isActive: true, isExhausted: false },
        orderBy: { createdAt: 'asc' },
    });
    
    for (const key of keys) {
        if (key.creditsUsed < key.creditLimit) {
            return { key: key.key, id: key.id };
        }
        // Key is actually exhausted but wasn't marked — fix it
        await prisma.apiKey.update({
            where: { id: key.id },
            data: { isExhausted: true, isActive: false },
        }).catch(() => {});
        console.log(`[keyManager] Auto-marking key "${key.label || key.id}" as exhausted (${key.creditsUsed}/${key.creditLimit})`);
    }
    
    return null;
}

/**
 * Mark a specific key as exhausted (called when API returns 402).
 * Auto-deletes the exhausted key and rotates to the next available one.
 * @param {string} keyId - the DB id of the key to mark
 * @returns {object|null} next available key or null
 */
async function markKeyExhausted(keyId) {
    if (!keyId) return getCurrentKey();
    
    // Auto-delete the exhausted key (ignore if already deleted)
    try {
        const key = await prisma.apiKey.findUnique({ where: { id: keyId } });
        if (key) {
            await prisma.apiKey.delete({ where: { id: keyId } });
            console.log(`[keyManager] Key "${key.label || keyId}" exhausted and auto-deleted.`);
        }
    } catch (_) { /* already deleted or doesn't exist */ }

    return getCurrentKey();
}

// ─── Record Usage for a SPECIFIC key ─────────────────────────────────────────

/**
 * Record credit usage against a specific key by its DB id.
 * @param {string} keyId - the DB id of the key that was used
 * @param {number} count - number of credits consumed (default 1)
 */
async function recordUsage(keyId, count = 1) {
    if (!keyId) return;

    let key;
    try {
        key = await prisma.apiKey.findUnique({ where: { id: keyId } });
    } catch (_) { return; }
    if (!key) return; // Key was already deleted

    const newUsed = key.creditsUsed + count;
    const exhausted = newUsed >= key.creditLimit;

    if (exhausted) {
        // Auto-delete the exhausted key
        await prisma.apiKey.delete({ where: { id: keyId } }).catch(() => {});
        console.log(`[keyManager] Key "${key.label || keyId}" exhausted (${newUsed}/${key.creditLimit}) — auto-deleted`);

        const allKeys = await prisma.apiKey.findMany({ where: { service: 'checkmail' } });
        const totalRemaining = allKeys.reduce((s, k) => s + Math.max(0, k.creditLimit - k.creditsUsed), 0);

        if (totalRemaining < 10) {
            sendRefillAlert(totalRemaining);
        }
        if (totalRemaining === 0) {
            console.warn('[keyManager] ALL KEYS EXHAUSTED — 0 credits remaining. Add new keys in Settings.');
        }
    } else {
        await prisma.apiKey.update({
            where: { id: keyId },
            data: {
                creditsUsed: newUsed,
                lastUsedAt: new Date(),
            },
        }).catch(() => {});
    }
}

// ─── Send Alert ──────────────────────────────────────────────────────────────

async function sendRefillAlert(remainingCredits) {
    try {
        const { Resend } = require('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
            from: process.env.MAIL_FROM || 'jobs@vishwateja.online',
            to: 'vishwateja2345@gmail.com',
            subject: '⚠️ Mailivox: Verification Credits Almost Empty',
            html: `<h2>API Credits Alert</h2><p>Only <strong>${remainingCredits}</strong> total credits remaining across all keys. Please add more in Settings.</p>`,
            text: `API Credits Alert: Only ${remainingCredits} total credits remaining. Please add more keys.`,
        });
        console.log('[keyManager] Low credits alert sent');
    } catch (e) {
        console.error('[keyManager] Alert failed:', e.message);
    }
}

// ─── Get Stats ───────────────────────────────────────────────────────────────

async function getKeyStats() {
    const keys = await prisma.apiKey.findMany({
        where: { service: 'checkmail' },
        orderBy: { createdAt: 'asc' },
    });

    const totalRemaining = keys.reduce((s, k) => s + Math.max(0, k.creditLimit - k.creditsUsed), 0);
    const totalUsed = keys.reduce((s, k) => s + k.creditsUsed, 0);

    return {
        keys: keys.map(k => ({
            id: k.id,
            label: k.label,
            key: k.key,
            creditsUsed: k.creditsUsed,
            creditLimit: k.creditLimit,
            remaining: k.creditLimit - k.creditsUsed,
            isActive: k.isActive,
            isExhausted: k.isExhausted,
            lastUsedAt: k.lastUsedAt,
            createdAt: k.createdAt,
        })),
        totalKeys: keys.length,
        activeKeys: keys.filter(k => !k.isExhausted).length,
        exhaustedKeys: keys.filter(k => k.isExhausted).length,
        totalUsed,
        totalRemaining,
    };
}

// ─── Add Key ─────────────────────────────────────────────────────────────────

async function addKey(apiKey, label = null, limit = 100) {
    const existing = await prisma.apiKey.findUnique({ where: { key: apiKey } });
    if (existing) return { error: 'Key already exists' };

    await prisma.apiKey.create({
        data: { service: 'checkmail', key: apiKey, label, creditLimit: limit, isActive: true },
    });
    return { ok: true };
}

// ─── Remove Key ──────────────────────────────────────────────────────────────

async function removeKey(id) {
    await prisma.apiKey.delete({ where: { id } });
    return { ok: true };
}

// ─── Remove All Exhausted ────────────────────────────────────────────────────

async function removeExhaustedKeys() {
    const result = await prisma.apiKey.deleteMany({
        where: { service: 'checkmail', isExhausted: true },
    });
    return { removed: result.count };
}

module.exports = { getCurrentKey, markKeyExhausted, recordUsage, getKeyStats, addKey, removeKey, removeExhaustedKeys };
