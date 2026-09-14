"use client"

import { useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"

/**
 * Collapses the old stat-row/activity-chart/"ready to post this week"
 * content (still rendered by DashboardStats.tsx, untouched) behind a
 * link at the bottom of the page -- that data is still genuinely useful,
 * just not hero-level content in the redesigned dashboard.
 */
export function DetailedStatsToggle({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-8 border-t pt-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        {open ? "Hide detailed stats" : "View detailed stats"}
      </button>
      {open && <div className="mt-4">{children}</div>}
    </div>
  )
}
