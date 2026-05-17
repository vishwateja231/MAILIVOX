/**
 * outreachSessionManager.js — Manages "outreach sessions" — groups of sent emails.
 *
 * An outreach session represents a single send operation (a campaign run).
 * When the user sends a follow-up:
 *   - If they're following up to ALL recipients of session X → reuse session X
 *   - If they're following up to a SUBSET of session X → create a new "child" session
 *
 * Outreach sessions are stored in the existing Session model with a special
 * sessionName prefix: "outreach_<timestamp>_<label>"
 */
const prisma = require('../db/prismaClient');

const OUTREACH_SESSION_PREFIX = 'outreach_';

/**
 * Create or reuse an outreach session for a set of leads.
 * @param {object} opts
 * @param {string[]} opts.leadIds - lead IDs being targeted in this send
 * @param {string} [opts.parentSessionId] - if this is a follow-up of a previous send
 * @param {string} [opts.label] - human-friendly label
 * @returns {Promise<{ sessionId: string, sessionName: string, reused: boolean }>}
 */
async function getOrCreateOutreachSession({ leadIds, parentSessionId = null, label = '' }) {
    if (!Array.isArray(leadIds) || leadIds.length === 0) {
        throw new Error('leadIds is required and must be non-empty');
    }

    // Sort lead IDs to compare consistently
    const sortedIds = [...leadIds].sort();

    // Try to reuse parent session if all leads match
    if (parentSessionId) {
        const parent = await prisma.session.findUnique({
            where: { id: parentSessionId },
            include: { leads: { select: { id: true } } },
        });
        if (parent) {
            const parentLeadIds = parent.leads.map(l => l.id).sort();
            const sameLeads =
                parentLeadIds.length === sortedIds.length &&
                parentLeadIds.every((id, i) => id === sortedIds[i]);

            if (sameLeads) {
                // Same set of leads — reuse the session
                return {
                    sessionId: parent.id,
                    sessionName: parent.sessionName,
                    reused: true,
                };
            }
        }
    }

    // Otherwise create a new outreach session with the same leads
    const ts = new Date();
    const sessionName = `${OUTREACH_SESSION_PREFIX}${ts.toISOString().replace(/[:.]/g, '-')}_${label || 'send'}`.slice(0, 200);

    const session = await prisma.session.create({
        data: {
            sessionName,
            totalProfiles: sortedIds.length,
            rawInput: JSON.stringify({
                source: 'outreach',
                parentSessionId,
                leadIds: sortedIds,
                createdAt: ts.toISOString(),
            }),
        },
    });

    return {
        sessionId: session.id,
        sessionName: session.sessionName,
        reused: false,
    };
}

/**
 * List all outreach sessions (sessions that came from sending emails, not from extraction).
 * Identified by sessionName prefix or by having sent emails associated.
 */
async function listOutreachSessions({ limit = 50 } = {}) {
    const sessions = await prisma.session.findMany({
        where: {
            OR: [
                { sessionName: { startsWith: OUTREACH_SESSION_PREFIX } },
                { rawInput: { contains: '"source":"outreach"' } },
            ],
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
            _count: { select: { leads: true } },
        },
    });

    // Enrich with sent email counts
    const enriched = await Promise.all(sessions.map(async (s) => {
        const sentCount = await prisma.sentEmail.count({
            where: { lead: { sessionId: s.id } },
        });
        const repliedCount = await prisma.sentEmail.count({
            where: { lead: { sessionId: s.id }, status: 'REPLIED' },
        });
        return {
            ...s,
            sentCount,
            repliedCount,
        };
    }));

    return enriched;
}

/**
 * Get full details of an outreach session, including sent emails.
 */
async function getOutreachSessionDetails(sessionId) {
    const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: {
            leads: {
                include: {
                    company: { select: { companyName: true, domain: true } },
                    sentEmails: {
                        orderBy: { sentAt: 'desc' },
                        take: 5,
                    },
                    status: true,
                },
            },
        },
    });

    if (!session) return null;

    return {
        id: session.id,
        sessionName: session.sessionName,
        createdAt: session.createdAt,
        leads: session.leads.map(lead => ({
            id: lead.id,
            fullName: lead.fullName,
            company: lead.company,
            role: lead.role,
            sentEmails: lead.sentEmails,
            replied: lead.status?.replied || false,
            outreachSent: lead.status?.outreachSent || false,
        })),
    };
}

module.exports = {
    getOrCreateOutreachSession,
    listOutreachSessions,
    getOutreachSessionDetails,
    OUTREACH_SESSION_PREFIX,
};
