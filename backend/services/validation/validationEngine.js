/**
 * validationEngine.js — Production-grade multi-layer email validation engine.
 * ─────────────────────────────────────────────────────────────────────────────
 * SMTP is SUPPLEMENTAL, not primary truth source.
 * Priority: delivery history > bounce history > company pattern > SMTP
 *
 * SMTP timeout ≠ INVALID. Timeout = UNKNOWN (reduce confidence slightly).
 * Enterprise providers (Microsoft365, Gmail, Proofpoint) intentionally throttle.
 *
 * Confidence rules:
 *   HIGH = delivery confirmed OR SMTP verified (non-catch-all) OR strong pattern
 *   MEDIUM = strong pattern + valid MX (even with SMTP timeout)
 *   LOW = weak guess
 *   INVALID = SMTP rejected OR bounced
 */
const dns = require('dns');
const net = require('net');
const prisma = require('../db/prismaClient');

// ─── Configuration ───────────────────────────────────────────────────────────

const SMTP_TIMEOUT_MS = parseInt(process.env.SMTP_TIMEOUT_MS || '7000', 10); // 7s default (6-8s range)
const SMTP_MAX_RETRIES = 1; // Single retry to keep speed
const SMTP_CONCURRENCY = parseInt(process.env.SMTP_CONCURRENCY || '5', 10);

// ─── Caches ──────────────────────────────────────────────────────────────────

const mxCache = new Map();           // domain → mxHost | null
const catchAllCache = new Map();     // domain → boolean
const smtpResultCache = new Map();   // email → { status, ts }
const timeoutDomainCache = new Map(); // domain → { count, lastSeen } (tarpitting detection)
const CACHE_TTL = 60 * 60 * 1000;   // 1 hour
const TIMEOUT_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours for timeout domains

// ─── Enterprise Provider Detection ──────────────────────────────────────────

const ENTERPRISE_MX_PATTERNS = {
    microsoft365: ['.mail.protection.outlook.com', '.olc.protection.outlook.com'],
    gmail: ['.google.com', '.googlemail.com', 'aspmx.l.google.com'],
    proofpoint: ['.pphosted.com', '.ppe-hosted.com'],
    mimecast: ['.mimecast.com'],
    cisco: ['.iphmx.com', '.cres.cisco.com'],
    barracuda: ['.barracudanetworks.com'],
};

function detectProvider(mxHost) {
    if (!mxHost) return 'unknown';
    const lower = mxHost.toLowerCase();
    for (const [provider, patterns] of Object.entries(ENTERPRISE_MX_PATTERNS)) {
        if (patterns.some(p => lower.includes(p))) return provider;
    }
    return 'generic';
}

function isEnterpriseProvider(provider) {
    return ['microsoft365', 'gmail', 'proofpoint', 'mimecast', 'cisco', 'barracuda'].includes(provider);
}

// ─── Tarpitting Detection ────────────────────────────────────────────────────

function isDomainTarpitting(domain) {
    const entry = timeoutDomainCache.get(domain);
    if (!entry) return false;
    if (Date.now() - entry.lastSeen > TIMEOUT_CACHE_TTL) {
        timeoutDomainCache.delete(domain);
        return false;
    }
    return entry.count >= 2; // 2+ timeouts = likely tarpitting
}

function recordTimeout(domain) {
    const entry = timeoutDomainCache.get(domain) || { count: 0, lastSeen: 0 };
    entry.count++;
    entry.lastSeen = Date.now();
    timeoutDomainCache.set(domain, entry);
}

// ─── Disposable Domains ──────────────────────────────────────────────────────

const DISPOSABLE_DOMAINS = new Set([
    'mailinator.com', 'guerrillamail.com', 'tempmail.com', 'throwaway.email',
    'yopmail.com', 'sharklasers.com', 'dispostable.com', 'trashmail.com',
    'maildrop.cc', 'temp-mail.org', 'fakeinbox.com', 'mailnesia.com',
]);

// ─── Layer 1: Syntax Validation ──────────────────────────────────────────────

