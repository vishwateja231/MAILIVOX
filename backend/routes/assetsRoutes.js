/**
 * assetsRoutes.js — Persistent user assets: resumes, profiles, signatures.
 * ─────────────────────────────────────────────────────────────────────────────
 * CRUD for reusable identity assets that auto-inject into outreach templates.
 */
const express = require('express');
const router = express.Router();
const prisma = require('../services/db/prismaClient');

// ═══════════════════════════════════════════════════════════════════════════════
// RESUMES
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/assets/resumes', async (_req, res) => {
    try {
        const resumes = await prisma.userResume.findMany({ orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }] });
        res.json(resumes);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/assets/resumes', async (req, res) => {
    try {
        const { name, url, tags, isDefault } = req.body;
        if (!name || !url) return res.status(400).json({ error: 'name and url required' });

        // If setting as default, unset others
        if (isDefault) {
            await prisma.userResume.updateMany({ data: { isDefault: false } });
        }

        const resume = await prisma.userResume.create({
            data: { name, url, tags: tags || null, isDefault: isDefault || false },
        });
        res.json(resume);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/assets/resumes/:id', async (req, res) => {
    try {
        const { name, url, tags, isDefault } = req.body;
        if (isDefault) {
            await prisma.userResume.updateMany({ data: { isDefault: false } });
        }
        const resume = await prisma.userResume.update({
            where: { id: req.params.id },
            data: { ...(name && { name }), ...(url && { url }), ...(tags !== undefined && { tags }), ...(isDefault !== undefined && { isDefault }) },
        });
        res.json(resume);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/assets/resumes/:id', async (req, res) => {
    try {
        await prisma.userResume.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PROFILES (GitHub, LinkedIn, Portfolio, etc.)
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/assets/profiles', async (_req, res) => {
    try {
        const profiles = await prisma.userProfile.findMany({ orderBy: [{ type: 'asc' }, { isDefault: 'desc' }] });
        res.json(profiles);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/assets/profiles', async (req, res) => {
    try {
        const { type, label, url, isDefault } = req.body;
        if (!type || !url) return res.status(400).json({ error: 'type and url required' });

        if (isDefault) {
            await prisma.userProfile.updateMany({ where: { type }, data: { isDefault: false } });
        }

        const profile = await prisma.userProfile.create({
            data: { type, label: label || type, url, isDefault: isDefault || false },
        });
        res.json(profile);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/assets/profiles/:id', async (req, res) => {
    try {
        const { label, url, isDefault } = req.body;
        const existing = await prisma.userProfile.findUnique({ where: { id: req.params.id } });
        if (!existing) return res.status(404).json({ error: 'Not found' });

        if (isDefault) {
            await prisma.userProfile.updateMany({ where: { type: existing.type }, data: { isDefault: false } });
        }

        const profile = await prisma.userProfile.update({
            where: { id: req.params.id },
            data: { ...(label && { label }), ...(url && { url }), ...(isDefault !== undefined && { isDefault }) },
        });
        res.json(profile);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/assets/profiles/:id', async (req, res) => {
    try {
        await prisma.userProfile.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SIGNATURES
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/assets/signatures', async (_req, res) => {
    try {
        const sigs = await prisma.userSignature.findMany({ orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }] });
        res.json(sigs);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/assets/signatures', async (req, res) => {
    try {
        const { name, content, isDefault } = req.body;
        if (!name || !content) return res.status(400).json({ error: 'name and content required' });

        if (isDefault) {
            await prisma.userSignature.updateMany({ data: { isDefault: false } });
        }

        const sig = await prisma.userSignature.create({
            data: { name, content, isDefault: isDefault || false },
        });
        res.json(sig);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/assets/signatures/:id', async (req, res) => {
    try {
        await prisma.userSignature.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ALL DEFAULTS — single call to get all default assets for template injection
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/assets/defaults', async (_req, res) => {
    try {
        const [resume, github, linkedin, portfolio, website, signature] = await Promise.all([
            prisma.userResume.findFirst({ where: { isDefault: true } }),
            prisma.userProfile.findFirst({ where: { type: 'github', isDefault: true } }),
            prisma.userProfile.findFirst({ where: { type: 'linkedin', isDefault: true } }),
            prisma.userProfile.findFirst({ where: { type: 'portfolio', isDefault: true } }),
            prisma.userProfile.findFirst({ where: { type: 'website', isDefault: true } }),
            prisma.userSignature.findFirst({ where: { isDefault: true } }),
        ]);

        res.json({
            resume_link: resume?.url || '',
            resume_name: resume?.name || '',
            github: github?.url || '',
            linkedin: linkedin?.url || '',
            portfolio: portfolio?.url || '',
            website: website?.url || '',
            signature: signature?.content || '',
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
