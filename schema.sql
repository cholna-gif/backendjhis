-- JihWorld PostgreSQL Schema
-- Run this on a fresh database: psql -U postgres -d jihwolrd -f schema.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── ENUMS ───────────────────────────────────────────────────────────────────
CREATE TYPE app_role AS ENUM ('passenger', 'driver', 'admin', 'partner', 'investor');

-- ─── USERS (replaces auth.users) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                       TEXT UNIQUE NOT NULL,
  password_hash               TEXT,
  email_verified              BOOLEAN DEFAULT false,
  email_verification_token    TEXT,
  email_verification_expires  TIMESTAMP WITH TIME ZONE,
  password_reset_token        TEXT,
  password_reset_expires      TIMESTAMP WITH TIME ZONE,
  raw_user_meta_data          JSONB DEFAULT '{}',
  created_at                  TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ─── PROFILES ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name       TEXT,
  email           TEXT,
  phone           TEXT,
  avatar_url      TEXT,
  language        TEXT DEFAULT 'en',
  wallet_balance  NUMERIC DEFAULT 0,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ─── USER ROLES ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_roles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       app_role NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (user_id, role)
);

-- ─── DRIVER APPLICATIONS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_applications (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name                 TEXT,
  phone                     TEXT,
  vehicle_type              TEXT CHECK (vehicle_type IN ('tuktuk', 'car', 'moto', 'van')),
  vehicle_color             TEXT,
  vehicle_brand             TEXT,
  vehicle_model             TEXT,
  vehicle_year              INTEGER,
  plate_number              TEXT,
  years_experience          INTEGER,
  languages_spoken          TEXT[],
  date_of_birth             DATE,
  national_id_number        TEXT,
  address                   TEXT,
  city                      TEXT,
  id_photo_url              TEXT,
  license_photo_url         TEXT,
  vehicle_photo_url         TEXT,
  nric_url                  TEXT,
  vehicle_id_card_url       TEXT,
  technical_inspection_url  TEXT,
  taxi_license_url          TEXT,
  vaccination_card_url      TEXT,
  bank_name                 TEXT,
  bank_account_number       TEXT,
  bank_account_holder       TEXT,
  status                    TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_notes               TEXT,
  rejection_reason          TEXT,
  reviewed_by               UUID REFERENCES users(id),
  reviewed_at               TIMESTAMP WITH TIME ZONE,
  email_sent                BOOLEAN DEFAULT false,
  email_sent_at             TIMESTAMP WITH TIME ZONE,
  resubmission_count        INTEGER DEFAULT 0,
  draft_data                JSONB,
  created_at                TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ─── DRIVER PROFILES ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_profiles (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  vehicle_type         TEXT,
  plate_number         TEXT,
  vehicle_color        TEXT,
  vehicle_brand        TEXT,
  vehicle_model        TEXT,
  is_online            BOOLEAN DEFAULT false,
  current_lat          DOUBLE PRECISION,
  current_lng          DOUBLE PRECISION,
  last_location_update TIMESTAMP WITH TIME ZONE,
  has_active_ride      BOOLEAN DEFAULT false,
  total_earnings       DOUBLE PRECISION DEFAULT 0,
  total_rides          INTEGER DEFAULT 0,
  average_rating       DOUBLE PRECISION DEFAULT 0,
  created_at           TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ─── RIDES ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rides (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  driver_id            UUID REFERENCES users(id),
  booking_type         TEXT DEFAULT 'standard',
  status               TEXT DEFAULT 'pending',
  pickup_address       TEXT,
  pickup_lat           DOUBLE PRECISION,
  pickup_lng           DOUBLE PRECISION,
  destination_address  TEXT,
  destination_lat      DOUBLE PRECISION,
  destination_lng      DOUBLE PRECISION,
  stops                JSONB DEFAULT '[]',
  vehicle_type         TEXT,
  estimated_fare       DOUBLE PRECISION,
  final_fare           DOUBLE PRECISION,
  driver_earnings      DOUBLE PRECISION,
  distance_km          DOUBLE PRECISION,
  duration_minutes     INTEGER,
  payment_method       TEXT DEFAULT 'cash',
  passenger_rating     INTEGER,
  driver_rating        INTEGER,
  passenger_review     TEXT,
  driver_review        TEXT,
  arrived_at           TIMESTAMP WITH TIME ZONE,
  started_at           TIMESTAMP WITH TIME ZONE,
  completed_at         TIMESTAMP WITH TIME ZONE,
  cancelled_at         TIMESTAMP WITH TIME ZONE,
  cancellation_reason  TEXT,
  created_at           TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ─── RIDE RATINGS ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ride_ratings (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id    UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  rater_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rated_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating     INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review     TEXT,
  rated_as   TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ─── NOTIFICATIONS ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT,
  message    TEXT,
  type       TEXT,
  read       BOOLEAN DEFAULT false,
  ride_id    UUID REFERENCES rides(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ─── ANALYTICS EVENTS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analytics_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name     TEXT NOT NULL,
  event_category TEXT,
  properties     JSONB,
  page           TEXT,
  session_id     TEXT,
  user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ─── APP WAITLIST ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_waitlist (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ─── ADMIN SETTINGS ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_settings (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key        TEXT UNIQUE NOT NULL,
  value      TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ─── SUPPORT TICKETS ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_tickets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  subject    TEXT,
  message    TEXT,
  status     TEXT DEFAULT 'open',
  category   TEXT DEFAULT 'general',
  priority   TEXT DEFAULT 'normal',
  ride_id    UUID REFERENCES rides(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ─── WALLET TRANSACTIONS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount     NUMERIC NOT NULL,
  reason     TEXT,
  type       TEXT,
  method     TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ─── CMS CONTENT ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cms_content (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key        TEXT UNIQUE NOT NULL,
  value      JSONB NOT NULL DEFAULT '{}',
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ─── CMS IMAGES ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cms_images (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot       TEXT UNIQUE NOT NULL,
  url        TEXT NOT NULL,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ─── TRAFFIC MESSAGES ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS traffic_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message    TEXT NOT NULL,
  active     BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ─── DONATIONS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS donations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  amount         NUMERIC NOT NULL,
  payment_method TEXT,
  status         TEXT DEFAULT 'pending',
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ─── AUDIT LOGS ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  action       TEXT NOT NULL,
  table_name   TEXT,
  record_id    UUID,
  old_data     JSONB,
  new_data     JSONB,
  ip_address   TEXT,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ─── DRIVER DOCUMENTS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_type    TEXT NOT NULL,
  url         TEXT NOT NULL,
  verified    BOOLEAN DEFAULT false,
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ─── DRIVER SUBSCRIPTIONS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_subscriptions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan       TEXT NOT NULL,
  status     TEXT DEFAULT 'active',
  starts_at  TIMESTAMP WITH TIME ZONE DEFAULT now(),
  ends_at    TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ─── INCIDENT REPORTS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS incident_reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reported_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ride_id     UUID REFERENCES rides(id),
  type        TEXT,
  description TEXT,
  status      TEXT DEFAULT 'open',
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ─── DISPUTES ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS disputes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id     UUID REFERENCES rides(id),
  opened_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  reason      TEXT,
  status      TEXT DEFAULT 'open',
  resolution  TEXT,
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMP WITH TIME ZONE,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ─── HOTEL PARTNERS ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hotel_partners (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  hotel_name   TEXT NOT NULL,
  contact_name TEXT,
  email        TEXT,
  phone        TEXT,
  address      TEXT,
  status       TEXT DEFAULT 'active',
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ─── BROADCAST MESSAGES ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS broadcast_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title      TEXT,
  body       TEXT NOT NULL,
  target     TEXT DEFAULT 'all',
  sent_by    UUID REFERENCES users(id),
  sent_at    TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ─── FARE ADJUSTMENTS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fare_adjustments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_type TEXT,
  base_fare    NUMERIC,
  per_km_rate  NUMERIC,
  surge_factor NUMERIC DEFAULT 1.0,
  active       BOOLEAN DEFAULT true,
  updated_by   UUID REFERENCES users(id),
  updated_at   TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ─── INDEXES ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_rides_passenger ON rides(passenger_id);
CREATE INDEX IF NOT EXISTS idx_rides_driver ON rides(driver_id);
CREATE INDEX IF NOT EXISTS idx_rides_status ON rides(status);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_name ON analytics_events(event_name);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user ON analytics_events(user_id);
CREATE INDEX IF NOT EXISTS idx_driver_applications_user ON driver_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_driver_applications_status ON driver_applications(status);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user ON wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);