function validateSyntax(email) {
    if (!email || typeof email !== 'string') return { valid: false, reason: 'empty' };
    const regex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
    if (!regex.test(email)) return { valid: false, reason: 'invalid_syntax' };
    const [local, domain] = email.split('@');
    if (local.length < 2) return { valid: false, reason: 'local_too_short' };
    if (local.length > 64) return { valid: false, reason: 'local_too_long' };
    return { valid: true, local, domain };
}

// ─── Layer 2: Disposable Domain Check ────────────────────────────────────────

function isDisposable(domain) {
    return DISPOSABLE_DOMAINS.has(domain.toLowerCase());
}

// ─── Layer 3: MX Record Lookup (cached) ──────────────────────────────────────

async function getMxHost(domain) {
    if (mxCache.has(domain)) return mxCache.get(domain);
    return new Promise(resolve => {
        dns.resolveMx(domain, (err, addresses) => {
            if (err || !addresses || addresses.length === 0) {
                mxCache.set(domain, null);
                resolve(null);
            } else {
                addresses.sort((a, b) => a.priority - b.priority);
                const host = addresses[0].exchange;
                mxCache.set(domain, host);
                resolve(host);
            }
        });
    });
}

// ─── Layer 4: Catch-All Detection (cached) ───────────────────────────────────

async function detectCatchAll(domain, mxHost) {
    if (catchAllCache.has(domain)) return catchAllCache.get(domain);
    const fakeEmail = `xyzrandomtest${Math.floor(Math.random() * 999999)}@${domain}`;
    const result = await smtpProbe(fakeEmail, mxHost, 8000);
    const isCatchAll = result === 'VERIFIED';
    catchAllCache.set(domain, isCatchAll);
    return isCatchAll;
}

// ─── Layer 5: SMTP Probing (safe — stops before DATA) ────────────────────────

/**
 * SMTP probe with nuanced result states.
 * Returns: VERIFIED | REJECTED | TIMEOUT | GREYLISTED | BLOCKED | UNKNOWN
 */
function smtpProbe(email, mxHost, timeoutMs = SMTP_TIMEOUT_MS) {
    return new Promise(resolve => {
        let resolved = false;
        let connectTime = Date.now();
        const socket = net.createConnection(25, mxHost);
        let step = 0;
        let buffer = '';

        socket.setTimeout(timeoutMs);

        const done = (status) => {
            if (resolved) return;
            resolved = true;
            socket.destroy();
            resolve(status);
        };

        socket.on('connect', () => {
            const elapsed = Date.now() - connectTime;
            // Detect tarpitting: if connection took > 5s, provider is throttling
            if (elapsed > 5000) {
                done('TIMEOUT'); // Treat slow connect as timeout
                return;
            }
        });

        socket.on('data', data => {
            buffer += data.toString();
            if (!buffer.includes('\r\n')) return;

            const lines = buffer.split('\r\n');
            const lastComplete = lines[lines.length - 2] || lines[0];
            const code = parseInt(lastComplete.substring(0, 3));
            buffer = '';

            if (isNaN(code)) { done('UNKNOWN'); return; }

            if (step === 0) {
                if (code === 220) { socket.write('EHLO verify.nexuscrm.local\r\n'); step++; }
                else if (code === 421 || code === 450) done('BLOCKED');
                else done('REJECTED');
            } else if (step === 1) {
                if (code === 250) { socket.write('MAIL FROM:<verify@nexuscrm.local>\r\n'); step++; }
                else if (code === 421) done('BLOCKED');
                else done('REJECTED');
            } else if (step === 2) {
                if (code === 250) { socket.write(`RCPT TO:<${email}>\r\n`); step++; }
                else done('REJECTED');
            } else if (step === 3) {
                socket.write('QUIT\r\n');
                if (code === 250 || code === 251) done('VERIFIED');
                else if (code >= 550 && code <= 559) done('REJECTED');
                else if (code === 450 || code === 451 || code === 452) done('GREYLISTED');
                else if (code === 421) done('BLOCKED');
                else done('UNKNOWN');
            }
        });

        socket.on('error', (err) => {
            if (err.code === 'ECONNREFUSED') done('BLOCKED');
            else if (err.code === 'ECONNRESET') done('BLOCKED');
            else if (err.code === 'ETIMEDOUT') done('TIMEOUT');
            else done('UNKNOWN');
        });

        socket.on('timeout', () => done('TIMEOUT'));
    });
}

