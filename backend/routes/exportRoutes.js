/**
 * exportRoutes.js — CSV/XLSX/JSON exports + complete Google Sheets sync system.
 * ALL data from PostgreSQL. ZERO mock responses.
 */
const express = require('express');
const router = express.Router();
const prisma = require('../services/db/prismaClient');
const { toCSV, toXLSX, flattenLeads } = require('../services/exports/exportService');
const {
    validateCredentials, createSheet,
    clearSheet, syncToSheet, getSheetMetadata, getDebugStatus,
} = require('../services/sheets/googleSheets');

async function fetchLeads(sessionId) {
    return prisma.lead.findMany({
        where: sessionId ? { sessionId } : {},
        include: {
            company: true,
            session: { select: { sessionName: true } },
            emails: { orderBy: { confidence: 'asc' } },
            status: true,
        },
        orderBy: { createdAt: 'desc' },
    });
}

function leadsToSheetRows(leads) {
    return flattenLeads(leads).map(r => [
        r['Full Name'], r['Company'], r['Domain'], r['Role'],
        r['Email'], r['Pattern'], r['Confidence'], r['Status'], r['Session'],
    ]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FILE EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/export', async (req, res) => {
    try {
        const { format = 'csv', sessionId } = req.body;
        const leads = await fetchLeads(sessionId);
        const rows = flattenLeads(leads);

        if (format === 'json') {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', 'attachment; filename="leads.json"');
            return res.send(JSON.stringify(rows, null, 2));
        }
        if (format === 'xlsx') {
            const buf = toXLSX(rows);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename="leads.xlsx"');
            return res.send(buf);
        }
        const csv = toCSV(rows);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
        return res.send(csv);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GOOGLE SHEETS
// ═══════════════════════════════════════════════════════════════════════════════

// Validate service account credentials
router.get('/google-sheets/status', async (req, res) => {
    try {
        const creds = await validateCredentials();
        const recentExports = await prisma.sheetExport.findMany({
            orderBy: { createdAt: 'desc' },
            take: 5,
            include: { session: { select: { sessionName: true } } },
        });
        res.json({ credentials: creds, recentExports });
    } catch (e) {
        res.json({ credentials: { valid: false, error: e.message }, recentExports: [] });
    }
});

// Get all sheet export sessions
router.get('/google-sheets/sessions', async (req, res) => {
    try {
        const exports = await prisma.sheetExport.findMany({
            orderBy: { createdAt: 'desc' },
            include: { session: { select: { sessionName: true } } },
        });
        res.json(exports);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Create a new Google Sheet
router.post('/google-sheets/create', async (req, res) => {
    try {
        const { title = `Leads Export ${new Date().toLocaleDateString()}` } = req.body;
        const sheet = await createSheet(title);
        res.json({ success: true, ...sheet });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Full sync — create sheet if needed, export leads
router.post('/google-sheets/sync', async (req, res) => {
    try {
        const { sessionId, spreadsheetId, sheetName = 'Leads', clearFirst = false, createNew = false } = req.body;

        const leads = await fetchLeads(sessionId);
        const rows = leadsToSheetRows(leads);

        let sheetId = spreadsheetId;
        let sheetUrl = null;

        if (createNew || !sheetId) {
            const newSheet = await createSheet(sheetName || `Leads Export ${Date.now()}`);
            sheetId = newSheet.spreadsheetId;
            sheetUrl = newSheet.spreadsheetUrl;
        }

        const exported = await syncToSheet(sheetId, sheetName, rows, clearFirst);

        // Persist export record
        if (sessionId) {
            await prisma.sheetExport.create({
                data: {
                    sessionId,
                    googleSheetId: sheetId,
                    sheetName,
                    sheetUrl,
                    exportedRows: exported,
                    status: 'SUCCESS',
                }
            }).catch(() => {});
        }

        // Update lead statuses
        if (sessionId) {
            const leadIds = leads.map(l => l.id);
            for (const id of leadIds) {
                await prisma.leadStatus.upsert({
                    where: { leadId: id },
                    update: { syncedToSheet: true },
                    create: { leadId: id, syncedToSheet: true },
                }).catch(() => {});
            }
        }

        res.json({ success: true, sheetId, sheetUrl, exportedRows: exported, totalLeads: leads.length });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Clear a sheet
router.post('/google-sheets/clear', async (req, res) => {
    try {
        const { spreadsheetId, sheetName = 'Leads' } = req.body;
        if (!spreadsheetId) return res.status(400).json({ error: 'spreadsheetId required' });
        await clearSheet(spreadsheetId, sheetName);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Legacy alias
router.post('/sync-sheets', async (req, res) => {
    req.url = '/google-sheets/sync';
    router.handle(req, res);
});

// Debug endpoint for Google Sheets diagnostics
router.get('/debug/google-status', async (_req, res) => {
    try {
        const status = await getDebugStatus();
        res.json(status);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
