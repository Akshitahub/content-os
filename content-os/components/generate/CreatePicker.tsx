"use client"

import { useState } from "react"
import { Film, TrendingUp, ChevronLeft } from "lucide-react"
import { TABS, type Tab } from "./tabsConfig"
import { TrendingNow } from "./TrendingNow"

interface CreatePickerProps {
  brandId: string
  onSelect: (tab: Tab, options?: { presetReelScript?: boolean }) => void
}

function iconFor(id: Tab): React.ElementType {
  return TABS.find((t) => t.id === id)!.icon
}

interface CardMeta {
  tab?: Tab
  title: string
  description: string
  icon: React.ElementType
  presetReelScript?: boolean
  /** Platforms this format can actually be scheduled/published to today — omit if no schedule/publish path exists yet. */
  platforms?: string
  isTrendingNow?: boolean
}

const PRIMARY_CARDS: CardMeta[] = [
  { tab: "content",   title: "Reel",      description: "Script plus AI voiceover video",       icon: Film,               presetReelScript: true },
  { tab: "full_post", title: "Post",      description: "Hook, caption and visual in one click", icon: iconFor("full_post"), platforms: "Instagram · Facebook" },
  { tab: "carousel",  title: "Carousel",  description: "Multi-slide story with AI copy per slide", icon: iconFor("carousel"), platforms: "Instagram" },
  { tab: "ad_maker",  title: "Ad",        description: "Product photo placed in an AI scene",   icon: iconFor("ad_maker") },
  { tab: "stories",   title: "Stories",   description: "3 to 5 connected story slides",         icon: iconFor("stories"), platforms: "Instagram" },
  { tab: "memes",     title: "Meme",      description: "AI image with a real meme caption",     icon: iconFor("memes"), platforms: "Instagram · Facebook" },
  { tab: "blog",      title: "Blog Post", description: "SEO article with AI suggestions",       icon: iconFor("blog") },
  { title: "Trending Now", description: "Real discussions from your niche, turned into content", icon: TrendingUp, isTrendingNow: true },
]

export function CreatePicker({ brandId, onSelect }: CreatePickerProps) {
  const [expandedTrending, setExpandedTrending] = useState(false)

  if (expandedTrending) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setExpandedTrending(false)}
          className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" /> Back to formats
        </button>
        <TrendingNow brandId={brandId} onNavigate={onSelect} />
      </div>
    )
  }

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
              key={card.tab ?? card.title}
              type="button"
              onClick={() => {
                if (card.isTrendingNow) {
                  setExpandedTrending(true)
                  return
                }
                onSelect(card.tab!, card.presetReelScript ? { presetReelScript: true } : undefined)
              }}
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
    </div>
  )
}
