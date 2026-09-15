-- Closes (part of) the reachability gap lib/social/engagement-sync.ts's own
-- module comment documents: calendar_entries already has caption_id/
-- hook_id, but carousels, stories, and ad_copies had no column of their
-- own to link back to, so a published carousel/story/ad post had no way
-- to trace its real engagement (content_engagement, see
-- supabase/migrations/051_content_engagement.sql) back onto the source
-- carousels/stories/ad_copies row.
--
-- All three nullable, same as caption_id/hook_id -- most calendar_entries
-- rows still won't have one set (see the reachability caveats
-- engagement-sync.ts documents: only lib/ai/fastlane.ts's Autopilot insert
-- sets carousel_id today, and only for slots whose carousel actually
-- rendered real slide images; app/api/v1/calendar/schedule-post/route.ts's
-- manual "schedule this" path -- used both right after generation and from
-- the Library -- never carries a source-row id through its request body at
-- all, for any content type, so it can't set any of the three either, same
-- structural gap as the existing caption_id/hook_id caveat). This is
-- forward-looking: it makes NEW entries linkable going forward, it doesn't
-- retroactively link anything already in the table.
--
-- ON DELETE SET NULL, not CASCADE -- deleting a saved carousel/story/ad
-- copy from the Library shouldn't also delete the calendar entry (and any
-- content_engagement row keyed to it) for a post that already published.
--
-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor -- no
-- automated migration runner is wired up in this environment.
ALTER TABLE public.calendar_entries
  ADD COLUMN carousel_id UUID REFERENCES public.carousels(id) ON DELETE SET NULL,
  ADD COLUMN story_id UUID REFERENCES public.stories(id) ON DELETE SET NULL,
  ADD COLUMN ad_copy_id UUID REFERENCES public.ad_copies(id) ON DELETE SET NULL;
