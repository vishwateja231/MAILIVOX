/**
 * dataRoutes.js — Complete CRUD + analytics routes. ALL data from PostgreSQL via Prisma.
 */
const express = require('express');
const router = express.Router();
const prisma = require('../services/db/prismaClient');
const {
    getOverviewStats, getVerificationBreakdown, getCompanyBreakdown,
    getSessionTrends, getRecruiterInsights, getCompanyStats, getSessionStats
} = require('../services/analytics/analyticsService');

// ═══════════════════════════════════════════════════════════════════════════════
// ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/analytics', async (req, res) => {
    try {
        const [overview, companies, sessions] = await Promise.all([
            getOverviewStats(), getCompanyStats(), getSessionStats(),
        ]);
        res.json({ overview, companies, sessions });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/analytics/overview', async (req, res) => {
    try { res.json(await getOverviewStats()); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/analytics/verification-stats', async (req, res) => {
    try { res.json(await getVerificationBreakdown()); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/analytics/company-breakdown', async (req, res) => {
    try { res.json(await getCompanyBreakdown()); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/analytics/session-trends', async (req, res) => {
    try { res.json(await getSessionTrends()); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/analytics/recruiter-insights', async (req, res) => {
    try { res.json(await getRecruiterInsights()); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// LEADS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/leads', async (req, res) => {
    try {
        const { page = 1, limit = 50, search = '', sessionId, companyId, status } = req.query;
        const skip = (Number(page) - 1) * Number(limit);

        const where = {
            ...(search ? {
                OR: [
                    { fullName: { contains: search, mode: 'insensitive' } },
                    { role: { contains: search, mode: 'insensitive' } },
                    { company: { companyName: { contains: search, mode: 'insensitive' } } },
                ]
            } : {}),
            ...(sessionId ? { sessionId } : {}),
            ...(companyId ? { companyId } : {}),
        };

        const [leads, total] = await Promise.all([
            prisma.lead.findMany({
                where, skip, take: Number(limit),
                orderBy: { createdAt: 'desc' },
                include: {
                    company: { select: { id: true, companyName: true, domain: true } },
                    session: { select: { sessionName: true } },
                    emails: { orderBy: { confidence: 'asc' } },
                    status: true,
                }
            }),
            prisma.lead.count({ where }),
        ]);

        res.json({ leads, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/leads/:id', async (req, res) => {
    try {
        const lead = await prisma.lead.findUnique({
            where: { id: req.params.id },
            include: {
                company: true,
                session: true,
                emails: { orderBy: { confidence: 'asc' } },
                status: true,
            }
        });
        if (!lead) return res.status(404).json({ error: 'Lead not found' });
        res.json(lead);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/leads/:id', async (req, res) => {
    try {
        await prisma.lead.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Bulk delete — accepts { ids: [id1, id2, ...] }
router.post('/leads/bulk-delete', async (req, res) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'ids array required' });
        }
        const result = await prisma.lead.deleteMany({
            where: { id: { in: ids } },
        });
        res.json({ success: true, deleted: result.count });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Add a lead directly — no validation, no domain lookup, just store it
router.post('/leads/add-direct', async (req, res) => {
    try {
        const { sessionId, fullName, email, role } = req.body;
        if (!email) return res.status(400).json({ error: 'email required' });
        if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

        // Verify session exists
        const session = await prisma.session.findUnique({ where: { id: sessionId } });
        if (!session) return res.status(404).json({ error: 'Session not found' });

        const name = fullName || email.split('@')[0].replace(/[._\-]/g, ' ');

        // Create lead in the given session
        const lead = await prisma.lead.create({
            data: {
                fullName: name,
                firstName: name.split(' ')[0]?.toLowerCase() || '',
                lastName: name.split(' ').slice(-1)[0]?.toLowerCase() || '',
                role: role || null,
                sessionId,
            },
        });

        // Store the email directly — VALID, no questions asked
        await prisma.generatedEmail.upsert({
            where: { email: email.trim() },
            update: { leadId: lead.id },
            create: {
                leadId: lead.id,
                email: email.trim(),
                pattern: 'PROVIDED_EMAIL',
                confidence: 'HIGH',
                verificationStatus: 'VALID',
                isVerified: true,
            },
        });

        // Status record
        await prisma.leadStatus.create({ data: { leadId: lead.id } }).catch(() => {});

        res.json({ ok: true, leadId: lead.id, email });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Alias route in case of path conflicts
router.post('/add-lead', async (req, res) => {
    try {
        const { sessionId, fullName, email, role } = req.body;
        if (!email) return res.status(400).json({ error: 'email required' });
        if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

        const session = await prisma.session.findUnique({ where: { id: sessionId } });
        if (!session) return res.status(404).json({ error: 'Session not found' });

        const name = fullName || email.split('@')[0].replace(/[._\-]/g, ' ');

        const lead = await prisma.lead.create({
            data: {
                fullName: name,
                firstName: name.split(' ')[0]?.toLowerCase() || '',
                lastName: name.split(' ').slice(-1)[0]?.toLowerCase() || '',
                role: role || null,
                sessionId,
            },
        });

        await prisma.generatedEmail.upsert({
            where: { email: email.trim() },
            update: { leadId: lead.id },
            create: { leadId: lead.id, email: email.trim(), pattern: 'PROVIDED_EMAIL', confidence: 'HIGH', verificationStatus: 'VALID', isVerified: true },
        });

        await prisma.leadStatus.create({ data: { leadId: lead.id } }).catch(() => {});

        res.json({ ok: true, leadId: lead.id, email });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/leads/:id/status', async (req, res) => {
    try {
        const status = await prisma.leadStatus.upsert({
            where: { leadId: req.params.id },
            update: req.body,
            create: { leadId: req.params.id, ...req.body }
        });
        res.json(status);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Update lead details (name, company, role, etc.) + optionally regenerate emails
router.patch('/leads/:id', async (req, res) => {
    try {
        const { fullName, firstName, lastName, role, location, linkedinUrl, companyName, domain, regenerateEmails, emails: emailUpdates } = req.body;
        const lead = await prisma.lead.findUnique({ where: { id: req.params.id }, include: { company: true } });
        if (!lead) return res.status(404).json({ error: 'Lead not found' });

        // Build update data
        const updateData = {};
        if (fullName !== undefined) updateData.fullName = fullName;
        if (firstName !== undefined) updateData.firstName = firstName;
        if (lastName !== undefined) updateData.lastName = lastName;
        if (role !== undefined) updateData.role = role;
        if (location !== undefined) updateData.location = location;
        if (linkedinUrl !== undefined) updateData.linkedinUrl = linkedinUrl;

        // Handle company change (only if provided and meaningful)
        let companyRecord = lead.company;
        if ((companyName && companyName.length > 1) || (domain && domain.length > 3)) {
            let resolvedDomain = domain || null;

            if (!resolvedDomain && companyName && companyName.length > 1) {
                try {
                    const { discoverDomain } = require('../services/domain/domainDiscovery');
                    const discovery = await discoverDomain({ company: companyName, manualDomain: domain });
                    resolvedDomain = discovery.domain;
                } catch (_) {}
            }

            if (resolvedDomain) {
                companyRecord = await prisma.company.upsert({
                    where: { domain: resolvedDomain },
                    update: { companyName: companyName || resolvedDomain },
                    create: { companyName: companyName || resolvedDomain, domain: resolvedDomain },
                });
                updateData.companyId = companyRecord.id;
            }
        }

        // Update the lead
        await prisma.lead.update({
            where: { id: req.params.id },
            data: updateData,
        });

        // Handle email additions (new emails added manually)
        if (Array.isArray(emailUpdates)) {
            for (const em of emailUpdates) {
                if (em.isNew && em.email && em.email.includes('@')) {
                    try {
                        await prisma.generatedEmail.upsert({
                            where: { email: em.email },
                            update: {},
                            create: { leadId: lead.id, email: em.email, pattern: 'MANUAL', confidence: 'HIGH', verificationStatus: 'VALID', isVerified: true },
                        });
                    } catch (_) {}
                }
            }
        }

        // Regenerate emails if requested
        if (regenerateEmails && companyRecord?.domain) {
            await prisma.generatedEmail.deleteMany({
                where: { leadId: lead.id, pattern: { notIn: ['PROVIDED_EMAIL', 'MANUAL'] } },
            });

            const { parseName } = require('../services/nameParser');
            const { generatePermutations } = require('../services/generator');
            const { getPattern } = require('../services/patternLearner');

            const nameParts = parseName(fullName || lead.fullName);
            const knownPattern = await getPattern(companyRecord.domain).catch(() => null);
            const perms = generatePermutations(nameParts, companyRecord.domain, knownPattern);

            for (const p of perms) {
                try {
                    await prisma.generatedEmail.upsert({
                        where: { email: p.email },
                        update: {},
                        create: { leadId: lead.id, email: p.email, pattern: p.pattern, confidence: p.confidence },
                    });
                } catch (_) {}
            }
        }

        // Reload with all relations
        const result = await prisma.lead.findUnique({
            where: { id: req.params.id },
            include: { company: true, emails: { orderBy: { confidence: 'asc' } }, status: true },
        });

        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMPANIES — Intelligence Hub
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/companies', async (req, res) => {
    try {
        const { search, sort = 'leads' } = req.query;

        const companies = await prisma.company.findMany({
            where: {
                ...(search ? { companyName: { contains: search, mode: 'insensitive' } } : {}),
                leads: { some: {} }, // Only companies with at least 1 lead
            },
            include: {
                _count: { select: { leads: true } },
                leads: {
                    select: {
                        id: true,
                        emails: { select: { verificationStatus: true, confidence: true } },
                        status: true,
                    },
                },
            },
            orderBy: { leadCount: 'desc' },
        });

        // Compute intelligence metrics per company
        const enriched = companies.map(c => {
            const totalEmails = c.leads.reduce((s, l) => s + l.emails.length, 0);
            const verified = c.leads.reduce((s, l) => s + l.emails.filter(e => e.verificationStatus === 'VALID').length, 0);
            const bounced = c.leads.reduce((s, l) => s + l.emails.filter(e => e.verificationStatus === 'INVALID').length, 0);
            const highConf = c.leads.reduce((s, l) => s + l.emails.filter(e => e.confidence === 'HIGH').length, 0);
            const contacted = c.leads.filter(l => l.status?.outreachSent).length;
            const replied = c.leads.filter(l => l.status?.replied).length;

            // Health score (0-100)
            let health = 50;
            if (c.learnedPattern) health += 20;
            if (verified > 0) health += 15;
            if (bounced === 0 && totalEmails > 0) health += 10;
            if (replied > 0) health += 15;
            if (bounced > verified) health -= 30;
            health = Math.max(0, Math.min(100, health));

            const healthLevel = health >= 80 ? 'Excellent' : health >= 60 ? 'Healthy' : health >= 40 ? 'Risky' : health >= 20 ? 'Poor' : 'Unknown';

            // Status
            let status = 'No Trusted Pattern Yet';
            if (c.learnedPattern && verified > 0) status = 'Verified Pattern Learned';
            else if (c.learnedPattern) status = 'Pattern Detected';
            else if (totalEmails > 0 && bounced > verified) status = 'Bounce Risk';

            return {
                id: c.id,
                companyName: c.companyName,
                domain: c.domain,
                learnedPattern: c.learnedPattern,
                leadCount: c._count.leads,
                totalEmails,
                verified,
                bounced,
                highConfidence: highConf,
                contacted,
                replied,
                health,
                healthLevel,
                status,
                deliveryRate: totalEmails > 0 ? Math.round((verified / totalEmails) * 100) : 0,
                replyRate: contacted > 0 ? Math.round((replied / contacted) * 100) : 0,
                updatedAt: c.updatedAt,
            };
        });

        // Sort
        if (sort === 'delivery') enriched.sort((a, b) => b.deliveryRate - a.deliveryRate);
        else if (sort === 'replies') enriched.sort((a, b) => b.replied - a.replied);
        else if (sort === 'health') enriched.sort((a, b) => b.health - a.health);
        else enriched.sort((a, b) => b.leadCount - a.leadCount);

        // Remove leads array from response (too heavy)
        res.json(enriched);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/companies/:id', async (req, res) => {
    try {
        const company = await prisma.company.findUnique({
            where: { id: req.params.id },
            include: {
                leads: {
                    include: {
                        emails: { orderBy: { confidence: 'asc' } },
                        status: true,
                        session: { select: { id: true, sessionName: true } },
                        sentEmails: { select: { status: true, sentAt: true }, take: 5, orderBy: { createdAt: 'desc' } },
                    },
                    orderBy: { createdAt: 'desc' },
                },
            },
        });
        if (!company) return res.status(404).json({ error: 'Company not found' });

        // Aggregate stats
        const totalEmails = company.leads.reduce((s, l) => s + l.emails.length, 0);
        const verified = company.leads.reduce((s, l) => s + l.emails.filter(e => e.verificationStatus === 'VALID').length, 0);
        const bounced = company.leads.reduce((s, l) => s + l.emails.filter(e => e.verificationStatus === 'INVALID').length, 0);
        const contacted = company.leads.filter(l => l.status?.outreachSent).length;
        const replied = company.leads.filter(l => l.status?.replied).length;

        // Pattern analysis
        const patternCounts = {};
        company.leads.forEach(l => l.emails.forEach(e => {
            if (!patternCounts[e.pattern]) patternCounts[e.pattern] = { total: 0, verified: 0, bounced: 0 };
            patternCounts[e.pattern].total++;
            if (e.verificationStatus === 'VALID') patternCounts[e.pattern].verified++;
            if (e.verificationStatus === 'INVALID') patternCounts[e.pattern].bounced++;
        }));
        const patterns = Object.entries(patternCounts).map(([pattern, stats]) => ({
            pattern,
            ...stats,
            successRate: stats.total > 0 ? Math.round((stats.verified / stats.total) * 100) : 0,
        })).sort((a, b) => b.successRate - a.successRate);

        // Sessions linked
        const sessionSet = new Map();
        company.leads.forEach(l => {
            if (l.session && !sessionSet.has(l.session.id)) {
                sessionSet.set(l.session.id, l.session.sessionName);
            }
        });
        const sessions = [...sessionSet.entries()].map(([id, name]) => ({ id, name }));

        res.json({
            ...company,
            totalEmails,
            verified,
            bounced,
            contacted,
            replied,
            patterns,
            sessions,
            deliveryRate: totalEmails > 0 ? Math.round((verified / totalEmails) * 100) : 0,
            replyRate: contacted > 0 ? Math.round((replied / contacted) * 100) : 0,
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SESSIONS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/sessions', async (req, res) => {
    try {
        const { archived } = req.query;
        const where = {};
        if (archived === 'true') where.isArchived = true;
        else if (archived === 'false' || !archived) where.isArchived = false;
        // archived === 'all' returns everything

        const sessions = await prisma.session.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            include: { _count: { select: { leads: true, exports: true, logs: true } } }
        });
        res.json(sessions);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/sessions/:id', async (req, res) => {
    try {
        const session = await prisma.session.findUnique({
            where: { id: req.params.id },
            include: {
                leads: {
                    include: {
                        company: { select: { companyName: true, domain: true } },
                        emails: { orderBy: { confidence: 'asc' } },
                    }
                },
                exports: true,
                logs: { orderBy: { createdAt: 'desc' }, take: 50 },
                _count: { select: { leads: true, exports: true } },
            }
        });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        res.json(session);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/sessions/:id', async (req, res) => {
    try {
        await prisma.session.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/sessions/:id/archive', async (req, res) => {
    try {
        const { isArchived = true } = req.body;
        const session = await prisma.session.update({
            where: { id: req.params.id },
            data: { isArchived },
        });
        res.json(session);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Rename a session
router.patch('/sessions/:id', async (req, res) => {
    try {
        const { sessionName } = req.body || {};
        if (!sessionName || typeof sessionName !== 'string' || !sessionName.trim()) {
            return res.status(400).json({ error: 'sessionName is required' });
        }
        const trimmed = sessionName.trim();
        if (trimmed.length > 200) {
            return res.status(400).json({ error: 'sessionName too long (max 200 chars)' });
        }
        // Check uniqueness
        const existing = await prisma.session.findUnique({ where: { sessionName: trimmed } });
        if (existing && existing.id !== req.params.id) {
            return res.status(409).json({ error: 'A session with that name already exists' });
        }
        const session = await prisma.session.update({
            where: { id: req.params.id },
            data: { sessionName: trimmed },
        });
        res.json(session);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// LOGS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/logs', async (req, res) => {
    try {
        const { sessionId, limit = 100 } = req.query;
        const logs = await prisma.processingLog.findMany({
            where: sessionId ? { sessionId } : {},
            orderBy: { createdAt: 'desc' },
            take: Number(limit),
        });
        res.json(logs);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/exports', async (req, res) => {
    try {
        const exports = await prisma.sheetExport.findMany({
            orderBy: { createdAt: 'desc' },
            include: { session: { select: { sessionName: true } } },
        });
        res.json(exports);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// API KEY MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/keys/stats', async (req, res) => {
    try {
        const { getKeyStats } = require('../services/validation/keyManager');
        res.json(await getKeyStats());
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/keys/add', async (req, res) => {
    try {
        const { key, label, limit } = req.body;
        if (!key || !key.startsWith('cm_live_')) return res.status(400).json({ error: 'Invalid key (must start with cm_live_)' });
        const { addKey } = require('../services/validation/keyManager');
        const result = await addKey(key, label || null, limit || 100);
        if (result.error) return res.status(400).json(result);
        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/keys/:id', async (req, res) => {
    try {
        const { removeKey } = require('../services/validation/keyManager');
        res.json(await removeKey(req.params.id));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/keys/cleanup', async (req, res) => {
    try {
        const { removeExhaustedKeys } = require('../services/validation/keyManager');
        res.json(await removeExhaustedKeys());
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
