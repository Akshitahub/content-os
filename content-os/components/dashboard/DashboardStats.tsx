"use client"

import Link from "next/link"
import { useState, useEffect } from "react"
import { Check, Sparkles, TrendingUp, TrendingDown } from "lucide-react"
import type { CalendarEntryRow } from "@/types/database"
import { ActivityChart, type DailyActivityPoint } from "@/components/dashboard/ActivityChart"

const ONBOARDING_KEY = "contentos_onboarding"

type RecentCalendarEntry = Pick<CalendarEntryRow, "id" | "title" | "scheduled_date" | "platform" | "status" | "hook_text" | "caption_text" | "is_ready" | "color">

interface DashboardStatsProps {
  generationsThisMonth: number
  generationsLastMonth: number
  savedContentCount: number
  calendarEntriesThisWeek: number
  activeBrands: number
  recentCalendar: RecentCalendarEntry[]
  firstBrandId: string | null
  dailyActivity: DailyActivityPoint[]
}

// Small solid dot per status, same colors as ContentCalendar.tsx's own
// STATUS_DOT -- this list only needs a glance-level color cue, not the
// full pale-badge treatment STATUS_COLORS (lib/design/constants.ts) is
// meant for.
const STATUS_DOT_COLORS: Record<string, string> = {
  planned: "bg-gray-400",
  content_ready: "bg-blue-500",
  scheduled: "bg-violet-500",
  published: "bg-emerald-500",
  missed: "bg-red-500",
}

