-- 037_festival_dates.sql
-- lib/occasions/occasions-data.ts and lib/data/indian-occasions.ts hardcoded
-- a single fixed MM-DD per festival -- wrong by definition for lunar/
-- lunisolar festivals (Diwali, Holi, Eid, Navratri, Raksha Bandhan, Ganesh
-- Chaturthi, etc.), which shift Gregorian date every year and drift further
-- wrong with each year that passes. This table is the cache a yearly cron
-- (app/api/v1/cron/refresh-festival-dates) writes real per-year dates into
-- (source of truth: TathaAstu API), so the app never hits a paid external
-- API on a normal page load -- only the cron does, once a year.
--
-- Not user-owned data (festival dates are the same for everyone), so RLS
-- allows public read and reserves writes for the service role (which
-- bypasses RLS entirely) via the cron route.
--
-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor -- no
-- automated migration runner is wired up in this environment.

CREATE TABLE public.festival_dates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  festival_id  TEXT NOT NULL,
  year         INTEGER NOT NULL,
  occurs_on    DATE NOT NULL,
  -- 'api' = resolved from TathaAstu this run. 'fallback' = TathaAstu had no
  -- match for this festival/year, so the catalog's static MM-DD was used
  -- instead (logged loudly by the cron route when this happens, not silent).
  source       TEXT NOT NULL CHECK (source IN ('api', 'fallback')),
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (festival_id, year)
);

CREATE INDEX idx_festival_dates_festival_id_year ON public.festival_dates (festival_id, year);

ALTER TABLE public.festival_dates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone_can_read_festival_dates" ON public.festival_dates FOR SELECT USING (true);
