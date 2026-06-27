import { createClient } from "@/lib/supabase/server"
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard"
import { DashboardStats } from "@/components/dashboard/DashboardStats"
import { UpcomingOccasions } from "@/components/dashboard/UpcomingOccasions"
import type { UserRow, CalendarEntryRow, HookRow } from "@/types/database"

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

  const now = new Date()
  const todayStr = now.toISOString().split("T")[0]!
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const dayOfWeek = now.getDay()
  const startOfWeek = new Date(now)
  startOfWeek.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))
  startOfWeek.setHours(0, 0, 0, 0)
  const endOfWeek = new Date(startOfWeek)
  endOfWeek.setDate(startOfWeek.getDate() + 6)
  const startOfWeekStr = startOfWeek.toISOString().split("T")[0]!
  const endOfWeekStr = endOfWeek.toISOString().split("T")[0]!

  const generationsResult = await supabase
    .from("ai_generation_logs")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", firstOfMonth)

  const generationsThisMonth = generationsResult.count ?? 0

  type RecentCalendarEntry = Pick<CalendarEntryRow, "id" | "title" | "scheduled_date" | "platform" | "status" | "hook_text" | "caption_text" | "is_ready" | "color">
  type TodayEntry = Pick<CalendarEntryRow, "id" | "title" | "platform" | "scheduled_date" | "status" | "is_ready" | "color">

  let calendarEntriesThisWeek = 0
  let recentCalendar: RecentCalendarEntry[] = []
  let recentHooks: Pick<HookRow, "id" | "hook_text" | "hook_type" | "created_at">[] = []
  let savedContentCount = 0
  let todayEntries: TodayEntry[] = []

  if (brandIds.length > 0) {
    const [
      calendarCountResult,
      recentCalendarResult,
      todayReadyResult,
      recentHooksResult,
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
        .select("id, hook_text, hook_type, created_at")
        .in("brand_id", brandIds)
        .order("created_at", { ascending: false })
        .limit(3),
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
    recentHooks = (recentHooksResult.data ?? []) as Pick<HookRow, "id" | "hook_text" | "hook_type" | "created_at">[]

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

  return (
    <div className="px-4 py-6 md:p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          {greeting}, {firstName} 👋
        </h1>
        <p className="mt-1 text-muted-foreground">
          Here&apos;s what&apos;s happening with your content today.
        </p>
      </div>

      <DashboardStats
        generationsThisMonth={generationsThisMonth}
        savedContentCount={savedContentCount}
        calendarEntriesThisWeek={calendarEntriesThisWeek}
        activeBrands={activeBrandCount}
        recentCalendar={recentCalendar}
        recentHooks={recentHooks}
        todayEntries={todayEntries}
        firstBrandId={firstBrandId}
      />

      <div className="mt-6">
        <UpcomingOccasions brandId={firstBrandId} />
      </div>
    </div>
  )
}
