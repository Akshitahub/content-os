-- 030_plan_billing_period.sql
-- Records whether a user's current paid plan was purchased monthly or
-- annually (lib/billing/apply-plan-upgrade.ts). Free users have no billing
-- period at all, hence nullable rather than defaulting to 'monthly'. This
-- commit only records the initial purchase's period — renewal/expiry
-- automation, proration, and downgrade handling are explicitly out of
-- scope and left for a later task.
--
-- MANUAL STEP REQUIRED: this migration must be run by hand in the
-- Supabase SQL Editor (no automated migration runner is wired up in this
-- environment) before the annual-billing code that reads/writes this
-- column will work.

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS plan_billing_period TEXT CHECK (plan_billing_period IN ('monthly', 'annual'));
