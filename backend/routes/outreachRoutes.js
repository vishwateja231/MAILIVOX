/**
 * outreachRoutes.js — Campaign management, email sending, queue control, AI generation.
 * ─────────────────────────────────────────────────────────────────────────────
 * All data from PostgreSQL. No mock responses.
 */
const express = require('express');
const router = express.Router();
const { z } = require('zod');
const prisma = require('../services/db/prismaClient');
const { sendEmail, sendBatch, getMailStats } = require('../services/mail/resendClient');
const { listTemplates, getRenderedTemplate } = require('../services/mail/templates');
const emailQueue = require('../services/mail/emailQueue');
const { generatePersonalizedEmail, generateVariants } = require('../services/ai/generateEmail');
const multer = require('multer');
const composeUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// ─── Template Rendering with Conditional Blocks ─────────────────────────────

/**
 * Render a template string with {{variable}} replacement and {{#if var}}...{{/if}} conditionals.
 * Gracefully handles missing variables (removes empty sentences, cleans punctuation).
 */
function renderWithConditionals(template, vars) {
    let rendered = template;

    // Process conditional blocks: {{#if variable}}content{{/if}}
    rendered = rendered.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/gi, (_, varName, content) => {
        const value = vars[varName] || vars[varName.toLowerCase()];
        return value && value.trim() ? content : '';
    });

    // Replace {{variable}} placeholders
    for (const [key, val] of Object.entries(vars)) {
        const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'gi');
        rendered = rendered.replace(regex, val || '');
    }

    // Clean up unreplaced variables
    rendered = rendered.replace(/\{\{[^}]+\}\}/g, '');

    // Clean up broken sentences: "I noticed you're at ." → remove
    rendered = rendered.replace(/\bat\s*\.\s*/g, '');
    rendered = rendered.replace(/\bas a\s*\.\s*/g, '');
    rendered = rendered.replace(/\s{2,}/g, ' ');
    rendered = rendered.replace(/\n{3,}/g, '\n\n');

    return rendered.trim();
}

// ─── Validation Schemas ──────────────────────────────────────────────────────

const SendEmailSchema = z.object({
    to: z.string().email(),
    toName: z.string().optional(),
    subject: z.string().min(1).max(200),
    html: z.string().min(1),
    text: z.string().optional(),
    campaignId: z.string().optional(),
    leadId: z.string().optional(),
    templateUsed: z.string().optional(),
});

const CampaignSchema = z.object({
    name: z.string().min(1).max(200),
    description: z.string().optional(),
    tone: z.enum(['professional', 'aggressive', 'startup', 'enterprise', 'concise']).optional(),
    sendRate: z.number().int().min(1).max(50).optional(),
});

