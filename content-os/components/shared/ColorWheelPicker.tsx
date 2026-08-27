"use client"

import { useState } from "react"
import { HexColorPicker } from "react-colorful"

// Real color picker for the "Custom color" background mode (see
// components/shared/VibePicker.tsx's 7th option) — instant, client-side
// only, never an AI-generation call. Gradient is the default rather than
// solid: a flat single-color fill reads noticeably cheaper next to the
// existing AI-generated abstract gradients it sits alongside as an
// alternative, so gradient is the natural default and solid is the
// secondary option, not the other way around.
export type ColorWheelMode = "solid" | "gradient"

interface ColorWheelPickerProps {
  /** 1 hex value for solid mode, 2 for gradient. Mode is derived from the
   * array length rather than tracked as separate state, so there's only
   * ever one source of truth for what's actually selected. */
  colors: string[]
  onChange: (colors: string[]) => void
}

const DEFAULT_SOLID = "#6366F1"
const DEFAULT_GRADIENT: [string, string] = ["#6366F1", "#EC4899"]

export function cssBackgroundFromColors(colors: string[] | null | undefined): string | undefined {
  if (!colors || colors.length === 0) return undefined
  if (colors.length === 1) return colors[0]
  return `linear-gradient(135deg, ${colors.join(", ")})`
}

export function ColorWheelPicker({ colors, onChange }: ColorWheelPickerProps) {
  const mode: ColorWheelMode = colors.length >= 2 ? "gradient" : "solid"
  const [activeStop, setActiveStop] = useState<0 | 1>(0)

  function setMode(next: ColorWheelMode) {
    if (next === "solid") {
      onChange([colors[0] ?? DEFAULT_SOLID])
    } else {
      onChange([colors[0] ?? DEFAULT_GRADIENT[0], colors[1] ?? DEFAULT_GRADIENT[1]])
    }
    setActiveStop(0)
  }

  function setStopColor(hex: string) {
    const next = [...colors]
    next[activeStop] = hex
    onChange(next)
  }

  const activeHex = colors[activeStop] ?? DEFAULT_SOLID

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {(["gradient", "solid"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 rounded-md border-2 py-1.5 text-xs font-semibold capitalize transition-all ${
              mode === m ? "border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-950/30" : "border-border hover:border-violet-300"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Live preview */}
      <div
        className="h-14 w-full rounded-lg border"
        style={{ background: cssBackgroundFromColors(colors) }}
      />

      {/* Gradient stop selector — which color the wheel below is editing */}
      {mode === "gradient" && (
        <div className="flex gap-2">
          {[0, 1].map((i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActiveStop(i as 0 | 1)}
              className={`flex h-8 flex-1 items-center justify-center rounded-md border-2 text-[10px] font-semibold uppercase tracking-wide text-white/90 transition-all ${
                activeStop === i ? "border-violet-500 ring-2 ring-violet-200" : "border-transparent"
              }`}
              style={{ backgroundColor: colors[i] ?? (i === 0 ? DEFAULT_GRADIENT[0] : DEFAULT_GRADIENT[1]) }}
            >
              Color {i + 1}
            </button>
          ))}
        </div>
      )}

      <div className="[&_.react-colorful]:w-full [&_.react-colorful]:h-40 [&_.react-colorful\_\_saturation]:rounded-lg [&_.react-colorful\_\_hue]:mt-2 [&_.react-colorful\_\_hue]:h-4 [&_.react-colorful\_\_hue]:rounded-full">
        <HexColorPicker color={activeHex} onChange={setStopColor} />
      </div>

      <input
        type="text"
        value={activeHex}
        onChange={(e) => setStopColor(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
        placeholder="#6366F1"
      />
    </div>
  )
}
