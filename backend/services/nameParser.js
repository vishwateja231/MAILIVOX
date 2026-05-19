/**
 * nameParser.js — Intelligent name decomposition for email generation.
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles: Indian names, multi-word surnames, initials, prefixes/suffixes,
 * hyphenated names, and single-initial patterns (R. K. Sharma).
 * Also sanitizes raw LinkedIn profile text that may include headlines,
 * connection degree, locations, and mutual connection info.
 */

function cleanString(str) {
    return str.toLowerCase()
        .replace(/['".,()]/g, '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .trim();
}

/**
 * sanitizeLinkedInName — Strips LinkedIn garbage from a raw name string.
 * Handles inputs like:
 *   "Aparna Billa • 2ndSDE2 @amazonHyderabad, Telangana, India..."
 *   "Harjot Singh • 1stSDE1 @ Amazon || Ex Infosys..."
 *   "Nitesh Gupta———Nitesh Gupta"
 *   "LAXMI PRANITHA R"
 */
function sanitizeLinkedInName(rawName) {
    if (!rawName || typeof rawName !== 'string') return '';

    let name = rawName.trim();

    // 1. Cut at connection degree markers: • 1st, • 2nd, • 3rd, · 1st, etc.
    name = name.split(/\s*[•·]\s*(?:1st|2nd|3rd|4th|5th)/i)[0].trim();

    // 2. Cut at " - " or " | " or " || " (headline separators)
    name = name.split(/\s*(?:\|\||[|–—])\s*/)[0].trim();

    // 3. Cut at connection degree without bullet: "Name 2nd" at end
    name = name.replace(/\s+(?:1st|2nd|3rd)$/i, '').trim();

    // 4. Remove "Message" or "Current:" that LinkedIn adds for 1st connections
    name = name.replace(/\bMessage\b.*$/i, '').trim();
    name = name.replace(/\bCurrent:.*$/i, '').trim();

    // 5. Remove emojis
    name = name.replace(/[\u{1F300}-\u{1FFFF}]/gu, '');
    name = name.replace(/[\u2600-\u27BF]/gu, '');
    name = name.replace(/[🚀✨💡🔥⭐️🎯💻🌟]/gu, '');

    // 6. Remove anything after "Hyderabad", "Bangalore", location patterns
    name = name.replace(/(?:Hyderabad|Bangalore|Bengaluru|Mumbai|Delhi|Chennai|Pune|Kolkata|Noida|Gurugram|India|United States|San Francisco|New York|London|Singapore|Remote).*$/i, '').trim();

    // 7. Remove role/company patterns that got concatenated without spaces
    // e.g., "Aparna BillaSDE2 @amazon" → "Aparna Billa"
    // Look for lowercase-to-uppercase boundary followed by common role words
    name = name.replace(/(?<=[a-z])(?:SDE|SWE|SSE|Manager|Engineer|Developer|Specialist|Analyst|Director|Recruiter|Intern|Senior|Junior|Lead|Staff|Principal|Software|Risk|AI|ML)\b.*/i, '').trim();

    // 8. Remove "@ Company" suffixes
    name = name.replace(/\s*@\s*\w+.*$/, '').trim();

    // 9. Remove repeated names (e.g., "Nitesh Gupta———Nitesh Gupta")
    name = name.split(/[—–\-]{2,}/)[0].trim();

    // 10. Remove trailing special characters
    name = name.replace(/[•·\-–—|@#]+$/, '').trim();

    // 11. Remove numbers, follower counts
    name = name.replace(/\d+[KkMm]?\+?\s*(followers|connections|mutual).*$/i, '').trim();
    name = name.replace(/\d+$/, '').trim();

    // 12. If the result still has location-like commas ("Name, State, Country"), take only before first comma
    // But be careful: "G.K.S Narasimha Rao" should NOT be split
    if (name.includes(',') && /[A-Z][a-z]+,\s*[A-Z]/.test(name)) {
        name = name.split(',')[0].trim();
    }

    // 13. Final cleanup: remove any remaining non-name characters
    // Keep only letters, spaces, dots, hyphens, apostrophes
    name = name.replace(/[^a-zA-Z\s.\-']/g, ' ').replace(/\s+/g, ' ').trim();

    // 14. If after all cleaning the name is too long (>5 words), take first 3-4 words
    const words = name.split(/\s+/);
    if (words.length > 5) {
        name = words.slice(0, 4).join(' ');
    }

    // 15. Reject if the result looks like a role/headline, not a person name
    // Common patterns: "ASE at Accenture", "SDE at Google", "Developer", "Engineer"
    const rolePatterns = /^(ASE|SDE|SSE|SWE|Manager|Engineer|Developer|Specialist|Analyst|Director|Recruiter|Intern|Associate|Consultant|Architect|Designer|Lead|VP|CEO|CTO|CFO|COO|CIO)\b/i;
    if (rolePatterns.test(name)) {
        // Strip the role part — try to extract just the name after "at" or return empty
        const atMatch = name.match(/\bat\s+(.+)/i);
        if (atMatch) {
            // "ASE at Accenture" → reject entirely (Accenture is company not name)
            return '';
        }
        return ''; // Pure role like "Developer" — not a name
    }
    
    // Also reject "Current: ..." patterns
    if (/^current:/i.test(name)) return '';

    return name;
}

// Common Indian middle-name connectors that are NOT surnames
const MIDDLE_CONNECTORS = new Set(['kumar', 'kumari', 'devi', 'singh', 'kaur', 'bai', 'lal', 'ram', 'nath', 'prasad', 'chand']);

function parseName(fullName) {
    if (!fullName || typeof fullName !== 'string') {
        return { first: '', last: '', middle: '', initials: '', rawParts: [], fullClean: '' };
    }

    // Sanitize LinkedIn garbage first
    let name = sanitizeLinkedInName(fullName);
    
    if (!name) {
        return { first: '', last: '', middle: '', initials: '', rawParts: [], fullClean: '' };
    }

    name = name.toLowerCase().trim();

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

    const initials = parts.map(p => p[0] || '').join('');
    const fullClean = parts.join(' ');

    return {
        first,
        last,
        middle,
        initials,
        rawParts,
        fullClean,
        firstInitial: first ? first[0] : '',
        lastInitial: last ? last[0] : '',
        middleInitial: middle ? middle[0] : '',
        hasMiddle: middle.length > 0,
        isInitialsOnly: parts.length >= 2 && parts[0].length === 1 && parts[1].length === 1,
    };
}

module.exports = { parseName, sanitizeLinkedInName };
