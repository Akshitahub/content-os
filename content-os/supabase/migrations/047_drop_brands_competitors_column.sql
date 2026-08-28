-- ============================================================
-- AI Content OS — Drop brands.competitors
-- The Competitor Analysis feature (Instagram Business Discovery lookups
-- of accounts you don't own) has been fully removed -- confirmed
-- unrestorable via Zernio, which has no equivalent capability anywhere in
-- its API. This column held the user-entered "brand names you compete
-- with" list that fed that feature's now-deleted AI auto-discovery path
-- (lib/ai/competitor-discovery.ts) -- confirmed via grep that nothing
-- else reads it (it was never used by any content-generation prompt or
-- other surviving feature). Plain column on an existing table, not a
-- separate table -- a column drop, not a table drop. Must be run manually
-- in the Supabase SQL Editor; it will not auto-apply.
-- ============================================================

ALTER TABLE public.brands DROP COLUMN IF EXISTS competitors;
