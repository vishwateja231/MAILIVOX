/**
 * pipeline.js — Unified Intelligence Pipeline (single-button flow).
 * ─────────────────────────────────────────────────────────────────────────────
 * Replaces the old two-step (parse → process) with one unified pipeline:
 *   1. Ingest raw text
 *   2. Clean noise + segment profiles
 *   3. Quality filter (reject junk)
 *   4. Deduplicate
 *   5. Normalize + infer company context
 *   6. Resolve domains (enterprise cache → Clearbit fallback)
 *   7. Generate email permutations
 *   8. Persist to PostgreSQL
 *   9. Stream progress via SSE
 *
 * Supports: company override, session tracking, structured logging.
 */
const { parseBulkLinkedInText } = require('../bulkParser');
const { filterProfiles, deduplicateProfiles } = require('./profileFilter');
const { propagateCompanyContext, getEnterpriseDomain } = require('./companyNormalizer');
const { findDomain } = require('../domainFinder');
const { parseName } = require('../nameParser');
const { generatePermutations } = require('../generator');
const { getPattern } = require('../patternLearner');
const prisma = require('../db/prismaClient');
const { broadcast } = require('../eventBus');
const { enqueueLeadEmails } = require('../validation/validationQueue');

const DELAY_BETWEEN_PROFILES_MS = 600;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Run the full intelligence pipeline.
 * @param {object} opts
 * @param {string} opts.rawText - raw LinkedIn paste
 * @param {string} opts.sessionName - session identifier
 * @param {string|null} opts.companyOverride - user-specified target company
 * @param {function} opts.onProgress - SSE progress callback
 * @returns {object} pipeline summary
 */
