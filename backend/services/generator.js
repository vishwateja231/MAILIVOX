/**
 * generator.js — Enterprise Email Permutation Engine v3
 * ─────────────────────────────────────────────────────────────────────────────
 * Based on real-world data from 1,842 HR contacts:
 *
 *   Pattern 1: firstname.lastname    — 51.7% (952 contacts)
 *   Pattern 2: firstname             — 34.6% (637 contacts)
 *   Pattern 3: firstname.l           —  9.4% (173 contacts)
 *   Pattern 4: firstnamelastname     —  3.0% (55 contacts)
 *   Pattern 5: f.lastname            —  0.6% (11 contacts)
 *   Pattern 6: firstname_lastname    —  0.4% (8 contacts)
 *   Pattern 7: firstname_l           —  0.3% (5 contacts)
 *   Pattern 8: special/other         —  0.1%
 *
 * These 7 patterns cover 99.9% of real corporate emails.
 * Generator produces them in EXACT probability order.
 *
 * Additional patterns (Tier B/C) are appended after the proven ones
 * for completeness but scored lower.
 */

/**
 * Generate enterprise email permutations sorted by real-world probability.
 * @param {object} nameParts - from parseName()
 * @param {string} domain
 * @param {string|null} knownPattern - verified pattern for this domain
 * @param {object} opts - { includeTierC: false }
 * @returns {Array<{email, pattern, confidence, tier}>}
 */
