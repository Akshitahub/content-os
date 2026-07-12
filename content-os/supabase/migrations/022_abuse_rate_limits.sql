-- 022_abuse_rate_limits.sql
-- Two actions had no rate limiting or usage-credit gating at all: scheduling
-- a post (POST /api/v1/calendar/schedule-post re-hosts an arbitrary-sized
-- image/video to Supabase Storage on every call, with no cap on call
-- frequency -- a storage-fill abuse vector) and sending influencer outreach
-- email (POST .../outreach/send-email can target any email address the
-- caller supplies, with no cap either -- a spam/phishing-relay vector using
-- this app's own Resend sending reputation). Neither ties into the existing
-- generation-credit system on purpose -- scheduling/sending already-created
-- content shouldn't cost a generation credit, that would be a billing change,
-- not a security fix -- so this adds a separate, generous daily counter for
-- each, following the exact same reset-window pattern as
-- reel_count_this_week/reel_count_reset_at (migration 020).

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS schedule_post_count_today INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS schedule_post_count_reset_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS outreach_email_count_today INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS outreach_email_count_reset_at TIMESTAMPTZ;
