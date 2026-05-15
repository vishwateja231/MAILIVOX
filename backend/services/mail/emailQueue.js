/**
 * emailQueue.js — In-process email queue with sequential processing.
 * ─────────────────────────────────────────────────────────────────────────────
 * Uses PostgreSQL (EmailQueueJob table) as the queue store.
 * Processes jobs one at a time with configurable delays.
 * Supports: pause/resume, retry, dead-letter, scheduling.
 *
 * No external Redis/BullMQ needed — keeps deployment simple.
 */
const prisma = require('../db/prismaClient');
const { sendEmail } = require('./resendClient');
const { broadcast } = require('../eventBus');

let isRunning = false;
let isPaused = false;
let processingInterval = null;
const POLL_INTERVAL_MS = 10_000; // Check for new jobs every 10s
const MIN_DELAY_MS = 4000;
const MAX_DELAY_MS = 12000;

/**
 * Add a job to the email queue.
 */
async function enqueue(opts) {
    const {
        campaignId, leadId, toEmail, toName,
        subject, htmlBody, textBody, templateUsed,
        priority = 0, scheduledFor, maxRetries = 3,
    } = opts;

    const job = await prisma.emailQueueJob.create({
        data: {
            campaignId: campaignId || null,
            leadId: leadId || null,
            toEmail,
            toName: toName || null,
            subject,
            htmlBody,
            textBody: textBody || null,
            templateUsed: templateUsed || null,
            priority,
            scheduledFor: scheduledFor || new Date(),
            maxRetries,
        },
    });

    broadcast('queue:job_added', { jobId: job.id, toEmail, subject });
    return job;
}

/**
 * Enqueue multiple jobs at once.
 */
async function enqueueBatch(jobs) {
    const results = [];
    for (const job of jobs) {
        results.push(await enqueue(job));
    }
    broadcast('queue:batch_enqueued', { count: results.length });
    return results;
}

/**
 * Process the next pending job.
 */
async function processNext() {
    if (isPaused) return null;

    // Find the next job that's ready to send
    const job = await prisma.emailQueueJob.findFirst({
        where: {
            status: 'PENDING',
            scheduledFor: { lte: new Date() },
        },
        orderBy: [
            { priority: 'desc' },
            { scheduledFor: 'asc' },
            { createdAt: 'asc' },
        ],
    });

    if (!job) return null;

    // Mark as processing
    await prisma.emailQueueJob.update({
        where: { id: job.id },
        data: { status: 'PROCESSING' },
    });

    broadcast('queue:job_processing', { jobId: job.id, toEmail: job.toEmail });

    try {
        const result = await sendEmail({
            to: job.toEmail,
            toName: job.toName,
            subject: job.subject,
            html: job.htmlBody,
            text: job.textBody,
            campaignId: job.campaignId,
            leadId: job.leadId,
            templateUsed: job.templateUsed,
            maxRetries: 0, // We handle retries at queue level
        });

        if (result.success) {
            await prisma.emailQueueJob.update({
                where: { id: job.id },
                data: { status: 'COMPLETED', processedAt: new Date() },
            });
            broadcast('queue:job_completed', { jobId: job.id, toEmail: job.toEmail });
        } else {
            throw new Error(result.error || 'Send failed');
        }
    } catch (err) {
        const newRetries = job.retries + 1;
        const isDead = newRetries >= job.maxRetries;

        await prisma.emailQueueJob.update({
            where: { id: job.id },
            data: {
                status: isDead ? 'DEAD' : 'PENDING',
                retries: newRetries,
                errorMessage: err.message,
                // If not dead, schedule retry with backoff
                scheduledFor: isDead ? undefined : new Date(Date.now() + Math.pow(2, newRetries) * 30_000),
            },
        });

        broadcast(isDead ? 'queue:job_dead' : 'queue:job_retry', {
            jobId: job.id,
            toEmail: job.toEmail,
            error: err.message,
            retries: newRetries,
        });
    }

    return job;
}

/**
 * Start the queue processor loop.
 */
function start() {
    if (isRunning) return;
    isRunning = true;
    isPaused = false;
    console.log('[emailQueue] Started');
    broadcast('queue:started', {});

    processingInterval = setInterval(async () => {
        if (isPaused) return;
        try {
            const job = await processNext();
            if (job) {
                // Random delay before next job
                const delay = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
                await new Promise(r => setTimeout(r, delay));
            }
        } catch (err) {
            console.error('[emailQueue] Processing error:', err.message);
        }
    }, POLL_INTERVAL_MS);
}

/**
 * Pause the queue.
 */
function pause() {
    isPaused = true;
    broadcast('queue:paused', {});
    console.log('[emailQueue] Paused');
}

/**
 * Resume the queue.
 */
function resume() {
    isPaused = false;
    broadcast('queue:resumed', {});
    console.log('[emailQueue] Resumed');
}

/**
 * Stop the queue processor.
 */
function stop() {
    isRunning = false;
    isPaused = false;
    if (processingInterval) {
        clearInterval(processingInterval);
        processingInterval = null;
    }
    broadcast('queue:stopped', {});
    console.log('[emailQueue] Stopped');
}

/**
 * Get queue stats.
 */
async function getQueueStats() {
    const [pending, processing, completed, failed, dead] = await Promise.all([
        prisma.emailQueueJob.count({ where: { status: 'PENDING' } }),
        prisma.emailQueueJob.count({ where: { status: 'PROCESSING' } }),
        prisma.emailQueueJob.count({ where: { status: 'COMPLETED' } }),
        prisma.emailQueueJob.count({ where: { status: 'FAILED' } }),
        prisma.emailQueueJob.count({ where: { status: 'DEAD' } }),
    ]);
    return { pending, processing, completed, failed, dead, isRunning, isPaused };
}

/**
 * Retry all dead-letter jobs.
 */
async function retryDead() {
    const result = await prisma.emailQueueJob.updateMany({
        where: { status: 'DEAD' },
        data: { status: 'PENDING', retries: 0, errorMessage: null, scheduledFor: new Date() },
    });
    broadcast('queue:dead_retried', { count: result.count });
    return result.count;
}

/**
 * Clear completed jobs older than N hours.
 */
async function clearCompleted(hoursOld = 24) {
    const cutoff = new Date(Date.now() - hoursOld * 60 * 60 * 1000);
    const result = await prisma.emailQueueJob.deleteMany({
        where: { status: 'COMPLETED', processedAt: { lt: cutoff } },
    });
    return result.count;
}

module.exports = {
    enqueue,
    enqueueBatch,
    processNext,
    start,
    pause,
    resume,
    stop,
    getQueueStats,
    retryDead,
    clearCompleted,
};
