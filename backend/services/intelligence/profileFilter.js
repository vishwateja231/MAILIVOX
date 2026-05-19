/**
 * profileFilter.js — Quality filtering + deduplication for extracted profiles.
 * ─────────────────────────────────────────────────────────────────────────────
 * Rejects junk profiles, LinkedIn UI noise, and duplicates.
 * Assigns confidence scores to each profile.
 */

// ─── Junk Name Patterns ──────────────────────────────────────────────────────
const JUNK_NAMES = new Set([
    'linkedin member', 'linkedin user', 'add a note',
    'connect', 'follow', 'message', 'pending',
    'people also viewed', 'people you may know',
    'more results', 'show more', 'see all',
    'sign in', 'join now', 'try premium',
    'promoted', 'ad', 'sponsored',
]);

const JUNK_PATTERNS = [
    /^(view|see|show|load|more|next|prev|back|skip|close|cancel|dismiss)/i,
    /^(page|result|filter|sort|search|find|browse)/i,
    /^\d+\s*(result|connection|follower|mutual)/i,
    /^(are these results helpful|did you find)/i,
    /^(upgrade|premium|try|start|get|buy|subscribe)/i,
    /^(accept|decline|ignore|remove|block|report)/i,
    /\b(are mutual|is connected|mutual connection|people also viewed)\b/i,
    /\s+(is|are|was|were)$/i, // Trailing verbs (LinkedIn fragments)
    /^[\W\d]+$/, // Only symbols/numbers
    /^.{1,2}$/, // Too short
    /^.{80,}$/, // Too long for a name
];

/**
 * Check if a name is valid (not junk).
 * IMPORTANT: Single names ARE valid (common in India, LinkedIn exports, recruiter lists).
 * Only reject actual garbage/UI noise.
 */
function isValidName(name) {
    if (!name || typeof name !== 'string') return false;
    const trimmed = name.trim();
    if (trimmed.length < 2) return false;
    if (JUNK_NAMES.has(trimmed.toLowerCase())) return false;
    if (JUNK_PATTERNS.some(p => p.test(trimmed))) return false;

    const words = trimmed.split(/\s+/).filter(w => w.length > 0);

    // Single word: valid if >= 3 chars and starts with letter
    if (words.length === 1) {
        return words[0].length >= 3 && /^[A-Za-z\u00C0-\u024F]/.test(words[0]);
    }

    // Multi-word: each word should start with a letter
    if (!words.every(w => /^[A-Za-z\u00C0-\u024F]/.test(w))) return false;

    // Should not contain typical UI text
    if (/\b(button|click|tap|menu|nav|header|footer|sidebar)\b/i.test(trimmed)) return false;

    return true;
}

/**
 * Compute a quality confidence score for a profile.
 * Single-name profiles with a company are VALID (common in India/LinkedIn).
 * Simple "name company" inputs are VALID (user explicitly typed them).
 * @returns {number} 0-1 score
 */
function computeProfileConfidence(profile) {
    let score = 0;
    const maxScore = 5;

    // Has valid name (required — but single names are OK now)
    if (isValidName(profile.fullName)) score += 1.5;
    else return 0;

    // Has company (strong signal)
    if (profile.company && profile.company.length > 1) score += 1.5;

    // Has role/headline
    if (profile.role && profile.role.length > 2) score += 1;

    // Has location
    if (profile.location && profile.location.length > 2) score += 0.5;

    // Name has proper capitalization (bonus, not required)
    const words = profile.fullName.trim().split(/\s+/);
    if (words.every(w => /^[A-Z]/.test(w))) score += 0.5;

    // Single name WITH company = still valid (minimum 0.5 confidence)
    if (words.length === 1 && profile.company && profile.company.length > 1) {
        score = Math.max(score, 3);
    }

    // Name + company (even without role/location) = valid user input
    // This ensures "vishwa apple" type inputs always pass
    if (profile.fullName && profile.company && profile.company.length > 1) {
        score = Math.max(score, 2.5);
    }

    // Penalize ONLY if the entire name IS a role title (not a person name)
    if (/^(manager|engineer|director|specialist|analyst|recruiter|intern)$/i.test(profile.fullName.trim())) {
        score -= 2;
    }

    return Math.max(0, Math.min(score / maxScore, 1));
}

/**
 * Filter profiles by quality threshold.
 * @param {Array} profiles
 * @param {number} minConfidence - minimum confidence (0-1), default 0.3
 * @returns {{ accepted: Array, rejected: Array }}
 */
function filterProfiles(profiles, minConfidence = 0.3) {
    const accepted = [];
    const rejected = [];

    for (const p of profiles) {
        const confidence = computeProfileConfidence(p);
        if (confidence >= minConfidence) {
            accepted.push({ ...p, qualityScore: confidence });
        } else {
            rejected.push({ ...p, qualityScore: confidence, rejectReason: getRejectReason(p) });
        }
    }

    return { accepted, rejected };
}

function getRejectReason(profile) {
    if (!profile.fullName || profile.fullName.trim().length < 2) return 'name_too_short';
    if (JUNK_NAMES.has(profile.fullName.trim().toLowerCase())) return 'junk_name';
    if (JUNK_PATTERNS.some(p => p.test(profile.fullName.trim()))) return 'junk_pattern';
    return 'low_confidence';
}

/**
 * Deduplicate profiles using exact + fuzzy matching.
 * @param {Array} profiles
 * @returns {{ unique: Array, duplicates: number }}
 */
function deduplicateProfiles(profiles) {
    const seen = new Map(); // key → profile
    const unique = [];
    let duplicates = 0;

    for (const p of profiles) {
        // Exact key: normalized name + normalized company
        const nameKey = (p.fullName || '').toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
        const companyKey = (p.company || '').toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
        const exactKey = `${nameKey}|${companyKey}`;

        if (seen.has(exactKey)) {
            duplicates++;
            continue;
        }

        // Fuzzy: check if name is very similar to an existing one (same company)
        let isDuplicate = false;
        for (const [key, existing] of seen) {
            const existingCompany = key.split('|')[1];
            if (existingCompany === companyKey && companyKey) {
                // Same company — check name similarity
                const similarity = computeNameSimilarity(nameKey, key.split('|')[0]);
                if (similarity > 0.85) {
                    isDuplicate = true;
                    duplicates++;
                    break;
                }
            }
        }

        if (!isDuplicate) {
            seen.set(exactKey, p);
            unique.push(p);
        }
    }

    return { unique, duplicates };
}

/**
 * Simple name similarity (Jaccard on character bigrams).
 */
function computeNameSimilarity(a, b) {
    if (a === b) return 1;
    if (!a || !b) return 0;

    const bigramsA = new Set();
    const bigramsB = new Set();
    for (let i = 0; i < a.length - 1; i++) bigramsA.add(a.slice(i, i + 2));
    for (let i = 0; i < b.length - 1; i++) bigramsB.add(b.slice(i, i + 2));

    let intersection = 0;
    for (const bg of bigramsA) {
        if (bigramsB.has(bg)) intersection++;
    }

    const union = bigramsA.size + bigramsB.size - intersection;
    return union > 0 ? intersection / union : 0;
}

module.exports = {
    isValidName,
    computeProfileConfidence,
    filterProfiles,
    deduplicateProfiles,
};
