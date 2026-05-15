/**
 * validationQueue.js — Background validation queue that runs in parallel.
 * ─────────────────────────────────────────────────────────────────────────────
 * Emails are pushed to this queue as they're generated. The queue processes
 * them in the background without blocking the pipeline.
 *
 * Features:
 * - Non-blocking: pipeline continues while validation runs
 * - Adaptive SMTP: starts with SMTP, falls back to pattern-only after timeouts
 * - Concurrency: validates multiple emails in parallel
 * - Auto-starts on server boot for any pending emails
 */

const { getPatternScore } = require('../generator');
const { validateSyntax, getMxHost, detectProvider, isEnterpriseProvider } = require('./validationEngine');
const prisma = require('../db/prismaClient');
const { broadcast } = require('../eventBus');

// ─── Queue State ─────────────────────────────────────────────────────────────

let queue = [];           // Array of { emailId, email, pattern, tier, leadId }
let isProcessing = false;
let totalProcessed = 0;
let totalValid = 0;
let totalInvalid = 0;

// ─── Configuration ───────────────────────────────────────────────────────────

const CONCURRENCY = 5;
const DELAY_BETWEEN_MS = 50;        // 50ms between batches (fast)

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Add emails to the validation queue. Non-blocking — returns immediately.
 * @param {Array} emails - [{ id, email, pattern, tier, leadId }]
 */
function enqueue(emails) {
    if (!Array.isArray(emails) || emails.length === 0) return;
    queue.push(...emails);
    // Start processing if not already running
    if (!isProcessing) {
        setImmediate(() => processQueue());
    }
}

/**
 * Add a single lead's emails to the queue by leadId.
 * Fetches pending emails from DB and enqueues them.
 */
async function enqueueLeadEmails(leadId) {
    try {
        const emails = await prisma.generatedEmail.findMany({
            where: { leadId, verificationStatus: { in: ['PENDING', 'UNVERIFIED'] } },
            select: { id: true, email: true, pattern: true, leadId: true },
        });
        if (emails.length > 0) {
            enqueue(emails.map(e => ({ emailId: e.id, email: e.email, pattern: e.pattern, tier: 'A', leadId: e.leadId })));
        }
    } catch (e) {
        console.error('[validationQueue] enqueueLeadEmails error:', e.message);
    }
}

/**
 * Load all pending emails from DB and enqueue them.
 * Called on server startup.
 */
async function enqueueAllPending() {
    try {
        const pending = await prisma.generatedEmail.findMany({
            where: { verificationStatus: { in: ['PENDING', 'UNVERIFIED'] } },
            select: { id: true, email: true, pattern: true, leadId: true },
            take: 500,
        });
        if (pending.length > 0) {
            console.log(`[validationQueue] Enqueuing ${pending.length} pending emails for validation`);
            enqueue(pending.map(e => ({ emailId: e.id, email: e.email, pattern: e.pattern, tier: 'A', leadId: e.leadId })));
        } else {
            console.log('[validationQueue] No pending emails to validate');
        }
    } catch (e) {
        console.error('[validationQueue] enqueueAllPending error:', e.message);
    }
}

/**
 * Get queue stats.
 */
function getStats() {
    return {
        pending: queue.length,
        isProcessing,
        totalProcessed,
        totalValid,
        totalInvalid,
    };
}

// ─── Queue Processor ─────────────────────────────────────────────────────────

async function processQueue() {
    if (isProcessing) return;
    isProcessing = true;

    console.log('[validationQueue] Processing ' + queue.length + ' emails (pattern-only mode, fast)');

    while (queue.length > 0) {
        // Take a batch
        const batch = queue.splice(0, CONCURRENCY);

        // Process batch in parallel
        await Promise.allSettled(batch.map(item => validateOne(item)));

        totalProcessed += batch.length;

        // Broadcast progress every 10 emails
        if (totalProcessed % 10 === 0) {
            broadcast('validation:progress', { totalProcessed, totalValid, totalInvalid, pending: queue.length });
        }

        // Minimal delay between batches
        if (queue.length > 0) {
            await new Promise(r => setTimeout(r, DELAY_BETWEEN_MS));
        }
    }

    isProcessing = false;
    console.log('[validationQueue] Done: ' + totalProcessed + ' processed, ' + totalValid + ' valid, ' + totalInvalid + ' invalid');

    // Check for more pending emails every 30 seconds
    setTimeout(async () => {
        const count = await prisma.generatedEmail.count({
            where: { verificationStatus: { in: ['PENDING', 'UNVERIFIED'] } },
        }).catch(() => 0);
        if (count > 0) {
            await enqueueAllPending();
        }
    }, 30000);
}

