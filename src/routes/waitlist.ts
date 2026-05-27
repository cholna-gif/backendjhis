import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { requireAuth } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

// POST /api/waitlist
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const { phone } = req.body;
  if (!phone) {
    res.status(400).json({ error: 'Phone number required' });
    return;
  }
  try {
    await pool.query(
      'INSERT INTO app_waitlist (phone) VALUES ($1) ON CONFLICT (phone) DO NOTHING',
      [phone]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Waitlist error:', err);
    res.status(500).json({ error: 'Failed to join waitlist' });
  }
});

// GET /api/waitlist — admin only
router.get('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user!.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  try {
    const { rows } = await pool.query('SELECT * FROM app_waitlist ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    console.error('Get waitlist error:', err);
    res.status(500).json({ error: 'Failed to get waitlist' });
  }
});

export default router;
