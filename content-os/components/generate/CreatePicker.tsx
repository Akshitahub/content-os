"use client"

import { useState } from "react"
import { Film, ChevronDown } from "lucide-react"
import { TABS, TAB_DESCRIPTIONS, type Tab } from "./tabsConfig"

interface CreatePickerProps {
  onSelect: (tab: Tab, options?: { presetReelScript?: boolean }) => void
}

function iconFor(id: Tab): React.ElementType {
  return TABS.find((t) => t.id === id)!.icon
}

interface CardMeta {
  tab: Tab
  title: string
  description: string
  icon: React.ElementType
  presetReelScript?: boolean
  /** Platforms this format can actually be scheduled/published to today — omit if no schedule/publish path exists yet. */
  platforms?: string
}

const PRIMARY_CARDS: CardMeta[] = [
  { tab: "content",   title: "Reel",      description: "Script plus AI voiceover video",       icon: Film,               presetReelScript: true },
  { tab: "full_post", title: "Post",      description: "Hook, caption and visual in one click", icon: iconFor("full_post"), platforms: "Instagram · Facebook" },
  { tab: "carousel",  title: "Carousel",  description: "Multi-slide story with AI copy per slide", icon: iconFor("carousel"), platforms: "Instagram" },
  { tab: "ad_maker",  title: "Ad",        description: "Product photo placed in an AI scene",   icon: iconFor("ad_maker") },
  { tab: "stories",   title: "Stories",   description: "3 to 5 connected story slides",         icon: iconFor("stories"), platforms: "Instagram" },
]

const SECONDARY_CARDS: CardMeta[] = [
  { tab: "hooks",     title: "Scroll stoppers", description: TAB_DESCRIPTIONS.hooks,     icon: iconFor("hooks") },
  { tab: "memes",     title: "Meme",            description: TAB_DESCRIPTIONS.memes,     icon: iconFor("memes") },
  { tab: "images",    title: "Visuals",         description: TAB_DESCRIPTIONS.images,    icon: iconFor("images") },
  { tab: "repurpose", title: "Repurpose",       description: TAB_DESCRIPTIONS.repurpose, icon: iconFor("repurpose") },
  { tab: "content",   title: "Deep content",    description: TAB_DESCRIPTIONS.content,   icon: iconFor("content") },
]

export function CreatePicker({ onSelect }: CreatePickerProps) {
  const [showMore, setShowMore] = useState(false)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">What do you want to create?</h2>
        <p className="mt-1 text-sm text-muted-foreground">Pick a format to get started — you can always switch later.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PRIMARY_CARDS.map((card) => {
          const Icon = card.icon
          return (
            <button
              key={card.tab + card.title}
              type="button"
              onClick={() => onSelect(card.tab, card.presetReelScript ? { presetReelScript: true } : undefined)}
              className="flex flex-col items-start gap-2 rounded-xl border p-5 text-left transition-colors hover:border-violet-400 hover:bg-violet-50/50"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50">
                <Icon className="h-5 w-5 text-violet-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{card.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{card.description}</p>
              </div>
              {card.platforms && <p className="text-[11px] text-muted-foreground">{card.platforms}</p>}
            </button>
          )
        })}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          More tools
          <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${showMore ? "rotate-180" : ""}`} />
        </button>

        {showMore && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {SECONDARY_CARDS.map((card) => {
              const Icon = card.icon
              return (
                <button
                  key={card.tab + card.title}
                  type="button"
                  onClick={() => onSelect(card.tab, card.presetReelScript ? { presetReelScript: true } : undefined)}
                  className="flex items-start gap-2 rounded-lg border p-3 text-left transition-colors hover:border-violet-400 hover:bg-violet-50/50"
                >
                  <Icon className="h-4 w-4 shrink-0 text-violet-600" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-foreground">{card.title}</p>
                    <p className="text-[11px] leading-snug text-muted-foreground line-clamp-2">{card.description}</p>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
