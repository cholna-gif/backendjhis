"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// All admin routes require auth + admin role
router.use(auth_1.requireAuth, (0, auth_1.requireRole)('admin'));
// GET /api/admin/users
router.get('/users', async (_req, res) => {
    try {
        const { rows } = await db_1.pool.query(`SELECT u.id, u.email, u.email_verified, u.created_at,
              p.full_name, p.phone, p.avatar_url, p.wallet_balance,
              r.role
       FROM users u
       LEFT JOIN profiles p ON p.id = u.id
       LEFT JOIN user_roles r ON r.user_id = u.id
       ORDER BY u.created_at DESC`);
        res.json(rows);
    }
    catch (err) {
        console.error('Get users error:', err);
        res.status(500).json({ error: 'Failed to get users' });
    }
});
// GET /api/admin/drivers
router.get('/drivers', async (_req, res) => {
    try {
        const { rows } = await db_1.pool.query(`SELECT u.id, u.email, p.full_name, p.phone, dp.*
       FROM users u
       JOIN user_roles r ON r.user_id = u.id AND r.role = 'driver'
       LEFT JOIN profiles p ON p.id = u.id
       LEFT JOIN driver_profiles dp ON dp.user_id = u.id
       ORDER BY u.created_at DESC`);
        res.json(rows);
    }
    catch (err) {
        console.error('Get drivers error:', err);
        res.status(500).json({ error: 'Failed to get drivers' });
    }
});
// GET /api/admin/applications
router.get('/applications', async (req, res) => {
    try {
        const status = req.query.status;
        const query = status
            ? 'SELECT da.*, p.email FROM driver_applications da LEFT JOIN profiles p ON p.id = da.user_id WHERE da.status = $1 ORDER BY da.created_at DESC'
            : 'SELECT da.*, p.email FROM driver_applications da LEFT JOIN profiles p ON p.id = da.user_id ORDER BY da.created_at DESC';
        const params = status ? [status] : [];
        const { rows } = await db_1.pool.query(query, params);
        res.json(rows);
    }
    catch (err) {
        console.error('Get applications error:', err);
        res.status(500).json({ error: 'Failed to get applications' });
    }
});
// PATCH /api/admin/applications/:id
router.patch('/applications/:id', async (req, res) => {
    const { status, admin_notes, rejection_reason } = req.body;
    try {
        const { rows } = await db_1.pool.query(`UPDATE driver_applications
       SET status = COALESCE($1, status),
           admin_notes = COALESCE($2, admin_notes),
           rejection_reason = COALESCE($3, rejection_reason),
           reviewed_by = $4,
           reviewed_at = NOW()
       WHERE id = $5 RETURNING *`, [status, admin_notes, rejection_reason, req.user.id, req.params.id]);
        if (!rows[0]) {
            res.status(404).json({ error: 'Application not found' });
            return;
        }
        // If approved: create driver profile and update role
        if (status === 'approved') {
            const app = rows[0];
            await db_1.pool.query(`INSERT INTO driver_profiles (user_id, vehicle_type, plate_number, vehicle_color, vehicle_brand, vehicle_model)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (user_id) DO UPDATE
         SET vehicle_type = $2, plate_number = $3, vehicle_color = $4`, [app.user_id, app.vehicle_type, app.plate_number, app.vehicle_color, app.vehicle_brand, app.vehicle_model]);
            await db_1.pool.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'driver') ON CONFLICT (user_id, role) DO NOTHING`, [app.user_id]);
        }
        res.json(rows[0]);
    }
    catch (err) {
        console.error('Update application error:', err);
        res.status(500).json({ error: 'Failed to update application' });
    }
});
// GET /api/admin/settings
router.get('/settings', async (_req, res) => {
    try {
        const { rows } = await db_1.pool.query('SELECT * FROM admin_settings ORDER BY key');
        res.json(rows);
    }
    catch (err) {
        console.error('Get settings error:', err);
        res.status(500).json({ error: 'Failed to get settings' });
    }
});
// PUT /api/admin/settings/:key
router.put('/settings/:key', async (req, res) => {
    const { value } = req.body;
    const { key } = req.params;
    try {
        const { rows } = await db_1.pool.query(`INSERT INTO admin_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
       RETURNING *`, [key, value]);
        res.json(rows[0]);
    }
    catch (err) {
        console.error('Update setting error:', err);
        res.status(500).json({ error: 'Failed to update setting' });
    }
});
// POST /api/admin/notifications — send notification to user
router.post('/notifications', async (req, res) => {
    const { user_id, title, message, type } = req.body;
    if (!user_id || !message) {
        res.status(400).json({ error: 'user_id and message required' });
        return;
    }
    try {
        const { rows } = await db_1.pool.query('INSERT INTO notifications (user_id, title, message, type) VALUES ($1, $2, $3, $4) RETURNING *', [user_id, title, message, type || 'info']);
        res.status(201).json(rows[0]);
    }
    catch (err) {
        console.error('Send notification error:', err);
        res.status(500).json({ error: 'Failed to send notification' });
    }
});
// GET /api/admin/rides
router.get('/rides', async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Number(req.query.offset) || 0;
    const status = req.query.status;
    try {
        const query = status
            ? `SELECT r.*, pp.full_name as passenger_name, dp.full_name as driver_name
         FROM rides r
         LEFT JOIN profiles pp ON pp.id = r.passenger_id
         LEFT JOIN profiles dp ON dp.id = r.driver_id
         WHERE r.status = $3
         ORDER BY r.created_at DESC LIMIT $1 OFFSET $2`
            : `SELECT r.*, pp.full_name as passenger_name, dp.full_name as driver_name
         FROM rides r
         LEFT JOIN profiles pp ON pp.id = r.passenger_id
         LEFT JOIN profiles dp ON dp.id = r.driver_id
         ORDER BY r.created_at DESC LIMIT $1 OFFSET $2`;
        const params = status ? [limit, offset, status] : [limit, offset];
        const { rows } = await db_1.pool.query(query, params);
        res.json(rows);
    }
    catch (err) {
        console.error('Get admin rides error:', err);
        res.status(500).json({ error: 'Failed to get rides' });
    }
});
exports.default = router;