function generatePermutations(nameParts, domain, knownPattern = null, opts = {}) {
    const { includeTierC = false } = opts;
    const { first, last, middle, firstInitial, middleInitial, lastInitial, rawParts, isInitialsOnly } = nameParts;
    const emails = new Map();

    const fi = firstInitial || (first ? first[0] : '');
    const li = lastInitial || (last ? last[0] : '');
    const mi = middleInitial || (middle ? middle[0] : '');

    function add(local, pattern, tier) {
        if (!local || local.includes('undefined') || local.includes('null')) return;
        local = local.replace(/\.\./g, '.').replace(/^[.\-_]/, '').replace(/[.\-_]$/, '').toLowerCase();
        if (!local || local.length < 2) return;

        const fullEmail = `${local}@${domain}`;
        if (emails.has(fullEmail)) return;

        let confidence = 'PENDING';
        if (knownPattern && pattern === knownPattern) confidence = 'HIGH';

        emails.set(fullEmail, { email: fullEmail, pattern, confidence, tier });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // TIER A — PROVEN PATTERNS (covers 99.9% of real corporate emails)
    // Generated in exact probability order from real data
    // ═══════════════════════════════════════════════════════════════════════════

    if (first && last) {
        // Pattern 1: firstname.lastname — 51.7% hit rate (MOST COMMON)
        add(`${first}.${last}`, 'firstname.lastname', 'A');

        // Pattern 2: firstname — 34.6% hit rate
        add(`${first}`, 'firstname', 'A');

        // Pattern 3: firstname.l (first initial of last name) — 9.4%
        add(`${first}.${li}`, 'firstname.lastinitial', 'A');

        // Pattern 4: firstnamelastname (concatenated) — 3.0%
        add(`${first}${last}`, 'firstnamelastname', 'A');

        // Pattern 5: f.lastname (first initial + lastname) — 0.6%
        add(`${fi}.${last}`, 'firstinitial.lastname', 'A');

        // Pattern 6: firstname_lastname (underscore) — 0.4%
        add(`${first}_${last}`, 'firstname_lastname', 'A');

        // Pattern 7: firstname_l (underscore + last initial) — 0.3%
        add(`${first}_${li}`, 'firstname_lastinitial', 'A');

        // Additional high-probability patterns (common in enterprise)
        add(`${fi}${last}`, 'firstinitiallastname', 'A');
        add(`${first}-${last}`, 'firstname-lastname', 'A');
        add(`${first}${li}`, 'firstnamelastinitial', 'A');

        // Middle name patterns (Tier A when middle exists)
        if (middle) {
            add(`${first}.${mi}.${last}`, 'firstname.middleinitial.lastname', 'A');
            add(`${first}.${middle}.${last}`, 'firstname.middle.lastname', 'A');
            add(`${first}.${last}.${mi}`, 'firstname.lastname.middleinitial', 'A');
        }

    } else if (first && !last) {
        // Single name — Pattern 2 is the only option
        add(`${first}`, 'firstname', 'A');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // TIER B — SECONDARY PATTERNS (less common but valid)
    // Try these if Tier A patterns bounce
    // ═══════════════════════════════════════════════════════════════════════════

    if (first && last) {
        add(`${last}.${first}`, 'lastname.firstname', 'B');
        add(`${last}${first}`, 'lastnamefirstname', 'B');
        add(`${last}_${first}`, 'lastname_firstname', 'B');
        add(`${last}-${first}`, 'lastname-firstname', 'B');
        add(`${last}`, 'lastname', 'B');
        add(`${last}.${fi}`, 'lastname.firstinitial', 'B');
        add(`${last}${fi}`, 'lastnamefirstinitial', 'B');

        if (middle) {
            add(`${first}${mi}${last}`, 'firstnamemiddleinitiallastname', 'B');
            add(`${fi}.${mi}.${last}`, 'firstinitial.middleinitial.lastname', 'B');
            add(`${first}_${last}_${mi}`, 'firstname_lastname_middleinitial', 'B');
        }

        // Numbered variants (large orgs with name collisions)
        add(`${first}.${last}1`, 'firstname.lastname1', 'B');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // TIER C — LOW PRIORITY (only if explicitly requested)
    // ═══════════════════════════════════════════════════════════════════════════

    if (includeTierC && first && last) {
        add(`${fi}${li}`, 'firstinitiallastinitial', 'C');
        add(`${fi}.${li}`, 'firstinitial.lastinitial', 'C');
        add(`${first}${last}1`, 'firstnamelastname1', 'C');
        add(`${fi}${last}1`, 'firstinitiallastname1', 'C');
        add(`${first}1`, 'firstname1', 'C');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Initials-style names (R K Sharma)
    // ═══════════════════════════════════════════════════════════════════════════

    if (isInitialsOnly && rawParts && rawParts.length >= 3) {
        const i1 = rawParts[0];
        const surname = rawParts[rawParts.length - 1];
        add(`${i1}.${surname}`, 'firstinitial.lastname', 'A');
        add(`${i1}${surname}`, 'firstinitiallastname', 'A');
        add(`${surname}.${i1}`, 'lastname.firstinitial', 'B');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SORT: Known pattern → Tier A (probability order) → Tier B → Tier C
    // ═══════════════════════════════════════════════════════════════════════════

    const TIER_ORDER = { A: 0, B: 1, C: 2 };

    // Probability-based ranking (from real data)
    const PATTERN_PROBABILITY = {
        'firstname.lastname': 1,          // 51.7%
        'firstname': 2,                   // 34.6%
        'firstname.lastinitial': 3,       // 9.4%
        'firstnamelastname': 4,           // 3.0%
        'firstinitial.lastname': 5,       // 0.6%
        'firstname_lastname': 6,          // 0.4%
        'firstname_lastinitial': 7,       // 0.3%
        'firstinitiallastname': 8,
        'firstname-lastname': 9,
        'firstnamelastinitial': 10,
        'firstname.middleinitial.lastname': 11,
        'firstname.middle.lastname': 12,
        'firstname.lastname.middleinitial': 13,
        // Tier B
        'lastname.firstname': 20,
        'lastnamefirstname': 21,
        'lastname_firstname': 22,
        'lastname-firstname': 23,
        'lastname': 24,
        'lastname.firstinitial': 25,
        'lastnamefirstinitial': 26,
        'firstnamemiddleinitiallastname': 27,
        'firstname.lastname1': 28,
        // Tier C
        'firstinitiallastinitial': 40,
        'firstnamelastname1': 41,
    };

    const results = Array.from(emails.values()).sort((a, b) => {
        // Known pattern always first
        if (a.confidence === 'HIGH' && b.confidence !== 'HIGH') return -1;
        if (b.confidence === 'HIGH' && a.confidence !== 'HIGH') return 1;
        // Then by tier
        const tierDiff = (TIER_ORDER[a.tier] ?? 2) - (TIER_ORDER[b.tier] ?? 2);
        if (tierDiff !== 0) return tierDiff;
        // Then by probability ranking
        const aRank = PATTERN_PROBABILITY[a.pattern] ?? 50;
        const bRank = PATTERN_PROBABILITY[b.pattern] ?? 50;
        return aRank - bRank;
    });

    return results;
}

/**
 * Get the pattern quality score for confidence scoring.
 * Based on real-world probability data.
 * @param {string} pattern
 * @param {string} tier
 * @returns {number} 0-100
 */
function getPatternScore(pattern, tier) {
    // Tier A scores (based on real hit rates)
    const SCORES = {
        // Tier A — proven patterns
        'firstname.lastname': 92,         // 51.7% — most common
        'firstname': 85,                  // 34.6% — very common at startups
        'firstname.lastinitial': 78,      // 9.4%
        'firstnamelastname': 75,          // 3.0%
        'firstinitial.lastname': 70,      // 0.6%
        'firstname_lastname': 68,         // 0.4%
        'firstname_lastinitial': 65,      // 0.3%
        'firstinitiallastname': 72,
        'firstname-lastname': 70,
        'firstnamelastinitial': 65,
        'firstname.middleinitial.lastname': 85,
        'firstname.middle.lastname': 80,
        'firstname.lastname.middleinitial': 72,
        // Tier B — secondary
        'lastname.firstname': 55,
        'lastnamefirstname': 50,
        'lastname_firstname': 50,
        'lastname-firstname': 50,
        'lastname': 40,
        'lastname.firstinitial': 48,
        'lastnamefirstinitial': 48,
        'firstnamemiddleinitiallastname': 55,
        'firstinitial.middleinitial.lastname': 52,
        'firstname_lastname_middleinitial': 50,
        'firstname.lastname1': 45,
        'firstname1.lastname': 45,
        // Tier C — low priority
        'firstinitiallastinitial': 30,
        'firstinitial.lastinitial': 30,
        'firstnamelastname1': 28,
        'firstinitiallastname1': 25,
        'firstname1': 25,
        // Special
        'PROVIDED_EMAIL': 98,
    };

    return SCORES[pattern] || (tier === 'A' ? 60 : tier === 'B' ? 42 : 25);
}

module.exports = { generatePermutations, getPatternScore };
