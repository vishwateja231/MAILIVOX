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
const { getCurrentKey, recordUsage } = require('./keyManager');
const prisma = require('../db/prismaClient');
const { broadcast } = require('../eventBus');

// ─── Queue State ─────────────────────────────────────────────────────────────

let queue = [];           // Array of { emailId, email, pattern, tier, leadId }
let isProcessing = false;
let totalProcessed = 0;
let totalValid = 0;
let totalInvalid = 0;

// ─── Configuration ───────────────────────────────────────────────────────────

const CONCURRENCY = 3;
const DELAY_BETWEEN_MS = 300;        // 300ms between batches (respect API rate limits)

// Early-stop logic: stop validating a lead's remaining emails once we have enough valid ones
// Saves credits when many patterns are generated per lead (e.g., 18 patterns → stop after 2-3 valid)
const MAX_VALID_PER_LEAD = 3;        // Stop after acquiring this many valid emails for a lead
const MIN_VALID_FOR_FEW = 1;         // If lead has very few patterns (≤5), stop after just 1 valid
const FEW_PATTERNS_THRESHOLD = 5;    // What counts as "few patterns" per lead

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
            select: { id: true, email: true, pattern: true, leadId: true, confidence: true },
            orderBy: { confidence: 'asc' }, // HIGH first (alphabetically: HIGH < LOW < MEDIUM, fix below)
        });
        if (emails.length > 0) {
            // Sort by confidence (HIGH > MEDIUM > LOW > INVALID) so we validate the best first
            const confidenceOrder = { HIGH: 0, MEDIUM: 1, LOW: 2, INVALID: 3 };
            emails.sort((a, b) => (confidenceOrder[a.confidence] ?? 9) - (confidenceOrder[b.confidence] ?? 9));
            
            // Track total generated for early-stop logic
            leadTotalGenerated.set(leadId, emails.length);
            leadValidCount.set(leadId, 0);
            
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

/**
 * Globally stop and clear all pending validations.
 * Returns the number of items that were queued.
 */
function clearQueue() {
    const cleared = queue.length;
    queue = [];
    leadValidCount.clear();
    leadTotalGenerated.clear();
    console.log(`[validationQueue] Globally cleared ${cleared} pending validations`);
    return cleared;
}

// ─── Domain Status Cache (skip domains where all emails are invalid) ─────────
const domainStatus = new Map(); // domain → { valid: 0, invalid: 0, checked: boolean }

// ─── Queue Processor ─────────────────────────────────────────────────────────

async function processQueue() {
    if (isProcessing) return;
    isProcessing = true;

    console.log('[validationQueue] Processing ' + queue.length + ' emails via CheckMail API');

    while (queue.length > 0) {
        // Take a batch
        const batch = queue.splice(0, CONCURRENCY);

        // Process batch in parallel
        await Promise.allSettled(batch.map(item => validateOne(item)));

        totalProcessed += batch.length;

        // Broadcast progress every 5 emails
        if (totalProcessed % 5 === 0) {
            broadcast('validation:progress', { totalProcessed, totalValid, totalInvalid, pending: queue.length });
        }

        // Delay between batches (respect API rate limits)
        if (queue.length > 0) {
            await new Promise(r => setTimeout(r, DELAY_BETWEEN_MS));
        }
    }

    isProcessing = false;
    console.log('[validationQueue] Done: ' + totalProcessed + ' processed, ' + totalValid + ' valid, ' + totalInvalid + ' invalid');

    // Clean up per-lead tracking after each batch run (saves memory)
    leadValidCount.clear();
    leadTotalGenerated.clear();

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
        const apiKey = getCurrentKey();
        if (apiKey) {
            try {
                const response = await fetch(
                    `https://api.checkmail.dev/v1/verify?email=${encodeURIComponent(email)}`,
                    { headers: { 'Authorization': `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15000) }
                );
                
                if (response.ok) {
                    const data = await response.json();
                    
                    // Only charge for definitive results (valid, invalid, catch_all, disposable)
                    if (data.status !== 'unknown') {
                        recordUsage(1);
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
                            // Mark all remaining emails for this domain in the queue as invalid
                            const remaining = queue.filter(q => q.email.endsWith('@' + domain));
                            for (const r of remaining) {
                                await updateEmailStatus(r.emailId, 'INVALID', 'INVALID', 'Domain rejects all tested emails');
                                totalInvalid++;
                            }
                            // Remove them from queue
                            queue = queue.filter(q => !q.email.endsWith('@' + domain));
                        }
                        return;
                    } else if (data.status === 'catch_all') {
                        dstat.valid++; // Catch-all means domain accepts, treat as potentially valid
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
                        // 'unknown' — rate limited, retry later (free)
                        await updateEmailStatus(emailId, 'LOW', 'PENDING', 'Verification inconclusive — will retry');
                        return;
                    }
                } else if (response.status === 402) {
                    console.warn('[validationQueue] CheckMail credits exhausted');
                    // Mark remaining as PENDING
                    await updateEmailStatus(emailId, 'MEDIUM', 'PENDING', 'Verification credits exhausted — unverified');
                    return;
                }
            } catch (fetchErr) {
                console.warn('[validationQueue] CheckMail API error:', fetchErr.message);
            }
        }

        // Fallback: No API key or API failed — use MX check only (stays PENDING)
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
