/**
 * companyNormalizer.js — Context-aware company inference + normalization.
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles: alias mapping, fuzzy matching, batch-level dominant company
 * inference, enterprise domain cache, and company propagation.
 */

// ─── Enterprise Domain Cache (never fail obvious ones) ───────────────────────
const ENTERPRISE_CACHE = {
    'honeywell': 'honeywell.com',
    'google': 'google.com',
    'microsoft': 'microsoft.com',
    'amazon': 'amazon.com',
    'meta': 'meta.com',
    'facebook': 'meta.com',
    'apple': 'apple.com',
    'netflix': 'netflix.com',
    'tesla': 'tesla.com',
    'nvidia': 'nvidia.com',
    'intel': 'intel.com',
    'ibm': 'ibm.com',
    'oracle': 'oracle.com',
    'salesforce': 'salesforce.com',
    'adobe': 'adobe.com',
    'spotify': 'spotify.com',
    'uber': 'uber.com',
    'airbnb': 'airbnb.com',
    'stripe': 'stripe.com',
    'shopify': 'shopify.com',
    'twitter': 'x.com',
    'linkedin': 'linkedin.com',
    'snap': 'snap.com',
    'snapchat': 'snap.com',
    'tiktok': 'tiktok.com',
    'bytedance': 'bytedance.com',
    'samsung': 'samsung.com',
    'sony': 'sony.com',
    'cisco': 'cisco.com',
    'vmware': 'vmware.com',
    'dell': 'dell.com',
    'hp': 'hp.com',
    'accenture': 'accenture.com',
    'deloitte': 'deloitte.com',
    'mckinsey': 'mckinsey.com',
    'jpmorgan': 'jpmorgan.com',
    'goldman sachs': 'goldmansachs.com',
    'morgan stanley': 'morganstanley.com',
    'tcs': 'tcs.com',
    'infosys': 'infosys.com',
    'wipro': 'wipro.com',
    'cognizant': 'cognizant.com',
    'hcl': 'hcltech.com',
    'capgemini': 'capgemini.com',
    'zoho': 'zoho.com',
    'freshworks': 'freshworks.com',
    'razorpay': 'razorpay.com',
    'flipkart': 'flipkart.com',
    'swiggy': 'swiggy.com',
    'zomato': 'zomato.com',
    'paytm': 'paytm.com',
    'ola': 'olacabs.com',
    'reliance': 'ril.com',
    'tata': 'tata.com',
    'mahindra': 'mahindra.com',
    'bajaj': 'bajaj.com',
};

// ─── Alias Mapping ───────────────────────────────────────────────────────────
const ALIAS_MAP = {
    'honey well': 'honeywell',
    'honeywell aerospace': 'honeywell',
    'honeywell international': 'honeywell',
    'honeywell technology solutions': 'honeywell',
    'honeywell india': 'honeywell',
    'google llc': 'google',
    'google inc': 'google',
    'google cloud': 'google',
    'alphabet': 'google',
    'microsoft corporation': 'microsoft',
    'microsoft india': 'microsoft',
    'amazon web services': 'amazon',
    'aws': 'amazon',
    'amazon india': 'amazon',
    'meta platforms': 'meta',
    'facebook inc': 'meta',
    'instagram': 'meta',
    'whatsapp': 'meta',
    'apple inc': 'apple',
    'tesla motors': 'tesla',
    'tesla inc': 'tesla',
    'nvidia corporation': 'nvidia',
    'tata consultancy services': 'tcs',
    'tata consulting': 'tcs',
    'infosys limited': 'infosys',
    'infosys bpo': 'infosys',
    'wipro limited': 'wipro',
    'wipro technologies': 'wipro',
    'hcl technologies': 'hcl',
    'jp morgan': 'jpmorgan',
    'jp morgan chase': 'jpmorgan',
    'goldman sachs group': 'goldman sachs',
};

/**
 * Normalize a company name to its canonical form.
 * @param {string} raw - raw company name
 * @returns {{ normalized: string, domain: string|null, confidence: number }}
 */
function normalizeCompany(raw) {
    if (!raw || typeof raw !== 'string') {
        return { normalized: '', domain: null, confidence: 0 };
    }

    let cleaned = raw.trim().toLowerCase()
        .replace(/\s*(pvt|private|ltd|limited|inc|llc|corp|corporation|co|company|group|technologies|solutions|services)\s*\.?\s*/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

    // Check alias map first
    if (ALIAS_MAP[cleaned]) {
        cleaned = ALIAS_MAP[cleaned];
    }

    // Check enterprise cache
    const domain = ENTERPRISE_CACHE[cleaned] || null;

    // Capitalize for display
    const normalized = cleaned.split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

    return {
        normalized,
        domain,
        confidence: domain ? 0.95 : 0.5,
    };
}

/**
 * Infer the dominant company from a batch of profiles.
 * If most profiles reference the same company (or aliases), propagate it.
 * @param {Array} profiles - array of parsed profiles
 * @returns {{ dominantCompany: string|null, dominantDomain: string|null, confidence: number }}
 */
function inferDominantCompany(profiles) {
    const counts = {};

    for (const p of profiles) {
        if (!p.company) continue;
        const { normalized } = normalizeCompany(p.company);
        if (!normalized) continue;
        counts[normalized] = (counts[normalized] || 0) + 1;
    }

    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) return { dominantCompany: null, dominantDomain: null, confidence: 0 };

    const [topCompany, topCount] = entries[0];
    const totalWithCompany = profiles.filter(p => p.company).length;
    const ratio = totalWithCompany > 0 ? topCount / totalWithCompany : 0;

    // If >50% of profiles reference the same company, it's dominant
    if (ratio >= 0.5 && topCount >= 2) {
        const { domain } = normalizeCompany(topCompany);
        return {
            dominantCompany: topCompany,
            dominantDomain: domain,
            confidence: Math.min(ratio, 0.99),
        };
    }

    return { dominantCompany: null, dominantDomain: null, confidence: 0 };
}

/**
 * Propagate company context across profiles that are missing it.
 * Uses: override > profile's own company > dominant company inference.
 * @param {Array} profiles - parsed profiles
 * @param {string|null} overrideCompany - user-specified company override
 * @returns {Array} enriched profiles
 */
function propagateCompanyContext(profiles, overrideCompany = null) {
    let resolvedOverride = null;
    let overrideDomain = null;

    if (overrideCompany) {
        const norm = normalizeCompany(overrideCompany);
        resolvedOverride = norm.normalized;
        overrideDomain = norm.domain;
    }

    const { dominantCompany, dominantDomain } = inferDominantCompany(profiles);

    return profiles.map(p => {
        // Priority: override > profile's own > dominant
        let company = p.company;
        let domain = null;
        let companySource = 'parsed';

        if (resolvedOverride) {
            company = resolvedOverride;
            domain = overrideDomain;
            companySource = 'override';
        } else if (company) {
            const norm = normalizeCompany(company);
            company = norm.normalized;
            domain = norm.domain;
            companySource = 'normalized';
        } else if (dominantCompany) {
            company = dominantCompany;
            domain = dominantDomain;
            companySource = 'inferred';
        }

        return {
            ...p,
            company,
            companyDomain: domain,
            companySource,
        };
    });
}

/**
 * Get domain from enterprise cache.
 */
function getEnterpriseDomain(companyName) {
    if (!companyName) return null;
    const { domain } = normalizeCompany(companyName);
    return domain;
}

module.exports = {
    normalizeCompany,
    inferDominantCompany,
    propagateCompanyContext,
    getEnterpriseDomain,
    ENTERPRISE_CACHE,
};