export function DashboardStats({
  generationsThisMonth,
  generationsLastMonth,
  savedContentCount,
  calendarEntriesThisWeek,
  activeBrands,
  recentCalendar,
  firstBrandId,
  dailyActivity,
}: DashboardStatsProps) {
  const [onboardingDismissed, setOnboardingDismissed] = useState(true)

  const checks = {
    brandAdded: activeBrands > 0,
    contentGenerated: generationsThisMonth > 0 || savedContentCount > 0,
    calendarBuilt: calendarEntriesThisWeek > 0 || recentCalendar.length > 0,
  }
  const doneCount = Object.values(checks).filter(Boolean).length
  const allDone = doneCount === 3

  useEffect(() => {
    try {
      if (localStorage.getItem(ONBOARDING_KEY) !== "done") {
        setOnboardingDismissed(false)
      }
    } catch {}
  }, [])

  useEffect(() => {
    if (allDone) {
      try { localStorage.setItem(ONBOARDING_KEY, "done") } catch {}
      const t = setTimeout(() => setOnboardingDismissed(true), 2000)
      return () => clearTimeout(t)
    }
  }, [allDone])

  // Month-over-month trend — the one stat where "vs last period" is an
  // honest, apples-to-apples number (a fixed-length calendar month
  // compared to the previous one). Saved content is a cumulative total
  // (no natural time window to trend against), and Calendar-this-week
  // mixes already-published and not-yet-happened entries (a "vs last
  // week" comparison there wouldn't mean what it looks like it means) --
  // both skip a trend rather than fabricate one, per instruction.
  const generationsTrend = generationsLastMonth > 0
    ? Math.round(((generationsThisMonth - generationsLastMonth) / generationsLastMonth) * 100)
    : null

  // Same brand-scoped-with-/brands-fallback pattern as Sidebar.tsx's
  // brandHref: when there's no brand yet, send the user to pick/create one
  // rather than building a broken /brands/undefined/... URL.
  const libraryHref = firstBrandId ? `/brands/${firstBrandId}/library` : "/brands"
  const calendarThisWeekHref = firstBrandId ? `/brands/${firstBrandId}/calendar?view=week` : "/brands"
  const createHref = firstBrandId ? `/brands/${firstBrandId}/generate` : "/brands"

  // Active brands is deliberately not here -- it's already visible via the
  // brand switcher/`/brands` page, not something that needs home-page
  // real estate.
  const stats = [
    {
      label: "generated this month",
      value: generationsThisMonth,
      trend: generationsTrend,
      // Same destination as "saved" below — both metrics live in the same
      // place (My Content/Library), and there's no real "recent vs. all"
      // distinction in the underlying data to justify two different query
      // params here.
      href: libraryHref,
    },
    { label: "saved", value: savedContentCount, trend: null, href: libraryHref },
    { label: "this week", value: calendarEntriesThisWeek, trend: null, href: calendarThisWeekHref },
  ]

  return (
    <div className="space-y-6">
      {/* Welcome banner — new users with no content yet */}
      {generationsThisMonth === 0 && savedContentCount === 0 && firstBrandId && (
        <div className="rounded-xl border bg-gradient-to-br from-violet-50 to-indigo-50 p-6 text-center shadow-sm space-y-3 dark:from-violet-900/20 dark:to-indigo-900/20">
          <div className="text-3xl">👋</div>
          <div>
            <p className="text-lg font-semibold">Welcome to SocioPosts!</p>
            <p className="mt-1 text-sm text-muted-foreground">Your AI content engine is ready. Create your first piece of content in seconds.</p>
          </div>
          <Link
            href={`/brands/${firstBrandId}/generate`}
            className="inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 transition-colors"
          >
            <Sparkles className="h-4 w-4" />
            Create my first content
          </Link>
        </div>
      )}

      {/* Onboarding checklist */}
      {!onboardingDismissed && (
        <div className="relative overflow-hidden rounded-xl border border-violet-200/60 bg-gradient-to-br from-violet-50/80 via-card to-card p-5 shadow-sm dark:border-violet-800/30 dark:from-violet-900/10">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600 text-white shadow-sm">
                <Sparkles className="h-3.5 w-3.5" />
              </div>
              <p className="text-sm font-semibold">Get started</p>
              <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                {doneCount}/3
              </span>
            </div>
            <button
              onClick={() => {
                try { localStorage.setItem(ONBOARDING_KEY, "done") } catch {}
                setOnboardingDismissed(true)
              }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Dismiss
            </button>
          </div>
          <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-violet-100 dark:bg-violet-900/30">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all duration-500"
              style={{ width: `${(doneCount / 3) * 100}%` }}
            />
          </div>
          <ul className="space-y-2">
            {[
              { label: "Add a brand", done: checks.brandAdded, href: firstBrandId ? undefined : "/brands/new" },
              { label: "Generate your first piece of content", done: checks.contentGenerated, href: firstBrandId ? `/brands/${firstBrandId}/generate` : undefined },
              { label: "Build a content calendar", done: checks.calendarBuilt, href: firstBrandId ? `/brands/${firstBrandId}/fastlane` : undefined },
            ].map(({ label, done, href }) => (
              <li key={label} className="flex items-center gap-2.5">
                <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${done ? "border-green-500 bg-green-500" : "border-muted-foreground/30"}`}>
                  {done && <Check className="h-3 w-3 text-white" />}
                </div>
                {href && !done ? (
                  <Link href={href} className="text-sm font-medium text-foreground hover:text-primary transition-colors">
                    {label}
                  </Link>
                ) : (
                  <span className={`text-sm ${done ? "line-through text-muted-foreground" : "font-medium text-foreground"}`}>{label}</span>
                )}
              </li>
            ))}
          </ul>
          {allDone && (
            <p className="mt-3 text-xs text-green-600 font-medium">All done! You&apos;re a content pro. 🎉</p>
          )}
        </div>
      )}

      {/* Stats — a light row of number + label pairs rather than bordered
       * cards; each still links to its existing destination. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {stats.map(({ label, value, trend, href }) => (
          <Link
            key={label}
            href={href}
            className="flex items-baseline gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <span className="text-lg font-semibold text-foreground">{value.toLocaleString()}</span>
            {label}
            {trend !== null && trend !== undefined && trend !== 0 && (
              <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${trend > 0 ? "text-green-600" : "text-red-500"}`}>
                {trend > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {Math.abs(trend)}%
              </span>
            )}
          </Link>
        ))}
      </div>

      {/* Activity chart */}
      <ActivityChart data={dailyActivity} createHref={createHref} />

      {/* Content preview — ready to post this week. A compact list, not a
       * working surface -- full detail/copy/edit already lives on the
       * Calendar page each row links to. */}
      {recentCalendar.length > 0 && firstBrandId && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">Ready to post this week</h2>
            <Link
              href={`/brands/${firstBrandId}/calendar`}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              View calendar →
            </Link>
          </div>
          <div className="divide-y rounded-lg border">
            {recentCalendar.slice(0, 4).map((entry) => (
              <Link
                key={entry.id}
                href={`/brands/${firstBrandId}/calendar`}
                className="flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors hover:bg-muted/50"
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT_COLORS[entry.status] ?? STATUS_DOT_COLORS.planned}`} />
                <span className="flex-1 truncate">{entry.hook_text || entry.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{entry.scheduled_date}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
