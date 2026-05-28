import { Router, Response, Request } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { pool } from '../db';
import { requireAuth } from '../middleware/auth';
import { AuthRequest } from '../types';

const uploadsDir = path.join(__dirname, '../../uploads/driver-docs');
const avatarsDir = path.join(__dirname, '../../uploads/avatars');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, file, cb) => {
    cb(null, file.fieldname === 'avatar' ? avatarsDir : uploadsDir);
  },
  filename: (req: Request, file, cb) => {
    const userId = (req as AuthRequest).user?.id || 'unknown';
    const ext = path.extname(file.originalname);
    cb(null, `${userId}-${file.fieldname}-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.pdf'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

const docFields = [
  { name: 'id_photo', maxCount: 1 },
  { name: 'license_photo', maxCount: 1 },
  { name: 'vehicle_photo', maxCount: 1 },
  { name: 'nric', maxCount: 1 },
  { name: 'vehicle_id_card', maxCount: 1 },
  { name: 'technical_inspection', maxCount: 1 },
  { name: 'taxi_license', maxCount: 1 },
  { name: 'vaccination_card', maxCount: 1 },
  { name: 'avatar', maxCount: 1 },
];

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
  const allowed = ['vehicle_type', 'plate_number', 'vehicle_color', 'vehicle_brand', 'vehicle_model', 'is_online', 'current_lat', 'current_lng', 'last_location_update', 'suspend_after_ride', 'pending_earnings', 'is_active'];
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
  upload.fields(docFields),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const files = req.files as Record<string, Express.Multer.File[]>;
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const docUrl = (fieldName: string) =>
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
          docUrl('id_photo'), docUrl('license_photo'), docUrl('vehicle_photo'),
          docUrl('nric'), docUrl('vehicle_id_card'), docUrl('technical_inspection'),
          docUrl('taxi_license'), docUrl('vaccination_card'),
          bank_name, bank_account_number, bank_account_holder,
          date_of_birth || null, national_id_number, address, city, vehicle_brand, vehicle_model, vehicle_year || null,
        ]
      );

      const upsertDoc = async (driverId: string, docType: string, url: string) => {
        await pool.query(
          `INSERT INTO driver_documents (driver_id, document_type, file_url, status, uploaded_at)
           VALUES ($1, $2, $3, 'pending', NOW())
           ON CONFLICT (driver_id, document_type) DO UPDATE SET
             file_url = EXCLUDED.file_url, status = 'pending', uploaded_at = NOW()`,
          [driverId, docType, url]
        ).catch((e) => console.error(`driver_documents upsert [${docType}]:`, e.message));
      };

      // Upsert driver_documents for each uploaded file
      const docTypeMap: Record<string, string> = {
        nric: 'nric',
        license_photo: 'driver_license',
        vehicle_photo: 'vehicle_photo',
        vehicle_id_card: 'vehicle_id_card',
        technical_inspection: 'technical_inspection',
        taxi_license: 'taxi_license',
        vaccination_card: 'vaccination_card',
      };
      for (const [fieldName, docType] of Object.entries(docTypeMap)) {
        const url = docUrl(fieldName);
        if (url) await upsertDoc(req.user!.id, docType, url);
      }

      // Update profile avatar and store as id_photo document
      if (files?.avatar?.[0]) {
        const avatarUrl = `${baseUrl}/uploads/avatars/${files.avatar[0].filename}`;
        await pool.query('UPDATE profiles SET avatar_url = $1 WHERE id = $2', [avatarUrl, req.user!.id])
          .catch((e) => console.error('avatar profile update:', e.message));
        await upsertDoc(req.user!.id, 'id_photo', avatarUrl);
      }

      res.status(201).json(rows[0]);
    } catch (err) {
      console.error('Create application error:', err);
      res.status(500).json({ error: 'Failed to submit application' });
    }
  }
);

// PATCH /api/driver/application/:id  (resubmission)
router.patch(
  '/application/:id',
  requireAuth,
  upload.fields(docFields),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { id } = req.params;
    const files = req.files as Record<string, Express.Multer.File[]>;
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

    // Verify ownership
    const { rows: existing } = await pool.query(
      'SELECT * FROM driver_applications WHERE id = $1 AND user_id = $2',
      [id, req.user!.id]
    );
    if (!existing.length) {
      res.status(404).json({ error: 'Application not found' });
      return;
    }
    const app = existing[0];

    const docUrl = (fieldName: string, existingUrl: string | null) =>
      files?.[fieldName]?.[0]
        ? `${baseUrl}/uploads/driver-docs/${files[fieldName][0].filename}`
        : existingUrl;

    const {
      full_name, phone, vehicle_type, vehicle_color, plate_number,
      years_experience, languages_spoken, bank_name, bank_account_number, bank_account_holder,
      date_of_birth, national_id_number, address, city,
      vehicle_brand, vehicle_model, vehicle_year,
    } = req.body;

    try {
      const { rows } = await pool.query(
        `UPDATE driver_applications SET
          full_name=$2, phone=$3, vehicle_type=$4, vehicle_color=$5, plate_number=$6,
          years_experience=$7, languages_spoken=$8,
          id_photo_url=$9, license_photo_url=$10, vehicle_photo_url=$11,
          nric_url=$12, vehicle_id_card_url=$13, technical_inspection_url=$14,
          taxi_license_url=$15, vaccination_card_url=$16,
          bank_name=$17, bank_account_number=$18, bank_account_holder=$19,
          date_of_birth=$20, national_id_number=$21, address=$22, city=$23,
          vehicle_brand=$24, vehicle_model=$25, vehicle_year=$26,
          status='pending'
         WHERE id=$1 AND user_id=$27
         RETURNING *`,
        [
          id,
          full_name, phone, vehicle_type, vehicle_color, plate_number,
          years_experience, languages_spoken ? JSON.parse(languages_spoken) : [],
          docUrl('id_photo', app.id_photo_url), docUrl('license_photo', app.license_photo_url),
          docUrl('vehicle_photo', app.vehicle_photo_url),
          docUrl('nric', app.nric_url), docUrl('vehicle_id_card', app.vehicle_id_card_url),
          docUrl('technical_inspection', app.technical_inspection_url),
          docUrl('taxi_license', app.taxi_license_url), docUrl('vaccination_card', app.vaccination_card_url),
          bank_name, bank_account_number, bank_account_holder,
          date_of_birth || null, national_id_number, address, city,
          vehicle_brand, vehicle_model, vehicle_year || null,
          req.user!.id,
        ]
      );

      const upsertDoc = async (driverId: string, docType: string, url: string) => {
        await pool.query(
          `INSERT INTO driver_documents (driver_id, document_type, file_url, status, uploaded_at)
           VALUES ($1, $2, $3, 'pending', NOW())
           ON CONFLICT (driver_id, document_type) DO UPDATE SET
             file_url = EXCLUDED.file_url, status = 'pending', uploaded_at = NOW()`,
          [driverId, docType, url]
        ).catch((e) => console.error(`driver_documents upsert [${docType}]:`, e.message));
      };

      // Update profile avatar and store as id_photo document
      if (files?.avatar?.[0]) {
        const avatarUrl = `${baseUrl}/uploads/avatars/${files.avatar[0].filename}`;
        await pool.query('UPDATE profiles SET avatar_url = $1 WHERE id = $2', [avatarUrl, req.user!.id])
          .catch((e) => console.error('avatar profile update:', e.message));
        await upsertDoc(req.user!.id, 'id_photo', avatarUrl);
      }

      // Upsert driver_documents for each newly uploaded file
      const docTypeMap: Record<string, string> = {
        nric: 'nric',
        license_photo: 'driver_license',
        vehicle_photo: 'vehicle_photo',
        vehicle_id_card: 'vehicle_id_card',
        technical_inspection: 'technical_inspection',
        taxi_license: 'taxi_license',
        vaccination_card: 'vaccination_card',
      };
      for (const [fieldName, docType] of Object.entries(docTypeMap)) {
        if (files?.[fieldName]?.[0]) {
          const url = `${baseUrl}/uploads/driver-docs/${files[fieldName][0].filename}`;
          await upsertDoc(req.user!.id, docType, url);
        }
      }

      res.json(rows[0]);
    } catch (err) {
      console.error('Update application error:', err);
      res.status(500).json({ error: 'Failed to update application' });
    }
  }
);

export default router;
