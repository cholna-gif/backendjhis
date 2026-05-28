import { Router, Response } from 'express';
import { pool } from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();
router.use(requireAuth, requireRole('admin'));

const ALLOWED_TABLES = new Set([
  'profiles', 'user_roles', 'driver_profiles', 'driver_applications',
  'driver_documents', 'rides', 'notifications', 'analytics_events',
  'donations', 'wallet_transactions', 'audit_logs', 'admin_settings',
  'support_tickets', 'incident_reports', 'disputes', 'fare_adjustments',
  'hotel_partners', 'traffic_messages', 'broadcast_messages',
  'cms_content', 'cms_images', 'driver_subscriptions', 'app_waitlist',
  'favorite_drivers', 'driver_locations', 'profile_update_requests',
  // additional tables
  'ride_ratings', 'users',
  'withdrawals', 'driver_leads', 'mool_transfers',
  'partner_bookings', 'partner_invoices',
  'consent_records', 'gdpr_requests', 'ride_logs', 'refunds',
]);

const COL_RE = /^[a-z_][a-z0-9_]*$/;
const safeCol = (s: string) => COL_RE.test(s);

function buildWhere(
  query: Record<string, string>,
  paramOffset = 0,
): { sql: string; values: unknown[]; nextIdx: number } {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = paramOffset + 1;

  for (const [key, val] of Object.entries(query)) {
    if (key.startsWith('eq_')) {
      const col = key.slice(3);
      if (!safeCol(col)) continue;
      conditions.push(`${col} = $${idx++}`);
      values.push(val);
    } else if (key.startsWith('neq_')) {
      const col = key.slice(4);
      if (!safeCol(col)) continue;
      conditions.push(`${col} != $${idx++}`);
      values.push(val);
    } else if (key.startsWith('in_')) {
      const col = key.slice(3);
      if (!safeCol(col)) continue;
      const arr = String(val).split(',').filter(Boolean);
      if (arr.length === 0) continue;
      const placeholders = arr.map(() => `$${idx++}`).join(', ');
      conditions.push(`${col} IN (${placeholders})`);
      values.push(...arr);
    } else if (key.startsWith('gte_')) {
      const col = key.slice(4);
      if (!safeCol(col)) continue;
      conditions.push(`${col} >= $${idx++}`);
      values.push(val);
    } else if (key.startsWith('lte_')) {
      const col = key.slice(4);
      if (!safeCol(col)) continue;
      conditions.push(`${col} <= $${idx++}`);
      values.push(val);
    } else if (key.startsWith('like_')) {
      const col = key.slice(5);
      if (!safeCol(col)) continue;
      conditions.push(`${col} ILIKE $${idx++}`);
      values.push(`%${val}%`);
    }
  }

  return {
    sql: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    values,
    nextIdx: idx,
  };
}

