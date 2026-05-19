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
const { getCurrentKey, markKeyExhausted, recordUsage } = require('./keyManager');
const prisma = require('../db/prismaClient');
const { broadcast } = require('../eventBus');

// ─── Queue State ─────────────────────────────────────────────────────────────

let queue = [];           // Array of { emailId, email, pattern, tier, leadId }
let isProcessing = false;
let isStopped = false;    // Global kill switch — prevents re-enqueuing
let totalProcessed = 0;
let totalValid = 0;
let totalInvalid = 0;

// ─── Configuration ───────────────────────────────────────────────────────────

const CONCURRENCY = 2;               // Process 2 at a time (reduced to avoid rate limits)
const DELAY_BETWEEN_MS = 1000;       // 1 second between batches (CheckMail rate limit safe)
const MAX_RETRIES_429 = 3;           // Max retries on rate limit before skipping

// Rate limiter state
let rateLimitBackoff = 0;            // Current backoff in ms (0 = no backoff)
let consecutive429s = 0;             // Track consecutive rate limit hits

// Early-stop logic: stop validating a lead's remaining emails once we have enough valid ones
// Saves credits when many patterns are generated per lead
const MAX_VALID_PER_LEAD = 2;        // Stop after acquiring 2 valid emails per lead
const MIN_VALID_FOR_FEW = 1;         // If lead has very few patterns (≤3), stop after 1 valid
const FEW_PATTERNS_THRESHOLD = 3;    // What counts as "few patterns" per lead

// Track how many valid emails we've found per lead in this run
const leadValidCount = new Map();    // leadId → count of valid emails found
const leadTotalGenerated = new Map(); // leadId → total emails generated

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Add emails to the validation queue. Non-blocking — returns immediately.
 * @param {Array} emails - [{ id, email, pattern, tier, leadId }]
 */
function enqueue(emails) {
    if (!Array.isArray(emails) || emails.length === 0) return;
    if (isStopped) return; // Kill switch active — don't accept new work
    queue.push(...emails);
    // Start processing if not already running
    if (!isProcessing) {
        setImmediate(() => processQueue());
    }
}

/**
 * Add a single lead's emails to the queue by leadId.
 * TIERED: Only validates top 3 patterns. Saves credits.
 */
async function enqueueLeadEmails(leadId) {
    if (isStopped) return;
    try {
        const emails = await prisma.generatedEmail.findMany({
            where: { leadId, verificationStatus: { in: ['PENDING', 'UNVERIFIED'] } },
            select: { id: true, email: true, pattern: true, leadId: true, confidence: true },
        });
        if (emails.length === 0) return;

        // Sort best-first
        const confidenceOrder = { HIGH: 0, MEDIUM: 1, LOW: 2, PENDING: 3, INVALID: 9 };
        emails.sort((a, b) => (confidenceOrder[a.confidence] ?? 5) - (confidenceOrder[b.confidence] ?? 5));

        // Only queue top 3 (Tier 1). Rest stay PENDING until user forces.
        const tier1 = emails.slice(0, 3);
        leadTotalGenerated.set(leadId, tier1.length);
        leadValidCount.set(leadId, 0);

        enqueue(tier1.map(e => ({ emailId: e.id, email: e.email, pattern: e.pattern, tier: 'A', leadId: e.leadId })));
    } catch (e) {
        console.error('[validationQueue] enqueueLeadEmails error:', e.message);
    }
}

/**
 * Load all pending emails from DB and enqueue them.
 * Called on server startup.
 */
