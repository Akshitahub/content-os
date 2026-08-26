"use client"

import { useRef, useState, useLayoutEffect } from "react"

/**
 * One reusable sliding-indicator tab control -- originally built for the
 * Influencers page (mode toggle + tier filter row), now shared so every
 * tab-like choice in the app uses the same pattern instead of each page
 * inventing its own (e.g. Library's tab bar used to be a plain
 * underline). Measures the active button's own box (not a hardcoded
 * width) so labels of any length still get a pixel-accurate pill under
 * them, and re-measures on resize since tab labels can wrap on narrow
 * viewports.
 */
export function SlidingTabs<T extends string>({
  tabs,
  active,
  onChange,
  variant = "filter",
}: {
  tabs: { id: T; label: string; icon?: React.ElementType }[]
  active: T
  onChange: (id: T) => void
  /** "filter" = compact muted/foreground tabs (e.g. a tier filter row, or
   * Library's tab bar). "segmented" = a boxed track with a solid pill
   * (e.g. a two-way mode toggle). */
  variant?: "filter" | "segmented"
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const btnRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const [indicator, setIndicator] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  useLayoutEffect(() => {
    function measure() {
      const btn = btnRefs.current.get(active)
      const container = containerRef.current
      if (!btn || !container) return
      const c = container.getBoundingClientRect()
      const b = btn.getBoundingClientRect()
      setIndicator({ left: b.left - c.left, top: b.top - c.top, width: b.width, height: b.height })
    }
    measure()
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [active, tabs.length])

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-wrap gap-1 ${variant === "segmented" ? "rounded-full border bg-muted/60 p-1" : ""}`}
    >
      {indicator && (
        <div
          className={`absolute rounded-full bg-violet-600 shadow-sm transition-[left,top,width,height] duration-200 ease-out ${
            variant === "segmented" ? "" : "shadow-violet-200"
          }`}
          style={{ left: indicator.left, top: indicator.top, width: indicator.width, height: indicator.height }}
        />
      )}
      {tabs.map((tab) => {
        const Icon = tab.icon
        return (
          <button
            key={tab.id}
            ref={(el) => {
              if (el) btnRefs.current.set(tab.id, el)
            }}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`relative z-10 flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-150 ${
              active === tab.id ? "text-white" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