/**
 * SMTP probe with retry + exponential backoff.
 */
async function smtpProbeWithRetry(email, mxHost, maxRetries = SMTP_MAX_RETRIES) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const result = await smtpProbe(email, mxHost);

        // Don't retry on definitive results
        if (result === 'VERIFIED' || result === 'REJECTED') return result;

        // Retry on transient failures
        if (attempt < maxRetries && (result === 'TIMEOUT' || result === 'GREYLISTED' || result === 'UNKNOWN')) {
            const delay = (1000 + Math.random() * 1000) * Math.pow(2, attempt);
            await new Promise(r => setTimeout(r, delay));
            continue;
        }

        return result;
    }
    return 'TIMEOUT';
}

// ─── Layer 6: Historical Delivery Lookup ─────────────────────────────────────

async function checkDeliveryHistory(email) {
    try {
        const delivered = await prisma.sentEmail.findFirst({
            where: { toEmail: email, status: { in: ['SENT', 'DELIVERED'] } },
            select: { status: true, sentAt: true },
        });
        if (delivered) return { delivered: true, sentAt: delivered.sentAt };

        const bounced = await prisma.sentEmail.findFirst({
            where: { toEmail: email, status: 'BOUNCED' },
            select: { status: true, bouncedAt: true },
        });
        if (bounced) return { bounced: true, bouncedAt: bounced.bouncedAt };

        return { noHistory: true };
    } catch {
        return { noHistory: true };
    }
}

// ─── Layer 7: Bounce History ─────────────────────────────────────────────────

async function checkBounceHistory(email) {
    try {
        const count = await prisma.sentEmail.count({
            where: { toEmail: email, status: 'BOUNCED' },
        });
        return { bounced: count > 0, count };
    } catch {
        return { bounced: false, count: 0 };
    }
}

// ─── Layer 8: Company Pattern Lookup ─────────────────────────────────────────

async function getCompanyPatternConfidence(domain, pattern) {
    try {
        const company = await prisma.company.findUnique({
            where: { domain },
            select: { learnedPattern: true },
        });
        if (company?.learnedPattern && company.learnedPattern === pattern) {
            return { matched: true, pattern: company.learnedPattern };
        }
        return { matched: false };
    } catch {
        return { matched: false };
    }
}

// ─── Final Confidence Scoring ────────────────────────────────────────────────

