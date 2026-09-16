"use client"

import { STATUS_COLORS, STATUS_LABELS } from "./calendar-status"

// Dedicated calendar-entry card for ContentCalendar.tsx's week AND month
// views -- deliberately NOT another PostCard.tsx size variant. PostCard's
// own size="sm" mode (tiny 36px thumbnail beside two lines of text, no time
// shown) is still used elsewhere (library, generators) and shouldn't
// change; this reads top-to-bottom instead, matching a real
// content-calendar tool: scheduled time -> full-width image -> title ->
// platform/format tags. Month view's day cells are half week view's height
// and use the `compact` prop below for a slim horizontal row instead.
//
// Status color coding: STATUS_COLORS already drove ContentCalendar.tsx's
// own legend, but was never actually applied to an entry card -- every
// status except "missed" rendered visually identical, which is actively
// misleading (an Autopilot content_ready entry shows a scheduled date/time
// already, looking confirmed to publish even though it still needs manual
// approval before the publish cron will ever pick it up). "missed" is
// deliberately excluded from the status pill/dot below -- it already gets
// its own stronger, more urgent badge treatment from the caller (see
// ContentCalendar.tsx), which stays exactly as it was.

// Local copy of PostCard.tsx's PLATFORM_GRADIENT rather than importing it
// -- this codebase's own convention already duplicates small per-component
// UI constant maps like this rather than cross-importing between sibling
// "shared"/"calendar" files (see ContentCalendar.tsx's own separate
// PLATFORM_GRADIENTS/PLATFORM_EMOJIS, distinct from PostCard.tsx's).
const PLATFORM_GRADIENT: Record<string, string> = {
  instagram: "from-purple-500 via-pink-500 to-rose-400",
  tiktok: "from-gray-900 via-gray-800 to-black",
  linkedin: "from-blue-700 via-blue-600 to-blue-500",
  twitter: "from-sky-400 via-sky-500 to-blue-500",
  facebook: "from-blue-600 via-blue-500 to-indigo-600",
  youtube: "from-red-600 via-red-500 to-orange-500",
}

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  twitter: "Twitter",
  facebook: "Facebook",
  youtube: "YouTube",
}

// calendar_entries.content_type has two real sources with different raw
// values: the manual "Add entry" modal's own picklist (reel/post/story/
// carousel/thread, see ContentCalendar.tsx) and Autopilot/Fastlane's
// generated slots -- which already normalize to that same picklist before
// insert (lib/ai/fastlane.ts: `content_type: isCarousel ? "carousel" :
// isReel ? "reel" : "post"`), so "reel_script"/"hooks"/etc. from
// ContentSlot's own internal type never actually reach this column today.
// Mapped here anyway (not just the 5 picklist values) so this stays
// correct if that normalization ever changes, and so any older/differently
// -sourced row still gets a real label instead of a raw snake_case string.
const CONTENT_TYPE_LABEL: Record<string, string> = {
  reel: "Reel Script",
  reel_script: "Reel Script",
  post: "Post",
  social_post: "Post",
  carousel: "Carousel",
  story: "Story",
  thread: "Thread",
  ad_copy: "Ad Copy",
  blog_post: "Blog Post",
  hook: "Hook",
  hooks: "Hook",
  caption: "Caption",
}

function titleCaseFallback(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ")
}

// Compact mode has no room for a full STATUS_COLORS pill (bg/text/border
// three-class combo, sized for a badge) -- derives a single solid dot fill
// from the same mapping's own "text-x-700" shade instead of maintaining a
// second, parallel color map that could drift from STATUS_COLORS.
function statusDotColor(status: string | undefined): string {
  const classes = status ? STATUS_COLORS[status] : undefined
  const textClass = classes?.split(" ").find((c) => c.startsWith("text-"))
  return textClass ? textClass.replace("text-", "bg-") : "bg-gray-400"
}

// calendar_entries.scheduled_time is a Postgres `time` column, serialized
// as "HH:mm:ss" (24-hour, e.g. "11:00:00" -- see
// app/api/v1/brands/[brandId]/calendar/bulk-schedule/route.ts's own
// DEFAULT_POST_TIMES for the exact stored shape). Formatted here into the
// "10:30 AM" 12-hour form this card actually displays.
function formatScheduledTime(time: string | null): string | null {
  if (!time) return null
  const match = /^(\d{1,2}):(\d{2})/.exec(time)
  if (!match) return null
  const rawHours = parseInt(match[1]!, 10)
  const minutes = match[2]
  const period = rawHours >= 12 ? "PM" : "AM"
  const hours = rawHours % 12 || 12
  return `${hours}:${minutes} ${period}`
}

