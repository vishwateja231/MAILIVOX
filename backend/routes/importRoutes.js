/**
 * importRoutes.js — File import: CSV, Excel, PDF, DOC/DOCX
 * ─────────────────────────────────────────────────────────────────────────────
 * Parses uploaded files, extracts contacts, creates sessions + leads.
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const prisma = require('../services/db/prismaClient');
const { parseName } = require('../services/nameParser');
const { generatePermutations } = require('../services/generator');
const { discoverDomain } = require('../services/domain/domainDiscovery');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const allowed = ['.pdf', '.xlsx', '.xls', '.csv', '.doc', '.docx', '.txt'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) cb(null, true);
        else cb(new Error('Unsupported file type'));
    }
});

// ─── File Parsers ─────────────────────────────────────────────────────────────

async function parseFile(buffer, filename) {
    const ext = path.extname(filename).toLowerCase();

    if (ext === '.csv' || ext === '.txt') {
        return parseCSV(buffer.toString('utf-8'));
    } else if (ext === '.xlsx' || ext === '.xls') {
        const XLSX = require('xlsx');
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(sheet);
        return extractContactsFromRows(data);
    } else if (ext === '.pdf') {
        try {
            const { PDFParse } = require('pdf-parse');
            PDFParse.setWorker(require.resolve('pdf-parse/dist/pdf-parse/cjs/pdf.worker.cjs'));
            const parser = new PDFParse({ data: buffer, verbosity: 0 });
            const result = await parser.getText();
            return extractContactsFromText(result.text);
        } catch (e) {
            console.error('[import] PDF parse error:', e.message);
            // Fallback: try to extract text directly from buffer as string
            const rawText = buffer.toString('utf-8').replace(/[^\x20-\x7E\n]/g, ' ');
            return extractContactsFromText(rawText);
        }
    } else if (ext === '.docx' || ext === '.doc') {
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ buffer });
        return extractContactsFromText(result.value);
    }
    return [];
}

// ─── CSV Parser ───────────────────────────────────────────────────────────────

function parseCSV(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length === 0) return [];

    // Detect separator
    const headerLine = lines[0].toLowerCase();
    const separator = headerLine.includes('\t') ? '\t' : ',';
    const headers = lines[0].split(separator).map(h => h.trim().toLowerCase().replace(/['"]/g, ''));

    // Map common header names
    const nameIdx = headers.findIndex(h => /^(name|full.?name|contact.?name|person)$/i.test(h));
    const firstNameIdx = headers.findIndex(h => /^(first.?name|fname|given.?name)$/i.test(h));
    const lastNameIdx = headers.findIndex(h => /^(last.?name|lname|surname|family.?name)$/i.test(h));
    const emailIdx = headers.findIndex(h => /^(email|e.?mail|mail|email.?address)$/i.test(h));
    const companyIdx = headers.findIndex(h => /^(company|organization|org|employer|company.?name)$/i.test(h));
    const roleIdx = headers.findIndex(h => /^(role|title|job.?title|position|designation)$/i.test(h));
    const phoneIdx = headers.findIndex(h => /^(phone|mobile|tel|telephone|contact|number)$/i.test(h));
    const locationIdx = headers.findIndex(h => /^(location|city|address|region)$/i.test(h));
    const linkedinIdx = headers.findIndex(h => /^(linkedin|linkedin.?url|profile)$/i.test(h));

    const contacts = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(separator).map(c => c.trim().replace(/^['"]|['"]$/g, ''));

        let fullName = nameIdx >= 0 ? cols[nameIdx] : '';
        if (!fullName && firstNameIdx >= 0) {
            fullName = [cols[firstNameIdx], cols[lastNameIdx] || ''].filter(Boolean).join(' ');
        }
        if (!fullName || fullName.trim().length < 2) continue;

        contacts.push({
            fullName: fullName.trim(),
            email: emailIdx >= 0 ? cols[emailIdx]?.trim() || null : null,
            company: companyIdx >= 0 ? cols[companyIdx]?.trim() || null : null,
            role: roleIdx >= 0 ? cols[roleIdx]?.trim() || null : null,
            phone: phoneIdx >= 0 ? cols[phoneIdx]?.trim() || null : null,
            location: locationIdx >= 0 ? cols[locationIdx]?.trim() || null : null,
            linkedinUrl: linkedinIdx >= 0 ? cols[linkedinIdx]?.trim() || null : null,
        });
    }
    return contacts;
}

// ─── Excel Row Extractor ──────────────────────────────────────────────────────

function extractContactsFromRows(rows) {
    return rows.map(row => {
        const values = Object.entries(row);
        let fullName = null, email = null, company = null, role = null, phone = null, location = null, linkedinUrl = null;

        for (const [key, val] of values) {
            const k = key.toLowerCase();
            const v = String(val || '').trim();
            if (!v) continue;

            if (/name|person|contact/i.test(k) && !fullName) fullName = v;
            else if (/first/i.test(k) && !fullName) fullName = v;
            else if (/email|mail/i.test(k)) email = v;
            else if (/company|org|employer/i.test(k)) company = v;
            else if (/role|title|position|designation/i.test(k)) role = v;
            else if (/phone|mobile|tel/i.test(k)) phone = v;
            else if (/location|city|address/i.test(k)) location = v;
            else if (/linkedin/i.test(k)) linkedinUrl = v;
        }

        // If we found a "first name" but no full name, check for last name
        if (fullName && !fullName.includes(' ')) {
            for (const [key, val] of values) {
                if (/last|surname/i.test(key.toLowerCase()) && val) {
                    fullName = `${fullName} ${String(val).trim()}`;
                    break;
                }
            }
        }

        // Auto-detect email from any field
        if (!email) {
            for (const [, val] of values) {
                const v = String(val || '');
                const emailMatch = v.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
                if (emailMatch) { email = emailMatch[0]; break; }
            }
        }

        if (!fullName || fullName.length < 2) return null;
        return { fullName, email, company, role, phone, location, linkedinUrl };
    }).filter(Boolean);
}

// ─── Text Extractor (PDF/DOC) ─────────────────────────────────────────────────

function extractContactsFromText(text) {
    const contacts = [];
    const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

    // Find all emails in the text
    const emails = [...new Set(text.match(emailRegex) || [])];

    // For each email, try to find a name nearby
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    for (const email of emails) {
        // Skip noise emails
        if (/noreply|example|test|info@|support@|admin@/i.test(email)) continue;

        const domain = email.split('@')[1];
        const localPart = email.split('@')[0];

        // Try to derive name from email local part
        let fullName = localPart.replace(/[._\-+]/g, ' ').replace(/\d+/g, '').trim();
        fullName = fullName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

        // Try to find a better name near the email in the text
        const emailLineIdx = lines.findIndex(l => l.includes(email));
        if (emailLineIdx >= 0) {
            for (let i = Math.max(0, emailLineIdx - 3); i < emailLineIdx; i++) {
                const line = lines[i];
                if (line.length > 2 && line.length < 50 && /^[A-Z][a-z]/.test(line) && !line.includes('@')) {
                    fullName = line.replace(/[,;:]/g, '').trim();
                    break;
                }
            }
        }

        if (fullName.length < 2) continue;

        const companyFromDomain = domain.split('.')[0];
        contacts.push({
            fullName,
            email,
            company: companyFromDomain.charAt(0).toUpperCase() + companyFromDomain.slice(1),
            role: null,
            phone: null,
            location: null,
            linkedinUrl: null,
        });
    }

    return contacts;
}


// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// Main upload endpoint
router.post('/import/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const filename = req.file.originalname;
        const contacts = await parseFile(req.file.buffer, filename);

        if (contacts.length === 0) {
            return res.status(400).json({ error: 'No contacts found in file. Ensure it has names and emails.' });
        }

        // Create session
        const sessionName = `import_${filename.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}_${Date.now().toString().slice(-6)}`;
        const session = await prisma.session.create({
            data: { sessionName, totalProfiles: contacts.length, rawInput: `File: ${filename} (${contacts.length} contacts)` },
        });

        let processed = 0, emailsGenerated = 0, companiesCreated = 0;

        for (const contact of contacts) {
            try {
                const { fullName, email, company, role, phone, location, linkedinUrl } = contact;

                // Resolve domain
                let domain = null;
                let companyRecord = null;

                if (email) {
                    domain = email.split('@')[1];
                } else if (company) {
                    try {
                        const discovery = await discoverDomain({ company });
                        domain = discovery.domain;
                    } catch (_) {}
                }

                if (domain) {
                    const existing = await prisma.company.findUnique({ where: { domain } });
                    companyRecord = await prisma.company.upsert({
                        where: { domain },
                        update: {},
                        create: { companyName: company || domain, domain },
                    });
                    if (!existing) companiesCreated++;
                }

                // Parse name
                const nameParts = parseName(fullName);
                const firstName = nameParts.first || fullName.split(/\s+/)[0].toLowerCase();
                const lastName = nameParts.last || fullName.split(/\s+/).slice(-1)[0].toLowerCase();

                // Create lead
                const leadData = {
                    fullName,
                    firstName,
                    lastName,
                    role: role || null,
                    location: location || null,
                    linkedinUrl: linkedinUrl || null,
                    sessionId: session.id,
                    ...(companyRecord ? { companyId: companyRecord.id } : {}),
                };

                let lead;
                if (companyRecord) {
                    lead = await prisma.lead.upsert({
                        where: { fullName_companyId: { fullName, companyId: companyRecord.id } },
                        update: { role: role || undefined, location: location || undefined },
                        create: leadData,
                    });
                } else {
                    lead = await prisma.lead.create({ data: leadData });
                }

                // Create status record
                await prisma.leadStatus.upsert({
                    where: { leadId: lead.id },
                    update: {},
                    create: { leadId: lead.id },
                }).catch(() => {});

                // Handle emails
                if (email) {
                    // Provided email — store directly
                    try {
                        await prisma.generatedEmail.upsert({
                            where: { email },
                            update: {},
                            create: { leadId: lead.id, email, pattern: 'PROVIDED_EMAIL', confidence: 'HIGH', verificationStatus: 'VALID', isVerified: true },
                        });
                        emailsGenerated++;
                    } catch (_) {}
                } else if (domain) {
                    // Generate permutations
                    const perms = generatePermutations(nameParts, domain);
                    for (const p of perms) {
                        try {
                            await prisma.generatedEmail.upsert({
                                where: { email: p.email },
                                update: {},
                                create: { leadId: lead.id, email: p.email, pattern: p.pattern, confidence: p.confidence },
                            });
                            emailsGenerated++;
                        } catch (_) {}
                    }
                }

                processed++;
            } catch (e) {
                console.error(`[import] Failed to process contact: ${contact.fullName}`, e.message);
            }
        }

        // Update session totals
        await prisma.session.update({
            where: { id: session.id },
            data: { totalProfiles: processed, totalEmails: emailsGenerated },
        });

        res.json({
            ok: true,
            sessionId: session.id,
            sessionName,
            filename,
            totalContacts: contacts.length,
            processed,
            emailsGenerated,
            companiesCreated,
        });
    } catch (e) {
        console.error('[import] Upload error:', e);
        res.status(500).json({ error: e.message });
    }
});

// List import sessions
router.get('/import/sessions', async (req, res) => {
    try {
        const sessions = await prisma.session.findMany({
            where: { sessionName: { startsWith: 'import_' } },
            orderBy: { createdAt: 'desc' },
            take: 50,
        });
        res.json(sessions);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
