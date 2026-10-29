"use client"

import { AlignLeft, BadgePercent, Captions, Heading, ListOrdered, PanelBottom, PanelLeft, Quote } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { TEXT_LAYOUT_LABELS, availableLayouts, type TextLayoutId } from "@/lib/design/text-layouts"

const ICONS: Record<TextLayoutId, LucideIcon> = {
  bold_stack: Heading,
  editorial: AlignLeft,
  numbered: ListOrdered,
  bottom_card: PanelBottom,
  split_panel: PanelLeft,
  quote: Quote,
  minimal_caption: Captions,
  offer_badge: BadgePercent,
}

/**
 * One row of layout icons (lib/design/text-layouts.ts). The user's pick
 * always wins over the auto-pick -- callers store it with
 * text_layout_source "user". Offer badge only appears when there's a real
 * offer. `onApplyAll`, when given, adds an "apply to all" action.
 */
export function TextLayoutPicker({
  value,
  onChange,
  hasOffer = false,
  onApplyAll,
  label = "Text layout",
}: {
  value: TextLayoutId | null | undefined
  onChange: (layout: TextLayoutId) => void
  hasOffer?: boolean
  onApplyAll?: () => void
  label?: string
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {onApplyAll && value && (
          <button type="button" onClick={onApplyAll} className="text-[11px] font-medium text-violet-600 hover:underline">
            Apply to all
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
        {availableLayouts(hasOffer).map((id) => {
          const Icon = ICONS[id]
          const active = value === id
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              title={TEXT_LAYOUT_LABELS[id]}
              aria-label={TEXT_LAYOUT_LABELS[id]}
              onClick={() => onChange(id)}
              className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${active ? "border-violet-500 bg-violet-50 text-violet-700" : "border-border text-muted-foreground hover:border-violet-300"}`}
            >
              <Icon className="h-4 w-4" />
            </button>
          )
        })}
      </div>
    </div>
  )
}
