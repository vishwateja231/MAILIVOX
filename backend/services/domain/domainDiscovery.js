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
    if (company && isValidCompanyForLookup(company)) {
        const domain = await findDomain(company);
        if (domain && isReasonableDomainMatch(company, domain)) {
            return { domain, source: 'clearbit', confidence: 'MEDIUM', pattern: null };
        }
    }

    // ── Layer 6: Smart fallback heuristics ───────────────────────────────────
    // Only attempt heuristics for multi-word company names or well-known short names
    if (company && isValidCompanyForLookup(company)) {
        const slug = company.toLowerCase().replace(/[^a-z0-9]/g, '');
        // Don't try heuristics for very short slugs (likely person names)
        if (slug.length >= 4) {
            const fallbacks = [`${slug}.com`];
            for (const candidate of fallbacks) {
                const hasMX = await verifyMX(candidate);
                if (hasMX) {
                    return { domain: candidate, source: 'heuristic', confidence: 'LOW', pattern: null };
                }
            }
        }
    }

    return { domain: null, source: 'not_found', confidence: 'NONE', pattern: null };
}

/**
 * Check if a company name is valid for domain lookup.
 * Rejects names that are likely person names or too vague.
 */
function isValidCompanyForLookup(company) {
    if (!company) return false;
    const lower = company.toLowerCase().trim();
    
    // Must be at least 2 characters
    if (lower.length < 2) return false;
    
    // Single-word names under 5 chars that could be person names — skip
    const words = lower.split(/\s+/);
    if (words.length === 1 && lower.length < 5) return false;
    
    // Common Indian last names / first names that get mistaken for companies
    const personNames = new Set([
        'kumar', 'singh', 'sharma', 'gupta', 'patel', 'reddy', 'rao', 'nair',
        'mishra', 'jain', 'agarwal', 'verma', 'yadav', 'chauhan', 'pandey',
        'sangam', 'kalyani', 'navudu', 'chiliveri', 'chikkula', 'sahay',
        'saha', 'raza', 'ahmad', 'khan', 'ali', 'ansari', 'shaikh',
        'john', 'smith', 'doe', 'james', 'david', 'michael', 'robert',
        'unknown', 'none', 'na', 'nil', 'null', 'undefined',
    ]);
    if (personNames.has(lower)) return false;
    if (words.length === 1 && personNames.has(words[0])) return false;
    
    // If it matches common "Unknown" variants
    if (/^(unknown|not\s*specified|n\/?a|none|—|-|–)$/i.test(lower)) return false;
    
    return true;
}

/**
 * Check if a Clearbit domain result is reasonable for the given company name.
 * Prevents "Sangam" → sangam.com (unrelated jewelry company).
 */
function isReasonableDomainMatch(company, domain) {
    if (!company || !domain) return false;
    
    const companySlug = company.toLowerCase().replace(/[^a-z0-9]/g, '');
    const domainBase = domain.split('.')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    
    // The domain should contain a significant portion of the company name
    // OR the company name should contain the domain base
    if (domainBase.includes(companySlug) || companySlug.includes(domainBase)) return true;
    
    // For multi-word companies, check if any word matches
    const words = company.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (words.some(w => domainBase.includes(w))) return true;
    
    // If the domain is completely unrelated to the company name, reject it
    // This prevents "Sangam" → "sangamwedding.com" type matches
    // Only accept if the domain base is AT LEAST 60% similar
    const similarity = longestCommonSubstring(companySlug, domainBase);
    if (similarity >= companySlug.length * 0.6) return true;
    
    return false;
}

function longestCommonSubstring(s1, s2) {
    if (!s1 || !s2) return 0;
    let max = 0;
    for (let i = 0; i < s1.length; i++) {
        for (let j = 0; j < s2.length; j++) {
            let k = 0;
            while (i + k < s1.length && j + k < s2.length && s1[i + k] === s2[j + k]) k++;
            if (k > max) max = k;
        }
    }
    return max;
}

module.exports = {
    discoverDomain,
    sanitizeDomain,
    extractPatternFromEmail,
    learnPatternFromEmail,
    getLearnedPattern,
    verifyMX,
};
