-- 048_admin_users.sql
-- Credential store for internal/admin tooling -- fully independent of the
-- customer-facing auth system. No FK to auth.users or public.users: an
-- admin account isn't a customer account, doesn't sign in through Supabase
-- Auth, and has no relationship to any brand/user row. RLS is enabled with
-- NO policies defined, which is the point -- anon and authenticated (the
-- roles a customer-facing request runs as) get zero access by default;
-- only the service-role client (which bypasses RLS entirely) can ever
-- read or write this table.
--
-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor -- no
-- automated migration runner is wired up in this environment.

CREATE TABLE public.admin_users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  name           TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  last_login_at  TIMESTAMPTZ
);

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
