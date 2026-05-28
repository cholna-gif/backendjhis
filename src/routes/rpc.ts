import { Router, Response } from 'express';
import { pool } from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import { AuthRequest } from '../types';
import { sendEmail } from '../lib/email';

const router = Router();
router.use(requireAuth, requireRole('admin'));

// POST /api/rpc/log_admin_action
router.post('/log_admin_action', async (req: AuthRequest, res: Response): Promise<void> => {
  const { p_action_type, p_target_type, p_target_id, p_target_name, p_details } = req.body;
  try {
    await pool.query(
      `INSERT INTO audit_logs
         (user_id, action, table_name, record_id, new_data,
          performed_by, action_type, target_type, target_id, target_name, details)
       VALUES ($1,$2,$3,$4,$5, $1,$6,$7,$8,$9,$5)`,
      [
        req.user!.id,
        `${p_action_type}${p_target_name ? ` — ${p_target_name}` : ''}`,
        p_target_type || null,
        p_target_id || null,
        p_details ? JSON.stringify(p_details) : null,
        p_action_type || null,
        p_target_type || null,
        p_target_id ? String(p_target_id) : null,
        p_target_name || null,
      ],
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error('RPC log_admin_action:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rpc/admin_adjust_wallet
router.post('/admin_adjust_wallet', async (req: AuthRequest, res: Response): Promise<void> => {
  const { p_user_id, p_amount, p_reason, p_type } = req.body;
  if (!p_user_id || p_amount == null) {
    res.status(400).json({ error: 'p_user_id and p_amount are required' });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE profiles SET wallet_balance = wallet_balance + $1 WHERE id = $2`,
      [p_amount, p_user_id],
    );
    await client.query(
      `INSERT INTO wallet_transactions (user_id, amount, reason, type, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [p_user_id, p_amount, p_reason || null, p_type || (p_amount >= 0 ? 'credit' : 'debit'), req.user!.id],
    );
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('RPC admin_adjust_wallet:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/rpc/send_driver_email  (called by supabase.functions.invoke)
router.post('/send_driver_email', async (req: AuthRequest, res: Response): Promise<void> => {
  const { to, subject, html, applicationId } = req.body;
  if (!to || !subject || !html) {
    res.status(400).json({ error: 'to, subject and html are required' });
    return;
  }
  try {
    await sendEmail(to, subject, html);
    if (applicationId) {
      await pool.query(
        `UPDATE driver_applications SET email_sent = true, email_sent_at = NOW() WHERE id = $1`,
        [applicationId],
      ).catch(() => {});
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error('RPC send_driver_email:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