function computeFinalConfidence(factors) {
    const {
        smtpResult,       // VERIFIED | REJECTED | TIMEOUT | GREYLISTED | BLOCKED | UNKNOWN
        isCatchAll,       // boolean
        deliveryHistory,  // { delivered, bounced, noHistory }
        bounceHistory,    // { bounced, count }
        patternMatch,     // { matched }
        localPartScore,   // number 0-100 (based on pattern quality)
        provider,         // string
    } = factors;

    // ── INVALID: hard evidence of failure ────────────────────────────────────
    if (smtpResult === 'REJECTED') return { confidence: 'INVALID', reason: 'SMTP rejected recipient' };
    if (bounceHistory.bounced) return { confidence: 'INVALID', reason: `Previously bounced (${bounceHistory.count}x)` };
    if (deliveryHistory.bounced) return { confidence: 'INVALID', reason: 'Historical bounce recorded' };

    // ── HIGH: strong evidence of existence ───────────────────────────────────
    if (deliveryHistory.delivered) return { confidence: 'HIGH', reason: 'Historical delivery confirmed' };
    if (smtpResult === 'VERIFIED' && !isCatchAll) return { confidence: 'HIGH', reason: 'SMTP verified (non-catch-all)' };
    if (smtpResult === 'VERIFIED' && isCatchAll && localPartScore >= 70) return { confidence: 'HIGH', reason: 'SMTP accepted + strong pattern (catch-all)' };
    if (patternMatch.matched && localPartScore >= 50) return { confidence: 'HIGH', reason: `Verified company pattern: ${patternMatch.pattern}` };

    // ── MEDIUM: reasonable confidence ────────────────────────────────────────
    if (smtpResult === 'VERIFIED' && isCatchAll) return { confidence: 'MEDIUM', reason: 'SMTP accepted (catch-all domain)' };
    if (patternMatch.matched) return { confidence: 'MEDIUM', reason: 'Matches verified company pattern' };

    // Strong pattern (firstname.lastname etc) + valid MX = MEDIUM even without SMTP
    // Enterprise providers (Microsoft365, Gmail) intentionally block SMTP probes
    if (localPartScore >= 65) {
        if (smtpResult === 'TIMEOUT' || smtpResult === 'BLOCKED' || smtpResult === 'UNKNOWN' || smtpResult === 'GREYLISTED') {
            return { confidence: 'MEDIUM', reason: `Strong pattern (score ${localPartScore}), SMTP inconclusive (${smtpResult})` };
        }
        return { confidence: 'MEDIUM', reason: `Strong corporate pattern (score ${localPartScore})` };
    }

    // Moderate patterns (score 50-64) with inconclusive SMTP = still MEDIUM
    if (localPartScore >= 50 && (smtpResult === 'TIMEOUT' || smtpResult === 'BLOCKED' || smtpResult === 'UNKNOWN')) {
        if (isEnterpriseProvider(provider)) {
            return { confidence: 'MEDIUM', reason: `Moderate pattern, enterprise provider (${provider}) blocked SMTP` };
        }
        return { confidence: 'MEDIUM', reason: 'Moderate pattern, SMTP inconclusive' };
    }

    if (localPartScore >= 50) return { confidence: 'MEDIUM', reason: 'Moderate corporate pattern' };

    // ── LOW: weak guess ──────────────────────────────────────────────────────
    return { confidence: 'LOW', reason: `Weak pattern (score ${localPartScore}), not verified` };
}

// ─── Main Validation Function ────────────────────────────────────────────────

/**
 * Validate a single email through all layers.
 * @param {string} email
 * @param {object} opts - { pattern, localPartScore, skipSmtp }
 * @returns {{ email, confidence, reason, details }}
 */
async function validateEmail(email, opts = {}) {
    const { pattern = null, localPartScore = 50, skipSmtp = false } = opts;
    const result = { email, confidence: 'LOW', reason: '', details: {} };

    // Layer 1: Syntax
    const syntax = validateSyntax(email);
    if (!syntax.valid) {
        result.confidence = 'INVALID';
        result.reason = `Invalid syntax: ${syntax.reason}`;
        return result;
    }
    const { domain } = syntax;

    // Layer 2: Disposable
    if (isDisposable(domain)) {
        result.confidence = 'INVALID';
        result.reason = 'Disposable email domain';
        return result;
    }

    // Layer 3: MX
    const mxHost = await getMxHost(domain);
    result.details.mxValid = !!mxHost;
    if (!mxHost) {
        result.confidence = 'INVALID';
        result.reason = 'No MX records found';
        return result;
    }

    // Detect provider
    const provider = detectProvider(mxHost);
    result.details.provider = provider;

    // Layer 4: Catch-all (skip if domain is known to tarpit OR skipSmtp is true)
    let isCatchAll = false;
    if (!skipSmtp && !isDomainTarpitting(domain)) {
        try { isCatchAll = await detectCatchAll(domain, mxHost); }
        catch { /* ignore */ }
    }
    result.details.isCatchAll = isCatchAll;

    // Layer 5: SMTP (skip if domain tarpits or skipSmtp requested)
    let smtpResult = 'SKIPPED';
    if (!skipSmtp && !isDomainTarpitting(domain)) {
        const cached = smtpResultCache.get(email);
        if (cached && (Date.now() - cached.ts) < CACHE_TTL) {
            smtpResult = cached.status;
        } else {
            smtpResult = await smtpProbeWithRetry(email, mxHost);
            smtpResultCache.set(email, { status: smtpResult, ts: Date.now() });

            // Track timeouts for tarpitting detection
            if (smtpResult === 'TIMEOUT') recordTimeout(domain);
        }
    } else if (isDomainTarpitting(domain)) {
        smtpResult = 'SKIPPED_TARPIT';
        result.details.tarpitDetected = true;
    }
    result.details.smtpResult = smtpResult;

    // Layer 6: Delivery history (HIGHEST PRIORITY)
    const deliveryHistory = await checkDeliveryHistory(email);
    result.details.deliveryHistory = deliveryHistory;

    // Layer 7: Bounce history
    const bounceHistory = await checkBounceHistory(email);
    result.details.bounceHistory = bounceHistory;

    // Layer 8: Company pattern
    const patternMatch = await getCompanyPatternConfidence(domain, pattern);
    result.details.patternMatch = patternMatch;

    // Final scoring
    const scoring = computeFinalConfidence({
        smtpResult: smtpResult === 'SKIPPED' || smtpResult === 'SKIPPED_TARPIT' ? 'UNKNOWN' : smtpResult,
        isCatchAll,
        deliveryHistory,
        bounceHistory,
        patternMatch,
        localPartScore,
        provider,
    });

    result.confidence = scoring.confidence;
    result.reason = scoring.reason;

    return result;
}

