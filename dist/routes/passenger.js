"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.get('/favorites', auth_1.requireAuth, async (req, res) => {
    try {
        const { rows } = await db_1.pool.query(`SELECT fd.*, p.full_name, p.avatar_url,
              dp.vehicle_type, dp.vehicle_color, dp.vehicle_brand, dp.plate_number,
              dp.average_rating, dp.is_online
       FROM favorite_drivers fd
       LEFT JOIN profiles p ON p.id = fd.driver_id
       LEFT JOIN driver_profiles dp ON dp.user_id = fd.driver_id
       WHERE fd.passenger_id = $1 ORDER BY fd.created_at DESC`, [req.user.id]);
        res.json(rows);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.post('/favorites', auth_1.requireAuth, async (req, res) => {
    const { driver_id } = req.body;
    if (!driver_id) {
        res.status(400).json({ error: 'driver_id required' });
        return;
    }
    try {
        const { rows } = await db_1.pool.query(`INSERT INTO favorite_drivers (passenger_id, driver_id) VALUES ($1,$2)
       ON CONFLICT (passenger_id, driver_id) DO NOTHING RETURNING *`, [req.user.id, driver_id]);
        res.status(201).json(rows[0] || { ok: true });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.delete('/favorites/:id', auth_1.requireAuth, async (req, res) => {
    try {
        await db_1.pool.query(`DELETE FROM favorite_drivers WHERE id = $1 AND passenger_id = $2`, [req.params.id, req.user.id]);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.delete('/favorites', auth_1.requireAuth, async (req, res) => {
    const { driver_id } = req.query;
    if (!driver_id) {
        res.status(400).json({ error: 'driver_id required' });
        return;
    }
    try {
        await db_1.pool.query(`DELETE FROM favorite_drivers WHERE passenger_id = $1 AND driver_id = $2`, [req.user.id, driver_id]);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.post('/ratings', auth_1.requireAuth, async (req, res) => {
    const { ride_id, rated_id, rater_id, rating, review, role } = req.body;
    if (!ride_id || !rated_id || !rating) {
        res.status(400).json({ error: 'ride_id, rated_id, rating required' });
        return;
    }
    try {
        const { rows } = await db_1.pool.query(`INSERT INTO ride_ratings (ride_id, rater_id, rated_id, rating, review, role)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (ride_id, rater_id) DO UPDATE SET rating=EXCLUDED.rating, review=EXCLUDED.review
       RETURNING *`, [ride_id, rater_id || req.user.id, rated_id, rating, review || null, role || 'passenger']);
        await db_1.pool.query(`UPDATE driver_profiles SET average_rating=(SELECT AVG(rating) FROM ride_ratings WHERE rated_id=$1) WHERE user_id=$1`, [rated_id]).catch(() => { });
        res.status(201).json(rows[0]);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.get('/settings/public', async (_req, res) => {
    const { key } = _req.query;
    try {
        if (key) {
            const { rows } = await db_1.pool.query('SELECT key, value FROM admin_settings WHERE key=$1', [key]);
            res.json(rows[0] || null);
        }
        else {
            const { rows } = await db_1.pool.query('SELECT key, value FROM admin_settings');
            res.json(rows);
        }
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.get('/profiles/:id/public', auth_1.requireAuth, async (req, res) => {
    try {
        const { rows } = await db_1.pool.query('SELECT id, full_name, avatar_url FROM profiles WHERE id=$1', [req.params.id]);
        res.json(rows[0] || null);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.get('/driver-profiles/:userId/public', auth_1.requireAuth, async (req, res) => {
    try {
        const { rows } = await db_1.pool.query(`SELECT user_id, vehicle_type, vehicle_color, vehicle_brand, vehicle_model,
              plate_number, average_rating, is_online, speaks_english, tourist_friendly
       FROM driver_profiles WHERE user_id=$1`, [req.params.userId]);
        res.json(rows[0] || null);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.post('/driver/withdrawals', auth_1.requireAuth, async (req, res) => {
    const { amount, method, details } = req.body;
    if (!amount || amount <= 0) {
        res.status(400).json({ error: 'Valid amount required' });
        return;
    }
    try {
        const { rows } = await db_1.pool.query(`INSERT INTO wallet_transactions (user_id, amount, reason, type) VALUES ($1,$2,$3,'debit') RETURNING *`, [req.user.id, -Math.abs(amount), `Withdrawal via ${method || 'bank'}: ${details || ''}`]);
        res.status(201).json(rows[0]);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
