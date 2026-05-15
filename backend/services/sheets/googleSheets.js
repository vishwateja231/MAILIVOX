/**
 * googleSheets.js — Production Google Sheets + Drive integration.
 * ─────────────────────────────────────────────────────────────────────────────
 * Uses explicit JWT auth with BOTH scopes (spreadsheets + drive).
 * Caches JWT instance globally. Auto-creates tabs. Retries on failure.
 */
const { google } = require('googleapis');

// ─── Cached JWT Client (singleton) ──────────────────────────────────────────

let cachedAuth = null;

function getAuth() {
    if (cachedAuth) return cachedAuth;

    const email = process.env.GOOGLE_CLIENT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    let key = process.env.GOOGLE_PRIVATE_KEY || '';

    if (!email || !key) {
        throw new Error('Missing GOOGLE_CLIENT_EMAIL / GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY');
    }

    // Fix escaped newlines from .env
    key = key.replace(/\\n/g, '\n');

    // Use object-form constructor (required for googleapis v171+)
    cachedAuth = new google.auth.JWT({
        email,
        key,
        scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive',
        ],
    });

    return cachedAuth;
}

async function getAuthorizedAuth() {
    const auth = getAuth();
    await auth.authorize();
    return auth;
}

function getSheetsClient(auth) {
    return google.sheets({ version: 'v4', auth });
}

function getDriveClient(auth) {
    return google.drive({ version: 'v3', auth });
}

const HEADERS = ['Full Name', 'Company', 'Domain', 'Role', 'Email', 'Pattern', 'Confidence', 'Status', 'Session', 'LinkedIn URL', 'Created'];

// ─── Retry Helper ────────────────────────────────────────────────────────────