async function runPipeline(opts) {
    const { rawText, sessionName, companyOverride = null, domainOverride = null, excludeInterns = true, excludeFreshers = false, onProgress } = opts;
    const send = onProgress || (() => {});

    const stats = {
        totalBlocks: 0,
        totalParsed: 0,
        rejected: 0,
        duplicates: 0,
        processed: 0,
        failed: 0,
        emailsGenerated: 0,
        companiesCreated: 0,
        leadsCreated: 0,
        dominantCompany: null,
        companyOverride: companyOverride || null,
    };

    // ── Step 1: Parse raw text ───────────────────────────────────────────────
    send({ type: 'stage', data: { stage: 'parsing', message: 'Parsing raw LinkedIn text...' } });

    const parseResult = parseBulkLinkedInText(rawText);
    stats.totalBlocks = parseResult.totalFound;
    stats.totalParsed = parseResult.profiles.length;

    send({ type: 'stage', data: { stage: 'parsed', message: `Segmented ${stats.totalBlocks} blocks → ${stats.totalParsed} profiles` } });

    if (stats.totalParsed === 0) {
        send({ type: 'complete', data: { ...stats, message: 'No valid profiles found in input.' } });
        return stats;
    }

    // ── Step 2: Quality filter ───────────────────────────────────────────────
    send({ type: 'stage', data: { stage: 'filtering', message: 'Filtering low-quality profiles...' } });

    const { accepted, rejected } = filterProfiles(parseResult.profiles, 0.3);
    stats.rejected = rejected.length;

    for (const r of rejected) {
        send({ type: 'log', data: { level: 'warn', message: `Rejected: "${r.fullName}" (${r.rejectReason})` } });
    }
    send({ type: 'stage', data: { stage: 'filtered', message: `Accepted ${accepted.length}, rejected ${stats.rejected} low-quality profiles` } });

    // ── Step 2b: Intern/Trainee Filter ───────────────────────────────────────
    const INTERN_KEYWORDS = ['intern', 'internship', 'trainee', 'student', 'apprentice', 'campus hire', 'graduate trainee', 'summer intern', 'research intern', 'associate intern', 'junior trainee'];
    const FRESHER_KEYWORDS = ['fresher', 'entry level', 'graduate engineer trainee', 'junior associate'];

    let filtered = accepted;
    let internFiltered = 0;

    if (excludeInterns || excludeFreshers) {
        const keywords = [...(excludeInterns ? INTERN_KEYWORDS : []), ...(excludeFreshers ? FRESHER_KEYWORDS : [])];
        const beforeCount = filtered.length;
        filtered = filtered.filter(p => {
            const text = `${p.role || ''} ${p.fullName || ''}`.toLowerCase();
            return !keywords.some(kw => text.includes(kw));
        });
        internFiltered = beforeCount - filtered.length;
        if (internFiltered > 0) {
            send({ type: 'log', data: { level: 'info', message: `Intern/trainee filter: removed ${internFiltered} profiles` } });
        }
    }

    // ── Step 3: Deduplicate ──────────────────────────────────────────────────
    send({ type: 'stage', data: { stage: 'deduplicating', message: 'Removing duplicates...' } });

    const { unique, duplicates } = deduplicateProfiles(filtered);
    stats.duplicates = duplicates;

    if (duplicates > 0) {
        send({ type: 'log', data: { level: 'info', message: `Removed ${duplicates} duplicate profiles` } });
    }

    // ── Step 4: Company normalization + context propagation ──────────────────
    send({ type: 'stage', data: { stage: 'enriching', message: 'Normalizing companies and inferring context...' } });

    const enriched = propagateCompanyContext(unique, companyOverride);

    // If domainOverride provided, inject it into all profiles
    if (domainOverride) {
        const { sanitizeDomain } = require('../domain/domainDiscovery');
        const cleanDomain = sanitizeDomain(domainOverride);
        if (cleanDomain) {
            enriched.forEach(p => { p.companyDomain = cleanDomain; });
            send({ type: 'log', data: { level: 'success', message: `Domain override applied: ${cleanDomain}` } });
        }
    }

    // Log company inference
    const companySources = {};
    for (const p of enriched) {
        companySources[p.companySource] = (companySources[p.companySource] || 0) + 1;
    }
    if (companyOverride) {
        send({ type: 'log', data: { level: 'success', message: `Company override applied: "${companyOverride}" → all profiles` } });
    }
    for (const [source, count] of Object.entries(companySources)) {
        if (source !== 'override') {
            send({ type: 'log', data: { level: 'info', message: `Company source "${source}": ${count} profiles` } });
        }
    }

    // ── Step 5: Create session ───────────────────────────────────────────────
    const sName = sessionName || `intel_${Date.now()}`;
    const session = await prisma.session.upsert({
        where: { sessionName: sName },
        update: {},
        create: { sessionName: sName, totalProfiles: enriched.length, rawInput: rawText.slice(0, 5000) },
    });

    send({ type: 'session', data: { sessionId: session.id, sessionName: sName } });
    broadcast('pipeline:started', { sessionId: session.id, sessionName: sName, total: enriched.length });

    // ── Step 6: Process each profile ─────────────────────────────────────────
    send({ type: 'stage', data: { stage: 'processing', message: `Processing ${enriched.length} profiles...` } });

    for (let i = 0; i < enriched.length; i++) {
        const profile = enriched[i];

        send({ type: 'progress', data: {
            current: i + 1,
            total: enriched.length,
            currentName: profile.fullName,
            company: profile.company,
            emailsGenerated: stats.emailsGenerated,
        }});

        try {
            const result = await processOneProfile(profile, session.id);
            stats.processed++;
            stats.emailsGenerated += result.emailCount;
            if (result.newCompany) stats.companiesCreated++;
            if (result.newLead) stats.leadsCreated++;

            send({ type: 'profile_done', data: {
                index: i,
                fullName: profile.fullName,
                company: profile.company,
                domain: result.domain,
                emailCount: result.emailCount,
                companySource: profile.companySource,
            }});

        } catch (err) {
            stats.failed++;
            send({ type: 'profile_error', data: {
                index: i,
                fullName: profile.fullName,
                error: err.message,
            }});
        }

        if (i < enriched.length - 1) await sleep(DELAY_BETWEEN_PROFILES_MS);
    }

    // ── Step 7: Update session totals ────────────────────────────────────────
    await prisma.session.update({
        where: { id: session.id },
        data: { totalProfiles: stats.processed, totalEmails: stats.emailsGenerated },
    }).catch(() => {});

    broadcast('pipeline:complete', { sessionId: session.id, ...stats });

    send({ type: 'complete', data: {
        ...stats,
        sessionId: session.id,
        sessionName: sName,
        message: `Pipeline complete: ${stats.processed} processed, ${stats.emailsGenerated} emails generated. Auto-validation starting...`,
    }});

    // ── Auto-validate in background (non-blocking, feature-flagged) ─────────
    if (stats.emailsGenerated > 0) {
        const { isEnabled } = require('../../config/features');
        if (isEnabled('autoValidation')) {
            setImmediate(() => autoValidateSession(session.id));
        }
    }

    return { ...stats, sessionId: session.id, sessionName: sName };
}

/**
 * Process a single enriched profile: domain → company → lead → emails.
 * CRITICAL RULE: If profile has a providedEmail, skip corporate generation entirely.
 */
