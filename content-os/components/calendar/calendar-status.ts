// Single source of truth for calendar_entries.status -> color/label,
// shared by ContentCalendar.tsx's own legend and CalendarEntryCard.tsx's
// per-entry status indicator, so the two can never drift out of sync with
// each other -- previously STATUS_COLORS lived only in ContentCalendar.tsx
// and drove the legend alone, with no visible connection to the actual
// entry cards it was supposed to describe. Lives in its own module (not
// re-exported from ContentCalendar.tsx) so CalendarEntryCard.tsx importing
// it doesn't create a circular import between the two component files.
export const STATUS_COLORS: Record<string, string> = {
  planned: "bg-slate-100 text-slate-700 border-slate-200",
  content_ready: "bg-blue-100 text-blue-700 border-blue-200",
  scheduled: "bg-purple-100 text-purple-700 border-purple-200",
  published: "bg-green-100 text-green-700 border-green-200",
  missed: "bg-red-100 text-red-700 border-red-200",
}

// content_ready specifically needs a more explicit label than a plain
// "Content ready" would suggest -- Autopilot leaves an entry here with a
// scheduled date/time already shown on the card, which reads as confirmed
// to publish even though it still requires a separate manual approval
// (the "Review & approve your posts" flow on the Autopilot page) before
// the publish cron will ever pick it up. Every other status keeps a plain,
// literal label -- this is the one place the wording needs to actively
// correct a likely misreading, not just name the state.
export const STATUS_LABELS: Record<string, string> = {
  planned: "Planned",
  content_ready: "Needs approval",
  scheduled: "Scheduled",
  published: "Published",
  missed: "Missed",
}
