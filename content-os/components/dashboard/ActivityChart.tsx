"use client"

import { useState } from "react"

export interface DailyActivityPoint {
  /** "Mon", "Tue", etc. — precomputed server-side so this stays a pure
   * display component with no date-formatting logic of its own. */
  label: string
  date: string
  count: number
}

interface ActivityChartProps {
  data: DailyActivityPoint[]
}

/**
 * A small real bar chart, not a placeholder — content generated per day
 * over the last 14 days. Hand-rolled SVG rather than pulling in a
 * charting library: recharts (assumed already installed) turned out not
 * to actually be a dependency here, and a 14-bar sparkline-style chart is
 * simple enough that adding a real new dependency for it isn't
 * justified. Flagged back rather than silently installing one.
 */
export function ActivityChart({ data }: ActivityChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const max = Math.max(1, ...data.map((d) => d.count))
  const barWidth = 100 / data.length
  const hovered = hoverIndex !== null ? data[hoverIndex] : null

  if (data.every((d) => d.count === 0)) {
    return (
      <div className="flex h-[120px] items-center justify-center rounded-xl border bg-card text-xs text-muted-foreground">
        No activity yet in the last {data.length} days
      </div>
    )
  }

  return (
    <div className="rounded-xl border bg-card p-5">
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
