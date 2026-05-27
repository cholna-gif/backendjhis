import { Router, Response } from 'express';
import { pool } from '../db';
import { requireAuth } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

// GET /api/rides — own rides (passenger or driver)
router.get('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const role = req.user!.role;

  try {
    let rows;
    if (role === 'admin') {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const offset = Number(req.query.offset) || 0;
      ({ rows } = await pool.query(
        'SELECT * FROM rides ORDER BY created_at DESC LIMIT $1 OFFSET $2',
        [limit, offset]
      ));
    } else if (role === 'driver') {
      ({ rows } = await pool.query(
        `SELECT * FROM rides WHERE driver_id = $1 OR (status = 'pending' AND driver_id IS NULL)
         ORDER BY created_at DESC LIMIT 50`,
        [userId]
      ));
    } else {
      ({ rows } = await pool.query(
        'SELECT * FROM rides WHERE passenger_id = $1 ORDER BY created_at DESC LIMIT 50',
        [userId]
      ));
    }
    res.json(rows);
  } catch (err) {
    console.error('Get rides error:', err);
    res.status(500).json({ error: 'Failed to get rides' });
  }
});

// GET /api/rides/:id
router.get('/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.user!.id;
  const role = req.user!.role;

  try {
    const { rows } = await pool.query('SELECT * FROM rides WHERE id = $1', [id]);
    if (!rows[0]) {
      res.status(404).json({ error: 'Ride not found' });
      return;
    }
    const ride = rows[0];
    const canAccess =
      role === 'admin' ||
      ride.passenger_id === userId ||
      ride.driver_id === userId;
    if (!canAccess) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    res.json(ride);
  } catch (err) {
    console.error('Get ride error:', err);
    res.status(500).json({ error: 'Failed to get ride' });
  }
});

// POST /api/rides — create booking
router.post('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const {
    booking_type, pickup_address, pickup_lat, pickup_lng,
    destination_address, destination_lat, destination_lng,
    stops, vehicle_type, estimated_fare, payment_method,
  } = req.body;

  try {
    const { rows } = await pool.query(
      `INSERT INTO rides
        (passenger_id, booking_type, pickup_address, pickup_lat, pickup_lng,
         destination_address, destination_lat, destination_lng, stops,
         vehicle_type, estimated_fare, payment_method, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending') RETURNING *`,
      [
        userId, booking_type || 'standard', pickup_address, pickup_lat, pickup_lng,
        destination_address, destination_lat, destination_lng,
        JSON.stringify(stops || []), vehicle_type, estimated_fare, payment_method || 'cash',
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Create ride error:', err);
    res.status(500).json({ error: 'Failed to create ride' });
  }
});

// PATCH /api/rides/:id — update status, assign driver, ratings, etc.
router.patch('/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.user!.id;
  const role = req.user!.role;

  try {
    const { rows: existing } = await pool.query('SELECT * FROM rides WHERE id = $1', [id]);
    if (!existing[0]) {
      res.status(404).json({ error: 'Ride not found' });
      return;
    }
    const ride = existing[0];

    const canEdit =
      role === 'admin' ||
      ride.passenger_id === userId ||
      ride.driver_id === userId ||
      (role === 'driver' && ride.status === 'pending');

    if (!canEdit) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const allowed = [
      'status', 'driver_id', 'final_fare', 'driver_earnings',
      'passenger_rating', 'driver_rating', 'passenger_review', 'driver_review',
      'completed_at', 'cancelled_at', 'cancellation_reason',
      'arrived_at', 'started_at',
    ];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in req.body) updates[key] = req.body[key];
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No valid fields to update' });
      return;
    }

    const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
    const values = [id, ...Object.values(updates)];

    const { rows } = await pool.query(
      `UPDATE rides SET ${setClauses} WHERE id = $1 RETURNING *`,
      values
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Update ride error:', err);
    res.status(500).json({ error: 'Failed to update ride' });
  }
});

export default router;
