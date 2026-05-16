/**
 * keyManager.js — CheckMail API Key Rotation (Supabase-backed)
 * ─────────────────────────────────────────────────────────────────────────────
 * Stores keys in PostgreSQL via Prisma. Auto-rotates when exhausted.
 * Sends alert email when only 1 key remains.
 */
const prisma = require('../db/prismaClient');

// ─── Get Current Active Key ──────────────────────────────────────────────────

async function getCurrentKey() {
    const key = await prisma.apiKey.findFirst({
        where: { service: 'checkmail', isActive: true, isExhausted: false },
        orderBy: { createdAt: 'asc' },
    });
    return key ? key.key : null;
}

// ─── Record Usage (call after each verification) ─────────────────────────────

async function recordUsage(count = 1) {
    const key = await prisma.apiKey.findFirst({
        where: { service: 'checkmail', isActive: true, isExhausted: false },
        orderBy: { createdAt: 'asc' },
    });
    if (!key) return;

    const newUsed = key.creditsUsed + count;
    const exhausted = newUsed >= key.creditLimit;

    await prisma.apiKey.update({
        where: { id: key.id },
        data: {
            creditsUsed: newUsed,
            lastUsedAt: new Date(),
            isExhausted: exhausted,
            isActive: !exhausted,
        },
    });

    if (exhausted) {
        console.log(`[keyManager] Key "${key.label || key.id}" exhausted (${newUsed}/${key.creditLimit})`);

        // Check TOTAL remaining credits across ALL keys
        const allKeys = await prisma.apiKey.findMany({ where: { service: 'checkmail' } });
        const totalRemaining = allKeys.reduce((s, k) => s + Math.max(0, k.creditLimit - k.creditsUsed), 0);

        // Only alert when total credits across all keys drops below 10
        if (totalRemaining < 10) {
            sendRefillAlert(totalRemaining);
        }

        if (totalRemaining === 0) {
            console.warn('[keyManager] ALL KEYS EXHAUSTED — 0 credits remaining');
        }
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

module.exports = { getCurrentKey, recordUsage, getKeyStats, addKey, removeKey, removeExhaustedKeys };
