"use client"

import Link from "next/link"
import { useCallback, useState, useEffect } from "react"
import { Zap, Bookmark, Calendar, Layers, Copy, Check, Sparkles, Users, CheckCircle2, Circle } from "lucide-react"
import type { CalendarEntryRow, HookRow } from "@/types/database"

const ONBOARDING_KEY = "contentos_onboarding"

type RecentCalendarEntry = Pick<CalendarEntryRow, "id" | "title" | "scheduled_date" | "platform" | "status" | "hook_text" | "caption_text" | "is_ready" | "color">
type TodayEntry = Pick<CalendarEntryRow, "id" | "title" | "platform" | "scheduled_date" | "status" | "is_ready" | "color">

interface DashboardStatsProps {
  generationsThisMonth: number
  savedContentCount: number
  calendarEntriesThisWeek: number
  activeBrands: number
  recentCalendar: RecentCalendarEntry[]
  recentHooks: Pick<HookRow, "id" | "hook_text" | "hook_type" | "created_at">[]
  todayEntries: TodayEntry[]
  firstBrandId: string | null
}

const PLATFORM_EMOJIS: Record<string, string> = {
  instagram: "📸",
  tiktok: "🎵",
  facebook: "👤",
  youtube: "▶️",
  linkedin: "💼",
  twitter: "🐦",
}

