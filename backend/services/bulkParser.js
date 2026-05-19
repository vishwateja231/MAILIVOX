/**
 * bulkParser.js
 * Reusable parser engine for pasting large bulk LinkedIn search results.
 * Intelligently splits, deduplicates, and extracts structured data from 100–1000 profiles.
 */

const { parseLinkedInText } = require('./linkedInParser');

// ─── Profile Block Splitters ──────────────────────────────────────────────────
// We detect the start of a new person block when a line looks like a proper name
// followed by connection indicators or standalone name at the top.

/**
 * Heuristic: A line is a "block boundary" if it looks like a name
 * AND is followed (within 3 lines) by a headline or connection indicator.
 */
// Known single-word non-name tokens that start with uppercase
const SINGLE_WORD_NOISE = new Set([
    'india', 'usa', 'uk', 'canada', 'australia', 'germany', 'france', 'singapore',
    'pending', 'connect', 'follow', 'message', 'remote', 'worldwide', 'global',
    'bangalore', 'mumbai', 'delhi', 'gurugram', 'hyderabad', 'chennai', 'pune',
    'kolkata', 'noida', 'ahmedabad', 'london', 'toronto', 'sydney', 'berlin',
    'paris', 'dubai', 'boston', 'seattle', 'austin', 'male', 'female',
]);

function isNameLine(line) {
    const trimmed = line.trim();
    // Must have 2–5 words to be a full name (single words are usually locations/noise)
    const words = trimmed.split(/\s+/);
    if (words.length < 2 || words.length > 5) return false;
    // Skip if any word is a known noise token
    if (words.some(w => SINGLE_WORD_NOISE.has(w.toLowerCase()))) return false;
    // Skip lines that contain common LinkedIn noise phrases
    const lower = trimmed.toLowerCase();
    if (/\b(are mutual|is connected|is a |is an |mutual connection|you both|people also viewed)\b/.test(lower)) return false;
    if (/\b(message|connect|follow|view profile|see all)\b/.test(lower)) return false;
    // Skip lines ending with "is" or containing "are" (LinkedIn fragments like "Merline is", "Raya are mutual")
    if (/\s+(is|are|was|were|has|have|had)$/i.test(trimmed)) return false;
    // Each word starts with a letter (case-insensitive — people type lowercase names)
    return words.every(w => /^[A-Za-z\u00C0-\u024F][a-zA-Z\u00C0-\u024F'\-\.]*$/.test(w));
}

/**
 * Split raw bulk text into individual profile blocks.
 * Strategy: group consecutive lines until we hit a new "name" boundary.
 */
function splitIntoBlocks(rawText) {
    // STEP 1: Split on connection degree markers (• 2nd, • 1st, • 3rd)
    // These are the most reliable profile boundaries in continuous LinkedIn text
    // Each profile starts with "Name • Xnd/st/rd"
    
    // First, try splitting by degree markers
    // Pattern: Name (with spaces) followed by • 1st/2nd/3rd
    // Use lookahead that requires WORD SPACE(S) BULLET DEGREE
    const degreePattern = /([A-Z][A-Za-z\s.\-']+?)\s*[•·]\s*(?:1st|2nd|3rd)/g;
    const degreeSplits = rawText.split(/(?=[A-Z][a-z]+[\s][A-Za-z\s.\-']+\s{1,5}[•·]\s*(?:1st|2nd|3rd))/);
    
    if (degreeSplits.length > 1) {
        // Successfully split by degree markers
        // Now inject newlines at known boundaries so parseLinkedInText can work
        return degreeSplits
            .map(block => injectNewlines(block.trim()))
            .filter(block => block.length > 10);
    }

    // STEP 2: Fallback — split on newlines and use name detection
    const preprocessed = rawText
        .split(/\r?\n/)
        .flatMap(line => {
            // Split on "Name • noise" patterns
            const parts = line.split(/\s*[•·]\s*/);
            return parts.map(p => p.trim()).filter(Boolean);
        });

    const blocks = [];
    let currentBlock = [];

    for (let i = 0; i < preprocessed.length; i++) {
        const trimmed = preprocessed[i].trim();

        if (!trimmed) {
            currentBlock.push(preprocessed[i]);
            continue;
        }

        if (isNameLine(trimmed) && currentBlock.length > 0) {
            const blockText = currentBlock.join('\n').trim();
            if (blockText) blocks.push(blockText);
            currentBlock = [trimmed];
        } else {
            currentBlock.push(trimmed);
        }
    }

    const lastBlock = currentBlock.join('\n').trim();
    if (lastBlock) blocks.push(lastBlock);

    return blocks;
}


/**
 * Inject newlines at known LinkedIn text boundaries so the per-profile parser can work.
 * Handles continuous text like: "Name • 2ndHeadlineLocationConnectCurrent: Role at CompanyMutuals"
 */
function injectNewlines(block) {
    let text = block;
    // Remove the degree marker: "MD ZAHEER PASHA  • 2ndProgrammer..." → "MD ZAHEER PASHA\nProgrammer..."
    text = text.replace(/^(.+?)\s*[•·]\s*(?:1st|2nd|3rd)\s*/, '$1\n');
    // Insert newline before "Current:" 
    text = text.replace(/(?<=\w)Current:/g, '\nCurrent:');
    // Insert newline AFTER "at CompanyName" (company is 1-3 words starting with uppercase)
    text = text.replace(/(at\s+[A-Z][A-Za-z]+(?:\s+[A-Z][a-z]+){0,2})(?=[A-Z][a-z])/g, '$1\n');
    // Insert newline before known Indian locations
    text = text.replace(/(?<=\w)(Hyderabad|Bangalore|Bengaluru|Mumbai|Delhi|Chennai|Pune|Kolkata|Noida|Gurugram|Guntur|Greater|Remote)/g, '\n$1');
    // Insert newline before ", India" or state
    text = text.replace(/(, Telangana|, Karnataka|, Maharashtra|, Andhra Pradesh|, Tamil Nadu|, India)/g, '$1\n');
    // Insert newline before "Connect" / "Follow" / "Message"
    text = text.replace(/(?<=\w)(Connect|Follow|Message)(?=Current|[A-Z]|$)/g, '\n$1\n');
    return text;
}

/**
 * Deduplicate profiles by fullName + company combination.
 */
function deduplicateProfiles(profiles) {
    const seen = new Set();
    return profiles.filter(p => {
        const key = `${(p.fullName || '').toLowerCase()}|${(p.company || '').toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * parseBulkLinkedInText(rawText)
 * Splits and parses bulk LinkedIn paste.
 * @param {string} rawText
 * @returns {{ profiles: Array, totalFound: number, totalValid: number }}
 */
function parseBulkLinkedInText(rawText) {
    if (!rawText || !rawText.trim()) {
        return { profiles: [], totalFound: 0, totalValid: 0 };
    }

    const blocks = splitIntoBlocks(rawText);
    
    const parsed = blocks
        .map(block => parseLinkedInText(block))
        .filter(p => {
            if (!p.fullName || p.fullName.trim().length === 0) return false;
            // Reject profiles where the "name" is a single noise word
            const words = p.fullName.trim().split(/\s+/);
            if (words.length === 1 && SINGLE_WORD_NOISE.has(words[0].toLowerCase())) return false;
            return true;
        });

    const deduped = deduplicateProfiles(parsed);

    return {
        profiles: deduped,
        totalFound: blocks.length,
        totalValid: deduped.length,
    };
}

module.exports = { parseBulkLinkedInText };
