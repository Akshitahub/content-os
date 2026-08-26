-- 041_marketing_email_optout.sql
-- The welcome email's "Unsubscribe" link has never actually unsubscribed
-- anyone -- it just points at APP_URL. Real compliance gap (CAN-SPAM/GDPR)
-- and a real sender-reputation risk, fixed here before any more marketing-
-- adjacent email gets added (see the two lifecycle emails this pairs
-- with). This column is the actual opt-out flag every non-transactional
-- email-sending function now checks before sending (see lib/email/resend.ts).
--
-- Payment confirmations are intentionally NOT gated on this -- they're
-- transactional/required (a receipt for money already charged), not
-- marketing.
--
-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor -- no
-- automated migration runner is wired up in this environment.

ALTER TABLE public.users
  ADD COLUMN marketing_emails_opted_out BOOLEAN NOT NULL DEFAULT false;
