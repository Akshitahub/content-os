import Link from "next/link"
import { Sparkles, Plus } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard"
import { CreditGiftBoxes } from "@/components/dashboard/CreditGiftBoxes"
import { CreditBalancePill } from "@/components/dashboard/CreditBalancePill"
import { DetailedStatsToggle } from "@/components/dashboard/DetailedStatsToggle"
import { DashboardStats } from "@/components/dashboard/DashboardStats"
import { UpcomingOccasions } from "@/components/dashboard/UpcomingOccasions"
import { ScheduleAction } from "@/components/shared/ScheduleAction"
import { getUpcomingOccasions } from "@/lib/occasions/get-upcoming-occasions"
import { getOrCreateDailyDraft } from "@/lib/dashboard/get-or-create-daily-draft"
import { getBestHookType } from "@/lib/dashboard/get-best-hook-type"
import { getISTDateString, getISTNow } from "@/lib/utils/ist"
import type { UserRow, BrandRow, CalendarEntryRow } from "@/types/database"

/** d is built via local-field arithmetic (setDate/setHours) on an
 * IST-simulated Date from getISTNow() -- toISOString() would reinterpret
 * that as a real UTC instant and risk shifting the date by a day depending
 * on the server's own timezone. Reading the local date components back out
 * avoids that (same pattern as lib/ai/fastlane.ts's formatLocalDate). */
