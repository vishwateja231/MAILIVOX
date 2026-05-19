/**
 * aiParser.js — Uses Gemini to extract structured profiles from messy LinkedIn text.
 * This is the enterprise-grade solution for parsing LinkedIn search results that
 * come as one continuous text blob without clear separators.
 * 
 * Cost: ~0.001 per call (Gemini Flash is nearly free)
 * Speed: 2-4 seconds per batch
 */
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_PROMPT = `You are a LinkedIn profile data extractor. Given raw text copied from LinkedIn search results, extract each person into a structured JSON array.

RULES:
- Extract ONLY real people (not companies, not UI text)
- fullName: the person's full name ONLY (no degree markers like "• 2nd", no titles, no emojis)
- role: their job title/headline (e.g., "Data Engineer", "Software Engineer")  
- company: the company they currently work at (extract from "Current: ... at COMPANY" or from "@COMPANY" in headline)
- Skip connection degree (1st, 2nd, 3rd), locations, mutual connections, follower counts
- If company appears as "@LTM" or "at LTM", the company is "LTM"
- If you see "LTI Mindtree" or "LTM", normalize to "LTIMindtree"

Return ONLY a valid JSON array. No markdown, no explanation. Example:
[{"fullName":"John Doe","role":"Software Engineer","company":"Google"},{"fullName":"Jane Smith","role":"Data Analyst","company":"Amazon"}]`;

/**
 * Parse raw LinkedIn text using Gemini AI.
 * @param {string} rawText - messy LinkedIn paste
 * @param {string|null} companyOverride - if provided, use this as company for all profiles
 * @returns {Array<{fullName, role, company}>}
 */
async function parseWithAI(rawText, companyOverride = null) {
    if (!process.env.GEMINI_API_KEY) {
        console.warn('[aiParser] No GEMINI_API_KEY — falling back to regex parser');
        return null; // Caller should fall back to bulkParser
    }

    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

        const userPrompt = companyOverride
            ? `Extract profiles from this LinkedIn text. The target company is "${companyOverride}" — assign this company to ALL profiles.\n\n${rawText.slice(0, 8000)}`
            : `Extract profiles from this LinkedIn text:\n\n${rawText.slice(0, 8000)}`;

        let result;
        try {
            result = await model.generateContent({
                contents: [{ role: 'user', parts: [{ text: SYSTEM_PROMPT + '\n\n' + userPrompt }] }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
            });
        } catch (primaryErr) {
            // If primary model fails (quota/rate limit), try lite model
            if (primaryErr.message?.includes('429') || primaryErr.message?.includes('quota')) {
                console.log('[aiParser] Primary model quota hit — trying gemini-2.0-flash-lite');
                const liteModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });
                result = await liteModel.generateContent({
                    contents: [{ role: 'user', parts: [{ text: SYSTEM_PROMPT + '\n\n' + userPrompt }] }],
                    generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
                });
            } else {
                throw primaryErr;
            }
        }

        const text = result.response.text().trim();
        
        // Extract JSON from response (handle markdown code blocks)
        let jsonStr = text;
        if (text.includes('```')) {
            const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (match) jsonStr = match[1].trim();
        }

        const profiles = JSON.parse(jsonStr);

        if (!Array.isArray(profiles)) {
            console.error('[aiParser] Response is not an array');
            return null;
        }

        // Validate and clean
        const cleaned = profiles
            .filter(p => p && typeof p.fullName === 'string' && p.fullName.trim().length >= 2)
            .map(p => ({
                fullName: p.fullName.trim(),
                role: (p.role || '').trim(),
                company: companyOverride || (p.company || '').trim(),
            }));

        console.log(`[aiParser] Extracted ${cleaned.length} profiles via Gemini`);
        return cleaned;

    } catch (e) {
        console.error('[aiParser] Gemini parsing failed:', e.message);
        return null; // Caller should fall back to bulkParser
    }
}

module.exports = { parseWithAI };
