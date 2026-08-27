"use client"

import Link from "next/link"
import { useCallback, useState, useEffect } from "react"
import { Zap, Bookmark, Calendar, Layers, Copy, Check, Sparkles, TrendingUp, TrendingDown, ArrowRight } from "lucide-react"
import type { CalendarEntryRow } from "@/types/database"
import { STATUS_COLORS } from "@/lib/design/constants"
import { PlatformIcon } from "@/components/shared/PlatformIcon"
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

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handle = useCallback(async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }, [text])
  return (
    <button
      onClick={handle}
      className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
    >
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  )
}

const QUICK_ACTIONS = [
  { href: "fastlane", label: "Autopilot", sub: "Plan a month in one click", icon: Zap, color: "text-violet-600", bg: "from-violet-500/20 to-violet-500/5", ring: "hover:border-violet-300", hoverShadow: "hover:shadow-violet-100" },
  { href: "generate", label: "Create", sub: "Hooks, posts, carousels & more", icon: Sparkles, color: "text-blue-600", bg: "from-blue-500/20 to-blue-500/5", ring: "hover:border-blue-300", hoverShadow: "hover:shadow-blue-100" },
  { href: "calendar", label: "Calendar", sub: "See what's scheduled", icon: Calendar, color: "text-green-600", bg: "from-green-500/20 to-green-500/5", ring: "hover:border-green-300", hoverShadow: "hover:shadow-green-100" },
] as const

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

  // Month-over-month trend — the one stat card where "vs last period" is
  // an honest, apples-to-apples number (a fixed-length calendar month
  // compared to the previous one). Saved content is a cumulative total
  // (no natural time window to trend against), Calendar-this-week mixes
  // already-published and not-yet-happened entries (a "vs last week"
  // comparison there wouldn't mean what it looks like it means), and
  // Active brands changes too rarely for a trend arrow to be meaningful
  // -- all three skip a trend rather than fabricate one, per instruction.
  const generationsTrend = generationsLastMonth > 0
    ? Math.round(((generationsThisMonth - generationsLastMonth) / generationsLastMonth) * 100)
    : null

  // Same brand-scoped-with-/brands-fallback pattern as Sidebar.tsx's
  // brandHref: when there's no brand yet, send the user to pick/create one
  // rather than building a broken /brands/undefined/... URL.
  const libraryHref = firstBrandId ? `/brands/${firstBrandId}/library` : "/brands"
  const calendarThisWeekHref = firstBrandId ? `/brands/${firstBrandId}/calendar?view=week` : "/brands"
  const createHref = firstBrandId ? `/brands/${firstBrandId}/generate` : "/brands"

  // hoverShadow tints each card's lift-on-hover shadow to match its own
  // accent (violet/blue/green/amber) rather than one uniform tint --
  // same "lift + colored shadow" motion Influencers/CreatePicker already
  // use, just following each card's own hue instead of a single brand
  // color, since these four cards are deliberately differently-accented.
  const stats = [
    {
      label: "Generated this month",
      value: generationsThisMonth,
      sub: "AI content pieces",
      icon: Zap,
      color: "text-violet-500",
      bg: "bg-gradient-to-br from-violet-500/20 to-violet-500/5",
      topBorder: "border-t-violet-400",
      hoverShadow: "hover:shadow-violet-100",
      trend: generationsTrend,
      // Same destination as "Saved content" below — both metrics live in
      // the same place (My Content/Library), and there's no real "recent
      // vs. all" distinction in the underlying data to justify two
      // different query params here.
      href: libraryHref,
    },
    {
      label: "Saved content",
      value: savedContentCount,
      sub: "across 7 types",
      icon: Bookmark,
      color: "text-blue-500",
      bg: "bg-gradient-to-br from-blue-500/20 to-blue-500/5",
      topBorder: "border-t-blue-400",
      hoverShadow: "hover:shadow-blue-100",
      trend: null,
      href: libraryHref,
    },
    {
      label: "Calendar this week",
      value: calendarEntriesThisWeek,
      sub: "content entries",
      icon: Calendar,
      color: "text-green-500",
      bg: "bg-gradient-to-br from-green-500/20 to-green-500/5",
      topBorder: "border-t-green-400",
      hoverShadow: "hover:shadow-green-100",
      trend: null,
      href: calendarThisWeekHref,
    },
    {
      label: "Active brands",
      value: activeBrands,
      sub: "imported & configured",
      icon: Layers,
      color: "text-amber-500",
      bg: "bg-gradient-to-br from-amber-500/20 to-amber-500/5",
      topBorder: "border-t-amber-400",
      hoverShadow: "hover:shadow-amber-100",
      trend: null,
      href: "/brands",
    },
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

      {/* Stat cards — 2x2 on mobile, 4 across on desktop */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {stats.map(({ label, value, sub, icon: Icon, color, bg, topBorder, hoverShadow, trend, href }) => (
          <Link
            key={label}
            href={href}
            className={`block cursor-pointer rounded-xl border border-t-2 bg-card p-5 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-lg ${topBorder} ${hoverShadow}`}
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-medium text-muted-foreground">{label}</p>
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${bg}`}>
                <Icon className={`h-4 w-4 ${color}`} />
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <p className="text-[22px] font-semibold leading-none">{value.toLocaleString()}</p>
              {trend !== null && trend !== undefined && trend !== 0 && (
                <span className={`flex items-center gap-0.5 text-[11px] font-semibold ${trend > 0 ? "text-green-600" : "text-red-500"}`}>
                  {trend > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {Math.abs(trend)}%
                </span>
              )}
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground/70">{sub}</p>
          </Link>
        ))}
      </div>

      {/* Activity chart */}
      <ActivityChart data={dailyActivity} createHref={createHref} />

      {/* Quick actions — primary entry points, not an afterthought row */}
      {firstBrandId && (
        <div>
          <h2 className="mb-4 text-base font-semibold">Quick actions</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {QUICK_ACTIONS.map(({ href, label, sub, icon: Icon, color, bg, ring, hoverShadow }) => (
              <Link
                key={href}
                href={`/brands/${firstBrandId}/${href}`}
                className={`group flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-lg ${ring} ${hoverShadow}`}
              >
                <div className="flex items-center justify-between">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${bg}`}>
                    <Icon className={`h-5 w-5 ${color}`} />
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{label}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{sub}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Content preview — ready to post this week */}
      {recentCalendar.length > 0 && firstBrandId && (
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold">Ready to post this week</h2>
            <Link
              href={`/brands/${firstBrandId}/calendar`}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              View calendar →
            </Link>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {recentCalendar.slice(0, 4).map((entry) => (
              <div
                key={entry.id}
                className="rounded-xl border bg-card p-4 space-y-3 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-lg hover:shadow-violet-100"
              >
                {/* Platform + date */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {entry.platform && <PlatformIcon platform={entry.platform} className="h-3.5 w-3.5" />}
                    <span className="text-xs font-medium capitalize text-muted-foreground">
                      {entry.platform ?? ""}
                    </span>
                    <span className="text-xs text-muted-foreground/60">·</span>
                    <span className="text-xs text-muted-foreground/60">{entry.scheduled_date}</span>
                  </div>
                  {entry.status && (
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold ${STATUS_COLORS[entry.status] ?? STATUS_COLORS.planned}`}>
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      {entry.status.replace("_", " ")}
                    </span>
                  )}
                </div>

                {/* Hook */}
                {entry.hook_text && (
                  <p className="text-sm font-semibold leading-snug line-clamp-2">
                    {entry.hook_text}
                  </p>
                )}

                {/* Caption preview */}
                {entry.caption_text && (
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                    {entry.caption_text}
                  </p>
                )}

                {/* Actions */}
                <div className="flex items-center gap-1 pt-1 border-t">
                  <CopyBtn
                    text={[entry.hook_text, entry.caption_text].filter(Boolean).join("\n\n")}
                  />
                  <Link
                    href={`/brands/${firstBrandId}/calendar`}
                    className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Edit →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
