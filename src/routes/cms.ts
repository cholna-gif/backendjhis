import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

// GET /api/cms?page=&section=&key=
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const { page, section, key } = req.query as Record<string, string>;
  try {
    let q = pool.query.bind(pool);
    let sql = 'SELECT * FROM cms_content WHERE 1=1';
    const params: any[] = [];
    if (page) { params.push(page); sql += ` AND key LIKE $${params.length} || ':%'`; }
    // Simple key-value store: key is "page::section::fieldname"
    const fullKey = [page, section, key].filter(Boolean).join('::');
    if (fullKey) {
      const { rows } = await pool.query('SELECT value FROM cms_content WHERE key = $1', [fullKey]);
      res.json(rows[0]?.value ?? null);
      return;
    }
    const { rows } = await pool.query('SELECT key, value FROM cms_content');
    res.json(rows);
  } catch (err) {
    console.error('CMS get error:', err);
    res.status(500).json({ error: 'Failed to get CMS content' });
  }
});

// GET /api/cms/all — returns all CMS content as { key: value } map
router.get('/all', async (_req: Request, res: Response): Promise<void> => {
  try {
    const { rows } = await pool.query('SELECT key, value FROM cms_content');
    const map: Record<string, any> = {};
    for (const row of rows) map[row.key] = row.value;
    res.json(map);
  } catch (err) {
    console.error('CMS all error:', err);
    res.status(500).json({ error: 'Failed to get CMS content' });
  }
});

// PUT /api/cms/:key — admin only
router.put('/:key(*)', requireAuth, requireRole('admin'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { value } = req.body;
  const key = req.params.key;
  try {
    const { rows } = await pool.query(
      `INSERT INTO cms_content (key, value, updated_by) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = $3, updated_at = NOW()
       RETURNING *`,
      [key, JSON.stringify(value), req.user!.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('CMS put error:', err);
    res.status(500).json({ error: 'Failed to update CMS content' });
  }
});

// GET /api/cms/seo/:pageName
router.get('/seo/:pageName', async (req: Request, res: Response): Promise<void> => {
  try {
    const { rows } = await pool.query(
      "SELECT value FROM cms_content WHERE key = $1",
      [`seo::${req.params.pageName}`]
    );
    res.json(rows[0]?.value ?? null);
  } catch (err) {
    console.error('SEO get error:', err);
    res.status(500).json({ error: 'Failed to get SEO settings' });
  }
});

// GET /api/cms/traffic-messages
router.get('/traffic-messages', async (_req: Request, res: Response): Promise<void> => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM traffic_messages WHERE active = true ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error('Traffic messages error:', err);
    res.status(500).json({ error: 'Failed to get traffic messages' });
  }
});

// POST /api/cms/traffic-messages — admin only
router.post('/traffic-messages', requireAuth, requireRole('admin'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { message } = req.body;
  if (!message) { res.status(400).json({ error: 'message required' }); return; }
  try {
    const { rows } = await pool.query(
      'INSERT INTO traffic_messages (message, created_by) VALUES ($1, $2) RETURNING *',
      [message, req.user!.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Create traffic message error:', err);
    res.status(500).json({ error: 'Failed to create traffic message' });
  }
});

export default router;
