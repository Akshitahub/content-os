"use client"

import { useState } from "react"
import Link from "next/link"
import { BarChart3, Sparkles } from "lucide-react"

export interface DailyActivityPoint {
  /** "Mon", "Tue", etc. — precomputed server-side so this stays a pure
   * display component with no date-formatting logic of its own. */
  label: string
  date: string
  count: number
}

interface ActivityChartProps {
  data: DailyActivityPoint[]
  /** Where the empty-state CTA sends the user to generate their first
   * piece of content — brand-scoped Create page, or /brands as a fallback
   * when there's somehow no active brand yet (same pattern as the stat
   * cards' own hrefs in DashboardStats.tsx). */
  createHref: string
}

/**
 * A small real bar chart, not a placeholder — content generated per day
 * over the last 14 days. Hand-rolled SVG rather than pulling in a
 * charting library: recharts (assumed already installed) turned out not
 * to actually be a dependency here, and a 14-bar sparkline-style chart is
 * simple enough that adding a real new dependency for it isn't
 * justified. Flagged back rather than silently installing one.
 */
export function ActivityChart({ data, createHref }: ActivityChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const max = Math.max(1, ...data.map((d) => d.count))
  const barWidth = 100 / data.length
  const hovered = hoverIndex !== null ? data[hoverIndex] : null

  if (data.every((d) => d.count === 0)) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-card px-5 py-10 text-center shadow-sm">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-violet-500/15 to-violet-500/5">
          <BarChart3 className="h-5 w-5 text-violet-500" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">No activity yet</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Generate your first post to see it here.
          </p>
        </div>
        <Link
          href={createHref}
          className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet-700"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Create your first post
        </Link>
      </div>
    )
  }

  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">Activity, last {data.length} days</p>
        <p className="text-xs font-medium text-foreground">
          {hovered ? `${hovered.count} on ${hovered.label}` : `${data.reduce((s, d) => s + d.count, 0)} total`}
        </p>
      </div>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-[72px] w-full overflow-visible">
        {data.map((d, i) => {
          const h = (d.count / max) * 36
          const isHovered = hoverIndex === i
          return (
            <rect
              key={d.date}
              x={i * barWidth + barWidth * 0.15}
              y={40 - h}
              width={barWidth * 0.7}
              height={Math.max(h, d.count > 0 ? 1.5 : 0.5)}
              rx={1}
              className={isHovered ? "fill-violet-600" : d.count > 0 ? "fill-violet-400" : "fill-muted"}
              onMouseEnter={() => setHoverIndex(i)}
              onMouseLeave={() => setHoverIndex(null)}
            />
          )
        })}
      </svg>
      <div className="mt-2 flex justify-between text-[10px] text-muted-foreground/70">
        <span>{data[0]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
    </div>
  )
}
