/**
 * patternLearner.js — DB-backed version using Prisma + Supabase.
 * Uses Company.learnedPattern column (no separate model needed).
 */
const prisma = require('./db/prismaClient');

async function getPattern(domain) {
    try {
        if (!domain) return null;
        const company = await prisma.company.findUnique({
            where: { domain },
            select: { learnedPattern: true },
        });
        return company?.learnedPattern || null;
    } catch (e) {
        console.error('[patternLearner] getPattern failed:', e.message);
        return null;
    }
}

async function learnPattern(domain, pattern) {
    try {
        if (!domain || !pattern) return;
        await prisma.company.update({
            where: { domain },
            data: { learnedPattern: pattern },
        });
    } catch (e) {
        console.error('[patternLearner] learnPattern failed:', e.message);
    }
}

module.exports = { getPattern, learnPattern };
