-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor -- no
-- automated migration runner is wired up in this environment.
--
-- Admin login hardening (app/api/admin/auth/login/route.ts): 5 wrong
-- attempts lock the account for 15 minutes, and an optional TOTP second
-- factor (enrolled with scripts/admin-enroll-totp.ts; the secret stored
-- AES-256-GCM encrypted with ADMIN_TOTP_ENC_KEY, lib/admin/totp-crypto.ts).
-- Until this runs, admin login works exactly as before (no lockout, no TOTP).

ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS failed_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until timestamptz,
  ADD COLUMN IF NOT EXISTS totp_secret_enc text,
  ADD COLUMN IF NOT EXISTS totp_enabled boolean NOT NULL DEFAULT false;
