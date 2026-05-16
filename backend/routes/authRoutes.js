const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../services/db/prismaClient');

const JWT_SECRET = process.env.JWT_SECRET || 'mailivox_secret_key_2026';

// POST /api/auth/login
router.post('/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

        const user = await prisma.user.findUnique({ where: { username } });
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

        if (!user.isApproved && user.role !== 'admin') {
            return res.status(403).json({ error: 'Account pending approval' });
        }

        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role, permissions: user.permissions },
            JWT_SECRET,
            { expiresIn: '7d' }
        );
        res.json({ token, user: { id: user.id, username: user.username, role: user.role, permissions: user.permissions } });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/auth/signup
router.post('/auth/signup', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
        if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

        const existing = await prisma.user.findUnique({ where: { username } });
        if (existing) return res.status(400).json({ error: 'Username already taken' });

        const hashed = await bcrypt.hash(password, 10);
        await prisma.user.create({ data: { username, password: hashed, role: 'pending', isApproved: false } });

        res.json({ ok: true, message: 'Account created. Awaiting admin approval.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/auth/me — get current user from token
router.get('/auth/me', async (req, res) => {
    try {
        const auth = req.headers.authorization;
        if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
        const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
        const user = await prisma.user.findUnique({
            where: { id: decoded.id },
            select: { id: true, username: true, role: true, permissions: true, isApproved: true }
        });
        if (!user) return res.status(401).json({ error: 'User not found' });
        res.json(user);
    } catch (e) {
        res.status(401).json({ error: 'Invalid token' });
    }
});

// GET /api/auth/users — admin only: list all users
router.get('/auth/users', async (req, res) => {
    try {
        const auth = req.headers.authorization;
        if (!auth) return res.status(401).json({ error: 'No token' });
        const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
        if (decoded.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

        const users = await prisma.user.findMany({
            select: { id: true, username: true, role: true, permissions: true, isApproved: true, createdAt: true, lastLoginAt: true }
        });
        res.json(users);
    } catch (e) {
        res.status(401).json({ error: 'Unauthorized' });
    }
});

// PATCH /api/auth/users/:id — admin: approve/update user
router.patch('/auth/users/:id', async (req, res) => {
    try {
        const auth = req.headers.authorization;
        if (!auth) return res.status(401).json({ error: 'No token' });
        const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
        if (decoded.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

        const { role, permissions, isApproved } = req.body;
        const data = {};
        if (role !== undefined) data.role = role;
        if (permissions !== undefined) data.permissions = permissions;
        if (isApproved !== undefined) data.isApproved = isApproved;

        const user = await prisma.user.update({ where: { id: req.params.id }, data });
        res.json(user);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// DELETE /api/auth/users/:id — admin: delete user
router.delete('/auth/users/:id', async (req, res) => {
    try {
        const auth = req.headers.authorization;
        if (!auth) return res.status(401).json({ error: 'No token' });
        const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
        if (decoded.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

        await prisma.user.delete({ where: { id: req.params.id } });
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
