/**
 * verifier.js — Multi-layer email validation engine with parallel processing.
 * ─────────────────────────────────────────────────────────────────────────────
 * Layers:
 *   1. Syntax validation
 *   2. MX record lookup (cached)
 *   3. Disposable domain filtering
 *   4. Catch-all detection (cached)
 *   5. SMTP handshake verification
 *   6. Confidence scoring
 *
 * Supports parallel validation with concurrency limits.
 */
const dns = require('dns');
const net = require('net');

// ─── Caches ──────────────────────────────────────────────────────────────────
const mxCache = new Map();       // domain → mxHost
const catchAllCache = new Map(); // domain → boolean
const validationCache = new Map(); // email → result (TTL: 1 hour)
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ─── Disposable domain list (common ones) ────────────────────────────────────
const DISPOSABLE_DOMAINS = new Set([
    'mailinator.com', 'guerrillamail.com', 'tempmail.com', 'throwaway.email',
    'yopmail.com', 'sharklasers.com', 'guerrillamailblock.com', 'grr.la',
    'dispostable.com', 'trashmail.com', 'maildrop.cc', 'temp-mail.org',
]);

// ─── Syntax Validation ───────────────────────────────────────────────────────
function isValidSyntax(email) {
    if (!email || typeof email !== 'string') return false;
    const regex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
    return regex.test(email);
}

// ─── MX Lookup (cached) ──────────────────────────────────────────────────────
async function getMxRecords(domain) {
    if (mxCache.has(domain)) return mxCache.get(domain);
    return new Promise((resolve) => {
        dns.resolveMx(domain, (err, addresses) => {
            if (err || !addresses || addresses.length === 0) {
                mxCache.set(domain, null);
                resolve(null);
            } else {
                addresses.sort((a, b) => a.priority - b.priority);
                const mxHost = addresses[0].exchange;
                mxCache.set(domain, mxHost);
                resolve(mxHost);
            }
        });
    });
}

// ─── SMTP Check ──────────────────────────────────────────────────────────────
function checkSmtp(email, mxHost, timeoutMs = 8000) {
    return new Promise((resolve) => {
        let resolved = false;
        const socket = net.createConnection(25, mxHost);
        let step = 0;
        let responseBuffer = '';

        socket.setTimeout(timeoutMs);

        const cleanup = (status) => {
            if (resolved) return;
            resolved = true;
            socket.destroy();
            resolve(status);
        };

        socket.on('data', (data) => {
            responseBuffer += data.toString();
            if (!responseBuffer.includes('\r\n')) return;

            const responseCode = parseInt(responseBuffer.substring(0, 3));
            responseBuffer = '';

            if (step === 0) {
                if (responseCode === 220) { socket.write('HELO verify.local\r\n'); step++; }
                else cleanup('INVALID');
            } else if (step === 1) {
                if (responseCode === 250) { socket.write('MAIL FROM:<verify@check.local>\r\n'); step++; }
                else cleanup('INVALID');
            } else if (step === 2) {
                if (responseCode === 250) { socket.write(`RCPT TO:<${email}>\r\n`); step++; }
                else cleanup('INVALID');
            } else if (step === 3) {
                socket.write('QUIT\r\n');
                if (responseCode === 250 || responseCode === 251) cleanup('VALID');
                else if (responseCode >= 550 && responseCode <= 559) cleanup('INVALID');
                else if (responseCode >= 450 && responseCode <= 459) cleanup('RISKY');
                else cleanup('UNKNOWN');
            }
        });

        socket.on('error', () => cleanup('UNVERIFIED'));
        socket.on('timeout', () => cleanup('UNVERIFIED'));
    });
}

// ─── Catch-All Detection (cached) ────────────────────────────────────────────
async function isCatchAll(domain, mxHost) {
    if (catchAllCache.has(domain)) return catchAllCache.get(domain);
    const fakeEmail = `xyzrandomtest${Math.floor(Math.random() * 999999)}@${domain}`;
    const status = await checkSmtp(fakeEmail, mxHost, 6000);
    const result = status === 'VALID';
    catchAllCache.set(domain, result);
    return result;
}

