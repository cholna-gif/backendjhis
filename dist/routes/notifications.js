"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// GET /api/notifications
router.get('/', auth_1.requireAuth, async (req, res) => {
    try {
        const { rows } = await db_1.pool.query('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [req.user.id]);
        res.json(rows);
    }
    catch (err) {
        console.error('Get notifications error:', err);
        res.status(500).json({ error: 'Failed to get notifications' });
    }
});
// PATCH /api/notifications/:id/read
router.patch('/:id/read', auth_1.requireAuth, async (req, res) => {
    try {
        const { rows } = await db_1.pool.query('UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2 RETURNING *', [req.params.id, req.user.id]);
        if (!rows[0]) {
            res.status(404).json({ error: 'Notification not found' });
            return;
        }
        res.json(rows[0]);
    }
    catch (err) {
        console.error('Mark notification read error:', err);
        res.status(500).json({ error: 'Failed to update notification' });
    }
});
// PATCH /api/notifications/read-all
router.patch('/read-all', auth_1.requireAuth, async (req, res) => {
    try {
        await db_1.pool.query('UPDATE notifications SET read = true WHERE user_id = $1 AND read = false', [req.user.id]);
        res.json({ ok: true });
    }
    catch (err) {
        console.error('Mark all read error:', err);
        res.status(500).json({ error: 'Failed to update notifications' });
    }
});
// POST /api/notifications
router.post('/', auth_1.requireAuth, async (req, res) => {
    const { user_id, title, message, type, ride_id } = req.body;
    if (!user_id || !title || !message) {
        res.status(400).json({ error: 'user_id, title, message required' });
        return;
    }
    try {
        const { rows } = await db_1.pool.query(`INSERT INTO notifications (user_id, title, message, type, ride_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [user_id, title, message, type || 'info', ride_id || null]);
        res.status(201).json(rows[0]);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