const STATUS_COLORS: Record<string, string> = {
  planned: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  content_ready: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  scheduled: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  published: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  missed: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
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

export function DashboardStats({
  generationsThisMonth,
  savedContentCount,
  calendarEntriesThisWeek,
  activeBrands,
  recentCalendar,
  recentHooks,
  todayEntries,
  firstBrandId,
}: DashboardStatsProps) {
  const [onboardingDismissed, setOnboardingDismissed] = useState(true)

  const checks = {
    brandAdded: activeBrands > 0,
    contentGenerated: generationsThisMonth > 0 || savedContentCount > 0,
    calendarBuilt: calendarEntriesThisWeek > 0 || recentCalendar.length > 0,
  }
  const allDone = Object.values(checks).every(Boolean)

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

  const stats = [
    {
      label: "Generated this month",
      value: generationsThisMonth,
      sub: "AI content pieces",
      icon: Zap,
      color: "text-violet-500",
      bg: "bg-violet-500/10",
    },
    {
      label: "Saved content",
      value: savedContentCount,
      sub: "across 7 types",
      icon: Bookmark,
      color: "text-blue-500",
      bg: "bg-blue-500/10",
    },
    {
      label: "Calendar this week",
      value: calendarEntriesThisWeek,
      sub: "content entries",
      icon: Calendar,
      color: "text-green-500",
      bg: "bg-green-500/10",
    },
    {
      label: "Active brands",
      value: activeBrands,
      sub: "imported & configured",
      icon: Layers,
      color: "text-amber-500",
      bg: "bg-amber-500/10",
    },
  ]

  return (
    <div className="space-y-6">
      {/* Onboarding checklist */}
      {!onboardingDismissed && (
        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold">Get started</p>
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
          <ul className="space-y-2">
            {[
              { label: "Add a brand", done: checks.brandAdded, href: firstBrandId ? undefined : "/brands/new" },
              { label: "Generate your first piece of content", done: checks.contentGenerated, href: firstBrandId ? `/brands/${firstBrandId}/generate` : undefined },
              { label: "Build a content calendar", done: checks.calendarBuilt, href: firstBrandId ? `/brands/${firstBrandId}/fastlane` : undefined },
            ].map(({ label, done, href }) => (
              <li key={label} className="flex items-center gap-2.5">
                {done
                  ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                  : <Circle className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                }
                {href && !done ? (
                  <Link href={href} className={`text-sm ${done ? "line-through text-muted-foreground" : "text-foreground hover:text-primary transition-colors"}`}>
                    {label}
                  </Link>
                ) : (
                  <span className={`text-sm ${done ? "line-through text-muted-foreground" : "text-foreground"}`}>{label}</span>
                )}
              </li>
            ))}
          </ul>
          {allDone && (
            <p className="mt-3 text-xs text-green-600 font-medium">All done! You&apos;re a content pro. 🎉</p>
          )}
        </div>
      )}

      {/* Today's banner */}
      {todayEntries.length > 0 && firstBrandId && (
        <div
          className="flex items-start justify-between gap-4 rounded-xl border border-violet-200/60 dark:border-violet-800/30 px-5 py-4"
          style={{ background: "rgba(99,102,241,0.06)" }}
        >
          <div>
            <p className="font-semibold text-violet-900 dark:text-violet-200">
              📅 {todayEntries.length} post{todayEntries.length !== 1 ? "s" : ""} ready for today
            </p>
            <p className="mt-0.5 text-xs text-violet-600/70 dark:text-violet-400/70 truncate max-w-sm">
              {todayEntries
                .map((e) => `${PLATFORM_EMOJIS[e.platform ?? ""] ?? ""} ${e.platform ?? ""}`)
                .join(" · ")}
            </p>
          </div>
          <Link
            href={`/brands/${firstBrandId}/calendar`}
            className="shrink-0 text-xs font-medium text-violet-700 dark:text-violet-300 hover:text-violet-900 dark:hover:text-violet-100 transition-colors"
          >
            View posts →
          </Link>
        </div>
      )}

      {/* Stat cards — 2x2 on mobile, 4 across on desktop */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {stats.map(({ label, value, sub, icon: Icon, color, bg }) => (
          <div
            key={label}
            className="rounded-xl border bg-card p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-medium text-muted-foreground">{label}</p>
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${bg}`}>
                <Icon className={`h-4 w-4 ${color}`} />
              </div>
            </div>
            <p className="text-[22px] font-semibold leading-none">{value.toLocaleString()}</p>
            <p className="mt-1 text-[10px] text-muted-foreground/70">{sub}</p>
          </div>
        ))}
      </div>

      {/* Quick actions — 2x2 grid on mobile, row on desktop */}
      {firstBrandId && (
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <Link
            href={`/brands/${firstBrandId}/fastlane`}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Zap className="h-4 w-4" />
            Autopilot
          </Link>
          <Link
            href={`/brands/${firstBrandId}/generate`}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-input bg-background px-4 text-sm font-medium transition-colors hover:bg-secondary"
          >
            <Sparkles className="h-4 w-4" />
            Create
          </Link>
          <Link
            href={`/brands/${firstBrandId}/calendar`}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-input bg-background px-4 text-sm font-medium transition-colors hover:bg-secondary"
          >
            <Calendar className="h-4 w-4" />
            Calendar
          </Link>
          <Link
            href={`/brands/${firstBrandId}/influencers`}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-input bg-background px-4 text-sm font-medium transition-colors hover:bg-secondary"
          >
            <Users className="h-4 w-4" />
            Creators
          </Link>
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
                className="rounded-xl border bg-card p-4 space-y-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
              >
                {/* Platform + date */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {entry.platform && (
                      <span className="text-sm">{PLATFORM_EMOJIS[entry.platform] ?? ""}</span>
                    )}
                    <span className="text-xs font-medium capitalize text-muted-foreground">
                      {entry.platform ?? ""}
                    </span>
                    <span className="text-xs text-muted-foreground/60">·</span>
                    <span className="text-xs text-muted-foreground/60">{entry.scheduled_date}</span>
                  </div>
                  {entry.status && (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[entry.status] ?? STATUS_COLORS.planned}`}>
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

      {/* Recent hooks */}
      {recentHooks.length > 0 && (
        <div className="rounded-xl border bg-card p-5">
          <h3 className="mb-4 font-semibold">Recent scroll stoppers</h3>
          <ul className="space-y-3">
            {recentHooks.map((hook) => (
              <li
                key={hook.id}
                className="flex items-start justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="line-clamp-2 text-sm">{hook.hook_text}</p>
                  {hook.hook_type && (
                    <p className="mt-0.5 text-xs text-muted-foreground capitalize">
                      {hook.hook_type.replace("_", " ")}
                    </p>
                  )}
                </div>
                <CopyBtn text={hook.hook_text} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
