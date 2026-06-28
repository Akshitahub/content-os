"use client"

import { Check } from "lucide-react"

export type Vibe =
  | "fun_playful"
  | "clean_minimal"
  | "bold_dramatic"
  | "warm_cozy"
  | "professional"
  | "trendy_genz"

const VIBES: {
  id: Vibe
  label: string
  emoji: string
  description: string
  colors: string[]
}[] = [
  {
    id: "fun_playful",
    label: "Fun & Playful",
    emoji: "🎉",
    description: "Bright, energetic, makes people smile",
    colors: ["#FF6B6B", "#FFE66D", "#4ECDC4"],
  },
  {
    id: "clean_minimal",
    label: "Clean & Minimal",
    emoji: "🤍",
    description: "Simple, elegant, less is more",
    colors: ["#FFFFFF", "#F5F5F5", "#333333"],
  },
  {
    id: "bold_dramatic",
    label: "Bold & Dramatic",
    emoji: "🖤",
    description: "Strong, confident, makes a statement",
    colors: ["#000000", "#6366F1", "#EC4899"],
  },
  {
    id: "warm_cozy",
    label: "Warm & Cozy",
    emoji: "🧡",
    description: "Friendly, inviting, feels like home",
    colors: ["#F59E0B", "#EF4444", "#FEF3C7"],
  },
  {
    id: "professional",
    label: "Professional",
    emoji: "💼",
    description: "Trustworthy, credible, business-focused",
    colors: ["#1E40AF", "#FFFFFF", "#1F2937"],
  },
  {
    id: "trendy_genz",
    label: "Trendy & Gen Z",
    emoji: "✨",
    description: "Fresh, viral, what's hot right now",
    colors: ["#7C3AED", "#EC4899", "#06B6D4"],
  },
]

interface VibePickerProps {
  selected?: Vibe
  onSelect: (vibe: Vibe) => void
  compact?: boolean
}

export function VibePicker({ selected, onSelect, compact = false }: VibePickerProps) {
  return (
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
            <div className="mb-2 text-2xl">{vibe.emoji}</div>
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
    </div>
  )
}

export { VIBES }
