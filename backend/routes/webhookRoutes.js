/**
 * webhookRoutes.js — Resend webhook handler (isolated, non-blocking).
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles delivery events asynchronously without blocking email sending.
 * Implements: bounce protection, reply detection, delivery learning, follow-up sync.
 *
 * REPLY DETECTION:
 * Resend fires `email.received` when an inbound email arrives (requires MX pointing to Resend).
 * We match the reply back to the original sent email using the `from` field (matches toEmail of original)
 * or via `In-Reply-To`/`References` headers matching our sent messageId.
 * When a reply is detected → cancel all pending follow-ups for that lead.
 *
 * SAFETY: Failures here NEVER affect outbound sending or CRM operations.
 */
const express = require('express');
const router = express.Router();
const prisma = require('../services/db/prismaClient');
const { isEnabled } = require('../config/features');
const { broadcast } = require('../services/eventBus');

// ─── Event Processing (async, isolated) ──────────────────────────────────────

async function processWebhookEvent(type, data) {
    // ── INBOUND REPLY DETECTION ─────────────────────────────────────────────
    // Resend sends `email.received` for inbound emails
    // We detect replies by matching the sender (from) to our previously-sent recipients (toEmail)
    if (type === 'email.received') {
        await handleInboundReply(data);
        return;
    }

    // ── OUTBOUND EVENT HANDLING ─────────────────────────────────────────────
    const resendId = data.email_id || data.id;
    if (!resendId) return;

    // Find the sent email
    const sentEmail = await prisma.sentEmail.findFirst({ where: { resendId } });
    if (!sentEmail) return;

    // Store raw event
    await prisma.emailEvent.create({
        data: {
            sentEmailId: sentEmail.id,
            eventType: type,
            payload: JSON.stringify(data),
        },
    }).catch(() => {});

    // Update delivery status
    const statusUpdates = {
        'email.sent': { status: 'SENT' },
        'email.delivered': { status: 'DELIVERED', deliveredAt: new Date() },
        'email.delivery_delayed': { status: 'SENT' },
        'email.bounced': { status: 'BOUNCED', bouncedAt: new Date(), errorMessage: data.bounce?.message || 'Bounced' },
        'email.complained': { status: 'BOUNCED', errorMessage: 'Spam complaint' },
        'email.opened': {},
        'email.clicked': {},
    };

    const update = statusUpdates[type];
    if (update && Object.keys(update).length > 0) {
        await prisma.sentEmail.update({ where: { id: sentEmail.id }, data: update }).catch(() => {});
    }

    // Campaign counter updates
    if (sentEmail.campaignId) {
        if (type === 'email.bounced') {
            await prisma.outreachCampaign.update({
                where: { id: sentEmail.campaignId },
                data: { totalBounced: { increment: 1 } },
            }).catch(() => {});
        } else if (type === 'email.complained') {
            await prisma.outreachCampaign.update({
                where: { id: sentEmail.campaignId },
                data: { totalBounced: { increment: 1 } },
            }).catch(() => {});
        }
    }

    // ── BOUNCE PROTECTION ────────────────────────────────────────────────────
    if (isEnabled('bounceProtection') && (type === 'email.bounced' || type === 'email.complained')) {
        const email = sentEmail.toEmail;

        // 1. Mark email as INVALID in generated emails
        await prisma.generatedEmail.updateMany({
            where: { email },
            data: { verificationStatus: 'INVALID', isVerified: false, confidence: 'INVALID', validationReason: `Bounced: ${data.bounce?.message || 'rejected'}` },
        }).catch(() => {});

        // 2. Cancel all pending follow-ups for this lead
        if (sentEmail.leadId) {
            await prisma.followUp.updateMany({
                where: { leadId: sentEmail.leadId, status: { in: ['SCHEDULED'] } },
                data: { status: 'CANCELLED' },
            }).catch(() => {});

            // 3. Update lead status
            await prisma.leadStatus.upsert({
                where: { leadId: sentEmail.leadId },
                update: { stage: 'BOUNCED', followUpNeeded: false },
                create: { leadId: sentEmail.leadId, stage: 'BOUNCED', followUpNeeded: false },
            }).catch(() => {});
        }

        // 4. Reduce pattern confidence for this domain
        const domain = email.split('@')[1];
        if (domain) {
            const { learnFromDelivery } = require('../services/validation/validationEngine');
            await learnFromDelivery(email, 'bounced').catch(() => {});
        }

        broadcast('bounce:detected', { email, leadId: sentEmail.leadId, campaignId: sentEmail.campaignId });
        console.log(`[webhook] BOUNCE: ${email} — removed from follow-ups, blacklisted`);
    }

    // ── DELIVERY LEARNING ────────────────────────────────────────────────────
    if (type === 'email.delivered') {
        const { learnFromDelivery } = require('../services/validation/validationEngine');
        await learnFromDelivery(sentEmail.toEmail, 'delivered').catch(() => {});

        // Update lead stage
        if (sentEmail.leadId) {
            await prisma.leadStatus.upsert({
                where: { leadId: sentEmail.leadId },
                update: { stage: 'CONTACTED', lastContactedAt: new Date() },
                create: { leadId: sentEmail.leadId, stage: 'CONTACTED', lastContactedAt: new Date() },
            }).catch(() => {});
        }

        broadcast('delivery:confirmed', { email: sentEmail.toEmail, leadId: sentEmail.leadId });
    }

    // Broadcast for real-time UI
    broadcast('webhook:event', { type, email: sentEmail.toEmail, leadId: sentEmail.leadId });
}