async function processOneProfile(profile, sessionId) {
    const { fullName, company, companyDomain, role, location, linkedinUrl, providedEmail } = profile;

    // Resolve domain via multi-layer discovery engine
    const { discoverDomain } = require('../domain/domainDiscovery');
    let domain = companyDomain;
    let discoveredPattern = null;

    if (!domain) {
        const discovery = await discoverDomain({
            company,
            manualDomain: companyDomain || null,
            knownEmail: providedEmail || null,
        });
        domain = discovery.domain;
        discoveredPattern = discovery.pattern;
    }

    let newCompany = false;
    let newLead = false;
    let companyRecord = null;

    if (domain) {
        const existing = await prisma.company.findUnique({ where: { domain } });
        companyRecord = await prisma.company.upsert({
            where: { domain },
            update: {},
            create: { companyName: company || domain, domain },
        });
        if (!existing) newCompany = true;
    }

    // Parse name
    const nameParts = parseName(fullName);
    const firstName = nameParts.first || fullName.split(/\s+/)[0].toLowerCase();
    const lastName = nameParts.last || fullName.split(/\s+/).slice(-1)[0].toLowerCase();
    const middleNames = nameParts.middle || null;

    // Upsert lead
    let leadRecord;
    if (companyRecord) {
        const existingLead = await prisma.lead.findUnique({
            where: { fullName_companyId: { fullName, companyId: companyRecord.id } },
        });
        leadRecord = await prisma.lead.upsert({
            where: { fullName_companyId: { fullName, companyId: companyRecord.id } },
            update: { role: role || undefined, location: location || undefined, linkedinUrl: linkedinUrl || undefined },
            create: { fullName, firstName, lastName, middleNames, role, location, linkedinUrl, sessionId, companyId: companyRecord.id },
        });
        if (!existingLead) newLead = true;
    } else {
        leadRecord = await prisma.lead.create({
            data: { fullName, firstName, lastName, middleNames, role, location, linkedinUrl, sessionId },
        });
        newLead = true;
    }

    // Ensure status record
    await prisma.leadStatus.upsert({
        where: { leadId: leadRecord.id },
        update: {},
        create: { leadId: leadRecord.id },
    }).catch(() => {});

    // ── EMAIL LOGIC: provided email vs corporate generation ──────────────────
    let emailCount = 0;

    if (providedEmail) {
        // PROVIDED EMAIL: store directly, skip corporate generation entirely
        try {
            await prisma.generatedEmail.upsert({
                where: { email: providedEmail },
                update: {},
                create: {
                    leadId: leadRecord.id,
                    email: providedEmail,
                    pattern: 'PROVIDED_EMAIL',
                    confidence: 'HIGH',
                    verificationStatus: 'VALID',
                    isVerified: true,
                },
            });
            emailCount = 1;
        } catch (_) { /* dedupe */ }
    } else if (domain) {
        // NO provided email: generate corporate patterns (only if domain exists)
        const knownPattern = discoveredPattern || await getPattern(domain).catch(() => null);
        const perms = generatePermutations(nameParts, domain, knownPattern);

        for (const p of perms) {
            try {
                await prisma.generatedEmail.upsert({
                    where: { email: p.email },
                    update: {},
                    create: { leadId: leadRecord.id, email: p.email, pattern: p.pattern, confidence: p.confidence },
                });
                emailCount++;
            } catch (_) { /* dedupe */ }
        }
    }

    // Enqueue for parallel validation immediately (non-blocking)
    // Validation runs in background while pipeline continues with next profile
    if (emailCount > 0 && !providedEmail) {
        setImmediate(() => enqueueLeadEmails(leadRecord.id));
    }

    return { domain, emailCount, newCompany, newLead, leadId: leadRecord.id, emailSource: providedEmail ? 'PROVIDED' : 'GENERATED' };

    // Enqueue for parallel validation immediately (non-blocking)
    // This runs in the background while the pipeline continues processing other profiles
}

/**
 * Auto-validate all PENDING emails for a session (runs in background after pipeline).
 * Non-blocking — fires and forgets.
 */
async function autoValidateSession(sessionId) {
    try {
        const { validateLeadEmails } = require('../validation/bulkValidator');
        const leads = await prisma.lead.findMany({
            where: { sessionId },
            select: { id: true },
        });

        console.log(`[pipeline] Auto-validation started for ${leads.length} leads`);
        broadcast('validation:auto_started', { sessionId, totalLeads: leads.length });

        for (let i = 0; i < leads.length; i++) {
            try {
                await validateLeadEmails(leads[i].id, { skipSmtp: false, concurrency: 3 });
            } catch (_) { /* continue on individual failures */ }
            broadcast('validation:auto_progress', { sessionId, completed: i + 1, total: leads.length });
        }

        broadcast('validation:auto_complete', { sessionId, totalLeads: leads.length });
        console.log(`[pipeline] Auto-validation complete for session ${sessionId}`);
    } catch (e) {
        console.error('[pipeline] Auto-validation error:', e.message);
    }
}

module.exports = { runPipeline, autoValidateSession };
