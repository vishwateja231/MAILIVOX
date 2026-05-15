/**
 * followUpProcessor.js — Automated follow-up scheduling and sending.
 * ─────────────────────────────────────────────────────────────────────────────
 * Checks for leads that need follow-ups based on campaign settings.
 * Respects: reply detection, follow-up count limits, scheduling.
 */
const prisma = require('../db/prismaClient');
const { sendEmail } = require('./resendClient');
const { broadcast } = require('../eventBus');

const FOLLOW_UP_CHECK_INTERVAL = 60 * 60 * 1000; // Check every hour

/**
 * Schedule follow-ups for a campaign's sent emails that haven't received replies.
 */
async function scheduleFollowUps(campaignId) {
    const campaign = await prisma.outreachCampaign.findUnique({ where: { id: campaignId } });
    if (!campaign || !campaign.followUpEnabled) return { scheduled: 0 };

    const delayMs = (campaign.followUpDelay || 3) * 24 * 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - delayMs);

    // Find sent emails that: were sent before cutoff, haven't been replied to, don't have a follow-up already
    const eligibleEmails = await prisma.sentEmail.findMany({
        where: {
            campaignId,
            status: { in: ['SENT', 'DELIVERED'] },
            sentAt: { lt: cutoff },
            repliedAt: null,
        },
        include: { lead: { include: { status: true } } },
    });

    let scheduled = 0;
    for (const sent of eligibleEmails) {
        // Skip if lead already replied or has too many follow-ups
        if (sent.lead?.status?.replied) continue;
        if ((sent.lead?.status?.followUpCount || 0) >= 2) continue;

        // Check if follow-up already exists for this email
        const existing = await prisma.followUp.findFirst({
            where: { campaignId, leadId: sent.leadId, sentEmailId: sent.id },
        });
        if (existing) continue;

        // Create follow-up
        const followUpBody = campaign.followUpBody || `Hi,\n\nJust following up on my previous message. Would love to connect if you have a moment.\n\nBest,\nVishwa Teja`;

        await prisma.followUp.create({
            data: {
                campaignId,
                leadId: sent.leadId || '',
                sentEmailId: sent.id,
                subject: `Re: ${sent.subject}`,
                body: followUpBody,
                scheduledFor: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
            },
        });

        scheduled++;
    }

    broadcast('followup:scheduled', { campaignId, scheduled });
    return { scheduled };
}

/**
 * Process due follow-ups.
 */
async function processDueFollowUps() {
    const due = await prisma.followUp.findMany({
        where: {
            status: 'SCHEDULED',
            scheduledFor: { lte: new Date() },
        },
        include: {
            campaign: true,
        },
        take: 10,
    });

    let sent = 0;
    for (const followUp of due) {
        try {
            // Get the original recipient
            const originalEmail = await prisma.sentEmail.findUnique({
                where: { id: followUp.sentEmailId || '' },
                select: { toEmail: true, toName: true },
            });

            if (!originalEmail) {
                await prisma.followUp.update({ where: { id: followUp.id }, data: { status: 'SKIPPED' } });
                continue;
            }

            // Check if lead replied since scheduling
            const lead = await prisma.lead.findFirst({
                where: { id: followUp.leadId },
                include: { status: true },
            });
            if (lead?.status?.replied) {
                await prisma.followUp.update({ where: { id: followUp.id }, data: { status: 'CANCELLED' } });
                continue;
            }

            // Send follow-up with threading headers
            const { renderEmail } = require('../outreach/renderEmail');
            const rendered = renderEmail({ subject: followUp.subject, body: followUp.body, vars: {} });

            // Get original email's threading info for same-thread delivery
            const originalSent = followUp.sentEmailId
                ? await prisma.sentEmail.findUnique({ where: { id: followUp.sentEmailId }, select: { resendId: true, messageId: true } })
                : null;

            const sendOpts = {
                to: originalEmail.toEmail,
                toName: originalEmail.toName,
                subject: followUp.subject,
                html: rendered.html,
                text: rendered.text,
                campaignId: followUp.campaignId,
                leadId: followUp.leadId,
            };

            // Add threading headers if original message exists
            if (originalSent?.resendId) {
                sendOpts.headers = {
                    'In-Reply-To': `<${originalSent.resendId}@resend.dev>`,
                    'References': `<${originalSent.resendId}@resend.dev>`,
                };
            }

            const result = await sendEmail(sendOpts);

            if (result.success) {
                await prisma.followUp.update({ where: { id: followUp.id }, data: { status: 'SENT', sentAt: new Date() } });
                // Update lead status
                await prisma.leadStatus.upsert({
                    where: { leadId: followUp.leadId },
                    update: { stage: 'FOLLOW_UP_SENT', followUpCount: { increment: 1 }, lastContactedAt: new Date() },
                    create: { leadId: followUp.leadId, stage: 'FOLLOW_UP_SENT', followUpCount: 1, lastContactedAt: new Date() },
                }).catch(() => {});
                sent++;
            }
        } catch (e) {
            console.error('[followUp] Error:', e.message);
        }

        // Delay between follow-ups
        await new Promise(r => setTimeout(r, 5000));
    }

    if (sent > 0) broadcast('followup:sent', { count: sent });
    return { processed: due.length, sent };
}

/**
 * Start the follow-up processor loop.
 */
let followUpInterval = null;
function startFollowUpProcessor() {
    if (followUpInterval) return;
    followUpInterval = setInterval(processDueFollowUps, FOLLOW_UP_CHECK_INTERVAL);
    console.log('[followUp] Processor started (checks every hour)');
}

function stopFollowUpProcessor() {
    if (followUpInterval) { clearInterval(followUpInterval); followUpInterval = null; }
}

module.exports = { scheduleFollowUps, processDueFollowUps, startFollowUpProcessor, stopFollowUpProcessor };
