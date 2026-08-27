import Link from "next/link"
import { Calendar } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard"
import { DashboardStats } from "@/components/dashboard/DashboardStats"
import { UpcomingOccasions } from "@/components/dashboard/UpcomingOccasions"
import { PlatformIcon } from "@/components/shared/PlatformIcon"
import { getUpcomingOccasions } from "@/lib/occasions/get-upcoming-occasions"
import type { UserRow, CalendarEntryRow } from "@/types/database"

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const [profileResult, brandsResult] = await Promise.all([
    supabase.from("users").select("full_name, plan").eq("id", user.id).single<Pick<UserRow, "full_name" | "plan">>(),
    supabase.from("brands").select("id, name, is_active").eq("user_id", user.id).returns<Array<{ id: string; name: string; is_active: boolean }>>(),
  ])

  const profile = profileResult.data
  const brands = brandsResult.data ?? []
  const brandCount = brands.length
  const activeBrandCount = brands.filter((b) => b.is_active).length
  const firstBrandId = brands.find((b) => b.is_active)?.id ?? brands[0]?.id ?? null
  const brandIds = brands.map((b) => b.id)

  if (brandCount === 0) {
    return <OnboardingWizard />
  }

  // Started here (not awaited yet) so it runs concurrently with the big
  // Promise.all batch below instead of serially blocking the page on a DB
  // round-trip that has nothing to do with the rest of this page's data --
  // deferred past the brandCount===0 check above so the onboarding path
  // never fires this query at all.
  const occasionsPromise = getUpcomingOccasions(14)

  const now = new Date()
  const todayStr = now.toISOString().split("T")[0]!
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const dayOfWeek = now.getDay()
  const startOfWeek = new Date(now)
  startOfWeek.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))
  startOfWeek.setHours(0, 0, 0, 0)
  const endOfWeek = new Date(startOfWeek)
  endOfWeek.setDate(startOfWeek.getDate() + 6)
  const startOfWeekStr = startOfWeek.toISOString().split("T")[0]!
  const endOfWeekStr = endOfWeek.toISOString().split("T")[0]!

  const ACTIVITY_CHART_DAYS = 14
  const activityWindowStart = new Date(now)
  activityWindowStart.setDate(now.getDate() - (ACTIVITY_CHART_DAYS - 1))
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
    return { date: d.toISOString().split("T")[0]!, label: DAY_LABELS[d.getDay()]!, count: 0 }
  })
  const dailyActivityIndex = new Map(dailyActivity.map((d, i) => [d.date, i]))
  for (const row of activityRowsResult.data ?? []) {
    const day = row.created_at.split("T")[0]!
    const idx = dailyActivityIndex.get(day)
    if (idx !== undefined) dailyActivity[idx]!.count++
  }

  type RecentCalendarEntry = Pick<CalendarEntryRow, "id" | "title" | "scheduled_date" | "platform" | "status" | "hook_text" | "caption_text" | "is_ready" | "color">
  type TodayEntry = Pick<CalendarEntryRow, "id" | "title" | "platform" | "scheduled_date" | "status" | "is_ready" | "color">

  let calendarEntriesThisWeek = 0
  let recentCalendar: RecentCalendarEntry[] = []
  let savedContentCount = 0
  let todayEntries: TodayEntry[] = []

  if (brandIds.length > 0) {
    const [
      calendarCountResult,
      recentCalendarResult,
      todayReadyResult,
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
        .from("calendar_entries")
        .select("id, title, platform, scheduled_date, status, is_ready, color")
        .in("brand_id", brandIds)
        .eq("scheduled_date", todayStr)
        .eq("is_ready", true)
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
    todayEntries = (todayReadyResult.data ?? []) as TodayEntry[]

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

  return (
    <div className="px-4 py-6 md:p-8">
      {/* Hero — greeting + today's-posts banner live in ONE gradient card so
       * they read as a single considered unit instead of two stacked,
       * disconnected boxes. The "today ready" panel below is a translucent
       * inset on the same gradient rather than its own bordered card. */}
      <div className="relative mb-6 overflow-hidden rounded-2xl border border-violet-200/60 bg-gradient-to-br from-violet-50 via-white to-blue-50 p-6 dark:border-violet-800/30 dark:from-violet-950/40 dark:via-background dark:to-blue-950/20 md:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">
              {dateLabel}
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight md:text-4xl">
              {greeting}, {firstName} 👋
            </h1>
            <p className="mt-1.5 text-muted-foreground">
              Here&apos;s what&apos;s happening with your content today.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/brands/new"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-violet-200/70 bg-white/90 px-3 text-sm font-medium backdrop-blur-sm transition-colors hover:bg-white dark:border-violet-800/40 dark:bg-white/5 dark:hover:bg-white/10"
            >
              + Add brand
            </Link>
            {firstBrandId && (
              <Link
                href={`/brands/${firstBrandId}/fastlane`}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-gradient-to-r from-violet-600 to-fuchsia-600 px-3 text-sm font-medium text-white shadow-sm shadow-violet-500/30 transition-colors hover:from-violet-700 hover:to-fuchsia-700"
              >
                ✈️ Run Autopilot
              </Link>
            )}
          </div>
        </div>

        {todayEntries.length > 0 && firstBrandId && (
          <div className="mt-6 flex items-center justify-between gap-4 rounded-xl border border-violet-200/70 bg-white/70 px-4 py-3 backdrop-blur-sm dark:border-violet-800/40 dark:bg-black/20">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white">
                <Calendar className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-violet-900 dark:text-violet-200">
                  {todayEntries.length} post{todayEntries.length !== 1 ? "s" : ""} ready for today
                </p>
                <div className="mt-1 flex items-center gap-1.5">
                  {todayEntries.map((e) => e.platform && (
                    <PlatformIcon key={e.id} platform={e.platform} className="h-3.5 w-3.5" />
                  ))}
                </div>
              </div>
            </div>
            <Link
              href={`/brands/${firstBrandId}/calendar`}
              className="shrink-0 text-xs font-medium text-violet-700 hover:text-violet-900 dark:text-violet-300 dark:hover:text-violet-100 transition-colors"
            >
              View posts →
            </Link>
          </div>
        )}
      </div>

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

      <div className="mt-6">
        <UpcomingOccasions brandId={firstBrandId} occasions={await occasionsPromise} />
      </div>
    </div>
  )
}
