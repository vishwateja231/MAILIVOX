/**
 * bulkValidator.js — Bulk email validation with multi-email output per lead.
 * ─────────────────────────────────────────────────────────────────────────────
 * For each lead: validates ALL generated permutations in parallel,
 * returns ALL valid/probable emails (not just one).
 * Updates DB with validation results.
 */
const prisma = require('../db/prismaClient');
const { validateEmail } = require('./validationEngine');
const { broadcast } = require('../eventBus');

/**
 * Validate all emails for a single lead.
 * Returns all emails with updated confidence + SMTP status.
 */
async function validateLeadEmails(leadId, opts = {}) {
    const { skipSmtp = false, concurrency = 5 } = opts;

    const emails = await prisma.generatedEmail.findMany({
        where: { leadId, verificationStatus: { in: ['PENDING', 'UNVERIFIED'] } },
    });

    if (emails.length === 0) return { leadId, validated: 0, results: [] };

    const results = [];
    const queue = [...emails];

    // Import pattern scoring from generator
    const { getPatternScore } = require('../generator');

    async function worker() {
        while (queue.length > 0) {
            const email = queue.shift();
            if (!email) break;
            try {
                // Use pattern-based score from the generator's tier system
                const patternScore = email.pattern === 'PROVIDED_EMAIL' ? 95 : getPatternScore(email.pattern, email.tier || 'A');

                const result = await validateEmail(email.email, {
                    pattern: email.pattern,
                    localPartScore: patternScore,
                    skipSmtp,
                });

                // Update DB — assign status based on validation result
                // INVALID only if SMTP definitively rejected or bounced
                // VALID if SMTP verified OR strong pattern with valid MX
                // Keep PENDING only if truly inconclusive (shouldn't happen often)
                let newStatus;
                if (result.confidence === 'INVALID') {
                    newStatus = 'INVALID';
                } else if (result.confidence === 'HIGH') {
                    newStatus = 'VALID';
                } else if (result.confidence === 'MEDIUM') {
                    newStatus = 'VALID'; // Medium = deliverable, good enough
                } else {
                    // LOW confidence — check if SMTP gave a definitive answer
                    const smtp = result.details?.smtpResult;
                    if (smtp === 'REJECTED') {
                        newStatus = 'INVALID';
                    } else if (smtp === 'VERIFIED') {
                        newStatus = 'VALID';
                    } else {
                        // Inconclusive SMTP + low pattern score = mark as PENDING
                        // so it can be retried later, not permanently killed
                        newStatus = patternScore >= 50 ? 'VALID' : 'INVALID';
                    }
                }

                await prisma.generatedEmail.update({
                    where: { id: email.id },
                    data: {
                        confidence: result.confidence,
                        verificationStatus: newStatus,
                        isVerified: newStatus === 'VALID',
                        smtpResult: result.details?.smtpResult || null,
                        validationReason: result.reason,
                        validatedAt: new Date(),
                    },
                });

                results.push({ email: email.email, ...result });
            } catch (e) {
                results.push({ email: email.email, confidence: 'LOW', reason: e.message });
            }
            await new Promise(r => setTimeout(r, 150));
        }
    }

    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () => worker());
    await Promise.allSettled(workers);

    // Mark the best email as primary
    const valid = results.filter(r => r.confidence === 'HIGH');
    if (valid.length > 0) {
        await prisma.generatedEmail.updateMany({ where: { leadId }, data: { isPrimary: false } });
        const best = await prisma.generatedEmail.findFirst({ where: { leadId, email: valid[0].email } });
        if (best) await prisma.generatedEmail.update({ where: { id: best.id }, data: { isPrimary: true } });
    }

    broadcast('validation:lead_complete', { leadId, total: emails.length, valid: valid.length });

    return { leadId, validated: results.length, results };
}

/**
 * Validate all pending emails for a session.
 */
async function validateSession(sessionId, opts = {}) {
    const leads = await prisma.lead.findMany({
        where: { sessionId },
        select: { id: true },
    });

    const results = [];
    for (const lead of leads) {
        const result = await validateLeadEmails(lead.id, opts);
        results.push(result);
        broadcast('validation:progress', { sessionId, completed: results.length, total: leads.length });
    }

    return { sessionId, leadsValidated: results.length, results };
}

module.exports = { validateLeadEmails, validateSession };
