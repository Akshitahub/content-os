-- ============================================================
-- AI Content OS — Drop the Creators (Influencers) feature's tables
-- The feature's UI/API reachability was removed first (no route creates or
-- serves influencer/partnership/outreach data anymore). Run
-- scripts/purge-influencers.ts with --yes BEFORE this migration -- it
-- deletes every row across all three tables first. Unlike memes, none of
-- these tables reference Supabase Storage (avatar_url/profile_url are
-- third-party scraped CDN URLs, never re-hosted into this app's own
-- bucket), so there's no storage orphaning risk here -- this is purely a
-- data-loss risk if run before confirming the purge script emptied all
-- three tables. Irreversible.
--
-- Drop order: child tables (outreach_messages, influencer_partnerships)
-- before the parent they reference (influencers), matching the FK
-- direction from 004_influencer_module.sql even though CASCADE would
-- handle it either way.
-- ============================================================

DROP TABLE IF EXISTS public.outreach_messages;
DROP TABLE IF EXISTS public.influencer_partnerships;
DROP TABLE IF EXISTS public.influencers;
