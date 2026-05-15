/**
 * webhookRoutes.js — Resend webhook handler (isolated, non-blocking).
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles delivery events asynchronously without blocking email sending.
 * Implements: bounce protection, delivery learning, follow-up sync.
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
        const [totalEvents, recentBounces, recentDeliveries] = await Promise.all([
            prisma.emailEvent.count(),
            prisma.emailEvent.count({ where: { eventType: 'email.bounced', createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
            prisma.emailEvent.count({ where: { eventType: 'email.delivered', createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
        ]);
        res.json({ totalEvents, recentBounces, recentDeliveries, features: require('../config/features').features });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
