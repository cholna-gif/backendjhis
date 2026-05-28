"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
const email_1 = require("../lib/email");
const router = (0, express_1.Router)();
const makeToken = (payload, expiresIn = '7d') => jsonwebtoken_1.default.sign(payload, process.env.JWT_SECRET, { expiresIn });
// POST /api/auth/register
router.post('/register', async (req, res) => {
    const { email, password, full_name, phone, role = 'passenger' } = req.body;
    if (!email || !password) {
        res.status(400).json({ error: 'Email and password are required' });
        return;
    }
    if (password.length < 8) {
        res.status(400).json({ error: 'Password must be at least 8 characters' });
        return;
    }
    const client = await db_1.pool.connect();
    try {
        await client.query('BEGIN');
        const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            res.status(409).json({ error: 'Email already registered' });
            return;
        }
        const password_hash = await bcryptjs_1.default.hash(password, 10);
        const devAutoVerify = process.env.DEV_AUTO_VERIFY === 'true';
        const verificationToken = devAutoVerify ? null : crypto_1.default.randomBytes(32).toString('hex');
        const verificationExpiry = devAutoVerify ? null : new Date(Date.now() + 24 * 60 * 60 * 1000);
        const { rows } = await client.query(`INSERT INTO users (email, password_hash, email_verified, email_verification_token, email_verification_expires, raw_user_meta_data)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, email`, [email, password_hash, devAutoVerify, verificationToken, verificationExpiry, JSON.stringify({ full_name, role })]);
        const user = rows[0];
        await client.query('INSERT INTO profiles (id, email, full_name, phone) VALUES ($1, $2, $3, $4)', [user.id, email, full_name || '', phone || null]);
        const validRole = ['passenger', 'driver', 'admin', 'partner', 'investor'].includes(role) ? role : 'passenger';
        await client.query('INSERT INTO user_roles (user_id, role) VALUES ($1, $2) ON CONFLICT (user_id, role) DO NOTHING', [user.id, validRole]);
        await client.query('COMMIT');
        if (!devAutoVerify) {
            const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
            try {
                await (0, email_1.sendVerificationEmail)(email, verificationToken, baseUrl);
            }
            catch (emailErr) {
                console.error('Failed to send verification email:', emailErr);
            }
        }
        if (devAutoVerify) {
            const token = makeToken({ id: user.id, email: user.email, role: validRole });
            const { rows: profileRows } = await db_1.pool.query('SELECT * FROM profiles WHERE id = $1', [user.id]);
            res.status(201).json({ token, user: { id: user.id, email: user.email, email_verified: true }, profile: profileRows[0], role: validRole });
        }
        else {
            res.status(201).json({ message: 'Account created. Please verify your email.' });
        }
    }
    catch (err) {
        await client.query('ROLLBACK');
        console.error('Register error:', err);
        res.status(500).json({ error: 'Registration failed' });
    }
    finally {
        client.release();
    }
});
// POST /api/auth/login
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        res.status(400).json({ error: 'Email and password are required' });
        return;
    }
    try {
        const { rows } = await db_1.pool.query(`SELECT u.*, r.role FROM users u
       LEFT JOIN user_roles r ON r.user_id = u.id
       WHERE u.email = $1
       ORDER BY CASE r.role WHEN 'admin' THEN 0 WHEN 'driver' THEN 1 WHEN 'partner' THEN 2 WHEN 'investor' THEN 3 ELSE 4 END
       LIMIT 1`, [email]);
        const user = rows[0];
        if (!user || !user.password_hash) {
            res.status(401).json({ error: 'Invalid credentials' });
            return;
        }
        const valid = await bcryptjs_1.default.compare(password, user.password_hash);
        if (!valid) {
            res.status(401).json({ error: 'Invalid credentials' });
            return;
        }
        if (!user.email_verified) {
            res.status(403).json({ error: 'Please verify your email before logging in', code: 'email_not_verified' });
            return;
        }
        const token = makeToken({ id: user.id, email: user.email, role: user.role });
        const { rows: profileRows } = await db_1.pool.query('SELECT * FROM profiles WHERE id = $1', [user.id]);
        res.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                email_verified: user.email_verified,
                created_at: user.created_at,
            },
            profile: profileRows[0] || null,
            role: user.role || null,
        });
    }
    catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed' });
    }
});
// GET /api/auth/verify?token=...
router.get('/verify', async (req, res) => {
    const { token } = req.query;
    if (!token) {
        res.status(400).json({ error: 'Token required' });
        return;
    }
    try {
        const { rows } = await db_1.pool.query(`UPDATE users SET email_verified = true, email_verification_token = NULL
       WHERE email_verification_token = $1 AND email_verification_expires > NOW()
       RETURNING id`, [token]);
        if (rows.length === 0) {
            res.status(400).json({ error: 'Invalid or expired verification token' });
            return;
        }
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        res.redirect(`${frontendUrl}/auth?tab=login&verified=true`);
    }
    catch (err) {
        console.error('Verify error:', err);
        res.status(500).json({ error: 'Verification failed' });
    }
});
// POST /api/auth/resend-verification
router.post('/resend-verification', async (req, res) => {
    const { email } = req.body;
    if (!email) {
        res.status(400).json({ error: 'Email required' });
        return;
    }
    try {
        const verificationToken = crypto_1.default.randomBytes(32).toString('hex');
        const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const { rows } = await db_1.pool.query(`UPDATE users SET email_verification_token = $1, email_verification_expires = $2
       WHERE email = $3 AND email_verified = false RETURNING id`, [verificationToken, verificationExpiry, email]);
        if (rows.length === 0) {
            res.status(400).json({ error: 'Email not found or already verified' });
            return;
        }
        const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        await (0, email_1.sendVerificationEmail)(email, verificationToken, baseUrl);
        res.json({ message: 'Verification email resent' });
    }
    catch (err) {
        console.error('Resend verification error:', err);
        res.status(500).json({ error: 'Failed to resend verification email' });
    }
});
// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    if (!email) {
        res.status(400).json({ error: 'Email required' });
        return;
    }
    try {
        const resetToken = crypto_1.default.randomBytes(32).toString('hex');
        const resetExpiry = new Date(Date.now() + 60 * 60 * 1000);
        const { rows } = await db_1.pool.query(`UPDATE users SET password_reset_token = $1, password_reset_expires = $2
       WHERE email = $3 RETURNING id`, [resetToken, resetExpiry, email]);
        if (rows.length > 0) {
            const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
            try {
                await (0, email_1.sendPasswordResetEmail)(email, resetToken, baseUrl);
            }
            catch (emailErr) {
                console.error('Failed to send reset email:', emailErr);
            }
        }
        // Always return success to prevent user enumeration
        res.json({ message: 'If an account exists, a reset email has been sent' });
    }
    catch (err) {
        console.error('Forgot password error:', err);
        res.status(500).json({ error: 'Failed to process request' });
    }
});
// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) {
        res.status(400).json({ error: 'Token and password required' });
        return;
    }
    if (password.length < 8) {
        res.status(400).json({ error: 'Password must be at least 8 characters' });
        return;
    }
    try {
        const password_hash = await bcryptjs_1.default.hash(password, 10);
        const { rows } = await db_1.pool.query(`UPDATE users SET password_hash = $1, password_reset_token = NULL, password_reset_expires = NULL
       WHERE password_reset_token = $2 AND password_reset_expires > NOW()
       RETURNING id`, [password_hash, token]);
        if (rows.length === 0) {
            res.status(400).json({ error: 'Invalid or expired reset token' });
            return;
        }
        res.json({ message: 'Password reset successfully' });
    }
    catch (err) {
        console.error('Reset password error:', err);
        res.status(500).json({ error: 'Failed to reset password' });
    }
});
// GET /api/auth/me
router.get('/me', auth_1.requireAuth, async (req, res) => {
    try {
        const { rows: userRows } = await db_1.pool.query('SELECT id, email, email_verified, created_at FROM users WHERE id = $1', [req.user.id]);
        const { rows: profileRows } = await db_1.pool.query('SELECT * FROM profiles WHERE id = $1', [req.user.id]);
        const { rows: roleRows } = await db_1.pool.query(`SELECT role FROM user_roles WHERE user_id = $1
       ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'driver' THEN 1 WHEN 'partner' THEN 2 WHEN 'investor' THEN 3 ELSE 4 END
       LIMIT 1`, [req.user.id]);
        if (!userRows[0]) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        res.json({
            user: userRows[0],
            profile: profileRows[0] || null,
            role: roleRows[0]?.role || null,
        });
    }
    catch (err) {
        console.error('Get user error:', err);
        res.status(500).json({ error: 'Failed to get user' });
    }
});
// POST /api/auth/logout
router.post('/logout', auth_1.requireAuth, (_req, res) => {
    // JWT is stateless — client just drops the token.
    // Add token to a blocklist here if you need server-side revocation.
    res.json({ message: 'Logged out' });
});
exports.default = router;
