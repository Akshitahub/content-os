"use client"

import Link from "next/link"
import { Zap, Bookmark, Calendar, Layers } from "lucide-react"
import type { CalendarEntryRow, HookRow } from "@/types/database"

interface DashboardStatsProps {
  generationsThisMonth: number
  savedContentCount: number
  calendarEntriesThisWeek: number
  activeBrands: number
  recentCalendar: Pick<CalendarEntryRow, "id" | "title" | "scheduled_date" | "platform" | "status">[]
  recentHooks: Pick<HookRow, "id" | "hook_text" | "hook_type" | "created_at">[]
  firstBrandId: string | null
}

const STATUS_COLORS: Record<string, string> = {
  planned: "bg-zinc-700 text-zinc-300",
  content_ready: "bg-blue-900/50 text-blue-300",
  scheduled: "bg-violet-900/50 text-violet-300",
  published: "bg-green-900/50 text-green-300",
  missed: "bg-red-900/50 text-red-300",
}

export function DashboardStats({
  generationsThisMonth,
  savedContentCount,
  calendarEntriesThisWeek,
  activeBrands,
  recentCalendar,
  recentHooks,
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
                <li key={entry.id} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{entry.title}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {entry.status && (
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_COLORS[entry.status] ?? "bg-zinc-700 text-zinc-300"}`}>
                        {entry.status.replace("_", " ")}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">{entry.scheduled_date}</span>
                  </div>
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
