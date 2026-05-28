"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// POST /api/waitlist
router.post('/', async (req, res) => {
    const { phone } = req.body;
    if (!phone) {
        res.status(400).json({ error: 'Phone number required' });
        return;
    }
    try {
        await db_1.pool.query('INSERT INTO app_waitlist (phone) VALUES ($1) ON CONFLICT (phone) DO NOTHING', [phone]);
        res.json({ ok: true });
    }
    catch (err) {
        console.error('Waitlist error:', err);
        res.status(500).json({ error: 'Failed to join waitlist' });
    }
});
// GET /api/waitlist — admin only
router.get('/', auth_1.requireAuth, async (req, res) => {
    if (req.user.role !== 'admin') {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    try {
        const { rows } = await db_1.pool.query('SELECT * FROM app_waitlist ORDER BY created_at DESC');
        res.json(rows);
    }
    catch (err) {
        console.error('Get waitlist error:', err);
        res.status(500).json({ error: 'Failed to get waitlist' });
    }
});
exports.default = router;
