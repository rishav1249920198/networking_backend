-- ============================================================
-- IGCIM Educational Networking Platform - PostgreSQL Schema
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. CENTRES
-- ============================================================
CREATE TABLE IF NOT EXISTS centres (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(200) NOT NULL,
  code          VARCHAR(20)  NOT NULL UNIQUE,
  address       TEXT,
  phone         VARCHAR(20),
  email         VARCHAR(150),
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 2. ROLES
-- ============================================================
CREATE TABLE IF NOT EXISTS roles (
  id   SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE  -- super_admin, centre_admin, staff, student
);

INSERT INTO roles (name) VALUES
  ('super_admin'),
  ('centre_admin'),
  ('staff'),
  ('student')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- 3. USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  system_id         VARCHAR(30)  NOT NULL UNIQUE,        -- e.g. IGCIM240001
  centre_id         UUID REFERENCES centres(id) ON DELETE SET NULL,
  role_id           INTEGER NOT NULL REFERENCES roles(id),
  full_name         VARCHAR(200) NOT NULL,
  email             VARCHAR(150) NOT NULL UNIQUE,
  mobile            VARCHAR(15)  NOT NULL UNIQUE,
  password_hash     TEXT NOT NULL,
  referral_code     VARCHAR(20)  NOT NULL UNIQUE,         -- e.g. IGCIM1234
  referred_by       UUID REFERENCES users(id) ON DELETE SET NULL,  -- self-reference
  profile_photo     TEXT,                                 -- file path
  is_email_verified BOOLEAN DEFAULT FALSE,
  is_mobile_verified BOOLEAN DEFAULT FALSE,
  is_active         BOOLEAN DEFAULT TRUE,
  failed_attempts   INTEGER DEFAULT 0,
  locked_until      TIMESTAMPTZ,
  last_login        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT no_self_referral CHECK (referred_by <> id)
);

-- Index for referral lookups
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
CREATE INDEX IF NOT EXISTS idx_users_referred_by   ON users(referred_by);
CREATE INDEX IF NOT EXISTS idx_users_centre_id     ON users(centre_id);

-- ============================================================
-- 4. COURSES
-- ============================================================
CREATE TABLE IF NOT EXISTS courses (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  centre_id       UUID REFERENCES centres(id) ON DELETE CASCADE,
  name            VARCHAR(200) NOT NULL,
  category        VARCHAR(50)  NOT NULL,  -- computer, university
  description     TEXT,
  duration_months INTEGER,
  fee             NUMERIC(10,2) NOT NULL,
  commission_percent NUMERIC(5,2) DEFAULT 10.00,  -- default 10%
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_courses_centre_id ON courses(centre_id);

-- ============================================================
-- 5. ADMISSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS admissions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  centre_id           UUID NOT NULL REFERENCES centres(id),
  course_id           UUID NOT NULL REFERENCES courses(id),
  student_id          UUID NOT NULL REFERENCES users(id),
  referred_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  admission_mode      VARCHAR(10) NOT NULL CHECK (admission_mode IN ('online', 'offline')),
  status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','rejected')),
  -- Snapshot values at admission time (immutable after creation)
  snapshot_fee        NUMERIC(10,2) NOT NULL,
  snapshot_commission_percent NUMERIC(5,2) NOT NULL,
  -- Student details
  student_name        VARCHAR(200) NOT NULL,
  student_mobile      VARCHAR(15)  NOT NULL,
  student_email       VARCHAR(150),
  -- Payment
  payment_proof_path  TEXT,                 -- for online
  payment_mode        VARCHAR(30),          -- cash, online, upi etc.
  payment_reference   VARCHAR(100),
  -- Staff who entered (for offline)
  entered_by_staff_id UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Admin action
  reviewed_by_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at         TIMESTAMPTZ,
  rejection_reason    TEXT,
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admissions_student_id        ON admissions(student_id);
CREATE INDEX IF NOT EXISTS idx_admissions_referred_by       ON admissions(referred_by_user_id);
CREATE INDEX IF NOT EXISTS idx_admissions_status            ON admissions(status);
CREATE INDEX IF NOT EXISTS idx_admissions_centre_id         ON admissions(centre_id);

-- ============================================================
-- 6. COMMISSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS commissions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admission_id        UUID NOT NULL UNIQUE REFERENCES admissions(id) ON DELETE CASCADE,
  referrer_id         UUID NOT NULL REFERENCES users(id),
  centre_id           UUID NOT NULL REFERENCES centres(id),
  snapshot_fee        NUMERIC(10,2) NOT NULL,
  snapshot_percent    NUMERIC(5,2)  NOT NULL,
  amount              NUMERIC(10,2) NOT NULL,  -- computed: fee * percent / 100
  level               INTEGER DEFAULT 1,        -- 1 = direct referral
  status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','paid','cancelled')),
  withdrawal_requested BOOLEAN DEFAULT FALSE,
  withdrawal_requested_at TIMESTAMPTZ,
  paid_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commissions_referrer_id ON commissions(referrer_id);
CREATE INDEX IF NOT EXISTS idx_commissions_status      ON commissions(status);

-- ============================================================
-- 7. OTP VERIFICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS otp_verifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  identifier  VARCHAR(200) NOT NULL,  -- email or mobile
  otp_code    VARCHAR(10)  NOT NULL,
  purpose     VARCHAR(30)  NOT NULL CHECK (purpose IN ('register','forgot_password','mobile_verify')),
  is_used     BOOLEAN DEFAULT FALSE,
  attempts    INTEGER DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_otp_identifier ON otp_verifications(identifier);

-- ============================================================
-- 8. LOGIN LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS login_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  email       VARCHAR(150),
  ip_address  INET,
  user_agent  TEXT,
  success     BOOLEAN NOT NULL,
  failure_reason VARCHAR(100),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_logs_user_id ON login_logs(user_id);

-- ============================================================
-- 9. ACTIVITY LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS activity_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role  VARCHAR(50),
  action      VARCHAR(100) NOT NULL,
  target_type VARCHAR(50),
  target_id   UUID,
  metadata    JSONB,
  ip_address  INET,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_actor_id  ON activity_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action    ON activity_logs(action);

-- ============================================================
-- 10. COMMISSION SETTINGS (per centre)
-- ============================================================
CREATE TABLE IF NOT EXISTS commission_settings (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  centre_id       UUID NOT NULL UNIQUE REFERENCES centres(id) ON DELETE CASCADE,
  default_percent NUMERIC(5,2) DEFAULT 10.00,
  multi_level     BOOLEAN DEFAULT FALSE,  -- disabled by default
  level_2_percent NUMERIC(5,2) DEFAULT 0,
  level_3_percent NUMERIC(5,2) DEFAULT 0,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 11. WITHDRAWAL REQUESTS
-- ============================================================
CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id    UUID NOT NULL REFERENCES users(id),
  centre_id     UUID NOT NULL REFERENCES centres(id),
  amount        NUMERIC(10,2) NOT NULL,
  upi_id        VARCHAR(100),
  bank_account  VARCHAR(30),
  bank_ifsc     VARCHAR(20),
  bank_name     VARCHAR(100),
  status        VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected','paid')),
  admin_notes   TEXT,
  reviewed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- AUTO-UPDATE updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['centres','users','courses','admissions','commissions','commission_settings','withdrawal_requests']
  LOOP
    EXECUTE format('
      CREATE TRIGGER trg_%s_updated_at
      BEFORE UPDATE ON %s
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    ', t, t);
  END LOOP;
END;
$$;
