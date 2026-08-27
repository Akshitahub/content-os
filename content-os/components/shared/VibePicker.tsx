"use client"

import { Check, PartyPopper, Circle, Moon, Flame, Briefcase, Sparkles, Palette, type LucideIcon } from "lucide-react"
import { ColorWheelPicker, cssBackgroundFromColors } from "@/components/shared/ColorWheelPicker"

export type Vibe =
  | "fun_playful"
  | "clean_minimal"
  | "bold_dramatic"
  | "warm_cozy"
  | "professional"
  | "trendy_genz"
  // Not an AI-generation vibe like the six above -- picking this renders
  // an instant client-side flat/gradient background from exact colors the
  // user picks (see ColorWheelPicker), never an AI-generation call. Kept
  // in this same union (rather than a parallel boolean flag) since exactly
  // one of these seven is ever the active mode at a time, matching how
  // every existing caller already tracks `vibe` as a single value.
  | "custom_color"

const VIBES: {
  id: Vibe
  label: string
  Icon: LucideIcon
  description: string
  colors: string[]
}[] = [
  {
    id: "fun_playful",
    label: "Fun & Playful",
    Icon: PartyPopper,
    description: "Bright, energetic, makes people smile",
    colors: ["#FF6B6B", "#FFE66D", "#4ECDC4"],
  },
  {
    id: "clean_minimal",
    label: "Clean & Minimal",
    Icon: Circle,
    description: "Simple, elegant, less is more",
    colors: ["#FFFFFF", "#F5F5F5", "#333333"],
  },
  {
    id: "bold_dramatic",
    label: "Bold & Dramatic",
    Icon: Moon,
    description: "Strong, confident, makes a statement",
    colors: ["#000000", "#6366F1", "#EC4899"],
  },
  {
    id: "warm_cozy",
    label: "Warm & Cozy",
    Icon: Flame,
    description: "Friendly, inviting, feels like home",
    colors: ["#F59E0B", "#EF4444", "#FEF3C7"],
  },
  {
    id: "professional",
    label: "Professional",
    Icon: Briefcase,
    description: "Trustworthy, credible, business-focused",
    colors: ["#1E40AF", "#FFFFFF", "#1F2937"],
  },
  {
    id: "trendy_genz",
    label: "Trendy & Gen Z",
    Icon: Sparkles,
    description: "Fresh, viral, what's hot right now",
    colors: ["#7C3AED", "#EC4899", "#06B6D4"],
  },
]

interface VibePickerProps {
  selected?: Vibe
  onSelect: (vibe: Vibe) => void
  compact?: boolean
  /** Only meaningful when selected === "custom_color" -- the exact
   * hex(es) picked, 1 for solid or 2 for gradient. Required whenever
   * "custom_color" is a reachable selection, since that's the only way
   * the picked color(s) reach the caller. */
  customColors?: string[]
  onCustomColorsChange?: (colors: string[]) => void
}

export function VibePicker({ selected, onSelect, compact = false, customColors = [], onCustomColorsChange }: VibePickerProps) {
  const isCustomSelected = selected === "custom_color"
  return (
    <div className="space-y-3">
      <div className={`grid gap-3 ${compact ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-3"}`}>
        {VIBES.map((vibe) => {
          const isSelected = selected === vibe.id
          return (
            <button
              key={vibe.id}
              type="button"
              onClick={() => onSelect(vibe.id)}
              className={`relative rounded-xl border-2 p-4 text-left transition-all duration-150 hover:scale-[1.02] ${
                isSelected
                  ? "border-violet-500 bg-violet-50 dark:bg-violet-950/30"
                  : "border-border bg-card hover:border-violet-300"
              }`}
            >
              {isSelected && (
                <div className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-violet-500">
                  <Check className="h-3 w-3 text-white" />
                </div>
              )}
              <vibe.Icon className="mb-2 h-6 w-6" />
              <p className="text-sm font-semibold leading-tight">{vibe.label}</p>
              {!compact && (
                <p className="mt-1 text-xs text-muted-foreground leading-snug">{vibe.description}</p>
              )}
              <div className="mt-2 flex gap-1">
                {vibe.colors.map((color) => (
                  <span
                    key={color}
                    className="h-3 w-3 rounded-full border border-black/5"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </button>
          )
        })}

        {/* 7th option — instant client-side custom color/gradient, not an
         * AI-generation vibe. Same card shape as the six above for visual
         * consistency, but its swatch previews the ACTUAL picked color(s)
         * (or a neutral placeholder before any pick) instead of a fixed
         * palette, since there's nothing fixed to show yet. */}
        <button
          type="button"
          onClick={() => onSelect("custom_color")}
          className={`relative rounded-xl border-2 p-4 text-left transition-all duration-150 hover:scale-[1.02] ${
            isCustomSelected
              ? "border-violet-500 bg-violet-50 dark:bg-violet-950/30"
              : "border-border bg-card hover:border-violet-300"
          }`}
        >
          {isCustomSelected && (
            <div className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-violet-500">
              <Check className="h-3 w-3 text-white" />
            </div>
          )}
          <Palette className="mb-2 h-6 w-6" />
          <p className="text-sm font-semibold leading-tight">Custom color</p>
          {!compact && (
            <p className="mt-1 text-xs text-muted-foreground leading-snug">Pick your own exact color or gradient — instant, no AI</p>
          )}
          <div
            className="mt-2 h-3 w-full rounded-full border border-black/5"
            style={{ background: cssBackgroundFromColors(customColors) ?? "linear-gradient(90deg, #6366F1, #EC4899)" }}
          />
        </button>
      </div>

      {isCustomSelected && onCustomColorsChange && (
        <div className="rounded-xl border bg-card p-4">
          <ColorWheelPicker colors={customColors.length > 0 ? customColors : ["#6366F1", "#EC4899"]} onChange={onCustomColorsChange} />
        </div>
      )}
    </div>
  )
}

export { VIBES }
