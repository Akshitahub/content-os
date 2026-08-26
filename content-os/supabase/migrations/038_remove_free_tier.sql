-- 038_remove_free_tier.sql
-- Pricing revision (2026-08-26): the Free plan is retired. Every account is
-- now either trialing (no payment yet) or subscribed to a real paid tier
-- (starter/pro/agency) -- see PLAN_LIMITS in types/app.ts. `plan` itself
-- never holds "free" again; trial-vs-subscribed status is tracked
-- orthogonally via the two new columns below, so the ~18 existing call
-- sites across the app that gate on PLAN_LIMITS[plan] keep working
-- unchanged (a trialing account is simply gated as "starter").
--
-- Confirmed live via scripts/check-free-users.ts before writing this:
-- 15 of 17 total users currently have plan='free' -- a real mix of
-- genuine users (nonzero generation_count, real gmail/university/personal
-- addresses) and obvious QA/test accounts (mailinator.com, test@test.com).
-- None can be silently dropped or ignored. Confirmed migration path: give
-- all 15 a FRESH 7-day trial starting from today (not back-dated to their
-- original signup date), so nobody's real account is broken and nobody
-- loses standing access without warning.
--
-- The other 2 of 17 (scripts/check-nonfree-users.ts) are already on a real
-- paid plan (both plan='pro') -- step 2 below backfills subscribed_at for
-- them BEFORE step 3 relabels the free users to 'starter', so both groups
-- can still be told apart by their original plan value. Skipping this
-- would leave every already-paying customer with subscribed_at IS NULL,
-- which lib/usage/trial-status.ts's isTrialExpired() would then read as
-- "trial over, block everything" for a customer who already paid --
-- caught before this migration was ever run, not live.
--
-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor -- no
-- automated migration runner is wired up in this environment.

-- 1. New trial-tracking columns. Both nullable: trial_ends_at is set for
--    every account (see step 3 below for existing free-tier users, and
--    step 2 for existing paid ones; new-signup defaulting is migration
--    039's job, in the handle_new_user() trigger), and subscribed_at
--    stays NULL until a real Razorpay payment succeeds (set by
--    lib/billing/apply-plan-upgrade.ts) -- except for step 2 below, which
--    backfills it for customers who were already paying before this
--    column existed.
ALTER TABLE public.users
  ADD COLUMN trial_ends_at TIMESTAMPTZ,
  ADD COLUMN subscribed_at TIMESTAMPTZ;

-- 2. Backfill subscribed_at for accounts already on a REAL paid plan
--    before this migration (must run before step 3, while plan != 'free'
--    still only matches genuine pre-existing subscribers, not the
--    about-to-be-migrated free users).
UPDATE public.users
SET subscribed_at = created_at
WHERE plan <> 'free' AND subscribed_at IS NULL;

-- 3. Migrate every existing plan='free' row to a fresh Starter trial
--    BEFORE the CHECK constraint below stops allowing 'free' at all.
UPDATE public.users
SET plan = 'starter',
    trial_ends_at = NOW() + INTERVAL '7 days',
    subscribed_at = NULL
WHERE plan = 'free';

-- 4. Drop 'free' from the allowed plan values and move the column default
--    to 'starter' -- matches every ?? "starter" fallback now used across
--    the app for a missing/unrecognized plan (see e.g.
--    app/api/v1/user/profile/route.ts).
ALTER TABLE public.users DROP CONSTRAINT users_plan_check;
ALTER TABLE public.users ADD CONSTRAINT users_plan_check CHECK (plan IN ('starter', 'pro', 'agency'));
ALTER TABLE public.users ALTER COLUMN plan SET DEFAULT 'starter';
