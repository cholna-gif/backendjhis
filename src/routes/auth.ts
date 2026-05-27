import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { pool } from '../db';
import { requireAuth } from '../middleware/auth';
import { AuthRequest } from '../types';
import { sendVerificationEmail, sendPasswordResetEmail } from '../lib/email';

const router = Router();

const makeToken = (payload: object, expiresIn: string = '7d') =>
  jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn } as jwt.SignOptions);

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  const { email, password, full_name, phone, role = 'passenger' } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    const password_hash = await bcrypt.hash(password, 10);
    const devAutoVerify = process.env.DEV_AUTO_VERIFY === 'true';
    const verificationToken = devAutoVerify ? null : crypto.randomBytes(32).toString('hex');
    const verificationExpiry = devAutoVerify ? null : new Date(Date.now() + 24 * 60 * 60 * 1000);

    const { rows } = await client.query(
      `INSERT INTO users (email, password_hash, email_verified, email_verification_token, email_verification_expires, raw_user_meta_data)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, email`,
      [email, password_hash, devAutoVerify, verificationToken, verificationExpiry, JSON.stringify({ full_name, role })]
    );
    const user = rows[0];

    await client.query(
      'INSERT INTO profiles (id, email, full_name, phone) VALUES ($1, $2, $3, $4)',
      [user.id, email, full_name || '', phone || null]
    );

    const validRole = ['passenger', 'driver', 'admin', 'partner', 'investor'].includes(role) ? role : 'passenger';
    await client.query(
      'INSERT INTO user_roles (user_id, role) VALUES ($1, $2) ON CONFLICT (user_id, role) DO NOTHING',
      [user.id, validRole]
    );

    await client.query('COMMIT');

    if (!devAutoVerify) {
      const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      try {
        await sendVerificationEmail(email, verificationToken!, baseUrl);
      } catch (emailErr) {
        console.error('Failed to send verification email:', emailErr);
      }
    }

    if (devAutoVerify) {
      const token = makeToken({ id: user.id, email: user.email, role: validRole });
      const { rows: profileRows } = await pool.query('SELECT * FROM profiles WHERE id = $1', [user.id]);
      res.status(201).json({ token, user: { id: user.id, email: user.email, email_verified: true }, profile: profileRows[0], role: validRole });
    } else {
      res.status(201).json({ message: 'Account created. Please verify your email.' });
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  } finally {
    client.release();
  }
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  try {
    const { rows } = await pool.query(
      'SELECT u.*, r.role FROM users u LEFT JOIN user_roles r ON r.user_id = u.id WHERE u.email = $1',
      [email]
    );
    const user = rows[0];

    if (!user || !user.password_hash) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    if (!user.email_verified) {
      res.status(403).json({ error: 'Please verify your email before logging in', code: 'email_not_verified' });
      return;
    }

    const token = makeToken({ id: user.id, email: user.email, role: user.role });

    const { rows: profileRows } = await pool.query('SELECT * FROM profiles WHERE id = $1', [user.id]);

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
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/verify?token=...
router.get('/verify', async (req: Request, res: Response): Promise<void> => {
  const { token } = req.query;
  if (!token) {
    res.status(400).json({ error: 'Token required' });
    return;
  }

  try {
    const { rows } = await pool.query(
      `UPDATE users SET email_verified = true, email_verification_token = NULL
       WHERE email_verification_token = $1 AND email_verification_expires > NOW()
       RETURNING id`,
      [token]
    );

    if (rows.length === 0) {
      res.status(400).json({ error: 'Invalid or expired verification token' });
      return;
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/auth?tab=login&verified=true`);
  } catch (err) {
    console.error('Verify error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// POST /api/auth/resend-verification
router.post('/resend-verification', async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body;
  if (!email) {
    res.status(400).json({ error: 'Email required' });
    return;
  }

  try {
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const { rows } = await pool.query(
      `UPDATE users SET email_verification_token = $1, email_verification_expires = $2
       WHERE email = $3 AND email_verified = false RETURNING id`,
      [verificationToken, verificationExpiry, email]
    );

    if (rows.length === 0) {
      res.status(400).json({ error: 'Email not found or already verified' });
      return;
    }

    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    await sendVerificationEmail(email, verificationToken, baseUrl);
    res.json({ message: 'Verification email resent' });
  } catch (err) {
    console.error('Resend verification error:', err);
    res.status(500).json({ error: 'Failed to resend verification email' });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body;
  if (!email) {
    res.status(400).json({ error: 'Email required' });
    return;
  }

  try {
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpiry = new Date(Date.now() + 60 * 60 * 1000);

    const { rows } = await pool.query(
      `UPDATE users SET password_reset_token = $1, password_reset_expires = $2
       WHERE email = $3 RETURNING id`,
      [resetToken, resetExpiry, email]
    );

    if (rows.length > 0) {
      const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      try {
        await sendPasswordResetEmail(email, resetToken, baseUrl);
      } catch (emailErr) {
        console.error('Failed to send reset email:', emailErr);
      }
    }

    // Always return success to prevent user enumeration
    res.json({ message: 'If an account exists, a reset email has been sent' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req: Request, res: Response): Promise<void> => {
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
    const password_hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `UPDATE users SET password_hash = $1, password_reset_token = NULL, password_reset_expires = NULL
       WHERE password_reset_token = $2 AND password_reset_expires > NOW()
       RETURNING id`,
      [password_hash, token]
    );

    if (rows.length === 0) {
      res.status(400).json({ error: 'Invalid or expired reset token' });
      return;
    }

    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { rows: userRows } = await pool.query(
      'SELECT id, email, email_verified, created_at FROM users WHERE id = $1',
      [req.user!.id]
    );
    const { rows: profileRows } = await pool.query('SELECT * FROM profiles WHERE id = $1', [req.user!.id]);
    const { rows: roleRows } = await pool.query('SELECT role FROM user_roles WHERE user_id = $1', [req.user!.id]);

    if (!userRows[0]) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({
      user: userRows[0],
      profile: profileRows[0] || null,
      role: roleRows[0]?.role || null,
    });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// POST /api/auth/logout
router.post('/logout', requireAuth, (_req, res: Response) => {
  // JWT is stateless — client just drops the token.
  // Add token to a blocklist here if you need server-side revocation.
  res.json({ message: 'Logged out' });
});

export default router;
