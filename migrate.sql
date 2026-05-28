-- Migration: add missing columns and tables
-- Run: node migrate.js

-- profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN DEFAULT false;

-- driver_profiles
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS suspend_after_ride BOOLEAN DEFAULT false;
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS is_id_verified BOOLEAN DEFAULT false;
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS is_license_verified BOOLEAN DEFAULT false;
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS is_vehicle_verified BOOLEAN DEFAULT false;
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS speaks_english BOOLEAN DEFAULT false;
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS tourist_friendly BOOLEAN DEFAULT false;
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS disability_support BOOLEAN DEFAULT false;
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS years_experience INTEGER;
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS languages_spoken TEXT[];

-- driver_applications
ALTER TABLE driver_applications ADD COLUMN IF NOT EXISTS internal_notes TEXT;
ALTER TABLE driver_applications DROP CONSTRAINT IF EXISTS driver_applications_status_check;
ALTER TABLE driver_applications ADD CONSTRAINT driver_applications_status_check
  CHECK (status IN ('pending', 'under_review', 'approved', 'rejected', 'needs_resubmission'));

-- rides
ALTER TABLE rides ADD COLUMN IF NOT EXISTS matched_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS cancelled_by TEXT;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'unpaid';
ALTER TABLE rides ADD COLUMN IF NOT EXISTS offered_fare DOUBLE PRECISION;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS agreed_price DOUBLE PRECISION;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS ride_type TEXT DEFAULT 'private';
ALTER TABLE rides ADD COLUMN IF NOT EXISTS hire_description TEXT;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS scheduled_datetime TIMESTAMP WITH TIME ZONE;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS preferred_driver_id UUID;

-- favorite_drivers (mobile app)
CREATE TABLE IF NOT EXISTS favorite_drivers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  driver_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (passenger_id, driver_id)
);

-- driver_locations (live tracking)
CREATE TABLE IF NOT EXISTS driver_locations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id  UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  lat        DOUBLE PRECISION NOT NULL,
  lng        DOUBLE PRECISION NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- profile_update_requests (admin panel)
CREATE TABLE IF NOT EXISTS profile_update_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  field_name  TEXT NOT NULL,
  old_value   TEXT,
  new_value   TEXT,
  status      TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMP WITH TIME ZONE,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- audit_logs — add columns expected by the admin UI
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS performed_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS action_type TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS target_type TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS target_id TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS target_name TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS details JSONB;

-- indexes
CREATE INDEX IF NOT EXISTS idx_favorite_drivers_passenger ON favorite_drivers(passenger_id);
CREATE INDEX IF NOT EXISTS idx_driver_locations_driver ON driver_locations(driver_id);
CREATE INDEX IF NOT EXISTS idx_profile_update_requests_user ON profile_update_requests(user_id);
