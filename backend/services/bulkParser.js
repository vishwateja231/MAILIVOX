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
    // Each word starts with a letter (case-insensitive — people type lowercase names)
    return words.every(w => /^[A-Za-z\u00C0-\u024F][a-zA-Z\u00C0-\u024F'\-\.]*$/.test(w));
}

/**
 * Split raw bulk text into individual profile blocks.
 * Strategy: group consecutive lines until we hit a new "name" boundary.
 */
function splitIntoBlocks(rawText) {
    // Pre-process: split lines that have inline bullets (e.g., "John Doe • 2nd") into separate lines
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

        // If this line looks like a name AND we already have a block, start a new one
        if (isNameLine(trimmed) && currentBlock.length > 0) {
            const blockText = currentBlock.join('\n').trim();
            if (blockText) blocks.push(blockText);
            currentBlock = [trimmed];
        } else {
            currentBlock.push(trimmed);
        }
    }

    // Push the last block
    const lastBlock = currentBlock.join('\n').trim();
    if (lastBlock) blocks.push(lastBlock);

    return blocks;
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
