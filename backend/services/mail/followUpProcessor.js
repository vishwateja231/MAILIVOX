/**
 * followUpProcessor.js — Automated follow-up scheduling and sending.
 * ─────────────────────────────────────────────────────────────────────────────
 * Checks for leads that need follow-ups based on campaign settings.
 * Respects: reply detection, follow-up count limits, scheduling.
 */
const prisma = require('../db/prismaClient');
const { sendEmail } = require('./resendClient');
const { broadcast } = require('../eventBus');

const FOLLOW_UP_CHECK_INTERVAL = 5 * 60 * 1000; // Check every 5 minutes

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
 * CRITICAL: Before sending each follow-up, re-check if the lead has replied.
 * If they replied after the follow-up was scheduled, cancel it instead of sending.
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
    let cancelled = 0;
    for (const followUp of due) {
        try {
            // ── REPLY CHECK: Has this lead replied since scheduling? ──────────
            // This is the safety net — even if the webhook missed the reply event,
            // we double-check right before sending.
            if (followUp.leadId) {
                const leadStatus = await prisma.leadStatus.findUnique({
                    where: { leadId: followUp.leadId },
                });
                if (leadStatus?.replied) {
                    await prisma.followUp.update({ where: { id: followUp.id }, data: { status: 'CANCELLED' } });
                    cancelled++;
                    console.log(`[followUp] Cancelled for lead ${followUp.leadId} — already replied`);
                    continue;
                }

                // Also check if any sentEmail to this lead has REPLIED status
                const hasReply = await prisma.sentEmail.findFirst({
                    where: { leadId: followUp.leadId, status: 'REPLIED' },
                });
                if (hasReply) {
                    await prisma.followUp.update({ where: { id: followUp.id }, data: { status: 'CANCELLED' } });
                    // Also mark leadStatus as replied
                    await prisma.leadStatus.upsert({
                        where: { leadId: followUp.leadId },
                        update: { replied: true, stage: 'REPLIED', followUpNeeded: false },
                        create: { leadId: followUp.leadId, replied: true, stage: 'REPLIED', followUpNeeded: false },
                    }).catch(() => {});
                    cancelled++;
                    console.log(`[followUp] Cancelled for lead ${followUp.leadId} — reply found in sentEmails`);
                    continue;
                }
            }

            // Get the original recipient
            const originalEmail = await prisma.sentEmail.findUnique({
                where: { id: followUp.sentEmailId || '' },
                select: { toEmail: true, toName: true, resendId: true, messageId: true },
            });

            if (!originalEmail) {
                await prisma.followUp.update({ where: { id: followUp.id }, data: { status: 'SKIPPED' } });
                continue;
            }

            // Send follow-up with threading headers
            const { renderEmail } = require('../outreach/renderEmail');
            const rendered = renderEmail({ subject: followUp.subject, body: followUp.body, vars: {} });

            const sendOpts = {
                to: originalEmail.toEmail,
                toName: originalEmail.toName,
                subject: followUp.subject,
                html: rendered.html,
                text: rendered.text,
                campaignId: followUp.campaignId,
                leadId: followUp.leadId,
            };

            // Add threading headers for same-thread delivery (Gmail/Outlook will group them)
            if (originalEmail.resendId || originalEmail.messageId) {
                const refId = originalEmail.messageId || `<${originalEmail.resendId}@resend.dev>`;
                sendOpts.headers = {
                    'In-Reply-To': refId,
                    'References': refId,
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

    if (sent > 0 || cancelled > 0) {
        broadcast('followup:processed', { sent, cancelled, total: due.length });
    }
    return { processed: due.length, sent, cancelled };
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
