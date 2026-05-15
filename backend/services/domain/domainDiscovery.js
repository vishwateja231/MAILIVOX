/**
 * domainDiscovery.js — Multi-layer domain resolution engine.
 * ─────────────────────────────────────────────────────────────────────────────
 * Priority order:
 *   1. Manual override (user-provided domain)
 *   2. Extracted from pasted emails (highest confidence)
 *   3. Local company cache (DB)
 *   4. Enterprise cache (in-memory known companies)
 *   5. Clearbit/web discovery
 *   6. Smart fallback heuristics
 *
 * Does NOT break existing domainFinder.js — this is an additional layer.
 */
const dns = require('dns');
const prisma = require('../db/prismaClient');
const { findDomain } = require('../domainFinder');
const { getEnterpriseDomain } = require('../intelligence/companyNormalizer');

// ─── Domain Sanitization ─────────────────────────────────────────────────────

/**
 * Clean a user-provided domain input.
 * Handles: @google.com, https://www.google.com, google.com/, etc.
 */
function sanitizeDomain(input) {
    if (!input || typeof input !== 'string') return null;
    let domain = input.trim().toLowerCase();
    // Remove protocol
    domain = domain.replace(/^https?:\/\//, '');
    // Remove www.
    domain = domain.replace(/^www\./, '');
    // Remove leading @
    domain = domain.replace(/^@/, '');
    // Remove trailing slash
    domain = domain.replace(/\/.*$/, '');
    // Remove paths/params
    domain = domain.split('/')[0].split('?')[0].split('#')[0];
    // Validate basic domain format
    if (!domain || !domain.includes('.') || domain.length < 4) return null;
    return domain;
}

// ─── Email Pattern Extraction ────────────────────────────────────────────────

/**
 * Extract domain and naming pattern from a known email address.
 * @param {string} email - e.g. "john.doe@apple.com"
 * @returns {{ domain, pattern, firstName, lastName } | null}
 */
function extractPatternFromEmail(email) {
    if (!email || !email.includes('@')) return null;
    const [local, domain] = email.split('@');
    if (!local || !domain) return null;

    let pattern = null;
    const parts = local.split(/[._\-]/);

    if (local.includes('.') && parts.length === 2 && parts[0].length > 1 && parts[1].length > 1) {
        pattern = 'firstname.lastname';
    } else if (local.includes('_') && parts.length === 2) {
        pattern = 'firstname_lastname';
    } else if (local.includes('-') && parts.length === 2) {
        pattern = 'firstname-lastname';
    } else if (parts.length === 1 && local.length > 3) {
        // Could be firstnamelastname or just firstname
        pattern = 'firstnamelastname';
    } else if (local.length <= 3 && /^[a-z]/.test(local)) {
        pattern = 'firstinitiallastname';
    }

    return { domain, pattern, local };
}

// ─── MX Verification ─────────────────────────────────────────────────────────

function verifyMX(domain) {
    return new Promise(resolve => {
        dns.resolveMx(domain, (err, addresses) => {
            resolve(!err && addresses && addresses.length > 0);
        });
    });
}

// ─── Company Pattern Learning ────────────────────────────────────────────────

/**
 * Learn a pattern from a verified email for a domain.
 * Stores in Company.learnedPattern.
 */
async function learnPatternFromEmail(email) {
    const extracted = extractPatternFromEmail(email);
    if (!extracted || !extracted.pattern) return;

    try {
        await prisma.company.updateMany({
            where: { domain: extracted.domain },
            data: { learnedPattern: extracted.pattern },
        });
    } catch (_) {}
}

/**
 * Get learned pattern for a domain.
 */
async function getLearnedPattern(domain) {
    try {
        const company = await prisma.company.findUnique({
            where: { domain },
            select: { learnedPattern: true },
        });
        return company?.learnedPattern || null;
    } catch {
        return null;
    }
}

// ─── Main Discovery Function ─────────────────────────────────────────────────

/**
 * Resolve domain for a company using multi-layer discovery.
 * @param {object} opts
 * @param {string} opts.company - company name
 * @param {string|null} opts.manualDomain - user-provided domain override
 * @param {string|null} opts.knownEmail - email found in pasted data
 * @returns {{ domain, source, confidence, pattern }}
 */
async function discoverDomain(opts) {
    const { company, manualDomain = null, knownEmail = null } = opts;

    // ── Layer 1: Manual override (highest priority) ──────────────────────────
    if (manualDomain) {
        const domain = sanitizeDomain(manualDomain);
        if (domain) {
            const hasMX = await verifyMX(domain);
            if (hasMX) {
                return { domain, source: 'manual_override', confidence: 'VERY_HIGH', pattern: null };
            }
            // Even without MX, trust user input
            return { domain, source: 'manual_override', confidence: 'HIGH', pattern: null };
        }
    }

    // ── Layer 2: Extract from known email ────────────────────────────────────
    if (knownEmail) {
        const extracted = extractPatternFromEmail(knownEmail);
        if (extracted) {
            const hasMX = await verifyMX(extracted.domain);
            if (hasMX) {
                // Learn the pattern
                await learnPatternFromEmail(knownEmail);
                return { domain: extracted.domain, source: 'pasted_email', confidence: 'VERY_HIGH', pattern: extracted.pattern };
            }
        }
    }

    // ── Layer 3: Local DB cache ──────────────────────────────────────────────
    if (company) {
        try {
            const normalized = company.toLowerCase().replace(/[^a-z\s]/g, '').trim();
            const cached = await prisma.company.findFirst({
                where: {
                    OR: [
                        { companyName: { contains: company, mode: 'insensitive' } },
                        { companyName: { contains: normalized, mode: 'insensitive' } },
                    ],
                    domain: { not: null },
                },
                select: { domain: true, learnedPattern: true },
            });
            if (cached?.domain) {
                return { domain: cached.domain, source: 'local_cache', confidence: 'HIGH', pattern: cached.learnedPattern };
            }
        } catch (_) {}
    }

    // ── Layer 4: Enterprise cache (in-memory) ────────────────────────────────
    if (company) {
        const enterpriseDomain = getEnterpriseDomain(company);
        if (enterpriseDomain) {
            return { domain: enterpriseDomain, source: 'enterprise_cache', confidence: 'HIGH', pattern: null };
        }
    }

    // ── Layer 5: External discovery (Clearbit) ───────────────────────────────
    if (company) {
        const domain = await findDomain(company);
        if (domain) {
            return { domain, source: 'clearbit', confidence: 'MEDIUM', pattern: null };
        }
    }

    // ── Layer 6: Smart fallback heuristics ───────────────────────────────────
    if (company) {
        const slug = company.toLowerCase().replace(/[^a-z0-9]/g, '');
        const fallbacks = [`${slug}.com`, `${slug}.ai`, `${slug}.io`, `${slug}.co`];

        for (const candidate of fallbacks) {
            const hasMX = await verifyMX(candidate);
            if (hasMX) {
                return { domain: candidate, source: 'heuristic', confidence: 'LOW', pattern: null };
            }
        }
    }

    return { domain: null, source: 'not_found', confidence: 'NONE', pattern: null };
}

module.exports = {
    discoverDomain,
    sanitizeDomain,
    extractPatternFromEmail,
    learnPatternFromEmail,
    getLearnedPattern,
    verifyMX,
};
