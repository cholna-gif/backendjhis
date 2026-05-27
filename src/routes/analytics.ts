import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { requireAuth } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

// POST /api/analytics/events — fire-and-forget, auth optional
router.post('/events', async (req: Request, res: Response): Promise<void> => {
  const { event_name, event_category, properties, page, session_id } = req.body;
  if (!event_name) {
    res.status(400).json({ error: 'event_name required' });
    return;
  }

  let userId: string | null = null;
  const authHeader = req.headers.authorization?.split(' ')[1];
  if (authHeader) {
    try {
      const jwt = await import('jsonwebtoken');
      const payload = jwt.default.verify(authHeader, process.env.JWT_SECRET!) as { id: string };
      userId = payload.id;
    } catch { /* unauthenticated event is fine */ }
  }

  try {
    await pool.query(
      `INSERT INTO analytics_events (event_name, event_category, properties, page, session_id, user_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [event_name, event_category || 'other', JSON.stringify(properties || {}), page, session_id, userId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Analytics insert error:', err);
    res.status(500).json({ error: 'Failed to record event' });
  }
});

// GET /api/analytics/events — admin only
router.get('/events', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user!.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const { rows } = await pool.query(
      'SELECT * FROM analytics_events ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    res.json(rows);
  } catch (err) {
    console.error('Get analytics error:', err);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

export default router;