function formatLocalDate(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const dd = String(date.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

const MOMENTUM_DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { onboarding } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const [profileResult, brandsResult] = await Promise.all([
    supabase.from("users").select("full_name, plan").eq("id", user.id).single<Pick<UserRow, "full_name" | "plan">>(),
    supabase.from("brands").select("*").eq("user_id", user.id).returns<BrandRow[]>(),
  ])

  const profile = profileResult.data
  const brands = brandsResult.data ?? []
  const brandCount = brands.length
  const activeBrandCount = brands.filter((b) => b.is_active).length
  const firstBrand = brands.find((b) => b.is_active) ?? brands[0] ?? null
  const firstBrandId = firstBrand?.id ?? null
  const brandIds = brands.map((b) => b.id)

  // A user who explicitly skipped onboarding (see OnboardingWizard's
  // handleSkipNoBrand) still has brandCount===0, but re-gating them back
  // onto OnboardingWizard here would make "Skip" look like it did nothing.
  // ?onboarding=skip lets them fall through to the normal dashboard shell
  // instead, with its own inline "add a brand" prompt below.
  const skippedOnboarding = onboarding === "skip"

  if (brandCount === 0 && !skippedOnboarding) {
    return <OnboardingWizard />
  }

  // Started here (not awaited yet), alongside the daily-draft and
  // best-hook-type lookups just below -- all three run concurrently via
  // the single Promise.all near the bottom of this function, rather than
  // serially blocking the page on each in turn. Skipped entirely for a
  // brandless user (the real onboarding path above, or a skipped one
  // rendering the "add a brand" prompt below) since none of the three
  // have anything to show either way.
  const occasionsPromise = brandCount > 0 ? getUpcomingOccasions(14) : Promise.resolve([])
  // A real, credit-charged draft -- at most one generation/charge per
  // brand per IST day, cached in daily_draft_cache (see
  // lib/dashboard/get-or-create-daily-draft.ts). null covers both "no
  // credits to charge" and "generation failed" -- either way the hero
  // below falls back to the plain CTA, no error surfaced.
  const dailyDraftPromise = firstBrand ? getOrCreateDailyDraft(firstBrand, user.id) : Promise.resolve(null)
  const bestHookTypePromise = getBestHookType(brandIds)

  const now = new Date()
  const todayStr = getISTDateString(now)
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)

  // "Today" for week/activity-window purposes must be India's calendar day,
  // not the server's own local day (a UTC host would otherwise roll the
  // week over ~5.5 hours early/late) -- getISTNow() gives a Date whose
  // local fields already reflect IST, safe to drive setDate()/setHours()
  // arithmetic on directly (see formatLocalDate above for reading it back).
  const istNow = getISTNow()
  const dayOfWeek = istNow.getDay()
  const startOfWeek = new Date(istNow)
  startOfWeek.setDate(istNow.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))
  startOfWeek.setHours(0, 0, 0, 0)
  const endOfWeek = new Date(startOfWeek)
  endOfWeek.setDate(startOfWeek.getDate() + 6)
  const startOfWeekStr = formatLocalDate(startOfWeek)
  const endOfWeekStr = formatLocalDate(endOfWeek)

  const ACTIVITY_CHART_DAYS = 14
  const activityWindowStart = new Date(istNow)
  activityWindowStart.setDate(istNow.getDate() - (ACTIVITY_CHART_DAYS - 1))
  activityWindowStart.setHours(0, 0, 0, 0)

  // Three cheap, independent user_id-scoped queries run together: the
  // existing "this month" count, a same-shape "last month" count (just
  // for the trend arrow on that one stat card -- the only card where a
  // month-over-month comparison is an honest apples-to-apples number;
  // see DashboardStats.tsx for why the other three cards skip a trend
  // rather than fabricating one), and the raw timestamps for the last 14
  // days (bucketed into a day-by-day chart below) -- still a head-less
  // select, but bounded to a realistic per-user 2-week volume, not a new
  // heavy computation.
  const [generationsResult, generationsLastMonthResult, activityRowsResult] = await Promise.all([
    supabase
      .from("ai_generation_logs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", firstOfMonth.toISOString()),
    supabase
      .from("ai_generation_logs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", firstOfLastMonth.toISOString())
      .lt("created_at", firstOfMonth.toISOString()),
    supabase
      .from("ai_generation_logs")
      .select("created_at")
      .eq("user_id", user.id)
      .gte("created_at", activityWindowStart.toISOString())
      .returns<{ created_at: string }[]>(),
  ])

  const generationsThisMonth = generationsResult.count ?? 0
  const generationsLastMonth = generationsLastMonthResult.count ?? 0

  const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  const dailyActivity = Array.from({ length: ACTIVITY_CHART_DAYS }, (_, i) => {
    const d = new Date(activityWindowStart)
    d.setDate(activityWindowStart.getDate() + i)
    return { date: formatLocalDate(d), label: DAY_LABELS[d.getDay()]!, count: 0 }
  })
  const dailyActivityIndex = new Map(dailyActivity.map((d, i) => [d.date, i]))
  for (const row of activityRowsResult.data ?? []) {
    const day = row.created_at.split("T")[0]!
    const idx = dailyActivityIndex.get(day)
    if (idx !== undefined) dailyActivity[idx]!.count++
  }

  // This week's momentum row (Mon-Sun) -- reuses dailyActivity above
  // (already a per-day count for the last 14 days, which fully covers the
  // current week) rather than a third parallel query. A day past today
  // with no entry in dailyActivity can't happen (the window always
  // extends through today), so a missing lookup only ever means a future
  // day still ahead this week.
  const dailyActivityByDate = new Map(dailyActivity.map((d) => [d.date, d.count]))
  const momentumDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startOfWeek)
    d.setDate(startOfWeek.getDate() + i)
    const dateStr = formatLocalDate(d)
    return {
      label: MOMENTUM_DAY_LABELS[i]!,
      dateStr,
      count: dailyActivityByDate.get(dateStr) ?? 0,
      isToday: dateStr === todayStr,
      isFuture: dateStr > todayStr,
    }
  })

  type RecentCalendarEntry = Pick<CalendarEntryRow, "id" | "title" | "scheduled_date" | "platform" | "status" | "hook_text" | "caption_text" | "is_ready" | "color">

  let calendarEntriesThisWeek = 0
  let recentCalendar: RecentCalendarEntry[] = []
  let savedContentCount = 0

  if (brandIds.length > 0) {
    const [
      calendarCountResult,
      recentCalendarResult,
      savedHooksResult,
      savedCaptionsResult,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rsResult,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      crResult,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      acResult,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      esResult,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pdResult,
    ] = await Promise.all([
      supabase
        .from("calendar_entries")
        .select("*", { count: "exact", head: true })
        .in("brand_id", brandIds)
        .gte("scheduled_date", startOfWeekStr)
        .lte("scheduled_date", endOfWeekStr),
      supabase
        .from("calendar_entries")
        .select("id, title, scheduled_date, platform, status, hook_text, caption_text, is_ready, color")
        .in("brand_id", brandIds)
        .gte("scheduled_date", startOfWeekStr)
        .order("scheduled_date", { ascending: true })
        .limit(5),
      supabase
        .from("hooks")
        .select("*", { count: "exact", head: true })
        .in("brand_id", brandIds)
        .eq("is_saved", true),
      supabase
        .from("captions")
        .select("*", { count: "exact", head: true })
        .in("brand_id", brandIds)
        .eq("is_saved", true),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("reel_scripts") as any)
        .select("*", { count: "exact", head: true })
        .in("brand_id", brandIds)
        .eq("is_saved", true),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("carousels") as any)
        .select("*", { count: "exact", head: true })
        .in("brand_id", brandIds)
        .eq("is_saved", true),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("ad_copies") as any)
        .select("*", { count: "exact", head: true })
        .in("brand_id", brandIds)
        .eq("is_saved", true),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("email_sequences") as any)
        .select("*", { count: "exact", head: true })
        .in("brand_id", brandIds)
        .eq("is_saved", true),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("product_descriptions") as any)
        .select("*", { count: "exact", head: true })
        .in("brand_id", brandIds)
        .eq("is_saved", true),
    ])

    calendarEntriesThisWeek = calendarCountResult.count ?? 0
    recentCalendar = (recentCalendarResult.data ?? []) as RecentCalendarEntry[]

    savedContentCount =
      (savedHooksResult.count ?? 0) +
      (savedCaptionsResult.count ?? 0) +
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((rsResult as any).count ?? 0) +
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((crResult as any).count ?? 0) +
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((acResult as any).count ?? 0) +
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((esResult as any).count ?? 0) +
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((pdResult as any).count ?? 0)
  }

  const firstName = profile?.full_name?.split(" ")[0] ?? "there"
  const hour = now.getHours()
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"
  const dateLabel = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })

  const [occasions, dailyDraft, bestHookType] = await Promise.all([occasionsPromise, dailyDraftPromise, bestHookTypePromise])

  const shareText = dailyDraft
    ? `${dailyDraft.hookText}\n\n${dailyDraft.captionText}${dailyDraft.hashtags.length > 0 ? `\n\n${dailyDraft.hashtags.map((h) => `#${h}`).join(" ")}` : ""}`
    : ""

  return (
    <div className="px-4 py-6 md:p-8">
      {/* Header row -- date + greeting on the left, a quiet always-on
       * credit balance pill on the right. The old "+ Add brand"/"Run
       * Autopilot" buttons that used to live here are dropped: both are
       * already permanent Sidebar.tsx nav items (Brands, and each brand's
       * own Autopilot page), same reasoning DashboardStats' now-removed
       * Quick Actions row was cut for. */}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">
            {dateLabel}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">
            {greeting}, {firstName} 👋
          </h1>
        </div>
        {brandCount > 0 && <CreditBalancePill />}
      </div>

      {brandCount === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-muted-foreground/25 px-6 py-16 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100 dark:bg-violet-900/30">
            <Sparkles className="h-6 w-6 text-violet-600 dark:text-violet-400" />
          </div>
          <h2 className="text-lg font-semibold">Add a brand to get started</h2>
          <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
            Your stats, calendar, and upcoming occasions will show up here once you&apos;ve added a brand.
          </p>
          <Link
            href="/brands/new"
            className="mt-6 inline-flex h-10 items-center gap-1.5 rounded-md bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 text-sm font-medium text-white shadow-sm shadow-violet-500/30 transition-colors hover:from-violet-700 hover:to-fuchsia-700"
          >
            + Add your first brand
          </Link>
        </div>
      ) : (
        <>
          {/* Hero -- a real cached daily draft when one generated
           * successfully today, else the lighter manual CTA. Never both,
           * never an error message for the null case (see
           * getOrCreateDailyDraft's own doc comment: null covers both "no
           * credits" and "generation failed", and either way this is a
           * silent fallback, not a surfaced error). */}
          {firstBrandId && dailyDraft ? (
            <div className="mb-6 rounded-2xl border bg-card p-6 md:p-8">
              <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">
                Today&apos;s draft
              </p>
              <div className="flex flex-col gap-6 sm:flex-row">
                <div className="w-full shrink-0 overflow-hidden rounded-xl bg-secondary sm:w-40">
                  {dailyDraft.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={dailyDraft.imageUrl} alt="" className="aspect-[4/5] w-full object-cover" />
                  ) : (
                    <div className="flex aspect-[4/5] items-center justify-center">
                      <Sparkles className="h-8 w-8 text-muted-foreground/40" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-3">
                  <p className="text-lg font-semibold leading-snug">{dailyDraft.hookText}</p>
                  <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{dailyDraft.captionText}</p>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <a
                      href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-9 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-sm font-medium text-white transition-colors hover:bg-violet-700"
                    >
                      Send
                    </a>
                    <Link
                      href={`/brands/${firstBrandId}/generate?tab=full_post`}
                      className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors hover:bg-muted"
                    >
                      Edit
                    </Link>
                    {dailyDraft.imageUrl && (
                      <ScheduleAction
                        brandId={firstBrandId}
                        caption={dailyDraft.captionText}
                        hashtags={dailyDraft.hashtags}
                        imageUrl={dailyDraft.imageUrl}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : firstBrandId && (
            <div className="mb-6 flex flex-col items-start justify-between gap-3 rounded-2xl border bg-card p-6 md:p-8 sm:flex-row sm:items-center">
              <div>
                <p className="text-base font-semibold">Ready to post today?</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Generate something fresh for {firstBrand?.name}
                  {firstBrand?.niche ? ` (${firstBrand.niche})` : ""}.
                </p>
              </div>
              <Link
                href={`/brands/${firstBrandId}/generate?tab=full_post`}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-violet-600 px-4 text-sm font-medium text-white transition-colors hover:bg-violet-700"
              >
                Generate a post
              </Link>
            </div>
          )}

          {/* Momentum -- Mon-Sun, filled for days with generation activity
           * (dailyActivity above), dashed outline for days not yet
           * reached, a "+" only on today when today has none yet. */}
          <div className="mb-6 rounded-2xl border bg-card p-6">
            <p className="mb-4 text-sm font-semibold">This week&apos;s momentum</p>
            <div className="flex items-center justify-between gap-2">
              {momentumDays.map((d) => {
                const filled = d.count > 0
                if (d.isFuture) {
                  return (
                    <div key={d.dateStr} className="flex flex-col items-center gap-1.5">
                      <div className="h-8 w-8 rounded-full border-2 border-dashed border-muted-foreground/30" />
                      <span className="text-[10px] text-muted-foreground">{d.label}</span>
                    </div>
                  )
                }
                if (d.isToday && !filled) {
                  return (
                    <Link
                      key={d.dateStr}
                      href={firstBrandId ? `/brands/${firstBrandId}/generate?tab=full_post` : "/brands/new"}
                      className="flex flex-col items-center gap-1.5"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-violet-400 text-violet-600 transition-colors hover:bg-violet-50 dark:hover:bg-violet-950/30">
                        <Plus className="h-4 w-4" />
                      </div>
                      <span className="text-[10px] font-medium text-violet-600">{d.label}</span>
                    </Link>
                  )
                }
                return (
                  <div key={d.dateStr} className="flex flex-col items-center gap-1.5">
                    <div className={`h-8 w-8 rounded-full ${filled ? "bg-violet-600" : "border-2 border-muted-foreground/20"}`} />
                    <span className="text-[10px] text-muted-foreground">{d.label}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Coming up (existing UpcomingOccasions data) + best hook type
           * this month (Part C) -- the latter omitted entirely when there
           * isn't enough rated data yet, not shown as a placeholder. */}
          <div className="grid gap-4 md:grid-cols-2">
            <UpcomingOccasions brandId={firstBrandId} occasions={occasions} />
            {bestHookType && (
              <div className="rounded-xl border bg-card p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your best hook type this month</p>
                <p className="mt-2 text-lg font-semibold capitalize">{bestHookType.hookType.replace(/_/g, " ")}</p>
                <p className="mt-1 text-sm text-muted-foreground">Averaging {bestHookType.avgRating.toFixed(1)}★ from rated hooks this month</p>
              </div>
            )}
          </div>

          {/* Kept exactly as before -- low-balance gating untouched, just
           * repositioned further down the page since the header pill
           * above is now the quiet always-on indicator. */}
          <div className="mt-6">
            <CreditGiftBoxes />
          </div>

          <DetailedStatsToggle>
            <DashboardStats
              generationsThisMonth={generationsThisMonth}
              generationsLastMonth={generationsLastMonth}
              savedContentCount={savedContentCount}
              calendarEntriesThisWeek={calendarEntriesThisWeek}
              activeBrands={activeBrandCount}
              recentCalendar={recentCalendar}
              firstBrandId={firstBrandId}
              dailyActivity={dailyActivity}
            />
          </DetailedStatsToggle>
        </>
      )}
    </div>
  )
}
