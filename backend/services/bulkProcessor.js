/**
 * bulkProcessor.js
 * Sequential queue-based processor with Supabase persistence.
 */
const { findDomain } = require('./domainFinder');
const { parseName } = require('./nameParser');
const { generatePermutations } = require('./generator');
const { getPattern } = require('./patternLearner');
const prisma = require('./db/prismaClient');

const DELAY_MS = 800;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function processProfile(profile, sessionId) {
    const { fullName, firstName, middleNames = [], lastName, company, role, location } = profile;

    try {
        if (!company) return { ...profile, domain: null, emails: [], error: 'No company detected' };

        const domain = await findDomain(company);
        if (!domain) return { ...profile, domain: null, emails: [], error: `Domain not found for "${company}"` };

        // Upsert company
        const companyRecord = await prisma.company.upsert({
            where: { domain },
            update: {},
            create: { companyName: company, domain }
        });

        // Upsert lead (skip duplicate name+company combos)
        const leadRecord = await prisma.lead.upsert({
            where: { fullName_companyId: { fullName, companyId: companyRecord.id } },
            update: {},
            create: {
                fullName,
                firstName: firstName || fullName.split(' ')[0].toLowerCase(),
                middleNames: Array.isArray(middleNames) ? middleNames.join(' ') : null,
                lastName: lastName || fullName.split(' ').pop().toLowerCase(),
                role: role || null,
                location: location || null,
                sessionId,
                companyId: companyRecord.id,
            }
        });

        // Generate emails
        const knownPattern = await getPattern(domain);
        const fullNameStr = [firstName, ...(Array.isArray(middleNames) ? middleNames : []), lastName].filter(Boolean).join(' ');
        const nameParts = parseName(fullNameStr || fullName);
        let perms = generatePermutations(nameParts, domain, knownPattern);

        // Persist emails (skip dups)
        for (const p of perms) {
            await prisma.generatedEmail.upsert({
                where: { email: p.email },
                update: {},
                create: { leadId: leadRecord.id, email: p.email, pattern: p.pattern, confidence: p.confidence }
            }).catch(() => {});
        }

        // Create lead status record
        await prisma.leadStatus.upsert({
            where: { leadId: leadRecord.id },
            update: {},
            create: { leadId: leadRecord.id }
        }).catch(() => {});

        const emails = perms.map(p => ({ email: p.email, pattern: p.pattern, confidence: p.confidence, status: 'NOT_VERIFIED' }));
        return { ...profile, domain, leadId: leadRecord.id, emails, error: null };

    } catch (err) {
        return { ...profile, domain: null, emails: [], error: err.message };
    }
}

async function processBulkQueue(profiles, onProgress, verify = false, sessionId = null) {
    const results = [];

    for (let i = 0; i < profiles.length; i++) {
        const profile = profiles[i];

        onProgress({
            type: 'progress',
            data: { current: i + 1, total: profiles.length, currentName: profile.fullName, emailsGenerated: results.reduce((a, r) => a + r.emails.length, 0) }
        });

        const result = await processProfile(profile, sessionId);
        results.push(result);

        onProgress({ type: 'profile_done', data: { index: i, profile: result } });

        if (i < profiles.length - 1) await sleep(DELAY_MS);
    }

    // Update session totals
    if (sessionId) {
        const totalEmails = results.reduce((a, r) => a + r.emails.length, 0);
        await prisma.session.update({
            where: { id: sessionId },
            data: { totalProfiles: results.length, totalEmails }
        }).catch(() => {});
    }

    onProgress({ type: 'complete', data: { total: results.length } });
    return results;
}

module.exports = { processProfile, processBulkQueue };
