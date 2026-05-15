/**
 * linkedInParser.js
 * Reusable parser for single LinkedIn profile text snippets.
 * Handles noisy copy-pasted text from LinkedIn profiles, search results, PDFs.
 */

// ─── Noise Patterns ───────────────────────────────────────────────────────────
const NOISE_PATTERNS = [
    /\b(1st|2nd|3rd|4th|5th)\b/gi,
    /\bconnection(s)?\b/gi,
    /\bfollower(s)?\b/gi,
    /\bmutual connection(s)?\b/gi,
    /\bcontact info\b/gi,
    /\bpending\b/gi,
    /\bconnect\b/gi,
    /\bfollow\b/gi,
    /\bopen to work\b/gi,
    /\bopen for work\b/gi,
    /\bare these results helpful\?/gi,
    /\bpage \d+\b/gi,
    /[\d,]+ followers/gi,
    /[\d,]+ connections/gi,
    /she\/her|he\/him|they\/them/gi,
    // Emoji ranges
    /[\u{1F300}-\u{1FFFF}]/gu,
    /[\u2600-\u27BF]/gu,
    // Lone bullets / separators
    /^[·•\-–—|]+$/gm,
];

// ─── Known Location Identifiers ───────────────────────────────────────────────
// We check if a line looks like a location (City, State/Country)
function looksLikeLocation(line) {
    const locationPatterns = [
        /,\s*(India|United States|US|UK|Canada|Australia|Germany|France|Singapore|UAE|Pakistan|Bangladesh|Nigeria|Brazil)/i,
        /\b(Bangalore|Mumbai|Delhi|Gurugram|Hyderabad|Chennai|Pune|Kolkata|Noida|Ahmedabad)\b/i,
        /\b(New York|San Francisco|London|Toronto|Sydney|Berlin|Paris|Dubai|Singapore|Boston|Seattle|Austin)\b/i,
        /\b(Haryana|Karnataka|Maharashtra|Uttar Pradesh|Tamil Nadu|Telangana)\b/i,
        /\b(Remote|Worldwide|Global)\b/i,
    ];
    return locationPatterns.some(p => p.test(line));
}

