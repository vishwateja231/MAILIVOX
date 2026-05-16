require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const parseRoutes = require('./routes/parseRoutes');
const dataRoutes = require('./routes/dataRoutes');
const exportRoutes = require('./routes/exportRoutes');
const extensionRoutes = require('./routes/extensionRoutes');
const outreachRoutes = require('./routes/outreachRoutes');
const assetsRoutes = require('./routes/assetsRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const importRoutes = require('./routes/importRoutes');
const authRoutes = require('./routes/authRoutes');
const emailQueue = require('./services/mail/emailQueue');
const { startFollowUpProcessor } = require('./services/mail/followUpProcessor');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Security ──────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ─── Auth Routes (before rate limiter) ─────────────────────────────────────────
app.use('/api', authRoutes);

// ─── Rate Limiting ─────────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
});
app.use('/api', apiLimiter);

// Stricter limit for email sending
const emailLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { error: 'Email rate limit exceeded. Max 10 sends per minute.' },
});
app.use('/api/outreach/send', emailLimiter);

// ─── Routes ────────────────────────────────────────────────────────────────────
app.use('/api', parseRoutes);      // parse + generate + verify + bulk stream
app.use('/api', dataRoutes);       // leads, companies, sessions, analytics, logs
app.use('/api', exportRoutes);     // CSV/XLSX/JSON export + Google Sheets sync
app.use('/api', extensionRoutes);  // Chrome extension: /leads/process + SSE /events/stream
app.use('/api', outreachRoutes);   // Outreach: campaigns, send, queue, AI, templates, webhooks
app.use('/api', assetsRoutes);    // User assets: resumes, profiles, signatures
app.use('/api', webhookRoutes);   // Resend webhooks (isolated, non-blocking)
app.use('/api', importRoutes);    // File import: CSV, Excel, PDF, DOC

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
    console.error('[server] Unhandled error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`\n🚀 Mailivox — Outreach Intelligence Platform`);
    console.log(`   Backend:  http://localhost:${PORT}`);
    console.log(`   DB:       Supabase PostgreSQL (Prisma v5)`);
    console.log(`   Mail:     Resend (${process.env.MAIL_FROM || 'not configured'})`);
    console.log(`   Queue:    Delivery queue ready\n`);

    // Auto-start processors
    emailQueue.start();
    startFollowUpProcessor();

    // Start the validation queue (processes emails in parallel as they arrive)
    const { enqueueAllPending } = require('./services/validation/validationQueue');
    setImmediate(() => enqueueAllPending());
});

// Validation is now handled by the validationQueue service
// which processes emails in parallel as they're generated.
