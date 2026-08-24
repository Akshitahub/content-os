-- ============================================================
-- AI Content OS — Drop the memes table
-- The Memes feature's UI/API reachability was removed first (no route
-- creates or serves new memes anymore). Run scripts/purge-memes.ts with
-- --yes BEFORE this migration -- it deletes every row's storage file from
-- the published-media bucket first, since dropping the table here does
-- NOT touch Supabase Storage at all and would otherwise orphan those
-- files permanently. Irreversible.
-- ============================================================

DROP TABLE IF EXISTS public.memes;
