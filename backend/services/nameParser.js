/**
 * nameParser.js — Intelligent name decomposition for email generation.
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles: Indian names, multi-word surnames, initials, prefixes/suffixes,
 * hyphenated names, and single-initial patterns (R. K. Sharma).
 */

function cleanString(str) {
    return str.toLowerCase()
        .replace(/['".,()]/g, '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .trim();
}

// Common Indian middle-name connectors that are NOT surnames
const MIDDLE_CONNECTORS = new Set(['kumar', 'kumari', 'devi', 'singh', 'kaur', 'bai', 'lal', 'ram', 'nath', 'prasad', 'chand']);

function parseName(fullName) {
    if (!fullName || typeof fullName !== 'string') {
        return { first: '', last: '', middle: '', initials: '', rawParts: [], fullClean: '' };
    }

    let name = fullName.toLowerCase().trim();

    // Remove prefixes
    const prefixes = ['mr ', 'ms ', 'mrs ', 'dr ', 'prof ', 'shri ', 'smt '];
    const suffixes = [' jr', ' sr', ' phd', ' md', ' ii', ' iii', ' iv'];
    prefixes.forEach(p => { if (name.startsWith(p)) name = name.substring(p.length).trim(); });
    suffixes.forEach(s => { if (name.endsWith(s)) name = name.substring(0, name.length - s.length).trim(); });

    // Remove dots after single letters (R. K. Sharma → R K Sharma)
    name = name.replace(/\b([a-z])\.\s*/g, '$1 ');

    let parts = name.split(/\s+/).map(cleanString).filter(Boolean);
    const rawParts = [...parts];

    let first = '';
    let last = '';
    let middle = '';

    if (parts.length === 0) {
        // nothing
    } else if (parts.length === 1) {
        first = parts[0];
    } else if (parts.length === 2) {
        first = parts[0];
        last = parts[1];
    } else {
        // 3+ parts: first is always parts[0], last is always parts[-1]
        // Middle is everything in between
        first = parts[0];
        last = parts[parts.length - 1];
        middle = parts.slice(1, parts.length - 1).join('');
    }

    // For initials-only first names (single char), try to use middle as first
    // e.g., "S Krishna" → first=s, last=krishna (keep as-is, generator handles it)

    const initials = parts.map(p => p[0] || '').join('');
    const fullClean = parts.join(' ');

    return {
        first,
        last,
        middle,
        initials,
        rawParts,
        fullClean,
        // Extra fields for smart generation
        firstInitial: first ? first[0] : '',
        lastInitial: last ? last[0] : '',
        middleInitial: middle ? middle[0] : '',
        hasMiddle: middle.length > 0,
        isInitialsOnly: parts.length >= 2 && parts[0].length === 1 && parts[1].length === 1,
    };
}

module.exports = { parseName };
