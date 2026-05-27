import { Router, Response, Request } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { pool } from '../db';
import { requireAuth } from '../middleware/auth';
import { AuthRequest } from '../types';

const uploadsDir = path.join(__dirname, '../../uploads/driver-docs');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (req: Request, file, cb) => {
    const userId = (req as AuthRequest).user?.id || 'unknown';
    const ext = path.extname(file.originalname);
    cb(null, `${userId}-${file.fieldname}-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.pdf'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

const router = Router();

// GET /api/driver/profile
router.get('/profile', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM driver_profiles WHERE user_id = $1',
      [req.user!.id]
    );
    res.json(rows[0] || null);
  } catch (err) {
    console.error('Get driver profile error:', err);
    res.status(500).json({ error: 'Failed to get driver profile' });
  }
});

// PATCH /api/driver/profile
router.patch('/profile', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const allowed = ['vehicle_type', 'plate_number', 'vehicle_color', 'vehicle_brand', 'vehicle_model', 'is_online', 'current_lat', 'current_lng', 'last_location_update'];
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
      `INSERT INTO driver_profiles (user_id, ${Object.keys(updates).join(', ')})
       VALUES ($1, ${Object.keys(updates).map((_, i) => `$${i + 2}`).join(', ')})
       ON CONFLICT (user_id) DO UPDATE SET ${setClauses}
       RETURNING *`,
      values
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Update driver profile error:', err);
    res.status(500).json({ error: 'Failed to update driver profile' });
  }
});

// GET /api/driver/application
router.get('/application', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM driver_applications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [req.user!.id]
    );
    res.json(rows[0] || null);
  } catch (err) {
    console.error('Get application error:', err);
    res.status(500).json({ error: 'Failed to get application' });
  }
});

// POST /api/driver/application
router.post(
  '/application',
  requireAuth,
  upload.fields([
    { name: 'id_photo', maxCount: 1 },
    { name: 'license_photo', maxCount: 1 },
    { name: 'vehicle_photo', maxCount: 1 },
    { name: 'nric', maxCount: 1 },
    { name: 'vehicle_id_card', maxCount: 1 },
    { name: 'technical_inspection', maxCount: 1 },
    { name: 'taxi_license', maxCount: 1 },
    { name: 'vaccination_card', maxCount: 1 },
  ]),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const files = req.files as Record<string, Express.Multer.File[]>;
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const fileUrl = (fieldName: string) =>
      files?.[fieldName]?.[0]
        ? `${baseUrl}/uploads/driver-docs/${files[fieldName][0].filename}`
        : null;

    const {
      full_name, phone, vehicle_type, vehicle_color, plate_number,
      years_experience, languages_spoken, bank_name, bank_account_number, bank_account_holder,
      date_of_birth, national_id_number, address, city,
      vehicle_brand, vehicle_model, vehicle_year,
    } = req.body;

    try {
      const { rows } = await pool.query(
        `INSERT INTO driver_applications
          (user_id, full_name, phone, vehicle_type, vehicle_color, plate_number,
           years_experience, languages_spoken, id_photo_url, license_photo_url, vehicle_photo_url,
           nric_url, vehicle_id_card_url, technical_inspection_url, taxi_license_url, vaccination_card_url,
           bank_name, bank_account_number, bank_account_holder,
           date_of_birth, national_id_number, address, city, vehicle_brand, vehicle_model, vehicle_year,
           status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,'pending')
         RETURNING *`,
        [
          req.user!.id, full_name, phone, vehicle_type, vehicle_color, plate_number,
          years_experience, languages_spoken ? JSON.parse(languages_spoken) : [],
          fileUrl('id_photo'), fileUrl('license_photo'), fileUrl('vehicle_photo'),
          fileUrl('nric'), fileUrl('vehicle_id_card'), fileUrl('technical_inspection'),
          fileUrl('taxi_license'), fileUrl('vaccination_card'),
          bank_name, bank_account_number, bank_account_holder,
          date_of_birth, national_id_number, address, city, vehicle_brand, vehicle_model, vehicle_year,
        ]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      console.error('Create application error:', err);
      res.status(500).json({ error: 'Failed to submit application' });
    }
  }
);

export default router;
