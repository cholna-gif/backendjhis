import { Router, Response } from 'express';
import { pool } from '../db';
import { requireAuth } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

// GET /api/profile
router.get('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { rows } = await pool.query('SELECT * FROM profiles WHERE id = $1', [req.user!.id]);
    if (!rows[0]) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// PATCH /api/profile
router.patch('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const allowed = ['full_name', 'phone', 'avatar_url', 'language'];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in req.body) updates[key] = req.body[key];
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'No valid fields to update' });
    return;
  }

  const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = [req.user!.id, ...Object.values(updates)];

  try {
    const { rows } = await pool.query(
      `UPDATE profiles SET ${setClauses} WHERE id = $1 RETURNING *`,
      values
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// GET /api/profile/:userId  (admin only — or own)
router.get('/:userId', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { userId } = req.params;
  const isOwnProfile = userId === req.user!.id;
  const isAdmin = req.user!.role === 'admin';

  if (!isOwnProfile && !isAdmin) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  try {
    const { rows } = await pool.query('SELECT * FROM profiles WHERE id = $1', [userId]);
    if (!rows[0]) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('Get profile by id error:', err);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

export default router;
