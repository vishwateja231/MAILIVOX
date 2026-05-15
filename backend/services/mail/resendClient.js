/**
 * resendClient.js — Centralized Resend email service.
 * ─────────────────────────────────────────────────────────────────────────────
 * MAIL HEADERS:
 *   From:     Vishwa Teja <jobs@vishwateja.online>
 *   Reply-To: reply@vishwateja.online
 *
 * ALL outbound mail uses these headers. No exceptions.
 */
const { Resend } = require('resend');
const prisma = require('../db/prismaClient');
const { broadcast } = require('../eventBus');

const resend = new Resend(process.env.RESEND_API_KEY);

// ─── Centralized Mail Config (single source of truth) ────────────────────────
const MAIL_CONFIG = {
    senderName: process.env.MAILIVOX_FROM_NAME || 'Vishwa Teja',
    fromEmail: process.env.MAILIVOX_FROM_EMAIL || process.env.MAIL_FROM || 'jobs@vishwateja.online',
    replyTo: process.env.MAILIVOX_REPLY_TO || process.env.MAIL_REPLY_TO || 'reply@vishwateja.online',
};
MAIL_CONFIG.from = `${MAIL_CONFIG.senderName} <${MAIL_CONFIG.fromEmail}>`;

// Rate limiting
let sendCountThisMinute = 0;
const MAX_SENDS_PER_MINUTE = 8;

function resetMinuteCounter() {
    sendCountThisMinute = 0;
    setTimeout(resetMinuteCounter, 60_000);
}
resetMinuteCounter();

async function waitForCapacity() {
    while (sendCountThisMinute >= MAX_SENDS_PER_MINUTE) {
        await new Promise(r => setTimeout(r, 5000));
    }
}

/**
 * Send a single email via Resend with retry + exponential backoff.
 * @param {object} opts
 * @param {string} opts.to - recipient email
 * @param {string} opts.toName - recipient name (optional)
 * @param {string} opts.subject - email subject
 * @param {string} opts.html - HTML body
 * @param {string} opts.text - plain text fallback (optional)
 * @param {string} opts.campaignId - campaign ID (optional)
 * @param {string} opts.leadId - lead ID (optional)
 * @param {string} opts.templateUsed - template name (optional)
 * @param {number} opts.maxRetries - max retry attempts (default 3)
 * @returns {object} { success, resendId, sentEmailId, error }
 */
async function sendEmail(opts) {
    const {
        to, toName, subject, html, text,
        campaignId, leadId, templateUsed,
        headers = null,
        maxRetries = 3,
    } = opts;

    // Create SentEmail record
    const sentEmail = await prisma.sentEmail.create({
        data: {
            campaignId: campaignId || null,
            leadId: leadId || null,
            toEmail: to,
            toName: toName || null,
            fromEmail: MAIL_CONFIG.from,
            subject,
            htmlBody: html,
            textBody: text || null,
            templateUsed: templateUsed || null,
            status: 'QUEUED',
            maxRetries,
        },
    });

    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            await waitForCapacity();

            // CRITICAL: Resend SDK v6 uses camelCase 'replyTo' (NOT reply_to)
            const sendPayload = {
                from: MAIL_CONFIG.from,
                to: [to],
                replyTo: MAIL_CONFIG.replyTo,
                subject,
                html,
                text: text || undefined,
                ...(headers ? { headers } : {}),
            };

            console.log(`[mail] Sending to ${to} | From: ${MAIL_CONFIG.from} | Reply-To: ${MAIL_CONFIG.replyTo}${headers ? ' | Threaded' : ''}`);

            const result = await resend.emails.send(sendPayload);

            sendCountThisMinute++;

            if (result.error) {
                throw new Error(result.error.message || JSON.stringify(result.error));
            }

            // Success
            const resendId = result.data?.id || null;
            await prisma.sentEmail.update({
                where: { id: sentEmail.id },
                data: {
                    status: 'SENT',
                    resendId,
                    messageId: resendId ? `<${resendId}@resend.dev>` : null,
                    sentAt: new Date(),
                    retries: attempt,
                },
            });

            // Log event
            await prisma.emailEvent.create({
                data: {
                    sentEmailId: sentEmail.id,
                    eventType: 'sent',
                    payload: JSON.stringify({ resendId, attempt }),
                },
            });

            // Update campaign counters
            if (campaignId) {
                await prisma.outreachCampaign.update({
                    where: { id: campaignId },
                    data: { totalSent: { increment: 1 } },
                }).catch(() => {});
            }

            // Update lead status
            if (leadId) {
                await prisma.leadStatus.upsert({
                    where: { leadId },
                    update: { outreachSent: true },
                    create: { leadId, outreachSent: true },
                }).catch(() => {});
            }

            broadcast('email:sent', {
                sentEmailId: sentEmail.id,
                to,
                subject,
                campaignId,
                resendId,
            });

            return { success: true, resendId, sentEmailId: sentEmail.id };

        } catch (err) {
            lastError = err.message || 'Unknown error';
            console.error(`[resend] Attempt ${attempt + 1}/${maxRetries + 1} failed for ${to}:`, lastError);

            // Exponential backoff: 2s, 4s, 8s...
            if (attempt < maxRetries) {
                const delay = Math.pow(2, attempt + 1) * 1000;
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }

    // All retries exhausted
    await prisma.sentEmail.update({
        where: { id: sentEmail.id },
        data: {
            status: 'FAILED',
            errorMessage: lastError,
            retries: maxRetries,
        },
    });

    if (campaignId) {
        await prisma.outreachCampaign.update({
            where: { id: campaignId },
            data: { totalFailed: { increment: 1 } },
        }).catch(() => {});
    }

    broadcast('email:failed', {
        sentEmailId: sentEmail.id,
        to,
        error: lastError,
        campaignId,
    });

    return { success: false, error: lastError, sentEmailId: sentEmail.id };
}

/**
 * Send batch emails sequentially with randomized delays.
 * @param {Array} emails - array of sendEmail opts
 * @param {number} delayMinMs - min delay between sends (ms)
 * @param {number} delayMaxMs - max delay between sends (ms)
 * @returns {Array} results
 */
async function sendBatch(emails, delayMinMs = 3000, delayMaxMs = 8000) {
    const results = [];
    for (let i = 0; i < emails.length; i++) {
        const result = await sendEmail(emails[i]);
        results.push(result);

        if (i < emails.length - 1) {
            const delay = delayMinMs + Math.random() * (delayMaxMs - delayMinMs);
            await new Promise(r => setTimeout(r, delay));
        }
    }
    return results;
}

/**
 * Get sending stats.
 */
async function getMailStats() {
    const [total, sent, failed, bounced, replied] = await Promise.all([
        prisma.sentEmail.count(),
        prisma.sentEmail.count({ where: { status: 'SENT' } }),
        prisma.sentEmail.count({ where: { status: 'FAILED' } }),
        prisma.sentEmail.count({ where: { status: 'BOUNCED' } }),
        prisma.sentEmail.count({ where: { status: 'REPLIED' } }),
    ]);
    return { total, sent, failed, bounced, replied };
}

module.exports = {
    sendEmail,
    sendBatch,
    getMailStats,
    MAIL_CONFIG,
};
