-- 017_influencer_email.sql
-- Email addresses aren't available from public profile scraping --
-- Instagram/TikTok/YouTube/LinkedIn don't expose contact email on public
-- profiles -- so this is populated manually by the user when they want to
-- send a direct outreach email, never guessed or auto-generated.

ALTER TABLE public.influencers
ADD COLUMN IF NOT EXISTS email TEXT;