// ─── Name Detection ───────────────────────────────────────────────────────────
function looksLikeName(line) {
    // A probable name: 2–5 words, each capitalized, no special chars (besides hyphen/period)
    const words = line.trim().split(/\s+/);
    if (words.length < 1 || words.length > 6) return false;
    // Each word should start with a letter, and not be a common noise word
    const noiseWords = new Set(['the', 'at', 'and', 'or', 'for', 'in', 'on', 'of', 'to', 'a', 'an', 'is', 'are', 'was']);
    return words.every(w => /^[A-Za-z][A-Za-z'\-\.]*$/.test(w) && !noiseWords.has(w.toLowerCase()));
}

// ─── Company Extraction From Headline ─────────────────────────────────────────
// Headline examples:
//   "Recruitment Specialist || Honeywell"
//   "Data Scientist at Honeywell | NITK'25"
//   "SWE Intern @ Google"
//   "Engineer at Honeywell · Product"
function extractCompanyFromHeadline(headline) {
    if (!headline) return null;

    // Pattern: "... at CompanyName" or "... @ CompanyName" or "... @CompanyName" or "... || CompanyName" or "... | CompanyName"
    const patterns = [
        /(?:at|@)\s*([A-Za-z][A-Za-z0-9\s&\-\.,']+?)(?:\s*[|·\|]|$)/i,
        /(?:\|\||\|)\s*([A-Za-z][A-Za-z0-9\s&\-\.,']+?)(?:\s*[|·\|]|$)/i,
    ];

    for (const pat of patterns) {
        const m = headline.match(pat);
        if (m) {
            const candidate = m[1].trim();
            // Filter out obvious non-company tokens like university codes e.g. NITK'25
            if (candidate && !/^[A-Z]{2,5}'\d{2}$/.test(candidate) && candidate.length > 1) {
                return candidate;
            }
        }
    }
    return null;
}

// ─── Role Extraction From Headline ────────────────────────────────────────────
function extractRoleFromHeadline(headline) {
    if (!headline) return null;
    // Role is typically the part before the company separator
    const parts = headline.split(/\s+(?:at)\s+|\s*@\s*|\s*@|\s*\|\|?\s*|\s*·\s*/);
    const role = parts[0]?.trim();
    if (role && role.length > 1) return role;
    return null;
}

// ─── Core Cleaner ─────────────────────────────────────────────────────────────
function cleanLine(line) {
    let cleaned = line;
    for (const pattern of NOISE_PATTERNS) {
        cleaned = cleaned.replace(pattern, '');
    }
    return cleaned.trim();
}

/**
 * parseLinkedInText(rawText)
 * Parses a single LinkedIn profile snippet.
 * Handles multiple input formats:
 *   - Full LinkedIn paste (name + headline + location)
 *   - Simple "name company" format (e.g., "vishwa apple")
 *   - "name@company.com" email format
 *   - "name | company" or "name at company" format
 * @param {string} rawText
 * @returns {{ fullName, firstName, middleNames, lastName, company, role, cleanedText, confidence }}
 */
function parseLinkedInText(rawText) {
    if (!rawText || !rawText.trim()) {
        return { error: 'Empty input' };
    }

    // ── Pre-check: Is this a simple "name company" or "name@domain" input? ───
    const trimmedInput = rawText.trim();
    
    // Check for email input: "vishwa@apple.com" or "name vishwa@apple.com"
    const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
    const foundEmails = (trimmedInput.match(emailRegex) || []).filter(e => {
        const lower = e.toLowerCase();
        return !lower.includes('example.com') && !lower.includes('test.com') && !lower.includes('noreply');
    });
    const providedEmail = foundEmails.length > 0 ? foundEmails[0] : null;

    // If input is JUST an email like "vishwa@apple.com", extract name and company from it
    if (providedEmail && trimmedInput.replace(emailRegex, '').trim().length === 0) {
        const [localPart, domainPart] = providedEmail.split('@');
        const companyFromDomain = domainPart.split('.')[0];
        // Try to extract name from local part (e.g., "vishwa.kumar" → "vishwa kumar")
        const nameParts = localPart.replace(/[._\-+]/g, ' ').trim().split(/\s+/);
        const fullName = nameParts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
        const firstName = nameParts[0] || '';
        const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
        
        return {
            fullName,
            firstName,
            middleNames: nameParts.length > 2 ? nameParts.slice(1, -1) : [],
            lastName,
            company: companyFromDomain.charAt(0).toUpperCase() + companyFromDomain.slice(1),
            role: '',
            providedEmail,
            cleanedText: trimmedInput,
            confidence: { name: 'MEDIUM', company: 'HIGH' },
        };
    }

    // Check for simple "name company" format (single line, 2-3 words, no separators)
    const singleLine = trimmedInput.split(/\r?\n/).filter(l => l.trim()).length === 1;
    if (singleLine && !trimmedInput.includes('|') && !trimmedInput.includes('·') && !/\bat\b/i.test(trimmedInput)) {
        const words = trimmedInput.split(/\s+/).filter(Boolean);
        // 2 words: could be "firstName company" — check if second word is a known company
        if (words.length === 2) {
            const [word1, word2] = words;
            // If either word looks like a well-known company, treat it as name + company
            const knownCompanies = new Set([
                'apple', 'google', 'microsoft', 'amazon', 'meta', 'facebook', 'netflix',
                'tesla', 'nvidia', 'intel', 'ibm', 'oracle', 'salesforce', 'adobe',
                'uber', 'lyft', 'airbnb', 'spotify', 'twitter', 'snap', 'pinterest',
                'linkedin', 'paypal', 'stripe', 'shopify', 'zoom', 'slack', 'atlassian',
                'samsung', 'sony', 'toshiba', 'honda', 'toyota', 'bmw', 'mercedes',
                'infosys', 'tcs', 'wipro', 'hcl', 'cognizant', 'accenture', 'deloitte',
                'kpmg', 'pwc', 'ey', 'mckinsey', 'bain', 'bcg', 'capgemini',
                'honeywell', 'siemens', 'bosch', 'philips', 'ge', 'boeing', 'airbus',
                'jpmorgan', 'goldman', 'morgan', 'citi', 'barclays', 'hsbc', 'wells',
                'walmart', 'target', 'costco', 'starbucks', 'mcdonalds', 'nike', 'adidas',
                'dell', 'hp', 'lenovo', 'cisco', 'vmware', 'redhat', 'sap', 'twilio',
                'databricks', 'snowflake', 'palantir', 'crowdstrike', 'cloudflare',
                'flipkart', 'swiggy', 'zomato', 'ola', 'paytm', 'razorpay', 'cred',
                'byju', 'unacademy', 'meesho', 'phonepe', 'groww', 'zerodha',
            ]);
            
            if (knownCompanies.has(word2.toLowerCase())) {
                const fullName = word1.charAt(0).toUpperCase() + word1.slice(1).toLowerCase();
                return {
                    fullName,
                    firstName: word1.toLowerCase(),
                    middleNames: [],
                    lastName: '',
                    company: word2.charAt(0).toUpperCase() + word2.slice(1).toLowerCase(),
                    role: '',
                    providedEmail,
                    cleanedText: trimmedInput,
                    confidence: { name: 'MEDIUM', company: 'HIGH' },
                };
            }
            
            // If not a known company, still treat as "name company" for simple 2-word inputs
            // (user clearly typed "name company" — respect their intent)
            const fullName = word1.charAt(0).toUpperCase() + word1.slice(1).toLowerCase();
            return {
                fullName,
                firstName: word1.toLowerCase(),
                middleNames: [],
                lastName: '',
                company: word2.charAt(0).toUpperCase() + word2.slice(1).toLowerCase(),
                role: '',
                providedEmail,
                cleanedText: trimmedInput,
                confidence: { name: 'MEDIUM', company: 'MEDIUM' },
            };
        }
        
        // 3 words: "firstName lastName company"
        if (words.length === 3) {
            const [w1, w2, w3] = words;
            const knownCompanies = new Set([
                'apple', 'google', 'microsoft', 'amazon', 'meta', 'facebook', 'netflix',
                'tesla', 'nvidia', 'intel', 'ibm', 'oracle', 'salesforce', 'adobe',
                'uber', 'lyft', 'airbnb', 'spotify', 'twitter', 'infosys', 'tcs',
                'wipro', 'hcl', 'cognizant', 'accenture', 'deloitte', 'honeywell',
                'flipkart', 'swiggy', 'zomato', 'paytm', 'razorpay',
            ]);
            if (knownCompanies.has(w3.toLowerCase())) {
                const fullName = [w1, w2].map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
                return {
                    fullName,
                    firstName: w1.toLowerCase(),
                    middleNames: [],
                    lastName: w2.toLowerCase(),
                    company: w3.charAt(0).toUpperCase() + w3.slice(1).toLowerCase(),
                    role: '',
                    providedEmail,
                    cleanedText: trimmedInput,
                    confidence: { name: 'HIGH', company: 'HIGH' },
                };
            }
        }
    }

    // ── Standard LinkedIn paste parsing ──────────────────────────────────────
    // Split into lines, clean each line, remove empty lines
    const lines = rawText
        .split(/\n/)
        .map(l => cleanLine(l))
        .filter(l => l.length > 0 && !looksLikeLocation(l));

    let fullName = null;
    let company = null;
    let role = null;
    let nameConfidence = 'LOW';
    let companyConfidence = 'LOW';

    // Strategy: first non-empty non-noise line is the name
    for (const line of lines) {
        if (!fullName && looksLikeName(line)) {
            fullName = line.trim();
            nameConfidence = 'HIGH';
            break;
        }
    }

    // If no name found with strict check, try a more lenient approach
    if (!fullName) {
        for (const line of lines) {
            const words = line.trim().split(/\s+/);
            // Accept 1-4 words where each starts with a letter (case-insensitive)
            if (words.length >= 1 && words.length <= 4 && words.every(w => /^[A-Za-z]/.test(w))) {
                fullName = line.trim();
                nameConfidence = 'MEDIUM';
                break;
            }
        }
    }

    // Find headline: first line that contains job-related separators
    const headlineKeywords = /\bat\b|\|\|?|@|specialist|engineer|manager|analyst|developer|director|intern|recruiter|scientist|designer|consultant|officer|lead|head|vp|ceo|cto|founder/i;
    for (const line of lines) {
        if (line === fullName) continue;
        if (headlineKeywords.test(line)) {
            // This is likely the headline
            const extractedCompany = extractCompanyFromHeadline(line);
            const extractedRole = extractRoleFromHeadline(line);
            if (extractedCompany && !company) {
                company = extractedCompany;
                companyConfidence = 'HIGH';
            }
            if (extractedRole && !role) {
                role = extractedRole;
            }
        }
    }

    // Fallback: if company still not found, check if any remaining line is a standalone company name
    if (!company) {
        for (const line of lines) {
            if (line === fullName || line === role) continue;
            if (looksLikeName(line) && !looksLikeLocation(line)) {
                // Could be a company name appearing standalone
                company = line;
                companyConfidence = 'MEDIUM';
                break;
            }
        }
    }

    // Parse name parts
    let firstName = '', middleNames = [], lastName = '';
    if (fullName) {
        const parts = fullName.toLowerCase()
            .replace(/['"]/g, '')
            .split(/\s+/)
            .filter(Boolean);
        if (parts.length === 1) {
            firstName = parts[0];
        } else if (parts.length === 2) {
            firstName = parts[0];
            lastName = parts[1];
        } else {
            firstName = parts[0];
            lastName = parts[parts.length - 1];
            middleNames = parts.slice(1, parts.length - 1);
        }
    }

    const cleanedText = lines.join('\n');

    return {
        fullName: fullName || '',
        firstName,
        middleNames,
        lastName,
        company: company || '',
        role: role || '',
        providedEmail,
        cleanedText,
        confidence: {
            name: nameConfidence,
            company: companyConfidence,
        }
    };
}

module.exports = { parseLinkedInText };
