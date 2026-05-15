/**
 * analyticsService.js — Real PostgreSQL aggregate analytics via Prisma.
 * ZERO mock data. Every number comes from the database.
 */
const prisma = require('../db/prismaClient');

async function getOverviewStats() {
    const [totalLeads, totalSessions, totalCompanies, totalEmails, emailStats, totalExports] = await Promise.all([
        prisma.lead.count(),
        prisma.session.count(),
        prisma.company.count(),
        prisma.generatedEmail.count(),
        prisma.generatedEmail.groupBy({
            by: ['verificationStatus'],
            _count: { verificationStatus: true }
        }),
        prisma.sheetExport.count({ where: { status: 'SUCCESS' } }),
    ]);

    const emailMap = {};
    for (const e of emailStats) emailMap[e.verificationStatus] = e._count.verificationStatus;

    const verified = emailMap['VALID'] || 0;
    const invalid = emailMap['INVALID'] || 0;
    const risky = (emailMap['RISKY'] || 0) + (emailMap['CATCH_ALL'] || 0);
    const pending = emailMap['PENDING'] || 0;
    const verificationRate = totalEmails > 0 ? Math.round((verified / totalEmails) * 100) : 0;

    // Count recruiter-tagged leads
    const recruiterCount = await prisma.lead.count({
        where: {
            role: { contains: 'recruit', mode: 'insensitive' }
        }
    }).catch(() => 0);

    return {
        totalLeads,
        totalSessions,
        totalCompanies,
        totalEmails,
        verifiedEmails: verified,
        invalidEmails: invalid,
        riskyEmails: risky,
        pendingEmails: pending,
        verificationRate,
        recruiterCount,
        totalExports,
    };
}

async function getVerificationBreakdown() {
    const stats = await prisma.generatedEmail.groupBy({
        by: ['verificationStatus'],
        _count: { verificationStatus: true }
    });
    return stats.map(s => ({
        status: s.verificationStatus,
        count: s._count.verificationStatus
    }));
}

async function getCompanyBreakdown() {
    const companies = await prisma.company.findMany({
        include: {
            _count: { select: { leads: true } },
            leads: {
                include: { emails: { where: { verificationStatus: 'VALID' }, select: { id: true } } }
            }
        },
        orderBy: { leadCount: 'desc' },
        take: 20,
    });

    return companies.map(c => ({
        id: c.id,
        name: c.companyName,
        domain: c.domain,
        learnedPattern: c.learnedPattern,
        leadCount: c._count.leads,
        verifiedCount: c.leads.reduce((sum, l) => sum + l.emails.length, 0),
    }));
}

async function getSessionTrends() {
    const sessions = await prisma.session.findMany({
        orderBy: { createdAt: 'asc' },
        take: 30,
        select: {
            id: true,
            sessionName: true,
            totalProfiles: true,
            totalEmails: true,
            totalVerified: true,
            createdAt: true,
            _count: { select: { leads: true, exports: true } },
        }
    });
    return sessions.map(s => ({
        id: s.id,
        name: s.sessionName,
        profiles: s._count.leads,
        emails: s.totalEmails,
        verified: s.totalVerified,
        exports: s._count.exports,
        date: s.createdAt,
    }));
}

async function getRecruiterInsights() {
    const RECRUITER_KEYWORDS = ['recruit', 'talent', 'hiring', 'hr ', 'human resource', 'acquisition', 'staffing', 'headhunt'];
    const conditions = RECRUITER_KEYWORDS.map(kw => ({ role: { contains: kw, mode: 'insensitive' } }));

    const recruiters = await prisma.lead.findMany({
        where: { OR: conditions },
        include: {
            company: { select: { companyName: true, domain: true } },
            emails: { where: { verificationStatus: 'VALID' }, select: { email: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
    });

    // Group by company
    const companyMap = {};
    for (const r of recruiters) {
        const cn = r.company?.companyName || 'Unknown';
        if (!companyMap[cn]) companyMap[cn] = { company: cn, domain: r.company?.domain, count: 0, verified: 0 };
        companyMap[cn].count++;
        companyMap[cn].verified += r.emails.length;
    }

    return {
        totalRecruiters: recruiters.length,
        recruiters: recruiters.map(r => ({
            id: r.id,
            fullName: r.fullName,
            role: r.role,
            company: r.company?.companyName,
            domain: r.company?.domain,
            verifiedEmails: r.emails.map(e => e.email),
        })),
        byCompany: Object.values(companyMap).sort((a, b) => b.count - a.count),
    };
}

async function getCompanyStats() {
    return getCompanyBreakdown();
}

async function getSessionStats() {
    return prisma.session.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
            _count: { select: { leads: true, exports: true } }
        }
    });
}

module.exports = {
    getOverviewStats,
    getVerificationBreakdown,
    getCompanyBreakdown,
    getSessionTrends,
    getRecruiterInsights,
    getCompanyStats,
    getSessionStats,
};