async function withRetry(fn, maxRetries = 3) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (e) {
            const code = e.code || e.response?.status;
            // Retry on 429 (rate limit) or 500/503 (transient)
            if (attempt < maxRetries && (code === 429 || code === 500 || code === 503)) {
                const delay = Math.pow(2, attempt + 1) * 1000;
                console.log(`[sheets] Retry ${attempt + 1}/${maxRetries} after ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            throw e;
        }
    }
}

// ─── Validation ──────────────────────────────────────────────────────────────

async function validateCredentials() {
    try {
        const auth = await getAuthorizedAuth();
        const email = process.env.GOOGLE_CLIENT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

        // Test Sheets API
        let sheetsEnabled = true;
        try {
            const sheets = getSheetsClient(auth);
            await sheets.spreadsheets.get({ spreadsheetId: '1dcs_eAqWbtNQJpFGE96qCfQzbbAfme6RoFF3DQ_bPjk' });
        } catch (e) {
            const code = e.code || e.response?.status;
            if (code === 403) sheetsEnabled = false;
            // 404 = API works, sheet not found (fine)
        }

        // Test Drive API
        let driveEnabled = true;
        try {
            const drive = getDriveClient(auth);
            await drive.files.list({ pageSize: 1 });
        } catch (e) {
            const code = e.code || e.response?.status;
            if (code === 403) driveEnabled = false;
        }

        return {
            valid: true,
            email,
            projectId: process.env.GOOGLE_PROJECT_ID || null,
            sheetsApiEnabled: sheetsEnabled,
            driveApiEnabled: driveEnabled,
            note: (!sheetsEnabled || !driveEnabled)
                ? 'Enable APIs at https://console.cloud.google.com/apis/library'
                : null,
        };
    } catch (e) {
        return { valid: false, error: e.message, diagnosis: 'auth_failed' };
    }
}

// ─── Tab Management ──────────────────────────────────────────────────────────

/**
 * Get list of tabs in a spreadsheet.
 */
async function getTabNames(auth, spreadsheetId) {
    const sheets = getSheetsClient(auth);
    const res = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
    return res.data.sheets.map(s => s.properties.title);
}

/**
 * Ensure a tab exists. Creates it + writes headers if missing.
 */
async function ensureTabExists(auth, spreadsheetId, tabName) {
    const tabs = await getTabNames(auth, spreadsheetId);
    if (tabs.includes(tabName)) return;

    const sheets = getSheetsClient(auth);

    // Create tab
    await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
    });

    // Write headers
    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${tabName}'!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [HEADERS] },
    });

    console.log(`[sheets] Created tab "${tabName}" in ${spreadsheetId}`);
}

// ─── Spreadsheet Creation ────────────────────────────────────────────────────

async function createSheet(title, tabName = 'Leads') {
    const auth = await getAuthorizedAuth();
    const sheets = getSheetsClient(auth);

    console.log(`[sheets] Creating spreadsheet: "${title}"`);

    let spreadsheetId, spreadsheetUrl;
    try {
        const res = await withRetry(() =>
            sheets.spreadsheets.create({
                requestBody: {
                    properties: { title },
                    sheets: [{ properties: { title: tabName } }],
                },
            })
        );
        spreadsheetId = res.data.spreadsheetId;
        spreadsheetUrl = res.data.spreadsheetUrl;
    } catch (e) {
        const code = e.code || e.response?.status;
        if (code === 403) {
            throw new Error(
                'Cannot create new spreadsheets. The service account lacks Drive file-creation permissions. ' +
                'Use "Sync to Existing Spreadsheet" instead, or grant the service account the "Editor" role in Google Cloud IAM.'
            );
        }
        throw new Error(`Failed to create spreadsheet: ${e.message}`);
    }

    // Write headers
    try {
        await withRetry(() =>
            sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `'${tabName}'!A1`,
                valueInputOption: 'RAW',
                requestBody: { values: [HEADERS] },
            })
        );
    } catch (_) { /* non-critical */ }

    // Share with anyone (link-based access)
    try {
        const drive = getDriveClient(auth);
        await drive.permissions.create({
            fileId: spreadsheetId,
            requestBody: { role: 'writer', type: 'anyone' },
        });
    } catch (_) { /* non-critical */ }

    console.log(`[sheets] Created: ${spreadsheetUrl}`);
    return { spreadsheetId, spreadsheetUrl };
}

// ─── Data Operations ─────────────────────────────────────────────────────────

async function clearSheet(spreadsheetId, tabName = 'Leads') {
    const auth = await getAuthorizedAuth();
    await ensureTabExists(auth, spreadsheetId, tabName);

    const sheets = getSheetsClient(auth);
    await withRetry(() =>
        sheets.spreadsheets.values.clear({ spreadsheetId, range: `'${tabName}'!A:Z` })
    );

    // Re-write headers
    await withRetry(() =>
        sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `'${tabName}'!A1`,
            valueInputOption: 'RAW',
            requestBody: { values: [HEADERS] },
        })
    );

    return true;
}

async function appendRows(spreadsheetId, tabName, rows, deduplicate = true) {
    const auth = await getAuthorizedAuth();
    await ensureTabExists(auth, spreadsheetId, tabName);

    const sheets = getSheetsClient(auth);

    // Deduplicate by email column
    if (deduplicate && rows.length > 0) {
        try {
            const existing = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `'${tabName}'!E:E`,
            });
            const existingEmails = new Set((existing.data.values || []).flat());
            rows = rows.filter(r => !existingEmails.has(r[4]));
        } catch (_) { /* empty sheet */ }
    }

    if (rows.length === 0) return 0;

    // Batch append in chunks
    const CHUNK = 500;
    let total = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        await withRetry(() =>
            sheets.spreadsheets.values.append({
                spreadsheetId,
                range: `'${tabName}'!A1`,
                valueInputOption: 'RAW',
                requestBody: { values: chunk },
            })
        );
        total += chunk.length;
        if (i + CHUNK < rows.length) await new Promise(r => setTimeout(r, 500));
    }

    console.log(`[sheets] Appended ${total} rows to "${tabName}"`);
    return total;
}

async function syncToSheet(spreadsheetId, tabName, rows, clearFirst = false) {
    if (clearFirst) {
        await clearSheet(spreadsheetId, tabName);
    }
    return appendRows(spreadsheetId, tabName, rows, !clearFirst);
}

async function getSheetMetadata(spreadsheetId) {
    const auth = await getAuthorizedAuth();
    const sheets = getSheetsClient(auth);
    const res = await sheets.spreadsheets.get({ spreadsheetId });
    return {
        title: res.data.properties.title,
        url: res.data.spreadsheetUrl,
        tabs: res.data.sheets.map(s => ({
            title: s.properties.title,
            index: s.properties.index,
            rowCount: s.properties.gridProperties?.rowCount || 0,
        })),
    };
}

// ─── Debug Endpoint Data ─────────────────────────────────────────────────────

async function getDebugStatus() {
    const email = process.env.GOOGLE_CLIENT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'NOT SET';
    const hasKey = !!(process.env.GOOGLE_PRIVATE_KEY && process.env.GOOGLE_PRIVATE_KEY.length > 100);
    const testSheetId = '1dcs_eAqWbtNQJpFGE96qCfQzbbAfme6RoFF3DQ_bPjk';

    let authValid = false;
    let canAccessExisting = false;
    let canCreateSheets = false;
    let existingSheetTabs = [];

    try {
        const auth = await getAuthorizedAuth();
        authValid = true;

        // Test existing spreadsheet access
        try {
            const sheets = getSheetsClient(auth);
            const meta = await sheets.spreadsheets.get({ spreadsheetId: testSheetId, fields: 'sheets.properties.title,properties.title' });
            canAccessExisting = true;
            existingSheetTabs = meta.data.sheets.map(s => s.properties.title);
        } catch (e) {
            canAccessExisting = false;
        }

        // Test creation
        try {
            const sheets = getSheetsClient(auth);
            const res = await sheets.spreadsheets.create({
                requestBody: { properties: { title: '__nexus_test_delete_me__' } },
            });
            canCreateSheets = true;
            // Clean up test sheet
            try {
                const drive = getDriveClient(auth);
                await drive.files.delete({ fileId: res.data.spreadsheetId });
            } catch (_) {}
        } catch (_) {
            canCreateSheets = false;
        }
    } catch (_) {}

    return {
        serviceAccountEmail: email,
        privateKeyPresent: hasKey,
        authValid,
        canAccessExisting,
        canCreateSheets,
        existingSheetId: testSheetId,
        existingSheetTabs,
        scopes: ['spreadsheets', 'drive'],
    };
}

module.exports = {
    validateCredentials,
    createSheet,
    ensureTabExists: async (spreadsheetId, tabName) => {
        const auth = await getAuthorizedAuth();
        return ensureTabExists(auth, spreadsheetId, tabName);
    },
    clearSheet,
    appendRows,
    syncToSheet,
    getSheetMetadata,
    getDebugStatus,
    HEADERS,
};