export interface CalendarEntryCardProps {
  title: string
  scheduledTime: string | null
  platform: string | null
  contentType: string | null
  imageUrl: string | null
  /** Drives the status pill (full card)/dot (compact) below via
   * STATUS_COLORS/STATUS_LABELS -- every status except "missed", which
   * still gets its own stronger, more urgent badge as the caller's own
   * absolute-positioned overlay (see ContentCalendar.tsx), unchanged from
   * before this component rendered any status indicator at all. "missed"
   * still gets the dimmed/ringed treatment on the card itself. */
  status?: string
  /** Month view's day cells are half week view's height and need to stack
   * up to 3 of these -- a slim horizontal row (small thumbnail + time +
   * title, one line each, tags dropped entirely -- there's no room) instead
   * of the full vertical card. Same gradient-placeholder-when-no-image and
   * missed-ring behavior, just laid out to fit. Week view is untouched --
   * this only activates when the caller opts in. */
  compact?: boolean
}

export function CalendarEntryCard({ title, scheduledTime, platform, contentType, imageUrl, status, compact = false }: CalendarEntryCardProps) {
  const gradient = PLATFORM_GRADIENT[platform ?? "instagram"] ?? PLATFORM_GRADIENT.instagram
  const timeLabel = formatScheduledTime(scheduledTime)
  const platformLabel = platform ? (PLATFORM_LABEL[platform] ?? titleCaseFallback(platform)) : null
  const typeLabel = contentType ? (CONTENT_TYPE_LABEL[contentType] ?? titleCaseFallback(contentType)) : null
  const isMissed = status === "missed"
  // "missed" already gets its own stronger badge from the caller -- the
  // status pill/dot below is only for everything else, so the two never
  // show redundant treatments for the same entry.
  const statusText = !isMissed && status ? STATUS_LABELS[status] : null
  const statusClasses = !isMissed && status ? STATUS_COLORS[status] : null

  if (compact) {
    return (
      <div
        className={`flex items-center gap-1.5 overflow-hidden rounded-md border bg-card px-1 py-1 shadow-sm transition-shadow hover:shadow-md ${isMissed ? "ring-1 ring-inset ring-red-500" : ""}`}
        title={statusText ? `${title} — ${statusText}` : undefined}
      >
        <div className="relative h-6 w-6 shrink-0 overflow-hidden rounded-sm">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className={`h-full w-full bg-gradient-to-br ${gradient}`} />
          )}
          {statusText && (
            <span className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-1 ring-white ${statusDotColor(status)}`} />
          )}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[10px] font-medium text-foreground">{title}</p>
          {timeLabel && <p className="truncate text-[8px] text-muted-foreground">{timeLabel}</p>}
        </div>
      </div>
    )
  }

  return (
    <div
      className={`overflow-hidden rounded-xl border bg-card shadow-sm transition-all hover:shadow-md ${isMissed ? "ring-1 ring-inset ring-red-500" : ""}`}
      title={statusText ? statusText : undefined}
    >
      {/* Image fills the top of the card at a consistent 1:1 ratio -- a
          gradient placeholder (same visual language as PostCard.tsx's
          MiniPreview: platform gradient + centered truncated text) stands
          in whenever there's no real generated/linked image yet, so this
          never renders blank. Scheduled time sits directly on top of it. */}
      <div className="relative aspect-square w-full overflow-hidden bg-muted">
        {timeLabel && (
          <span className="absolute left-1.5 top-1.5 z-10 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
            {timeLabel}
          </span>
        )}
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${gradient} p-2`}>
            <p className="line-clamp-4 text-center text-[11px] font-bold leading-snug text-white drop-shadow-sm">
              {title}
            </p>
          </div>
        )}
      </div>

      {/* Title, then status/platform/format tags */}
      <div className="p-2 space-y-1.5">
        <p className="line-clamp-2 text-xs font-medium leading-snug text-foreground">{title}</p>
        {(statusText || platformLabel || typeLabel) && (
          <div className="flex flex-wrap items-center gap-1">
            {statusText && statusClasses && (
              <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${statusClasses}`}>
                {statusText}
              </span>
            )}
            {platformLabel && (
              <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-medium text-secondary-foreground">
                {platformLabel}
              </span>
            )}
            {typeLabel && (
              <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-medium text-secondary-foreground">
                {typeLabel}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