const GenerateSchema = z.object({
    recruiterName: z.string().min(1),
    recruiterRole: z.string().optional(),
    company: z.string().min(1),
    targetRole: z.string().optional(),
    tone: z.enum(['professional', 'aggressive', 'startup', 'enterprise', 'concise']).optional(),
    type: z.enum(['cold_outreach', 'referral_request', 'follow_up', 'networking', 'startup_founder']).optional(),
    context: z.object({
        myName: z.string().optional(),
        myRole: z.string().optional(),
        myTitle: z.string().optional(),
        skills: z.string().optional(),
        experience: z.string().optional(),
        recentWork: z.string().optional(),
        recentUpdate: z.string().optional(),
        industry: z.string().optional(),
    }).optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// SESSION-AWARE OUTREACH — loads leads + emails for a session
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/outreach/session-leads', async (req, res) => {
    try {
        const { sessionId, sessionIds } = req.query;
        
        // Require at least one session filter — never return all leads unfiltered
        if (!sessionId && !sessionIds) {
            return res.json([]);
        }
        
        // Support both single sessionId and multiple sessionIds (comma-separated)
        let sessionFilter = {};
        if (sessionIds) {
            const ids = sessionIds.split(',').map(s => s.trim()).filter(Boolean);
            if (ids.length === 0) return res.json([]);
            sessionFilter = { sessionId: { in: ids } };
        } else if (sessionId) {
            sessionFilter = { sessionId };
        }
        
        const where = {
            ...sessionFilter,
        };

        // Single query — fetch all leads with ALL their emails (no N+1)
        const leads = await prisma.lead.findMany({
            where,
            include: {
                company: { select: { companyName: true, domain: true } },
                emails: {
                    orderBy: [{ confidence: 'asc' }, { createdAt: 'asc' }],
                    take: 10,
                },
                status: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 300,
        });

        // Normalize in-memory (no extra DB calls)
        const enriched = leads.map(l => {
            const role = l.role && l.role.includes('@') ? null : l.role;
            return {
                ...l,
                role,
                companyName: l.company?.companyName || '',
                companyDomain: l.company?.domain || '',
            };
        });

        res.json(enriched);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Bulk send using template — replaces variables per lead and queues
router.post('/outreach/bulk-send-template', async (req, res) => {
    try {
        const { leadIds, subject, body, campaignId, variables = {} } = req.body;
        if (!Array.isArray(leadIds) || leadIds.length === 0) {
            return res.status(400).json({ error: 'leadIds array required' });
        }
        if (!subject || !body) {
            return res.status(400).json({ error: 'subject and body required' });
        }

        // Fetch leads with their top email
        const leads = await prisma.lead.findMany({
            where: { id: { in: leadIds } },
            include: {
                company: { select: { companyName: true, domain: true } },
                emails: { orderBy: { confidence: 'asc' }, take: 1 },
            },
        });

        const jobs = [];
        const skipped = [];
        for (const lead of leads) {
            const topEmail = lead.emails[0];
            if (!topEmail) { skipped.push({ id: lead.id, reason: 'no_email' }); continue; }
            
            // SAFETY: Only send to verified emails — never send to PENDING/unverified
            if (topEmail.verificationStatus !== 'VALID' && topEmail.pattern !== 'PROVIDED_EMAIL') {
                skipped.push({ id: lead.id, reason: 'email_not_verified', email: topEmail.email });
                continue;
            }

            // ── Normalize lead fields (prevent email-in-role, etc.) ───────────
            let leadRole = lead.role || '';
            let leadCompany = lead.company?.companyName || '';

            // If role contains @ it's actually an email — clear it
            if (leadRole.includes('@')) leadRole = '';
            // If company is empty but role looks like a company, swap
            if (!leadCompany && leadRole && !leadRole.match(/engineer|manager|recruiter|developer|director|analyst|intern|lead|head|vp|ceo|cto|founder|specialist|consultant|designer|architect/i)) {
                // Might be a company name misclassified as role — leave as-is for safety
            }

            // Build variables with strict normalization
            const firstName = lead.firstName || lead.fullName?.split(' ')[0]?.toLowerCase() || '';
            const vars = {
                name: lead.fullName || '',
                first_name: firstName.charAt(0).toUpperCase() + firstName.slice(1),
                last_name: lead.lastName || '',
                company: leadCompany,
                domain: lead.company?.domain || '',
                role: leadRole,
                email: topEmail.email,
                linkedin: lead.linkedinUrl || '',
                ...variables, // global campaign variables override
            };

            // Render email using production renderer
            const { renderEmail } = require('../services/outreach/renderEmail');
            const rendered = renderEmail({ subject, body, vars });

            // Validate: don't send if subject or body is effectively empty
            if (!rendered.subject.trim() || rendered.text.trim().length < 20) {
                skipped.push({ id: lead.id, reason: 'empty_render' });
                continue;
            }

            jobs.push({
                campaignId: campaignId || null,
                leadId: lead.id,
                toEmail: topEmail.email,
                toName: lead.fullName,
                subject: rendered.subject,
                htmlBody: rendered.html,
                textBody: rendered.text,
                templateUsed: 'custom_template',
            });
        }

        // Enqueue all jobs
        const queued = await emailQueue.enqueueBatch(jobs);
        res.json({ ok: true, queued: queued.length, skipped: skipped.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CAMPAIGNS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/outreach/campaigns', async (req, res) => {
    try {
        const campaigns = await prisma.outreachCampaign.findMany({
            orderBy: { createdAt: 'desc' },
        });
        res.json(campaigns);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/outreach/campaigns/:id', async (req, res) => {
    try {
        const campaign = await prisma.outreachCampaign.findUnique({
            where: { id: req.params.id },
            include: {
                sentEmails: { orderBy: { createdAt: 'desc' }, take: 50 },
                queuedJobs: { orderBy: { createdAt: 'desc' }, take: 50 },
            },
        });
        if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
        res.json(campaign);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/outreach/campaigns', async (req, res) => {
    try {
        const data = CampaignSchema.parse(req.body);
        const campaign = await prisma.outreachCampaign.create({ data });
        res.json(campaign);
    } catch (e) {
        if (e.name === 'ZodError') return res.status(400).json({ error: 'Validation failed', details: e.errors });
        res.status(500).json({ error: e.message });
    }
});

router.patch('/outreach/campaigns/:id', async (req, res) => {
    try {
        const campaign = await prisma.outreachCampaign.update({
            where: { id: req.params.id },
            data: req.body,
        });
        res.json(campaign);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/outreach/campaigns/:id', async (req, res) => {
    try {
        await prisma.outreachCampaign.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SEND EMAILS
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/outreach/send', async (req, res) => {
    try {
        const data = SendEmailSchema.parse(req.body);
        const result = await sendEmail(data);
        res.json(result);
    } catch (e) {
        if (e.name === 'ZodError') return res.status(400).json({ error: 'Validation failed', details: e.errors });
        res.status(500).json({ error: e.message });
    }
});

router.post('/outreach/send-batch', async (req, res) => {
    try {
        const { emails } = req.body;
        if (!Array.isArray(emails) || emails.length === 0) {
            return res.status(400).json({ error: 'emails array required' });
        }
        if (emails.length > 50) {
            return res.status(400).json({ error: 'Maximum 50 emails per batch' });
        }
        const results = await sendBatch(emails);
        res.json({ total: results.length, results });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SENT EMAILS HISTORY
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/outreach/sent', async (req, res) => {
    try {
        const { page = 1, limit = 50, campaignId, status } = req.query;
        const skip = (Number(page) - 1) * Number(limit);
        const where = {
            ...(campaignId ? { campaignId } : {}),
            ...(status ? { status } : {}),
        };
        const [emails, total] = await Promise.all([
            prisma.sentEmail.findMany({
                where, skip, take: Number(limit),
                orderBy: { createdAt: 'desc' },
                include: { lead: { select: { fullName: true, company: { select: { companyName: true } } } } },
            }),
            prisma.sentEmail.count({ where }),
        ]);
        res.json({ emails, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/outreach/stats', async (req, res) => {
    try {
        const stats = await getMailStats();
        const queueStats = await emailQueue.getQueueStats();
        res.json({ ...stats, queue: queueStats });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// EMAIL QUEUE
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/outreach/queue/add', async (req, res) => {
    try {
        const job = await emailQueue.enqueue(req.body);
        res.json(job);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/outreach/queue/add-batch', async (req, res) => {
    try {
        const { jobs } = req.body;
        if (!Array.isArray(jobs)) return res.status(400).json({ error: 'jobs array required' });
        const results = await emailQueue.enqueueBatch(jobs);
        res.json({ queued: results.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/outreach/queue/start', async (_req, res) => {
    emailQueue.start();
    res.json({ ok: true, status: 'running' });
});

router.post('/outreach/queue/pause', async (_req, res) => {
    emailQueue.pause();
    res.json({ ok: true, status: 'paused' });
});

router.post('/outreach/queue/resume', async (_req, res) => {
    emailQueue.resume();
    res.json({ ok: true, status: 'resumed' });
});

router.post('/outreach/queue/stop', async (_req, res) => {
    emailQueue.stop();
    res.json({ ok: true, status: 'stopped' });
});

router.post('/outreach/queue/retry-dead', async (_req, res) => {
    try {
        const count = await emailQueue.retryDead();
        res.json({ ok: true, retriedCount: count });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/outreach/queue/stats', async (_req, res) => {
    try {
        const stats = await emailQueue.getQueueStats();
        res.json(stats);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/outreach/queue/jobs', async (req, res) => {
    try {
        const { status, limit = 50 } = req.query;
        const jobs = await prisma.emailQueueJob.findMany({
            where: status ? { status } : {},
            orderBy: { createdAt: 'desc' },
            take: Number(limit),
        });
        res.json(jobs);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/outreach/templates', (_req, res) => {
    res.json(listTemplates());
});

router.post('/outreach/templates/render', (req, res) => {
    try {
        const { templateId, variables } = req.body;
        if (!templateId) return res.status(400).json({ error: 'templateId required' });
        const rendered = getRenderedTemplate(templateId, variables || {});
        res.json(rendered);
    } catch (e) { res.status(400).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// AI GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/outreach/generate', async (req, res) => {
    try {
        const data = GenerateSchema.parse(req.body);
        const result = await generatePersonalizedEmail(data);
        res.json(result);
    } catch (e) {
        if (e.name === 'ZodError') return res.status(400).json({ error: 'Validation failed', details: e.errors });
        res.status(500).json({ error: e.message });
    }
});

router.post('/outreach/generate-variants', async (req, res) => {
    try {
        const { count = 3, ...opts } = req.body;
        const data = GenerateSchema.parse(opts);
        const variants = await generateVariants(data, Math.min(count, 5));
        res.json(variants);
    } catch (e) {
        if (e.name === 'ZodError') return res.status(400).json({ error: 'Validation failed', details: e.errors });
        res.status(500).json({ error: e.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOK — Resend delivery events
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/outreach/webhook/resend', async (req, res) => {
    try {
        const { type, data } = req.body;
        if (!type || !data) return res.status(400).json({ error: 'Invalid webhook payload' });

        const resendId = data.email_id;
        if (!resendId) return res.status(200).json({ ok: true });

        // Find the sent email by resendId
        const sentEmail = await prisma.sentEmail.findFirst({ where: { resendId } });
        if (!sentEmail) return res.status(200).json({ ok: true, note: 'Email not found' });

        // Log event
        await prisma.emailEvent.create({
            data: {
                sentEmailId: sentEmail.id,
                eventType: type,
                payload: JSON.stringify(data),
            },
        });

        // Update status based on event type
        const statusMap = {
            'email.delivered': { status: 'DELIVERED', deliveredAt: new Date() },
            'email.bounced': { status: 'BOUNCED', bouncedAt: new Date() },
            'email.complained': { status: 'BOUNCED' },
        };

        if (statusMap[type]) {
            await prisma.sentEmail.update({
                where: { id: sentEmail.id },
                data: statusMap[type],
            });

            // Update campaign counters for bounces
            if (type === 'email.bounced' && sentEmail.campaignId) {
                await prisma.outreachCampaign.update({
                    where: { id: sentEmail.campaignId },
                    data: { totalBounced: { increment: 1 } },
                }).catch(() => {});
            }
        }

        // ── Delivery Learning: improve validation intelligence ────────────
        const { learnFromDelivery } = require('../services/validation/validationEngine');
        if (type === 'email.delivered') {
            await learnFromDelivery(sentEmail.toEmail, 'delivered').catch(() => {});
        } else if (type === 'email.bounced') {
            await learnFromDelivery(sentEmail.toEmail, 'bounced').catch(() => {});

            // ── BOUNCE PROTECTION: Remove from all follow-up queues ──────────
            await prisma.followUp.updateMany({
                where: {
                    leadId: sentEmail.leadId || undefined,
                    status: { in: ['SCHEDULED', 'PENDING'] },
                },
                data: { status: 'CANCELLED' },
            }).catch(() => {});

            // Update lead status to reflect bounce
            if (sentEmail.leadId) {
                await prisma.leadStatus.upsert({
                    where: { leadId: sentEmail.leadId },
                    update: { stage: 'BOUNCED', followUpNeeded: false },
                    create: { leadId: sentEmail.leadId, stage: 'BOUNCED', followUpNeeded: false },
                }).catch(() => {});
            }

            console.log(`[webhook] Bounce detected: ${sentEmail.toEmail} — removed from follow-ups`);
        }

        res.status(200).json({ ok: true });
    } catch (e) {
        console.error('[webhook] Error:', e.message);
        res.status(200).json({ ok: true }); // Always 200 for webhooks
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONVERSATIONS / THREADS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/outreach/conversations', async (req, res) => {
    try {
        const { limit = 50, status } = req.query;
        const where = { status: { in: ['SENT', 'DELIVERED', 'REPLIED'] } };
        if (status === 'replied') where.status = 'REPLIED';

        const threads = await prisma.sentEmail.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: Number(limit),
            include: {
                lead: { select: { fullName: true, role: true, company: { select: { companyName: true } } } },
                events: { orderBy: { createdAt: 'desc' }, take: 5 },
            },
        });

        // Group by lead for thread view
        const grouped = {};
        for (const email of threads) {
            const key = email.leadId || email.toEmail;
            if (!grouped[key]) {
                grouped[key] = {
                    leadId: email.leadId,
                    leadName: email.lead?.fullName || email.toName || email.toEmail,
                    company: email.lead?.company?.companyName || '',
                    emails: [],
                    latestStatus: email.status,
                    latestDate: email.sentAt || email.createdAt,
                };
            }
            grouped[key].emails.push({
                id: email.id,
                subject: email.subject,
                status: email.status,
                sentAt: email.sentAt,
                deliveredAt: email.deliveredAt,
                resendId: email.resendId,
            });
        }

        res.json(Object.values(grouped).slice(0, Number(limit)));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// EMAIL PREVIEW — renders template with sample data
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/outreach/preview', (req, res) => {
    try {
        const { subject, body, vars = {} } = req.body;
        if (!body) return res.status(400).json({ error: 'body required' });
        const { renderEmail } = require('../services/outreach/renderEmail');
        const rendered = renderEmail({ subject: subject || '', body, vars });
        res.json(rendered);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CAMPAIGN HISTORY
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/outreach/history', async (req, res) => {
    try {
        const { status, limit = 50 } = req.query;
        const where = status ? { status } : {};
        const campaigns = await prisma.outreachCampaign.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: Number(limit),
        });
        res.json(campaigns);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATION — Bulk lead/session validation
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/outreach/validate-lead', async (req, res) => {
    try {
        const { leadId, skipSmtp = false, force = false } = req.body;
        if (!leadId) return res.status(400).json({ error: 'leadId required' });
        
        // Force: reset all emails to PENDING first so they get re-validated
        if (force) {
            await prisma.generatedEmail.updateMany({
                where: { leadId, pattern: { not: 'PROVIDED_EMAIL' } },
                data: { verificationStatus: 'PENDING', isVerified: false, validatedAt: null },
            });
        }
        
        const { validateLeadEmails } = require('../services/validation/bulkValidator');
        const result = await validateLeadEmails(leadId, { skipSmtp });
        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/outreach/validate-session', async (req, res) => {
    try {
        const { sessionId, skipSmtp = false, force = false } = req.body;
        if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
        
        // Force: reset all emails in session to PENDING
        if (force) {
            const leads = await prisma.lead.findMany({ where: { sessionId }, select: { id: true } });
            const leadIds = leads.map(l => l.id);
            if (leadIds.length > 0) {
                await prisma.generatedEmail.updateMany({
                    where: { leadId: { in: leadIds }, pattern: { not: 'PROVIDED_EMAIL' } },
                    data: { verificationStatus: 'PENDING', isVerified: false, validatedAt: null },
                });
            }
        }
        
        const { validateSession } = require('../services/validation/bulkValidator');
        const result = await validateSession(sessionId, { skipSmtp });
        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Force validate ALL pending emails across all sessions
router.post('/outreach/validate-all', async (req, res) => {
    try {
        const { force = false } = req.body;
        const { enqueueAllPending } = require('../services/validation/validationQueue');
        
        // Respond immediately — do the work in background
        res.json({ ok: true, message: force ? 'Resetting and re-validating all emails...' : 'Validating pending emails...' });
        
        // Background: reset + enqueue
        setImmediate(async () => {
            try {
                if (force) {
                    await prisma.generatedEmail.updateMany({
                        where: { pattern: { not: 'PROVIDED_EMAIL' } },
                        data: { verificationStatus: 'PENDING', isVerified: false, validatedAt: null },
                    });
                    console.log('[validate-all] Reset complete, enqueuing...');
                }
                await enqueueAllPending();
            } catch (e) {
                console.error('[validate-all] Background error:', e.message);
            }
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// FOLLOW-UPS
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/outreach/follow-ups/schedule', async (req, res) => {
    try {
        const { campaignId } = req.body;
        if (!campaignId) return res.status(400).json({ error: 'campaignId required' });
        const { scheduleFollowUps } = require('../services/mail/followUpProcessor');
        const result = await scheduleFollowUps(campaignId);
        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/outreach/follow-ups/process', async (_req, res) => {
    try {
        const { processDueFollowUps } = require('../services/mail/followUpProcessor');
        const result = await processDueFollowUps();
        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/outreach/follow-ups', async (req, res) => {
    try {
        const { campaignId, status, limit = 50 } = req.query;
        const where = {};
        if (campaignId) where.campaignId = campaignId;
        if (status) where.status = status;
        const followUps = await prisma.followUp.findMany({
            where,
            orderBy: { scheduledFor: 'asc' },
            take: Number(limit),
        });
        res.json(followUps);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// MANUAL FOLLOW-UP — Schedule a custom follow-up to specific sent emails
// ═══════════════════════════════════════════════════════════════════════════════

// POST /outreach/follow-ups/manual
// Schedule one or more follow-ups for specific previously-sent emails
// Body: {
//   sentEmailIds: ["abc", "def"],   // emails to follow up on
//   subject: "Re: ..."  (optional, defaults to "Re: <original>"),
//   body: "...",
//   scheduleType: "1d" | "2d" | "3d" | "5d" | "1w" | "2w" | "15d" | "custom",
//   customDate: "ISO string"  (only if scheduleType === "custom"),
//   threaded: true | false   (true = reply in same thread)
// }
router.post('/outreach/follow-ups/manual', async (req, res) => {
    try {
        const { sentEmailIds, subject, body, scheduleType, customDate, threaded = true } = req.body || {};

        if (!Array.isArray(sentEmailIds) || sentEmailIds.length === 0) {
            return res.status(400).json({ error: 'sentEmailIds (array) is required' });
        }
        if (!body || typeof body !== 'string') {
            return res.status(400).json({ error: 'body is required' });
        }

        // Resolve schedule date
        const scheduledFor = resolveScheduleDate(scheduleType, customDate);
        if (!scheduledFor) {
            return res.status(400).json({ error: 'Invalid scheduleType or customDate' });
        }

        // Fetch original sent emails
        const sentEmails = await prisma.sentEmail.findMany({
            where: { id: { in: sentEmailIds } },
            include: { lead: true },
        });

        if (sentEmails.length === 0) {
            return res.status(404).json({ error: 'No matching sent emails found' });
        }

        // Group leads by their session to determine if we should reuse or create new session
        const leadIds = sentEmails.map(s => s.leadId).filter(Boolean);
        const uniqueLeadIds = [...new Set(leadIds)];

        const created = [];
        for (const sent of sentEmails) {
            const finalSubject = (subject && subject.trim()) || `Re: ${sent.subject}`;
            const followUp = await prisma.followUp.create({
                data: {
                    campaignId: sent.campaignId || null,
                    leadId: sent.leadId || '',
                    sentEmailId: sent.id,
                    subject: finalSubject,
                    body,
                    scheduledFor,
                    status: 'SCHEDULED',
                },
            });
            created.push(followUp);
        }

        broadcast('followup:scheduled', { count: created.length, scheduledFor });
        res.json({ ok: true, scheduled: created.length, scheduledFor, followUps: created });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /outreach/follow-ups/:id/cancel
router.post('/outreach/follow-ups/:id/cancel', async (req, res) => {
    try {
        const followUp = await prisma.followUp.update({
            where: { id: req.params.id },
            data: { status: 'CANCELLED' },
        });
        broadcast('followup:cancelled', { id: followUp.id });
        res.json({ ok: true, followUp });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /outreach/follow-ups/:id/send-now
router.post('/outreach/follow-ups/:id/send-now', async (req, res) => {
    try {
        await prisma.followUp.update({
            where: { id: req.params.id },
            data: { scheduledFor: new Date() },
        });
        // Trigger immediate processing
        const { processDueFollowUps } = require('../services/mail/followUpProcessor');
        const result = await processDueFollowUps();
        res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /outreach/follow-ups/:id — edit scheduled follow-up
router.patch('/outreach/follow-ups/:id', async (req, res) => {
    try {
        const { subject, body, scheduleType, customDate } = req.body || {};
        const data = {};
        if (subject !== undefined) data.subject = subject;
        if (body !== undefined) data.body = body;
        if (scheduleType !== undefined) {
            const scheduledFor = resolveScheduleDate(scheduleType, customDate);
            if (scheduledFor) data.scheduledFor = scheduledFor;
        }
        const followUp = await prisma.followUp.update({
            where: { id: req.params.id },
            data,
        });
        res.json({ ok: true, followUp });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCHEDULED SEND (non-threaded delayed send to NEW recipients)
// ═══════════════════════════════════════════════════════════════════════════════

// POST /outreach/scheduled-send
// Body: {
//   leadIds: [...],
//   subject, body,
//   scheduleType, customDate,
//   templateUsed?
// }
router.post('/outreach/scheduled-send', async (req, res) => {
    try {
        const { leadIds, subject, body, scheduleType, customDate, templateUsed } = req.body || {};

        if (!Array.isArray(leadIds) || leadIds.length === 0) {
            return res.status(400).json({ error: 'leadIds is required' });
        }
        if (!subject || !body) {
            return res.status(400).json({ error: 'subject and body required' });
        }

        const scheduledFor = resolveScheduleDate(scheduleType, customDate);
        if (!scheduledFor) {
            return res.status(400).json({ error: 'Invalid schedule' });
        }

        // Fetch leads with their primary verified emails
        const leads = await prisma.lead.findMany({
            where: { id: { in: leadIds } },
            include: {
                emails: {
                    where: { OR: [{ isPrimary: true }, { verificationStatus: 'VALID' }] },
                    orderBy: [{ isPrimary: 'desc' }, { confidence: 'asc' }],
                    take: 1,
                },
            },
        });

        const queueJobs = [];
        for (const lead of leads) {
            const email = lead.emails[0];
            if (!email) continue;
            const job = await prisma.emailQueueJob.create({
                data: {
                    leadId: lead.id,
                    toEmail: email.email,
                    toName: lead.fullName,
                    subject,
                    htmlBody: body,
                    textBody: body.replace(/<[^>]*>/g, ''),
                    templateUsed: templateUsed || null,
                    scheduledFor,
                    status: 'PENDING',
                },
            });
            queueJobs.push(job);
        }

        broadcast('scheduled_send:created', { count: queueJobs.length, scheduledFor });
        res.json({ ok: true, scheduled: queueJobs.length, scheduledFor });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /outreach/scheduled-sends — List pending scheduled sends
router.get('/outreach/scheduled-sends', async (req, res) => {
    try {
        const jobs = await prisma.emailQueueJob.findMany({
            where: { status: 'PENDING', scheduledFor: { gt: new Date() } },
            orderBy: { scheduledFor: 'asc' },
            take: 100,
        });
        res.json(jobs);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// OUTREACH SESSIONS (groups of sent emails)
// ═══════════════════════════════════════════════════════════════════════════════

// GET /outreach/sessions — list outreach (send) sessions
router.get('/outreach/sessions', async (req, res) => {
    try {
        const { listOutreachSessions } = require('../services/outreach/outreachSessionManager');
        const sessions = await listOutreachSessions({ limit: Number(req.query.limit) || 50 });
        res.json(sessions);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /outreach/sessions/:id — outreach session details
router.get('/outreach/sessions/:id', async (req, res) => {
    try {
        const { getOutreachSessionDetails } = require('../services/outreach/outreachSessionManager');
        const details = await getOutreachSessionDetails(req.params.id);
        if (!details) return res.status(404).json({ error: 'Session not found' });
        res.json(details);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Helper: resolve schedule date ───────────────────────────────────────────
function resolveScheduleDate(scheduleType, customDate) {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const map = {
        '1h': 60 * 60 * 1000,
        '6h': 6 * 60 * 60 * 1000,
        '1d': day,
        '2d': 2 * day,
        '3d': 3 * day,
        '5d': 5 * day,
        '1w': 7 * day,
        '2w': 14 * day,
        '15d': 15 * day,
        '1m': 30 * day,
    };
    if (scheduleType === 'now') return new Date(now);
    if (scheduleType === 'custom') {
        if (!customDate) return null;
        const d = new Date(customDate);
        if (isNaN(d.getTime())) return null;
        return d;
    }
    const offset = map[scheduleType];
    return offset ? new Date(now + offset) : null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEBUG — Test Reply-To routing
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/debug/test-reply-to', async (req, res) => {
    try {
        const { to } = req.body;
        if (!to) return res.status(400).json({ error: 'to email required' });

        const { Resend } = require('resend');
        const resendDirect = new Resend(process.env.RESEND_API_KEY);
        const { MAIL_CONFIG } = require('../services/mail/resendClient');

        const payload = {
            from: MAIL_CONFIG.from,
            to: [to],
            replyTo: MAIL_CONFIG.replyTo,
            subject: 'Reply-To Routing Test — Click Reply to verify',
            html: `<div style="font-family: sans-serif; padding: 20px;">
                <h2>Reply-To Test</h2>
                <p>This email was sent from: <strong>${MAIL_CONFIG.from}</strong></p>
                <p>Reply-To is set to: <strong>${MAIL_CONFIG.replyTo}</strong></p>
                <p><strong>Click "Reply" on this email.</strong> The recipient field should auto-fill with: <code>${MAIL_CONFIG.replyTo}</code></p>
                <p>If it shows <code>${MAIL_CONFIG.fromEmail}</code> instead, the Reply-To header is not working.</p>
            </div>`,
        };

        console.log('[debug] Sending Reply-To test:', JSON.stringify({ from: payload.from, to: payload.to, replyTo: payload.replyTo }));

        const result = await resendDirect.emails.send(payload);
        res.json({ ok: true, payload: { from: payload.from, replyTo: payload.replyTo, to: payload.to }, resendResponse: result });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMPOSE & SEND — Gmail-style direct email sending with attachments
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/outreach/compose-send', composeUpload.array('attachments', 10), async (req, res) => {
    try {
        const { to, cc, bcc, subject, body } = req.body;
        if (!to || !subject || !body) return res.status(400).json({ error: 'to, subject, and body are required' });

        const { Resend } = require('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);

        // Build attachments array for Resend
        const attachments = (req.files || []).map(file => ({
            filename: file.originalname,
            content: file.buffer,
        }));

        // Parse CC and BCC (comma-separated)
        const ccList = cc ? cc.split(',').map(e => e.trim()).filter(Boolean) : undefined;
        const bccList = bcc ? bcc.split(',').map(e => e.trim()).filter(Boolean) : undefined;

        const result = await resend.emails.send({
            from: process.env.MAIL_FROM || 'jobs@vishwateja.online',
            to: to.split(',').map(e => e.trim()).filter(Boolean),
            cc: ccList,
            bcc: bccList,
            subject,
            html: body.replace(/\n/g, '<br>'),
            text: body,
            reply_to: process.env.MAIL_REPLY_TO || 'reply@vishwateja.online',
            attachments: attachments.length > 0 ? attachments : undefined,
        });

        // Store in DB
        for (const recipient of to.split(',').map(e => e.trim()).filter(Boolean)) {
            await prisma.sentEmail.create({
                data: {
                    toEmail: recipient,
                    subject,
                    htmlBody: body.replace(/\n/g, '<br>'),
                    textBody: body,
                    status: 'SENT',
                    sentAt: new Date(),
                    resendId: result.data?.id || null,
                },
            }).catch(() => {});
        }

        res.json({ ok: true, id: result.data?.id, message: 'Email sent successfully' });
    } catch (e) {
        console.error('[compose-send] Error:', e);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
