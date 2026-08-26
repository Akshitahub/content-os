-- 039_signup_trial.sql
-- Every new signup now starts on a 7-day no-card trial (plan defaults to
-- 'starter' for gating per migration 038; trial_ends_at is what actually
-- marks the account as trialing rather than subscribed -- see
-- lib/usage/trial-status.ts). No Razorpay order or subscription is ever
-- created here -- this only sets a plain timestamp column, matching the
-- task requirement that no card/payment is involved at signup.
--
-- CREATE OR REPLACE, not ALTER -- redefines the same on_auth_user_created
-- trigger function from 001_initial_schema.sql with one added field, so
-- there is exactly one definition of "what happens when a new user signs
-- up" rather than two competing ones.
--
-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor -- no
-- automated migration runner is wired up in this environment.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, avatar_url, trial_ends_at)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url',
    NOW() + INTERVAL '7 days'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
