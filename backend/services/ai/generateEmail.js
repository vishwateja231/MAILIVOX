/**
 * generateEmail.js — AI-powered personalized email generation.
 * ─────────────────────────────────────────────────────────────────────────────
 * Provider priority: Gemini → OpenAI → Template fallback
 * Supports: tone selection, outreach types, variable templating.
 */
const { getRenderedTemplate } = require('../mail/templates');

// ─── Provider Abstraction ────────────────────────────────────────────────────

let geminiModel = null;
let openaiClient = null;

// Initialize Gemini (primary)
try {
    if (process.env.GEMINI_API_KEY) {
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        geminiModel = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
        console.log('[AI] gemini-3-flash-previewinitialized');
    }
} catch (_) { /* Gemini not available */ }

// Initialize OpenAI (fallback)
try {
    if (process.env.OPENAI_API_KEY && !geminiModel) {
        const OpenAI = require('openai');
        openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        console.log('[AI] OpenAI initialized (fallback)');
    }
} catch (_) { /* OpenAI not available */ }

// ─── Tone Prompts ────────────────────────────────────────────────────────────

const TONE_PROMPTS = {
    professional: 'Write in a professional, polished tone. Be concise and respectful.',
    aggressive: 'Write in a confident, direct networking tone. Be bold but not rude.',
    startup: 'Write in a casual, founder-style tone. Be direct, skip formalities.',
    enterprise: 'Write in a formal enterprise tone. Be structured, mention metrics.',
    concise: 'Be extremely concise. Maximum 4 sentences total.',
};

// ─── Core Generation ─────────────────────────────────────────────────────────

/**
 * Generate a personalized email using AI (Gemini → OpenAI → Template fallback).
 */
async function generatePersonalizedEmail(opts) {
    const {
        recruiterName, recruiterRole, company, targetRole,
        tone = 'professional', type = 'cold_outreach', context = {},
    } = opts;

    const recruiterFirstName = recruiterName?.split(' ')[0] || 'there';

    // Try Gemini first
    if (geminiModel) {
        try {
            const result = await generateWithGemini({ recruiterFirstName, recruiterName, recruiterRole, company, targetRole, tone, type, context });
            return { ...result, generatedBy: 'gemini' };
        } catch (err) {
            console.error('[AI] Gemini failed:', err.message);
        }
    }

    // Try OpenAI fallback
    if (openaiClient) {
        try {
            const result = await generateWithOpenAI({ recruiterFirstName, recruiterName, recruiterRole, company, targetRole, tone, type, context });
            return { ...result, generatedBy: 'openai' };
        } catch (err) {
            console.error('[AI] OpenAI failed:', err.message);
        }
    }

    // Template fallback
    const variables = {
        recruiterFirstName, recruiterName: recruiterName || '', company: company || '',
        role: targetRole || 'the open position',
        myName: context.myName || 'Vishwa Teja',
        myRole: context.myRole || 'Full-Stack Developer',
        myTitle: context.myTitle || '',
        skills: context.skills || 'full-stack development, React, Node.js',
        experience: context.experience || '3+ years',
        recentWork: context.recentWork || 'building production-grade SaaS platforms',
        recentUpdate: context.recentUpdate || 'completed a new project',
        industry: context.industry || 'tech',
    };

    const rendered = getRenderedTemplate(type, variables);
    return { ...rendered, generatedBy: 'template' };
}

// ─── Gemini Provider ─────────────────────────────────────────────────────────

async function generateWithGemini(opts) {
    const { recruiterFirstName, recruiterName, recruiterRole, company, targetRole, tone, type, context } = opts;
    const toneInstruction = TONE_PROMPTS[tone] || TONE_PROMPTS.professional;

    const prompt = buildPrompt({ recruiterFirstName, recruiterName, recruiterRole, company, targetRole, toneInstruction, type, context });

    const result = await geminiModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.8, maxOutputTokens: 500, responseMimeType: 'application/json' },
    });

    const text = result.response.text();
    const parsed = JSON.parse(text);
    if (!parsed.subject || !parsed.body) throw new Error('Invalid AI response');

    const htmlBody = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; color: #1a1a1a; line-height: 1.7;">${parsed.body.split('\n').filter(l => l.trim()).map(l => `<p style="margin: 0 0 12px 0;">${l}</p>`).join('')}</div>`;

    return { subject: parsed.subject, html: htmlBody, text: parsed.body, templateId: `ai_${type}` };
}

// ─── OpenAI Provider ─────────────────────────────────────────────────────────

async function generateWithOpenAI(opts) {
    const { recruiterFirstName, recruiterName, recruiterRole, company, targetRole, tone, type, context } = opts;
    const toneInstruction = TONE_PROMPTS[tone] || TONE_PROMPTS.professional;

    const prompt = buildPrompt({ recruiterFirstName, recruiterName, recruiterRole, company, targetRole, toneInstruction, type, context });

    const completion = await openaiClient.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8,
        max_tokens: 500,
        response_format: { type: 'json_object' },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('Empty AI response');

    const parsed = JSON.parse(content);
    if (!parsed.subject || !parsed.body) throw new Error('Invalid AI response');

    const htmlBody = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; color: #1a1a1a; line-height: 1.7;">${parsed.body.split('\n').filter(l => l.trim()).map(l => `<p style="margin: 0 0 12px 0;">${l}</p>`).join('')}</div>`;

    return { subject: parsed.subject, html: htmlBody, text: parsed.body, templateId: `ai_${type}` };
}

// ─── Shared Prompt Builder ───────────────────────────────────────────────────

function buildPrompt({ recruiterFirstName, recruiterName, recruiterRole, company, targetRole, toneInstruction, type, context }) {
    const typeDescriptions = {
        cold_outreach: 'a cold outreach email to a recruiter/hiring manager',
        referral_request: 'a referral request email',
        follow_up: 'a follow-up email after no response',
        networking: 'a networking/coffee chat request',
        startup_founder: 'a direct founder-style outreach',
    };

    return `Generate ${typeDescriptions[type] || 'a professional outreach email'}.

RECIPIENT: ${recruiterName || 'Unknown'} (${recruiterRole || 'Recruiter'}) at ${company || 'Unknown'}
SENDER: ${context.myName || 'Vishwa Teja'}, ${context.myRole || 'Full-Stack Developer'}
Skills: ${context.skills || 'React, Node.js, TypeScript, PostgreSQL'}
Experience: ${context.experience || '3+ years'}
Recent: ${context.recentWork || 'Building AI-powered SaaS platforms'}
TARGET ROLE: ${targetRole || 'Software Engineer'}

TONE: ${toneInstruction}

RULES:
- Under 150 words
- No generic filler
- Specific to company/role
- Clear call-to-action
- NO "I hope this email finds you well"
- Sound human, not robotic

Return ONLY JSON: {"subject": "...", "body": "..."}`;
}

/**
 * Generate multiple variants.
 */
async function generateVariants(opts, count = 3) {
    const variants = [];
    for (let i = 0; i < count; i++) {
        const variant = await generatePersonalizedEmail({ ...opts, context: { ...opts.context, variant: i + 1 } });
        variants.push(variant);
    }
    return variants;
}

module.exports = { generatePersonalizedEmail, generateVariants };