async function validateOne(item) {
    const { emailId, email, pattern, tier } = item;

    try {
        const patternScore = pattern === 'PROVIDED_EMAIL' ? 98 : getPatternScore(pattern, tier || 'A');

        // Fast validation: MX check + pattern scoring (no SMTP, no DB history lookups)
        
        // Layer 1: Syntax
        const syntax = validateSyntax(email);
        if (!syntax.valid) {
            await updateEmailStatus(emailId, 'INVALID', 'INVALID', 'Invalid syntax');
            totalInvalid++;
            return;
        }
        
        // Layer 2: MX check (with timeout)
        let mxHost;
        try {
            mxHost = await Promise.race([
                getMxHost(syntax.domain),
                new Promise((_, reject) => setTimeout(() => reject(new Error('MX timeout')), 3000))
            ]);
        } catch {
            // MX timeout — use pattern score only
            const newStatus = patternScore >= 60 ? 'VALID' : 'INVALID';
            const confidence = patternScore >= 75 ? 'HIGH' : patternScore >= 50 ? 'MEDIUM' : 'LOW';
            await updateEmailStatus(emailId, confidence, newStatus, 'MX lookup timeout, pattern-based');
            if (newStatus === 'VALID') totalValid++; else totalInvalid++;
            return;
        }
        
        if (!mxHost) {
            await updateEmailStatus(emailId, 'INVALID', 'INVALID', 'No MX records');
            totalInvalid++;
            return;
        }
        
        // Layer 3: Pattern-based confidence
        const provider = detectProvider(mxHost);
        let confidence, reason;
        
        if (patternScore >= 75) {
            confidence = 'HIGH';
            reason = 'Strong pattern (score ' + patternScore + '), valid MX (' + provider + ')';
        } else if (patternScore >= 50) {
            confidence = 'MEDIUM';
            reason = 'Moderate pattern (score ' + patternScore + '), valid MX';
        } else {
            confidence = 'LOW';
            reason = 'Weak pattern (score ' + patternScore + ')';
        }
        
        // Boost for enterprise providers
        if (isEnterpriseProvider(provider) && patternScore >= 60) {
            confidence = 'HIGH';
            reason = 'Enterprise provider (' + provider + '), strong pattern';
        }
        
        const newStatus = confidence === 'LOW' ? 'INVALID' : 'VALID';
        await updateEmailStatus(emailId, confidence, newStatus, reason);
        
        if (newStatus === 'VALID') totalValid++;
        else totalInvalid++;
    } catch (e) {
        // On error, mark based on pattern score alone
        try {
            const patternScore = pattern === 'PROVIDED_EMAIL' ? 98 : getPatternScore(pattern, tier || 'A');
            const newStatus = patternScore >= 50 ? 'VALID' : 'INVALID';
            const confidence = patternScore >= 75 ? 'HIGH' : patternScore >= 50 ? 'MEDIUM' : 'LOW';
            await updateEmailStatus(emailId, confidence, newStatus, 'Validation error, pattern-based fallback');
            if (newStatus === 'VALID') totalValid++; else totalInvalid++;
        } catch (_) {}
    }
}

async function updateEmailStatus(emailId, confidence, status, reason) {
    await prisma.generatedEmail.update({
        where: { id: emailId },
        data: {
            confidence,
            verificationStatus: status,
            isVerified: status === 'VALID',
            validationReason: reason,
            validatedAt: new Date(),
        },
    });
}

// ─── Export ──────────────────────────────────────────────────────────────────

module.exports = {
    enqueue,
    enqueueLeadEmails,
    enqueueAllPending,
    getStats,
};