async function enqueueAllPending() {
    if (isStopped) return; // Respect kill switch
    try {
        // Log available keys on startup for diagnostics
        const keyData = await getCurrentKey();
        if (keyData) {
            console.log(`[validationQueue] Active key available: ...${keyData.key.slice(-8)}`);
        } else {
            console.log('[validationQueue] WARNING: No active API keys found. Add keys in Settings.');
        }

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

/**
 * Globally stop and clear all pending validations.
 * Returns the number of items that were queued.
 */
function clearQueue() {
    const cleared = queue.length;
    queue = [];
    isStopped = true; // Kill switch — prevents re-enqueuing
    isProcessing = false;
    leadValidCount.clear();
    leadTotalGenerated.clear();
    console.log(`[validationQueue] Globally cleared ${cleared} pending validations — STOPPED`);
    return cleared;
}

/**
 * Resume the queue (allows new enqueues after a stop).
 */
function resumeQueue() {
    isStopped = false;
    console.log('[validationQueue] Resumed — accepting new validations');
}

// ─── Domain Status Cache (skip domains where all emails are invalid) ─────────
const domainStatus = new Map(); // domain → { valid: 0, invalid: 0, checked: boolean }

// ─── Queue Processor ─────────────────────────────────────────────────────────

async function processQueue() {
    if (isProcessing) return;
    if (isStopped) return;
    
    isProcessing = true;
    console.log('[validationQueue] Processing ' + queue.length + ' emails via CheckMail API');

    while (queue.length > 0 && !isStopped) {
        // Take a batch
        const batch = queue.splice(0, CONCURRENCY);

        // Process batch in parallel
        await Promise.allSettled(batch.map(item => validateOne(item)));

        totalProcessed += batch.length;

        // Broadcast progress every 5 emails
        if (totalProcessed % 5 === 0) {
            broadcast('validation:progress', { totalProcessed, totalValid, totalInvalid, pending: queue.length });
        }

        // Rate limit delay — uses backoff if we've been rate limited
        if (queue.length > 0) {
            const delay = rateLimitBackoff > 0 ? rateLimitBackoff : DELAY_BETWEEN_MS;
            await new Promise(r => setTimeout(r, delay));
        }
    }

    isProcessing = false;
    console.log('[validationQueue] Done: ' + totalProcessed + ' processed, ' + totalValid + ' valid, ' + totalInvalid + ' invalid');

    // Tier 2: If any leads got 0 valid from Tier 1, queue more patterns
    if (!isStopped) {
        const hasCredits = await getCurrentKey();
        if (hasCredits) {
            for (const [leadId, validCount] of leadValidCount.entries()) {
                if (validCount === 0 && !isStopped) {
                    try {
                        const remaining = await prisma.generatedEmail.findMany({
                            where: { leadId, verificationStatus: 'PENDING' },
                            select: { id: true, email: true, pattern: true, leadId: true },
                            take: 4,
                        });
                        if (remaining.length > 0) {
                            console.log(`[validationQueue] Tier 2: queuing ${remaining.length} more for lead (Tier 1 had 0 valid)`);
                            queue.push(...remaining.map(e => ({ emailId: e.id, email: e.email, pattern: e.pattern, tier: 'B', leadId: e.leadId })));
                        }
                    } catch (_) {}
                }
            }

            // Process Tier 2 if items were added
            if (queue.length > 0 && !isStopped) {
                leadValidCount.clear();
                leadTotalGenerated.clear();
                setImmediate(() => processQueue());
                return;
            }
        }
    }

    // Clean up
    leadValidCount.clear();
    leadTotalGenerated.clear();
}

async function validateOne(item) {
    const { emailId, email, pattern, tier, leadId } = item;

    try {
        // ─── Early-stop check: if this lead already has enough valid emails, skip ───
        if (leadId) {
            const validCount = leadValidCount.get(leadId) || 0;
            const totalGenerated = leadTotalGenerated.get(leadId) || 0;
            
            // If we have few patterns total, stop after MIN_VALID_FOR_FEW
            // If we have many patterns, stop after MAX_VALID_PER_LEAD
            const threshold = totalGenerated <= FEW_PATTERNS_THRESHOLD ? MIN_VALID_FOR_FEW : MAX_VALID_PER_LEAD;
            
            if (validCount >= threshold) {
                // Already have enough valid emails for this lead — skip without using credits
                await updateEmailStatus(emailId, 'LOW', 'PENDING', `Skipped — lead already has ${validCount} valid email(s)`);
                
                // Remove other emails for this lead from queue too
                queue = queue.filter(q => q.leadId !== leadId);
                return;
            }
        }

        // User-provided emails are trusted — skip verification
        if (pattern === 'PROVIDED_EMAIL') {
            await updateEmailStatus(emailId, 'HIGH', 'VALID', 'User-provided email');
            totalValid++;
            if (leadId) leadValidCount.set(leadId, (leadValidCount.get(leadId) || 0) + 1);
            return;
        }

        // Layer 1: Syntax check (free, instant)
        const syntax = validateSyntax(email);
        if (!syntax.valid) {
            await updateEmailStatus(emailId, 'INVALID', 'INVALID', 'Invalid syntax');
            totalInvalid++;
            return;
        }

        // Layer 2: Domain-level check — if we already know this domain rejects everything, skip
        const domain = syntax.domain;
        const ds = domainStatus.get(domain);
        if (ds && ds.invalid >= 3 && ds.valid === 0) {
            // Domain has 3+ consecutive invalids and 0 valids — skip to save credits
            await updateEmailStatus(emailId, 'INVALID', 'INVALID', 'Domain rejects all tested emails — likely wrong domain');
            totalInvalid++;
            return;
        }

        // Layer 3: Real verification via CheckMail API (SMTP-level check)
        const keyData = await getCurrentKey();
        if (keyData) {
            console.log(`[validationQueue] Verifying ${email} with key ${keyData.id.slice(-6)}`);
            try {
                const response = await fetch(
                    `https://api.checkmail.dev/v1/verify?email=${encodeURIComponent(email)}`,
                    { headers: { 'Authorization': `Bearer ${keyData.key}` }, signal: AbortSignal.timeout(15000) }
                );
                
                if (response.ok) {
                    const data = await response.json();
                    
                    // Successful response — reset rate limit backoff
                    consecutive429s = 0;
                    rateLimitBackoff = 0;
                    
                    // Record usage against the EXACT key that was used
                    if (data.status !== 'unknown') {
                        recordUsage(keyData.id, 1);
                    }
                    
                    // Track domain stats
                    if (!domainStatus.has(domain)) domainStatus.set(domain, { valid: 0, invalid: 0 });
                    const dstat = domainStatus.get(domain);
                    
                    if (data.status === 'valid') {
                        dstat.valid++;
                        await updateEmailStatus(emailId, 'HIGH', 'VALID', 'Verified — mailbox exists (SMTP confirmed)');
                        totalValid++;
                        if (leadId) leadValidCount.set(leadId, (leadValidCount.get(leadId) || 0) + 1);
                        return;
                    } else if (data.status === 'invalid') {
                        dstat.invalid++;
                        const reason = data.reason ? `SMTP rejected (${data.reason})` : 'Mailbox does not exist';
                        await updateEmailStatus(emailId, 'INVALID', 'INVALID', reason);
                        totalInvalid++;
                        
                        // If 3+ invalids on this domain, mark remaining as invalid too (save credits)
                        if (dstat.invalid >= 3 && dstat.valid === 0) {
                            console.log('[validationQueue] Domain ' + domain + ' has 3+ invalid — skipping remaining');
                            const remaining = queue.filter(q => q.email.endsWith('@' + domain));
                            for (const r of remaining) {
                                await updateEmailStatus(r.emailId, 'INVALID', 'INVALID', 'Domain rejects all tested emails');
                                totalInvalid++;
                            }
                            queue = queue.filter(q => !q.email.endsWith('@' + domain));
                        }
                        return;
                    } else if (data.status === 'catch_all') {
                        dstat.valid++;
                        const patternScore = getPatternScore(pattern, tier || 'A');
                        if (patternScore >= 70) {
                            await updateEmailStatus(emailId, 'MEDIUM', 'VALID', 'Catch-all domain + strong pattern — likely valid');
                            totalValid++;
                            if (leadId) leadValidCount.set(leadId, (leadValidCount.get(leadId) || 0) + 1);
                        } else {
                            await updateEmailStatus(emailId, 'LOW', 'PENDING', 'Catch-all domain — cannot confirm individual mailbox');
                        }
                        return;
                    } else if (data.status === 'disposable') {
                        await updateEmailStatus(emailId, 'INVALID', 'INVALID', 'Disposable email provider');
                        totalInvalid++;
                        return;
                    } else {
                        // 'unknown' — rate limited or inconclusive
                        await updateEmailStatus(emailId, 'LOW', 'PENDING', 'Verification inconclusive — will retry');
                        return;
                    }
                } else if (response.status === 402) {
                    // Key exhausted on CheckMail's side — mark it and rotate
                    const nextKey = await markKeyExhausted(keyData.id);
                    if (nextKey) {
                        // Track retries to prevent infinite loop
                        item._retries402 = (item._retries402 || 0) + 1;
                        if (item._retries402 > 5) {
                            // Tried too many keys — all are exhausted
                            console.warn('[validationQueue] All keys returning 402 — stopping queue');
                            await updateEmailStatus(emailId, 'MEDIUM', 'PENDING', 'All verification credits exhausted');
                            queue = []; // Clear remaining queue
                            return;
                        }
                        console.log(`[validationQueue] Key exhausted (402), rotated to next key (attempt ${item._retries402})`);
                        queue.unshift(item);
                        return;
                    } else {
                        console.warn('[validationQueue] All CheckMail keys exhausted — stopping');
                        await updateEmailStatus(emailId, 'MEDIUM', 'PENDING', 'All verification credits exhausted');
                        queue = []; // Clear remaining queue
                        return;
                    }
                } else if (response.status === 429) {
                    // Rate limited — apply exponential backoff and retry
                    consecutive429s++;
                    rateLimitBackoff = Math.min(1000 * Math.pow(2, consecutive429s), 30000); // Max 30s
                    console.warn(`[validationQueue] Rate limited (429). Backoff: ${rateLimitBackoff}ms`);
                    // Push item back to retry after backoff
                    queue.unshift(item);
                    await new Promise(r => setTimeout(r, rateLimitBackoff));
                    return;
                }
            } catch (fetchErr) {
                console.warn('[validationQueue] CheckMail API error:', fetchErr.message);
            }
        }

        // Fallback: No API key or API failed — use MX check only (stays PENDING)
        if (!keyData) {
            console.warn('[validationQueue] No active API key found — cannot verify. Add keys in Settings.');
            await updateEmailStatus(emailId, 'LOW', 'PENDING', 'No API key available');
            queue = []; // Stop processing — no point continuing without a key
            return;
        }
        let mxHost;
        try {
            mxHost = await Promise.race([
                getMxHost(syntax.domain),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
            ]);
        } catch {
            await updateEmailStatus(emailId, 'LOW', 'PENDING', 'Cannot verify — no API credits and MX timeout');
            return;
        }

        if (!mxHost) {
            await updateEmailStatus(emailId, 'INVALID', 'INVALID', 'No MX records — domain cannot receive email');
            totalInvalid++;
            return;
        }

        await updateEmailStatus(emailId, 'MEDIUM', 'PENDING', 'MX valid but mailbox unverified — add CheckMail credits to verify');
    } catch (e) {
        // On error, leave as PENDING
    }
}

async function updateEmailStatus(emailId, confidence, status, reason) {
    // Use updateMany so missing records don't throw — handles cases where the email
    // was deleted between enqueue and validation (e.g., user cleared a session)
    try {
        await prisma.generatedEmail.updateMany({
            where: { id: emailId },
            data: {
                confidence,
                verificationStatus: status,
                isVerified: status === 'VALID',
                validationReason: reason,
                validatedAt: new Date(),
            },
        });
    } catch (e) {
        // Log but don't crash — most common cause is record deletion mid-flight
        if (!e.message?.includes('Record to update not found')) {
            console.error('[validationQueue] updateEmailStatus error:', e.message);
        }
    }
}

// ─── Export ──────────────────────────────────────────────────────────────────

module.exports = {
    enqueue,
    enqueueLeadEmails,
    enqueueAllPending,
    getStats,
    clearQueue,
};
