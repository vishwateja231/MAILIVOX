/**
 * extensionRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Endpoints used by the Chrome Extension + live dashboard.
 *
 *   POST /api/leads/process     — Extension pushes extracted LinkedIn profiles.
 *                                 Pipeline: dedupe → domain lookup → upsert
 *                                 Company / Lead → generate email permutations
 *                                 → persist GeneratedEmail rows. Verification
 *                                 is NOT run synchronously (keep it fast); the
 *                                 user can trigger SMTP verification afterwards
 *                                 from the dashboard.
 *
 *   GET  /api/events/stream     — Server-Sent Events stream. Any backend
 *                                 service can push events via eventBus and
 *                                 every connected dashboard tab receives them.
 *
 *   GET  /api/extension/ping    — Tiny health probe for the extension popup.
 *
 * ALL data comes from real inputs. No mock/demo payloads are ever generated
 * here or pushed downstream.
 */
const express = require('express');
const router = express.Router();

const prisma = require('../services/db/prismaClient');
const { findDomain } = require('../services/domainFinder');
const { parseName, sanitizeLinkedInName } = require('../services/nameParser');
const { generatePermutations } = require('../services/generator');
const { getPattern } = require('../services/patternLearner');
const logger = require('../services/logger/logger');
const { bus, broadcast } = require('../services/eventBus');

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/extension/ping
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/extension/ping', (_req, res) => {
    res.json({ ok: true, service: 'nexuscrm-backend', ts: Date.now() });
});

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function deriveName(contact) {
    const supplied = String(contact.fullName || contact.name || '').trim();
    if (supplied) return sanitizeLinkedInName(supplied) || supplied.split(/\s+/).slice(0, 3).join(' ');

    const email = normalizeEmail(contact.email);
    const local = email.split('@')[0] || 'LinkedIn Contact';
    return local
        .replace(/[._-]+/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ') || 'LinkedIn Contact';
}

function companyNameFromDomain(domain) {
    const label = String(domain || '').split('.')[0] || 'Unknown Company';
    return label
        .replace(/[._-]+/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

// POST /api/extension/batch
// Direct import for LinkedIn connection emails. These emails came from
// LinkedIn contact info, so they are stored as verified provided emails.
router.post('/extension/batch', async (req, res) => {
    const { contacts, sessionName } = req.body || {};

    if (!Array.isArray(contacts)) {
        return res.status(400).json({ error: 'contacts must be an array' });
    }

    const clean = contacts
        .map(contact => ({ ...contact, email: normalizeEmail(contact.email) }))
        .filter(contact => contact.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email));

    const resolvedSessionName = String(sessionName || `linkedin_emails_${Date.now()}`).trim();

    try {
        const session = await prisma.session.upsert({
            where: { sessionName: resolvedSessionName },
            update: {},
            create: {
                sessionName: resolvedSessionName,
                totalProfiles: 0,
                totalEmails: 0,
                totalVerified: 0,
                rawInput: JSON.stringify({ source: 'chrome_extension_deep_extract' }),
            },
        });

        broadcast('extension:batch_start', {
            mode: 2,
            sessionId: session.id,
            sessionName: resolvedSessionName,
            total: clean.length,
        });

        let processed = 0;
        let skipped = contacts.length - clean.length;
        let totalVerified = 0;
        let newLeads = 0;
        let newCompanies = 0;
        const seenEmails = new Set();

        for (const contact of clean) {
            if (seenEmails.has(contact.email)) {
                skipped++;
                continue;
            }
            seenEmails.add(contact.email);

            const fullName = deriveName(contact);
            const parsed = parseName(fullName);
            const domain = contact.email.split('@')[1];
            const companyName = String(contact.company || '').trim() || companyNameFromDomain(domain);
            const role = contact.role ? String(contact.role).trim() : null;
            const location = contact.location ? String(contact.location).trim() : null;
            const linkedinUrl = contact.linkedinUrl || null;

            broadcast('extension:profile_start', {
                mode: 2,
                sessionId: session.id,
                fullName,
                email: contact.email,
            });

            try {
                const existingCompany = await prisma.company.findUnique({ where: { domain } });
                const company = await prisma.company.upsert({
                    where: { domain },
                    update: {
                        companyName: companyName || undefined,
                    },
                    create: {
                        companyName,
                        domain,
                    },
                });
                if (!existingCompany) newCompanies++;

                const existingLead = await prisma.lead.findUnique({
                    where: { fullName_companyId: { fullName, companyId: company.id } },
                });

                const lead = await prisma.lead.upsert({
                    where: { fullName_companyId: { fullName, companyId: company.id } },
                    update: {
                        role: role || undefined,
                        location: location || undefined,
                        linkedinUrl: linkedinUrl || undefined,
                    },
                    create: {
                        fullName,
                        firstName: contact.firstName || parsed.first || fullName.split(/\s+/)[0].toLowerCase(),
                        middleNames: contact.middleNames || parsed.middle || null,
                        lastName: contact.lastName || parsed.last || '',
                        role,
                        location,
                        linkedinUrl,
                        sessionId: session.id,
                        companyId: company.id,
                    },
                });
                if (!existingLead) newLeads++;

                await prisma.generatedEmail.updateMany({
                    where: { leadId: lead.id },
                    data: { isPrimary: false },
                });

                await prisma.generatedEmail.upsert({
                    where: { email: contact.email },
                    update: {
                        leadId: lead.id,
                        pattern: 'LINKEDIN_CONTACT_INFO',
                        confidence: 'HIGH',
                        verificationStatus: 'VALID',
                        isVerified: true,
                        isPrimary: true,
                        smtpResult: 'VERIFIED',
                        validationReason: 'Imported from LinkedIn contact info',
                        validatedAt: new Date(),
                    },
                    create: {
                        leadId: lead.id,
                        email: contact.email,
                        pattern: 'LINKEDIN_CONTACT_INFO',
                        confidence: 'HIGH',
                        verificationStatus: 'VALID',
                        isVerified: true,
                        isPrimary: true,
                        smtpResult: 'VERIFIED',
                        validationReason: 'Imported from LinkedIn contact info',
                        validatedAt: new Date(),
                    },
                });

                await prisma.leadStatus.upsert({
                    where: { leadId: lead.id },
                    update: { stage: 'VERIFIED' },
                    create: { leadId: lead.id, stage: 'VERIFIED' },
                });

                processed++;
                totalVerified++;

                broadcast('extension:profile_done', {
                    mode: 2,
                    sessionId: session.id,
                    leadId: lead.id,
                    fullName,
                    company: company.companyName,
                    email: contact.email,
                    verificationStatus: 'VALID',
                });

                broadcast('extension:batch_progress', {
                    mode: 2,
                    sessionId: session.id,
                    processed,
                    total: clean.length,
                    emailsFound: totalVerified,
                });
            } catch (err) {
                skipped++;
                broadcast('extension:profile_error', {
                    mode: 2,
                    sessionId: session.id,
                    fullName,
                    email: contact.email,
                    error: err.message,
                });
                await logger.error(`Extension direct import failed: ${contact.email} - ${err.message}`, session.id);
            }
        }

        const [leadCount, emailCount, verifiedCount] = await Promise.all([
            prisma.lead.count({ where: { sessionId: session.id } }),
            prisma.generatedEmail.count({ where: { lead: { sessionId: session.id } } }),
            prisma.generatedEmail.count({
                where: { lead: { sessionId: session.id }, verificationStatus: 'VALID' },
            }),
        ]);

        await prisma.session.update({
            where: { id: session.id },
            data: {
                totalProfiles: leadCount,
                totalEmails: emailCount,
                totalVerified: verifiedCount,
            },
        }).catch(() => {});

        const summary = {
            ok: true,
            sessionId: session.id,
            sessionName: resolvedSessionName,
            totalReceived: contacts.length,
            totalProcessed: processed,
            totalSkipped: skipped,
            totalVerified,
            newLeads,
            newCompanies,
        };

        broadcast('extension:batch_complete', summary);
        await logger.success(
            `Extension direct import complete: ${processed}/${contacts.length} contacts, ${totalVerified} verified emails.`,
            session.id,
        );

        res.json(summary);
    } catch (err) {
        console.error('[POST /api/extension/batch] fatal:', err);
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/events/stream  — Server-Sent Events
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/events/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const write = (event) => {
        try { res.write(`data: ${JSON.stringify(event)}\n\n`); }
        catch (_) { /* socket closed */ }
    };

    write({ type: 'connected', ts: Date.now(), data: { service: 'events' } });

    const handler = (event) => write(event);
    bus.on('event', handler);

    // Heartbeat so proxies don't kill idle connections
    const heartbeat = setInterval(() => {
        try { res.write(': heartbeat\n\n'); } catch (_) { /* noop */ }
    }, 25_000);

    req.on('close', () => {
        bus.off('event', handler);
        clearInterval(heartbeat);
        try { res.end(); } catch (_) { /* noop */ }
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/leads/process  — Extension payload
// ═══════════════════════════════════════════════════════════════════════════════
//
// Payload:
// {
//   sessionName: "honeywell_recruiters_may12",       // required, used to group a batch
//   source: "chrome_extension",
//   searchUrl?: "https://linkedin.com/search/...",
//   extractedProfiles: [
//     {
//       fullName, firstName?, middleNames?, lastName?,
//       role, company, location?,
//       linkedinUrl?, connectionDegree?, recruiterProbability?,
//       extractedAt
//     }, ...
//   ]
// }
// ───────────────────────────────────────────────────────────────────────────────
router.post('/leads/process', async (req, res) => {
    const {
        sessionName,
        source = 'chrome_extension',
        searchUrl,
        extractedProfiles,
    } = req.body || {};

    if (!sessionName || typeof sessionName !== 'string') {
        return res.status(400).json({ error: 'sessionName is required' });
    }
    if (!Array.isArray(extractedProfiles)) {
        return res.status(400).json({ error: 'extractedProfiles must be an array' });
    }

    // Strip obviously empty profiles up front — no fabrication, just filtering junk.
    const clean = extractedProfiles
        .filter(p => p && typeof p.fullName === 'string' && p.fullName.trim().length >= 2);

    if (clean.length === 0) {
        return res.status(200).json({
            ok: true,
            sessionId: null,
            sessionName,
            totalReceived: extractedProfiles.length,
            totalProcessed: 0,
            totalSkipped: extractedProfiles.length,
            newLeads: 0,
            newCompanies: 0,
            totalEmailsGenerated: 0,
            note: 'No valid profiles in payload.',
        });
    }

    try {
        // ── Upsert session ───────────────────────────────────────────────────────
        const session = await prisma.session.upsert({
            where: { sessionName },
            update: {},
            create: {
                sessionName,
                totalProfiles: 0,
                rawInput: searchUrl ? JSON.stringify({ source, searchUrl }) : null,
            },
        });

        broadcast('extension:batch_start', {
            sessionId: session.id,
            sessionName,
            source,
            searchUrl: searchUrl || null,
            total: clean.length,
        });
        await logger.info(
            `Extension batch: ${clean.length} profiles for session "${sessionName}" (source=${source})`,
            session.id,
        );

        // ── Per-profile pipeline ─────────────────────────────────────────────────
        let newLeads = 0;
        let newCompanies = 0;
        let totalEmailsGenerated = 0;
        let totalSkipped = 0;
        const newCompanyDomains = new Set();

        // In-memory dedupe for this request — guarantees we never process the
        // same name+company twice in a single extension batch even before DB.
        const seenKeys = new Set();

        for (const profile of clean) {
            const rawFullName = String(profile.fullName).trim();
            const fullName = sanitizeLinkedInName(rawFullName) || rawFullName.split(/\s+/).slice(0, 3).join(' ');
            const companyName = String(profile.company || '').trim();
            const role = profile.role ? String(profile.role).trim() : null;
            const location = profile.location ? String(profile.location).trim() : null;
            const linkedinUrl = profile.linkedinUrl || null;

            if (!companyName) {
                totalSkipped++;
                broadcast('extension:profile_skipped', {
                    sessionId: session.id, fullName, reason: 'no_company',
                });
                continue;
            }

            const dedupeKey = `${fullName.toLowerCase()}|${companyName.toLowerCase()}`;
            if (seenKeys.has(dedupeKey)) {
                totalSkipped++;
                continue;
            }
            seenKeys.add(dedupeKey);

            broadcast('extension:profile_start', {
                sessionId: session.id, fullName, company: companyName,
            });

            try {
                // Resolve domain (best-effort). No domain = skip email gen but
                // we still record the Lead for visibility.
                const domain = await findDomain(companyName);

                let company = null;
                if (domain) {
                    const existingCompany = await prisma.company.findUnique({ where: { domain } });
                    company = await prisma.company.upsert({
                        where: { domain },
                        update: {},
                        create: { companyName, domain },
                    });
                    if (!existingCompany) {
                        newCompanies++;
                        newCompanyDomains.add(domain);
                    }
                }

                // Parse name
                const parsed = parseName(fullName);
                const firstName = profile.firstName
                    || parsed.first
                    || fullName.split(/\s+/)[0].toLowerCase();
                const lastName = profile.lastName
                    || parsed.last
                    || fullName.split(/\s+/).slice(-1)[0].toLowerCase();
                const middleNames = Array.isArray(profile.middleNames)
                    ? profile.middleNames.join(' ')
                    : (profile.middleNames || parsed.middle || null);

                // Upsert Lead. Unique constraint is (fullName, companyId).
                let leadBeforeUpsert = null;
                if (company) {
                    leadBeforeUpsert = await prisma.lead.findUnique({
                        where: { fullName_companyId: { fullName, companyId: company.id } },
                    });
                }

                const lead = company
                    ? await prisma.lead.upsert({
                          where: { fullName_companyId: { fullName, companyId: company.id } },
                          update: {
                              role: role || undefined,
                              location: location || undefined,
                              linkedinUrl: linkedinUrl || undefined,
                          },
                          create: {
                              fullName,
                              firstName,
                              lastName,
                              middleNames,
                              role,
                              location,
                              linkedinUrl,
                              sessionId: session.id,
                              companyId: company.id,
                          },
                      })
                    : await prisma.lead.create({
                          data: {
                              fullName,
                              firstName,
                              lastName,
                              middleNames,
                              role,
                              location,
                              linkedinUrl,
                              sessionId: session.id,
                          },
                      });

                if (!leadBeforeUpsert) newLeads++;

                // Ensure status row exists
                await prisma.leadStatus.upsert({
                    where: { leadId: lead.id },
                    update: {},
                    create: { leadId: lead.id },
                }).catch(() => {});

                // Generate emails only if we have a domain
                let emailsGeneratedForLead = 0;
                if (domain) {
                    const knownPattern = await getPattern(domain).catch(() => null);
                    let perms = generatePermutations(parsed, domain);
                    if (knownPattern) {
                        perms = perms.map(p =>
                            p.pattern === knownPattern ? { ...p, confidence: 'HIGH' } : p,
                        );
                    }

                    for (const p of perms) {
                        try {
                            await prisma.generatedEmail.upsert({
                                where: { email: p.email },
                                update: {},
                                create: {
                                    leadId: lead.id,
                                    email: p.email,
                                    pattern: p.pattern,
                                    confidence: p.confidence,
                                },
                            });
                            emailsGeneratedForLead++;
                        } catch (_) { /* dedupe race */ }
                    }
                }

                totalEmailsGenerated += emailsGeneratedForLead;

                broadcast('extension:profile_done', {
                    sessionId: session.id,
                    leadId: lead.id,
                    fullName,
                    company: companyName,
                    domain: domain || null,
                    emailsGenerated: emailsGeneratedForLead,
                });
            } catch (err) {
                totalSkipped++;
                console.error(`[extension] profile "${fullName}" failed:`, err.message);
                broadcast('extension:profile_error', {
                    sessionId: session.id, fullName, error: err.message,
                });
                await logger.error(
                    `Extension profile failed: ${fullName} — ${err.message}`,
                    session.id,
                );
            }
        }

        // ── Update session totals (incremental) ─────────────────────────────────
        const [leadCount, emailCount] = await Promise.all([
            prisma.lead.count({ where: { sessionId: session.id } }),
            prisma.generatedEmail.count({
                where: { lead: { sessionId: session.id } },
            }),
        ]);

        await prisma.session.update({
            where: { id: session.id },
            data: {
                totalProfiles: leadCount,
                totalEmails: emailCount,
            },
        }).catch(() => {});

        const summary = {
            ok: true,
            sessionId: session.id,
            sessionName,
            totalReceived: extractedProfiles.length,
            totalProcessed: clean.length - totalSkipped,
            totalSkipped,
            newLeads,
            newCompanies,
            totalEmailsGenerated,
            source,
        };

        broadcast('extension:batch_complete', summary);
        await logger.success(
            `Extension batch complete: ${summary.totalProcessed}/${summary.totalReceived} processed, ` +
            `${summary.newLeads} new leads, ${summary.totalEmailsGenerated} emails.`,
            session.id,
        );

        res.json(summary);
    } catch (err) {
        console.error('[POST /api/leads/process] fatal:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
