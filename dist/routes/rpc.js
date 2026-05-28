"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
const email_1 = require("../lib/email");
const router = (0, express_1.Router)();
// ── Admin-only RPCs ───────────────────────────────────────────────────────────
// POST /api/rpc/log_admin_action
router.post('/log_admin_action', auth_1.requireAuth, (0, auth_1.requireRole)('admin'), async (req, res) => {
    const { p_action_type, p_target_type, p_target_id, p_target_name, p_details } = req.body;
    try {
        await db_1.pool.query(`INSERT INTO audit_logs
         (user_id, action, table_name, record_id, new_data,
          performed_by, action_type, target_type, target_id, target_name, details)
       VALUES ($1,$2,$3,$4,$5, $1,$6,$7,$8,$9,$5)`, [
            req.user.id,
            `${p_action_type}${p_target_name ? ` — ${p_target_name}` : ''}`,
            p_target_type || null,
            p_target_id || null,
            p_details ? JSON.stringify(p_details) : null,
            p_action_type || null,
            p_target_type || null,
            p_target_id ? String(p_target_id) : null,
            p_target_name || null,
        ]);
        res.json({ success: true });
    }
    catch (err) {
        console.error('RPC log_admin_action:', err.message);
        res.status(500).json({ error: err.message });
    }
});
// POST /api/rpc/admin_adjust_wallet
router.post('/admin_adjust_wallet', auth_1.requireAuth, (0, auth_1.requireRole)('admin'), async (req, res) => {
    const { p_user_id, p_amount, p_reason, p_type } = req.body;
    if (!p_user_id || p_amount == null) {
        res.status(400).json({ error: 'p_user_id and p_amount are required' });
        return;
    }
    const client = await db_1.pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`UPDATE profiles SET wallet_balance = wallet_balance + $1 WHERE id = $2`, [p_amount, p_user_id]);
        await client.query(`INSERT INTO wallet_transactions (user_id, amount, reason, type, created_by)
       VALUES ($1, $2, $3, $4, $5)`, [p_user_id, p_amount, p_reason || null, p_type || (p_amount >= 0 ? 'credit' : 'debit'), req.user.id]);
        await client.query('COMMIT');
        res.json({ success: true });
    }
    catch (err) {
        await client.query('ROLLBACK');
        console.error('RPC admin_adjust_wallet:', err.message);
        res.status(500).json({ error: err.message });
    }
    finally {
        client.release();
    }
});
// POST /api/rpc/send_driver_email
router.post('/send_driver_email', auth_1.requireAuth, (0, auth_1.requireRole)('admin'), async (req, res) => {
    const { to, subject, html, applicationId } = req.body;
    if (!to || !subject || !html) {
        res.status(400).json({ error: 'to, subject and html are required' });
        return;
    }
    try {
        await (0, email_1.sendEmail)(to, subject, html);
        if (applicationId) {
            await db_1.pool.query(`UPDATE driver_applications SET email_sent = true, email_sent_at = NOW() WHERE id = $1`, [applicationId]).catch(() => { });
        }
        res.json({ success: true });
    }
    catch (err) {
        console.error('RPC send_driver_email:', err.message);
        res.status(500).json({ error: err.message });
    }
});
// ── Passenger RPCs ────────────────────────────────────────────────────────────
// POST /api/rpc/handle_passenger_cancellation
router.post('/handle_passenger_cancellation', auth_1.requireAuth, async (req, res) => {
    const { p_ride_id } = req.body;
    if (!p_ride_id) {
        res.status(400).json({ error: 'p_ride_id required' });
        return;
    }
    const client = await db_1.pool.connect();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query('SELECT * FROM rides WHERE id = $1', [p_ride_id]);
        const ride = rows[0];
        if (!ride) {
            await client.query('ROLLBACK');
            res.status(404).json({ error: 'Ride not found' });
            return;
        }
        if (ride.passenger_id !== req.user.id) {
            await client.query('ROLLBACK');
            res.status(403).json({ error: 'Forbidden' });
            return;
        }
        // Compute cancellation tier
        let tier = 'no_penalty';
        let penalty = 0;
        if (ride.status === 'matched') {
            const matchedAt = ride.matched_at ? new Date(ride.matched_at).getTime() : Date.now();
            const elapsedSeconds = (Date.now() - matchedAt) / 1000;
            if (elapsedSeconds <= 180) {
                tier = 'early_cancel';
                penalty = 0;
            }
            else {
                tier = 'late_cancel';
                penalty = 1.00;
            }
        }
        else if (ride.status === 'arrived') {
            tier = 'arrived_cancel';
            penalty = 2.00;
        }
        // Cancel the ride
        await client.query(`UPDATE rides SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = 'passenger',
       cancellation_reason = $1 WHERE id = $2`, [`Passenger cancelled (${tier})`, p_ride_id]);
        let refund = 0;
        // Handle wallet payment: apply penalty and refund remainder
        if (ride.payment_method === 'wallet' && ride.payment_status === 'paid') {
            const fare = parseFloat(ride.estimated_fare || ride.offered_fare || '0');
            refund = Math.max(0, fare - penalty);
            if (penalty > 0) {
                await client.query(`UPDATE profiles SET wallet_balance = wallet_balance - $1 WHERE id = $2`, [penalty, req.user.id]);
                await client.query(`INSERT INTO wallet_transactions (user_id, amount, reason, type) VALUES ($1,$2,$3,'debit')`, [req.user.id, -penalty, `Cancellation fee — ride ${p_ride_id}`]);
            }
            if (refund > 0) {
                await client.query(`UPDATE profiles SET wallet_balance = wallet_balance + $1 WHERE id = $2`, [refund, req.user.id]);
                await client.query(`INSERT INTO wallet_transactions (user_id, amount, reason, type) VALUES ($1,$2,$3,'credit')`, [req.user.id, refund, `Refund for cancelled ride ${p_ride_id}`]);
            }
        }
        await client.query('COMMIT');
        res.json({ tier, penalty, refund });
    }
    catch (err) {
        await client.query('ROLLBACK');
        console.error('RPC handle_passenger_cancellation:', err.message);
        res.status(500).json({ error: err.message });
    }
    finally {
        client.release();
    }
});
// POST /api/rpc/add_wallet_balance
router.post('/add_wallet_balance', auth_1.requireAuth, async (req, res) => {
    const { p_amount, p_method } = req.body;
    if (!p_amount || p_amount <= 0) {
        res.status(400).json({ error: 'Valid p_amount required' });
        return;
    }
    const client = await db_1.pool.connect();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query(`UPDATE profiles SET wallet_balance = wallet_balance + $1 WHERE id = $2 RETURNING wallet_balance`, [p_amount, req.user.id]);
        await client.query(`INSERT INTO wallet_transactions (user_id, amount, reason, type) VALUES ($1,$2,$3,'credit')`, [req.user.id, p_amount, `Top-up via ${p_method || 'unknown'}`]);
        await client.query('COMMIT');
        res.json({ new_balance: rows[0]?.wallet_balance ?? 0 });
    }
    catch (err) {
        await client.query('ROLLBACK');
        console.error('RPC add_wallet_balance:', err.message);
        res.status(500).json({ error: err.message });
    }
    finally {
        client.release();
    }
});
// ── Driver RPCs ───────────────────────────────────────────────────────────────
// POST /api/rpc/handle_driver_cancellation
router.post('/handle_driver_cancellation', auth_1.requireAuth, async (req, res) => {
    const { p_ride_id } = req.body;
    if (!p_ride_id) {
        res.status(400).json({ error: 'p_ride_id required' });
        return;
    }
    const client = await db_1.pool.connect();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query('SELECT * FROM rides WHERE id = $1', [p_ride_id]);
        const ride = rows[0];
        if (!ride) {
            await client.query('ROLLBACK');
            res.status(404).json({ error: 'Ride not found' });
            return;
        }
        if (ride.driver_id !== req.user.id) {
            await client.query('ROLLBACK');
            res.status(403).json({ error: 'Forbidden' });
            return;
        }
        // Re-queue if in early stages, otherwise cancel
        const requeue = ['matched', 'arrived'].includes(ride.status);
        if (requeue) {
            await client.query(`UPDATE rides SET status = 'pending', driver_id = NULL, matched_at = NULL,
         arrived_at = NULL, cancelled_by = NULL WHERE id = $1`, [p_ride_id]);
        }
        else {
            await client.query(`UPDATE rides SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = 'driver',
         cancellation_reason = 'Driver cancelled' WHERE id = $1`, [p_ride_id]);
        }
        // Notify passenger
        if (ride.passenger_id) {
            await client.query(`INSERT INTO notifications (user_id, title, message, type, ride_id)
         VALUES ($1, $2, $3, 'ride_cancelled', $4)`, [
                ride.passenger_id,
                'Driver cancelled',
                requeue ? 'Your driver cancelled. We\'re finding a new driver for you.' : 'Your driver cancelled the ride.',
                p_ride_id,
            ]).catch(() => { });
        }
        await client.query('COMMIT');
        res.json({ requeued: requeue });
    }
    catch (err) {
        await client.query('ROLLBACK');
        console.error('RPC handle_driver_cancellation:', err.message);
        res.status(500).json({ error: err.message });
    }
    finally {
        client.release();
    }
});
exports.default = router;