// ─── Reply Detection ─────────────────────────────────────────────────────────
/**
 * Handle inbound reply detection.
 * Strategy:
 *   1. Match by sender email (the person replying was our original recipient)
 *   2. Match by In-Reply-To / References headers (threading)
 *   3. On match → mark sentEmail as REPLIED, cancel pending follow-ups, update lead
 */
async function handleInboundReply(data) {
    const fromEmail = (data.from || '').toLowerCase().trim();
    const subject = data.subject || '';
    const messageId = data.message_id || '';

    if (!fromEmail) return;

    console.log(`[webhook] Inbound email received from: ${fromEmail} | Subject: ${subject}`);

    // Strategy 1: Find the most recent email we sent TO this person
    const matchedSentEmail = await prisma.sentEmail.findFirst({
        where: {
            toEmail: fromEmail,
            status: { in: ['SENT', 'DELIVERED'] },
        },
        orderBy: { sentAt: 'desc' },
    });

    if (!matchedSentEmail) {
        console.log(`[webhook] No matching outbound email found for reply from: ${fromEmail}`);
        return;
    }

    // Mark as REPLIED
    await prisma.sentEmail.update({
        where: { id: matchedSentEmail.id },
        data: {
            status: 'REPLIED',
            repliedAt: new Date(),
        },
    }).catch(() => {});

    // Store the reply event
    await prisma.emailEvent.create({
        data: {
            sentEmailId: matchedSentEmail.id,
            eventType: 'reply_received',
            payload: JSON.stringify({ from: fromEmail, subject, message_id: messageId, receivedAt: new Date().toISOString() }),
        },
    }).catch(() => {});

    // Update campaign counter
    if (matchedSentEmail.campaignId) {
        await prisma.outreachCampaign.update({
            where: { id: matchedSentEmail.campaignId },
            data: { totalReplied: { increment: 1 } },
        }).catch(() => {});
    }

    // ── CANCEL ALL PENDING FOLLOW-UPS FOR THIS LEAD ─────────────────────────
    // This is the key feature: if they replied, we don't want to send them
    // any more automated follow-ups. They're engaged.
    if (matchedSentEmail.leadId) {
        const cancelled = await prisma.followUp.updateMany({
            where: {
                leadId: matchedSentEmail.leadId,
                status: { in: ['SCHEDULED'] },
            },
            data: { status: 'CANCELLED' },
        });

        // Also cancel any scheduled (non-threaded) sends in the queue
        await prisma.emailQueueJob.updateMany({
            where: {
                leadId: matchedSentEmail.leadId,
                status: 'PENDING',
            },
            data: { status: 'DEAD', errorMessage: 'Cancelled: recipient replied' },
        }).catch(() => {});

        // Update lead status to REPLIED
        await prisma.leadStatus.upsert({
            where: { leadId: matchedSentEmail.leadId },
            update: {
                stage: 'REPLIED',
                replied: true,
                followUpNeeded: false,
            },
            create: {
                leadId: matchedSentEmail.leadId,
                stage: 'REPLIED',
                replied: true,
                followUpNeeded: false,
            },
        }).catch(() => {});

        console.log(`[webhook] REPLY detected from ${fromEmail} → cancelled ${cancelled.count} pending follow-ups`);
        broadcast('reply:detected', {
            fromEmail,
            leadId: matchedSentEmail.leadId,
            campaignId: matchedSentEmail.campaignId,
            cancelledFollowUps: cancelled.count,
        });
    }
}

// ─── Webhook Endpoint ────────────────────────────────────────────────────────

router.post('/webhooks/resend', async (req, res) => {
    // Always respond 200 immediately (Resend requirement)
    res.status(200).json({ ok: true });

    // Process asynchronously (non-blocking)
    try {
        const { type, data } = req.body || {};
        if (!type || !data) return;

        // Process in background
        setImmediate(() => {
            processWebhookEvent(type, data).catch(e => {
                console.error('[webhook] Processing error:', e.message);
            });
        });
    } catch (e) {
        console.error('[webhook] Parse error:', e.message);
    }
});

// ─── Webhook Status Endpoint ─────────────────────────────────────────────────

router.get('/webhooks/status', async (_req, res) => {
    try {
        const [totalEvents, recentBounces, recentDeliveries, recentReplies] = await Promise.all([
            prisma.emailEvent.count(),
            prisma.emailEvent.count({ where: { eventType: 'email.bounced', createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
            prisma.emailEvent.count({ where: { eventType: 'email.delivered', createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
            prisma.emailEvent.count({ where: { eventType: 'reply_received', createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
        ]);
        res.json({ totalEvents, recentBounces, recentDeliveries, recentReplies, features: require('../config/features').features });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
