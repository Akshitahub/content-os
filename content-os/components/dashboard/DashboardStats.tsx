"use client"

import Link from "next/link"
import { Zap, Bookmark, Calendar, Layers } from "lucide-react"
import type { CalendarEntryRow, HookRow } from "@/types/database"

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

const STATUS_COLORS: Record<string, string> = {
  planned: "bg-zinc-700 text-zinc-300",
  content_ready: "bg-blue-900/50 text-blue-300",
  scheduled: "bg-violet-900/50 text-violet-300",
  published: "bg-green-900/50 text-green-300",
  missed: "bg-red-900/50 text-red-300",
}

const PLATFORM_EMOJIS: Record<string, string> = {
  instagram: "📸",
  tiktok: "🎵",
  facebook: "👤",
  youtube: "▶️",
  linkedin: "💼",
  twitter: "🐦",
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
  const stats = [
    { label: "Generations this month", value: generationsThisMonth, icon: Zap, color: "text-violet-400" },
    { label: "Content saved", value: savedContentCount, icon: Bookmark, color: "text-blue-400" },
    { label: "Calendar entries this week", value: calendarEntriesThisWeek, icon: Calendar, color: "text-green-400" },
    { label: "Active brands", value: activeBrands, icon: Layers, color: "text-amber-400" },
  ]

  return (
    <div className="space-y-6">
      {/* Today's content banner */}
      {todayEntries.length > 0 && firstBrandId && (
        <div className="flex items-start justify-between gap-4 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/20 px-5 py-4">
          <div>
            <p className="font-medium text-blue-800 dark:text-blue-300">
              📅 {todayEntries.length} post{todayEntries.length !== 1 ? "s" : ""} ready for today
            </p>
            <p className="mt-0.5 text-xs text-blue-600/80 dark:text-blue-400/70 truncate max-w-sm">
              {todayEntries.map(e => e.title).join(" · ")}
            </p>
          </div>
          <Link
            href={`/brands/${firstBrandId}/calendar`}
            className="shrink-0 text-xs font-medium text-blue-700 dark:text-blue-300 hover:text-blue-900 dark:hover:text-blue-100 transition-colors"
          >
            View posts →
          </Link>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-lg border bg-card p-6">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{label}</p>
              <Icon className={`h-4 w-4 ${color}`} />
            </div>
            <p className="mt-2 text-3xl font-bold">{value.toLocaleString()}</p>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      {firstBrandId && (
        <div className="flex flex-wrap gap-3">
          <Link
            href={`/brands/${firstBrandId}/generate`}
            className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Generate content →
          </Link>
          <Link
            href={`/brands/${firstBrandId}/products`}
            className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium transition-colors hover:bg-secondary"
          >
            Add product →
          </Link>
          <Link
            href={`/brands/${firstBrandId}/calendar`}
            className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium transition-colors hover:bg-secondary"
          >
            View calendar →
          </Link>
        </div>
      )}

      {/* Recent activity */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-6">
          <h3 className="mb-4 font-semibold">Upcoming calendar</h3>
          {recentCalendar.length === 0 ? (
            <p className="text-sm text-muted-foreground">No upcoming entries this week.</p>
          ) : (
            <ul className="space-y-3">
              {recentCalendar.map((entry) => (
                <li key={entry.id} className="space-y-0.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      {entry.platform && (
                        <span className="shrink-0 text-xs">{PLATFORM_EMOJIS[entry.platform]}</span>
                      )}
                      <span className="truncate text-sm font-medium">{entry.title}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {entry.is_ready && (
                        <span className="rounded bg-green-900/40 px-1.5 py-0.5 text-xs font-medium text-green-300">
                          Ready
                        </span>
                      )}
                      {entry.status && (
                        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_COLORS[entry.status] ?? "bg-zinc-700 text-zinc-300"}`}>
                          {entry.status.replace("_", " ")}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">{entry.scheduled_date}</span>
                    </div>
                  </div>
                  {entry.hook_text && (
                    <p className="text-xs text-muted-foreground truncate pl-5">
                      {entry.hook_text.length > 80 ? `${entry.hook_text.slice(0, 80)}…` : entry.hook_text}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border bg-card p-6">
          <h3 className="mb-4 font-semibold">Recent hooks</h3>
          {recentHooks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hooks generated yet.</p>
          ) : (
            <ul className="space-y-3">
              {recentHooks.map((hook) => (
                <li key={hook.id} className="rounded-md bg-muted/40 px-3 py-2">
                  <p className="line-clamp-2 text-sm">{hook.hook_text}</p>
                  {hook.hook_type && (
                    <p className="mt-1 text-xs text-muted-foreground capitalize">{hook.hook_type.replace("_", " ")}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