// ─── Batch Validation ────────────────────────────────────────────────────────

/**
 * Validate multiple emails in parallel with concurrency limit.
 */
async function validateBatch(emails, opts = {}) {
    const { concurrency = SMTP_CONCURRENCY, skipSmtp = false } = opts;
    const results = [];
    const queue = [...emails];

    async function worker() {
        while (queue.length > 0) {
            const item = queue.shift();
            if (!item) break;
            try {
                const result = await validateEmail(item.email, {
                    pattern: item.pattern,
                    localPartScore: item.localPartScore || item.score || 50,
                    skipSmtp,
                });
                results.push(result);
            } catch (e) {
                results.push({ email: item.email, confidence: 'LOW', reason: `Error: ${e.message}`, details: {} });
            }
            // Delay between checks (anti-abuse)
            await new Promise(r => setTimeout(r, 100));
        }
    }

    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () => worker());
    await Promise.allSettled(workers);
    return results;
}

// ─── Delivery Learning ───────────────────────────────────────────────────────

/**
 * Learn from delivery events to improve future scoring.
 */
async function learnFromDelivery(email, event) {
    if (!email) return;
    const domain = email.split('@')[1];
    if (!domain) return;

    try {
        if (event === 'delivered' || event === 'replied') {
            const genEmail = await prisma.generatedEmail.findUnique({
                where: { email },
                select: { pattern: true },
            });
            if (genEmail?.pattern) {
                await prisma.company.updateMany({
                    where: { domain },
                    data: { learnedPattern: genEmail.pattern },
                });
            }
            await prisma.generatedEmail.updateMany({
                where: { email },
                data: { verificationStatus: 'VALID', isVerified: true, confidence: 'HIGH' },
            });
            // Clear negative cache entries
            smtpResultCache.delete(email);
        } else if (event === 'bounced') {
            await prisma.generatedEmail.updateMany({
                where: { email },
                data: { verificationStatus: 'INVALID', isVerified: false, confidence: 'INVALID' },
            });
        }
    } catch (e) {
        console.error('[validationEngine] learnFromDelivery error:', e.message);
    }
}

// ─── Diagnostics ─────────────────────────────────────────────────────────────

function getCacheStats() {
    return {
        mxCache: mxCache.size,
        catchAllCache: catchAllCache.size,
        smtpResultCache: smtpResultCache.size,
        timeoutDomainCache: timeoutDomainCache.size,
        tarpittingDomains: [...timeoutDomainCache.entries()]
            .filter(([_, v]) => v.count >= 2)
            .map(([domain]) => domain),
    };
}

module.exports = {
    validateEmail,
    validateBatch,
    learnFromDelivery,
    validateSyntax,
    getMxHost,
    detectCatchAll,
    smtpProbe,
    smtpProbeWithRetry,
    checkDeliveryHistory,
    computeFinalConfidence,
    detectProvider,
    getCacheStats,
};
