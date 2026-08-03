-- 025_calendar_entry_error_message.sql
-- recordFailure() in app/api/v1/cron/publish-scheduled/route.ts only ever
-- logged the publish failure reason to the server console -- it was never
-- persisted on the calendar_entries row itself, so a "missed" entry (3
-- failed attempts) had no way to tell the user WHY it failed in the
-- calendar UI. Adds a nullable column recordFailure now writes into, and
-- that a successful publish clears back to null.

ALTER TABLE public.calendar_entries
ADD COLUMN IF NOT EXISTS error_message TEXT;
