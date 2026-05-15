/**
 * logger.js — Centralized logging service that writes to DB + console.
 */
const prisma = require('../db/prismaClient');

const LEVELS = { info: 'info', warn: 'warn', error: 'error', success: 'success' };

async function log(message, level = 'info', sessionId = null) {
    const levelStr = LEVELS[level] || 'info';
    const prefix = { info: '›', warn: '⚠', error: '✖', success: '✔' }[levelStr] || '›';
    console.log(`[${levelStr.toUpperCase()}] ${prefix} ${message}`);

    try {
        await prisma.processingLog.create({
            data: { message, level: levelStr, sessionId: sessionId || undefined }
        });
    } catch (_) {
        // Don't crash if DB is unreachable — just log to console
    }
}

const logger = {
    info: (msg, sessionId) => log(msg, 'info', sessionId),
    warn: (msg, sessionId) => log(msg, 'warn', sessionId),
    error: (msg, sessionId) => log(msg, 'error', sessionId),
    success: (msg, sessionId) => log(msg, 'success', sessionId),
};

module.exports = logger;
