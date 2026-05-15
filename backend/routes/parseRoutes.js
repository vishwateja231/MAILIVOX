/**
 * parseRoutes.js — LinkedIn paste parsing, email generation, and bulk processing.
 */
const express = require('express');
const router = express.Router();

const { parseLinkedInText } = require('../services/linkedInParser');
const { parseBulkLinkedInText } = require('../services/bulkParser');
const { processBulkQueue } = require('../services/bulkProcessor');
const { findDomain } = require('../services/domainFinder');
const { parseName } = require('../services/nameParser');
const { generatePermutations } = require('../services/generator');
const { getPattern, learnPattern } = require('../services/patternLearner');
const { verifyEmail } = require('../services/verifier');
const prisma = require('../services/db/prismaClient');
const logger = require('../services/logger/logger');

// ─── POST /api/parse-linkedin — single profile ────────────────────────────────
router.post('/parse-linkedin', async (req, res) => {
    try {
        const { rawText } = req.body;
        if (!rawText) return res.status(400).json({ error: 'rawText is required' });
        const parsed = parseLinkedInText(rawText);
        res.json(parsed);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── POST /api/parse-linkedin-bulk — preview only ─────────────────────────────
router.post('/parse-linkedin-bulk', async (req, res) => {
    try {
        const { rawText } = req.body;
        if (!rawText) return res.status(400).json({ error: 'rawText is required' });
        const result = parseBulkLinkedInText(rawText);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── POST /api/generate-emails — single name + company ────────────────────────
router.post('/generate-emails', async (req, res) => {
    try {
        const { fullName, companyName, sessionId, email: providedEmail, role, skipValidation } = req.body;
        if (!fullName && !providedEmail) return res.status(400).json({ error: 'fullName or email required' });

        let domain = null;
        let company = null;

        // If email is provided directly, extract domain from it
        if (providedEmail) {
            domain = providedEmail.split('@')[1];
            const compName = companyName || domain.split('.')[0];
            company = await prisma.company.upsert({
                where: { domain },
                update: {},
                create: { companyName: compName, domain }
            });
        } else if (companyName) {
            domain = await findDomain(companyName);
            if (domain) {
                company = await prisma.company.upsert({
                    where: { domain },
                    update: {},
                    create: { companyName, domain }
                });
            }
        }

        // Use provided sessionId or create a new manual session
        let session;
        if (sessionId) {
            session = await prisma.session.findUnique({ where: { id: sessionId } });
            if (!session) return res.status(404).json({ error: 'Session not found' });
        } else {
            session = await prisma.session.create({
                data: { sessionName: `manual_${Date.now()}`, totalProfiles: 1 }
            });
        }

        const nameParts = parseName(fullName || providedEmail.split('@')[0].replace(/[._\-]/g, ' '));
        const leadName = fullName || providedEmail.split('@')[0].replace(/[._\-]/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

        const lead = await prisma.lead.create({
            data: {
                fullName: leadName,
                firstName: nameParts.first,
                lastName: nameParts.last,
                middleNames: nameParts.middle || null,
                role: role || null,
                sessionId: session.id,
                ...(company ? { companyId: company.id } : {}),
            }
        });

        // Create status record
        await prisma.leadStatus.upsert({
            where: { leadId: lead.id },
            update: {},
            create: { leadId: lead.id },
        }).catch(() => {});

        let emails = [];
        if (providedEmail) {
            // Store provided email directly
            await prisma.generatedEmail.upsert({
                where: { email: providedEmail },
                update: {},
                create: { leadId: lead.id, email: providedEmail, pattern: 'PROVIDED_EMAIL', confidence: 'HIGH', verificationStatus: 'VALID', isVerified: true }
            }).catch(() => {});
            emails = [{ email: providedEmail, pattern: 'PROVIDED_EMAIL', confidence: 'HIGH' }];
        } else if (domain) {
            // Generate permutations
            const knownPattern = await getPattern(domain).catch(() => null);
            const perms = generatePermutations(nameParts, domain, knownPattern);
            for (const p of perms) {
                // If skipValidation, mark as VALID directly
                const status = skipValidation ? 'VALID' : 'PENDING';
                const conf = skipValidation ? 'HIGH' : (p.confidence || 'PENDING');
                await prisma.generatedEmail.upsert({
                    where: { email: p.email },
                    update: {},
                    create: { leadId: lead.id, email: p.email, pattern: p.pattern, confidence: conf, verificationStatus: status, isVerified: skipValidation }
                }).catch(() => {});
            }
            emails = perms.map(p => ({ email: p.email, pattern: p.pattern, confidence: skipValidation ? 'HIGH' : p.confidence }));
        }

        // Update session totals
        const leadCount = await prisma.lead.count({ where: { sessionId: session.id } });
        await prisma.session.update({ where: { id: session.id }, data: { totalProfiles: leadCount } }).catch(() => {});

        res.json({ domain, sessionId: session.id, leadId: lead.id, emails });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// ─── POST /api/verify-email ───────────────────────────────────────────────────
router.post('/verify-email', async (req, res) => {
    try {
        const { email, pattern } = req.body;
        if (!email) return res.status(400).json({ error: 'email is required' });

        const domain = email.split('@')[1];
        const result = await verifyEmail(email, domain);

        // Update DB record
        await prisma.generatedEmail.updateMany({
            where: { email },
            data: { verificationStatus: result.status, isVerified: result.status === 'VALID' }
        }).catch(() => {});

        if (result.status === 'VALID' && pattern) await learnPattern(domain, pattern);

        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── POST /api/validate-email — Production validation engine ──────────────────
router.post('/validate-email', async (req, res) => {
    try {
        const { email, pattern, score } = req.body;
        if (!email) return res.status(400).json({ error: 'email is required' });

        const { validateEmail: validate } = require('../services/validation/validationEngine');
        const result = await validate(email, { pattern, localPartScore: score || 50 });

        // Update DB record with new confidence
        const statusMap = { HIGH: 'VALID', MEDIUM: 'PENDING', LOW: 'PENDING', INVALID: 'INVALID' };
        await prisma.generatedEmail.updateMany({
            where: { email },
            data: {
                verificationStatus: statusMap[result.confidence] || 'PENDING',
                confidence: result.confidence,
                isVerified: result.confidence === 'HIGH',
            }
        }).catch(() => {});

        // Learn pattern if validated HIGH
        if (result.confidence === 'HIGH' && pattern) {
            const domain = email.split('@')[1];
            await learnPattern(domain, pattern);
        }

        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── POST /api/validate-batch — Batch validation ──────────────────────────────
router.post('/validate-batch', async (req, res) => {
    try {
        const { emails, skipSmtp = false } = req.body;
        if (!Array.isArray(emails) || emails.length === 0) {
            return res.status(400).json({ error: 'emails array required' });
        }
        if (emails.length > 50) {
            return res.status(400).json({ error: 'Maximum 50 emails per batch' });
        }

        const { validateBatch } = require('../services/validation/validationEngine');
        const results = await validateBatch(emails, { concurrency: 4, skipSmtp });

        // Update DB records
        for (const r of results) {
            const statusMap = { HIGH: 'VALID', MEDIUM: 'PENDING', LOW: 'PENDING', INVALID: 'INVALID' };
            await prisma.generatedEmail.updateMany({
                where: { email: r.email },
                data: {
                    verificationStatus: statusMap[r.confidence] || 'PENDING',
                    confidence: r.confidence,
                    isVerified: r.confidence === 'HIGH',
                }
            }).catch(() => {});
        }

        res.json({ total: results.length, results });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── POST /api/bulk-process-stream — SSE stream ───────────────────────────────
router.post('/bulk-process-stream', async (req, res) => {
    try {
        const { profiles, sessionName, verify = false } = req.body;
        if (!profiles || !Array.isArray(profiles)) return res.status(400).json({ error: 'profiles array required' });

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();

        const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

        // Create session
        const sName = sessionName || `bulk_${Date.now()}`;
        const session = await prisma.session.create({
            data: { sessionName: sName, totalProfiles: profiles.length, rawInput: JSON.stringify(profiles) }
        });
        send({ type: 'session', data: { sessionId: session.id, sessionName: sName } });
        await logger.info(`Session created: ${sName} with ${profiles.length} profiles`, session.id);

        await processBulkQueue(profiles, send, verify, session.id);
        res.end();
    } catch (e) {
        console.error(e);
        if (!res.headersSent) res.status(500).json({ error: e.message });
    }
});

// ─── POST /api/run-pipeline — Unified Intelligence Pipeline (SSE) ─────────────
// Single-button flow: raw text → parse → filter → dedupe → enrich → persist
router.post('/run-pipeline', async (req, res) => {
    try {
        const { rawText, sessionName, companyOverride, domainOverride, excludeInterns = true, excludeFreshers = false } = req.body;
        if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
            return res.status(400).json({ error: 'rawText is required' });
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();

        const send = (obj) => {
            try { res.write(`data: ${JSON.stringify(obj)}\n\n`); }
            catch (_) { /* connection closed */ }
        };

        const { runPipeline } = require('../services/intelligence/pipeline');
        await runPipeline({ rawText, sessionName, companyOverride, domainOverride, excludeInterns, excludeFreshers, onProgress: send });
        res.end();
    } catch (e) {
        console.error('[run-pipeline]', e);
        if (!res.headersSent) res.status(500).json({ error: e.message });
    }
});

module.exports = router;