// GET /api/db/:table
router.get('/:table', async (req: AuthRequest, res: Response): Promise<void> => {
  const table = req.params.table as string;
  if (!ALLOWED_TABLES.has(table)) { res.status(403).json({ error: 'Table not allowed' }); return; }

  const { select = '*', order_by, limit, offset, ...filters } = req.query as Record<string, string>;
  const { sql: whereSql, values } = buildWhere(filters);

  let orderSql = '';
  if (order_by) {
    const [col, dir] = String(order_by).split('.');
    if (safeCol(col) && (dir === 'asc' || dir === 'desc' || !dir)) {
      orderSql = `ORDER BY ${col} ${dir || 'asc'}`;
    }
  }
  const limitSql = limit && !isNaN(Number(limit)) ? `LIMIT ${Number(limit)}` : '';
  const offsetSql = offset && !isNaN(Number(offset)) ? `OFFSET ${Number(offset)}` : '';

  // Build SELECT — strip Supabase join syntax like "profiles(email)"
  let selectCols = '*';
  if (select && select !== '*' && !String(select).includes('(')) {
    const cols = String(select).split(',').map(c => c.trim()).filter(safeCol);
    if (cols.length > 0) selectCols = cols.join(', ');
  }

  // Special JOINs per table — use subqueries so WHERE/ORDER cols are never ambiguous
  let fromClause = table;
  if (table === 'driver_applications') {
    fromClause = `(SELECT da.*, p.email AS email FROM driver_applications da LEFT JOIN profiles p ON p.id = da.user_id) driver_applications`;
  } else if (table === 'withdrawals') {
    fromClause = `(SELECT w.*, p.full_name AS driver_name, p.email AS driver_email FROM withdrawals w LEFT JOIN profiles p ON p.id = w.driver_id) withdrawals`;
  } else if (table === 'partner_bookings') {
    fromClause = `(SELECT pb.*, hp.name AS hotel_name FROM partner_bookings pb LEFT JOIN hotel_partners hp ON hp.id = pb.hotel_id) partner_bookings`;
  } else if (table === 'partner_invoices') {
    fromClause = `(SELECT pi.*, hp.name AS hotel_name FROM partner_invoices pi LEFT JOIN hotel_partners hp ON hp.id = pi.hotel_id) partner_invoices`;
  }

  try {
    const q = `SELECT ${selectCols} FROM ${fromClause} ${whereSql} ${orderSql} ${limitSql} ${offsetSql}`;
    const { rows } = await pool.query(q, values);
    res.json(rows);
  } catch (err: any) {
    console.error(`DB GET ${table}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/db/:table  (insert single or array)
router.post('/:table', async (req: AuthRequest, res: Response): Promise<void> => {
  const table = req.params.table as string;
  if (!ALLOWED_TABLES.has(table)) { res.status(403).json({ error: 'Table not allowed' }); return; }

  const payload = req.body;
  const rows = Array.isArray(payload) ? payload : [payload];
  if (rows.length === 0) { res.status(400).json({ error: 'Empty payload' }); return; }

  const cols = Object.keys(rows[0]).filter(safeCol);
  if (cols.length === 0) { res.status(400).json({ error: 'No valid columns' }); return; }

  const rowPlaceholders: string[] = [];
  const allValues: unknown[] = [];
  let idx = 1;
  for (const row of rows) {
    rowPlaceholders.push(`(${cols.map(() => `$${idx++}`).join(', ')})`);
    allValues.push(...cols.map(c => row[c]));
  }

  try {
    const q = `INSERT INTO ${table} (${cols.join(', ')}) VALUES ${rowPlaceholders.join(', ')} RETURNING *`;
    const { rows: inserted } = await pool.query(q, allValues);

    // After approving a driver application, create driver profile + role
    if (table === 'driver_applications') {
      // handled via PATCH
    }

    res.status(201).json(Array.isArray(payload) ? inserted : inserted[0]);
  } catch (err: any) {
    console.error(`DB POST ${table}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/db/:table/upsert
router.post('/:table/upsert', async (req: AuthRequest, res: Response): Promise<void> => {
  const table = req.params.table as string;
  if (!ALLOWED_TABLES.has(table)) { res.status(403).json({ error: 'Table not allowed' }); return; }

  const { on_conflict } = req.query as Record<string, string>;
  const payload = Array.isArray(req.body) ? req.body : [req.body];
  if (payload.length === 0) { res.status(400).json({ error: 'Empty payload' }); return; }

  const cols = Object.keys(payload[0]).filter(safeCol);
  const conflictCols = on_conflict ? on_conflict.split(',').filter(safeCol) : ['id'];
  const updateCols = cols.filter(c => !conflictCols.includes(c));
  const updateSql = updateCols.length > 0
    ? `DO UPDATE SET ${updateCols.map(c => `${c} = EXCLUDED.${c}`).join(', ')}`
    : 'DO NOTHING';

  const rowPlaceholders: string[] = [];
  const allValues: unknown[] = [];
  let idx = 1;
  for (const row of payload) {
    rowPlaceholders.push(`(${cols.map(() => `$${idx++}`).join(', ')})`);
    allValues.push(...cols.map(c => row[c]));
  }

  try {
    const q = `
      INSERT INTO ${table} (${cols.join(', ')})
      VALUES ${rowPlaceholders.join(', ')}
      ON CONFLICT (${conflictCols.join(', ')}) ${updateSql}
      RETURNING *`;
    const { rows } = await pool.query(q, allValues);
    res.status(201).json(rows);
  } catch (err: any) {
    console.error(`DB UPSERT ${table}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/db/:table  (update rows matching WHERE from query params)
router.patch('/:table', async (req: AuthRequest, res: Response): Promise<void> => {
  const table = req.params.table as string;
  if (!ALLOWED_TABLES.has(table)) { res.status(403).json({ error: 'Table not allowed' }); return; }

  const payload = req.body;
  const updateCols = Object.keys(payload).filter(safeCol);
  if (updateCols.length === 0) { res.status(400).json({ error: 'No valid columns to update' }); return; }

  const setClauses = updateCols.map((c, i) => `${c} = $${i + 1}`).join(', ');
  const updateValues = updateCols.map(c => payload[c]);

  const { sql: whereSql, values: whereValues } = buildWhere(
    req.query as Record<string, string>,
    updateCols.length,
  );
  if (!whereSql) { res.status(400).json({ error: 'At least one filter required for update' }); return; }

  try {
    const q = `UPDATE ${table} SET ${setClauses} ${whereSql} RETURNING *`;
    const { rows } = await pool.query(q, [...updateValues, ...whereValues]);

    // If approving a driver application, auto-create driver profile + role
    if (table === 'driver_applications' && payload.status === 'approved' && rows.length > 0) {
      const app = rows[0];
      await pool.query(
        `INSERT INTO driver_profiles (user_id, vehicle_type, plate_number, vehicle_color, vehicle_brand, vehicle_model,
          is_id_verified, is_license_verified, is_vehicle_verified, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,true,true,true,true)
         ON CONFLICT (user_id) DO UPDATE SET
           vehicle_type=$2, plate_number=$3, vehicle_color=$4, vehicle_brand=$5, vehicle_model=$6,
           is_id_verified=true, is_license_verified=true, is_vehicle_verified=true, is_active=true`,
        [app.user_id, app.vehicle_type, app.plate_number, app.vehicle_color, app.vehicle_brand, app.vehicle_model]
      ).catch(() => {});
      await pool.query(
        `INSERT INTO user_roles (user_id, role) VALUES ($1, 'driver') ON CONFLICT (user_id, role) DO NOTHING`,
        [app.user_id]
      ).catch(() => {});
    }

    res.json(rows);
  } catch (err: any) {
    console.error(`DB PATCH ${table}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/db/:table
router.delete('/:table', async (req: AuthRequest, res: Response): Promise<void> => {
  const table = req.params.table as string;
  if (!ALLOWED_TABLES.has(table)) { res.status(403).json({ error: 'Table not allowed' }); return; }

  const { sql: whereSql, values } = buildWhere(req.query as Record<string, string>);
  if (!whereSql) { res.status(400).json({ error: 'At least one filter required for delete' }); return; }

  try {
    const q = `DELETE FROM ${table} ${whereSql} RETURNING *`;
    const { rows } = await pool.query(q, values);
    res.json(rows);
  } catch (err: any) {
    console.error(`DB DELETE ${table}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
