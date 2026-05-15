/**
 * exportService.js — CSV, XLSX and JSON export from DB.
 */
const XLSX = require('xlsx');

function toCSV(rows) {
    if (!rows.length) return '';
    const headers = Object.keys(rows[0]);
    const lines = [headers.join(',')];
    for (const row of rows) {
        lines.push(headers.map(h => `"${String(row[h] ?? '').replace(/"/g, '""')}"`).join(','));
    }
    return lines.join('\n');
}

function toXLSX(rows) {
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Leads');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function flattenLeads(leads) {
    return leads.flatMap(lead =>
        (lead.emails && lead.emails.length > 0 ? lead.emails : [{ email: '', pattern: '', confidence: '', verificationStatus: '' }])
            .map(email => ({
                'Full Name': lead.fullName,
                'Company': lead.company?.companyName || '',
                'Domain': lead.company?.domain || '',
                'Role': lead.role || '',
                'Location': lead.location || '',
                'Email': email.email,
                'Pattern': email.pattern,
                'Confidence': email.confidence,
                'Status': email.verificationStatus,
                'Session': lead.session?.sessionName || '',
                'Synced': lead.status?.syncedToSheet ? 'Yes' : 'No',
            }))
    );
}

module.exports = { toCSV, toXLSX, flattenLeads };