// ─── Single Email Verification ───────────────────────────────────────────────
/**
 * Verify a single email through all layers.
 * @returns {{ email, status, details, mxValid, isCatchAll, isDisposable }}
 */
async function verifyEmail(email, domain) {
    // Check cache first
    const cached = validationCache.get(email);
    if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
        return cached.result;
    }

    const result = { email, status: 'PENDING', details: '', mxValid: false, isCatchAll: false, isDisposable: false };

    try {
        // Layer 1: Syntax
        if (!isValidSyntax(email)) {
            result.status = 'INVALID';
            result.details = 'Invalid email syntax';
            validationCache.set(email, { result, ts: Date.now() });
            return result;
        }

        // Layer 2: Disposable domain
        if (DISPOSABLE_DOMAINS.has(domain)) {
            result.status = 'INVALID';
            result.details = 'Disposable email domain';
            result.isDisposable = true;
            validationCache.set(email, { result, ts: Date.now() });
            return result;
        }

        // Layer 3: MX records
        const mxHost = await getMxRecords(domain);
        if (!mxHost) {
            result.status = 'INVALID';
            result.details = 'No MX records found';
            validationCache.set(email, { result, ts: Date.now() });
            return result;
        }
        result.mxValid = true;

        // Layer 4: Catch-all detection
        const catchAll = await isCatchAll(domain, mxHost);
        if (catchAll) {
            result.status = 'CATCH_ALL';
            result.details = 'Domain accepts all addresses (catch-all)';
            result.isCatchAll = true;
            validationCache.set(email, { result, ts: Date.now() });
            return result;
        }

        // Layer 5: SMTP verification
        const smtpResult = await checkSmtp(email, mxHost);
        result.status = smtpResult;
        result.details = smtpResult === 'VALID' ? 'SMTP confirmed mailbox exists'
            : smtpResult === 'INVALID' ? 'SMTP rejected recipient'
            : 'SMTP check inconclusive';

    } catch (err) {
        result.status = 'UNVERIFIED';
        result.details = err.message;
    }

    validationCache.set(email, { result, ts: Date.now() });
    return result;
}

// ─── Parallel Batch Verification ─────────────────────────────────────────────
/**
 * Verify multiple emails in parallel with concurrency limit.
 * @param {Array<{email, domain}>} emails
 * @param {number} concurrency - max parallel verifications (default 5)
 * @returns {Array} results
 */
async function verifyBatch(emails, concurrency = 5) {
    const results = [];
    const queue = [...emails];

    async function worker() {
        while (queue.length > 0) {
            const item = queue.shift();
            if (!item) break;
            const result = await verifyEmail(item.email, item.domain || item.email.split('@')[1]);
            results.push(result);
        }
    }

    // Spawn workers
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () => worker());
    await Promise.allSettled(workers);

    return results;
}

/**
 * Quick MX-only validation (fast, no SMTP).
 * Useful for bulk pre-filtering.
 */
async function quickValidate(email) {
    if (!isValidSyntax(email)) return { email, valid: false, reason: 'syntax' };
    const domain = email.split('@')[1];
    if (DISPOSABLE_DOMAINS.has(domain)) return { email, valid: false, reason: 'disposable' };
    const mx = await getMxRecords(domain);
    if (!mx) return { email, valid: false, reason: 'no_mx' };
    return { email, valid: true, mxHost: mx };
}

/**
 * Get cache stats for monitoring.
 */
function getCacheStats() {
    return {
        mxCacheSize: mxCache.size,
        catchAllCacheSize: catchAllCache.size,
        validationCacheSize: validationCache.size,
    };
}

module.exports = {
    verifyEmail,
    verifyBatch,
    quickValidate,
    getMxRecords,
    isCatchAll,
    isValidSyntax,
    getCacheStats,
};
