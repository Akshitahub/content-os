"use client"

import { Film } from "lucide-react"
import { TABS, type Tab } from "./tabsConfig"
import { REELS_ENABLED } from "@/lib/constants"
import { ComingSoonBadge } from "@/components/shared/ComingSoonBadge"
import { cn } from "@/lib/utils"

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
  comingSoon?: boolean
}

const PRIMARY_CARDS: CardMeta[] = [
  { tab: "content",   title: "Reel",        description: "Script plus AI voiceover video",       icon: Film,               presetReelScript: true, comingSoon: !REELS_ENABLED },
  { tab: "full_post", title: "Post",        description: "Hook, caption and visual in one click", icon: iconFor("full_post"), platforms: "Instagram · Facebook" },
  { tab: "carousel",  title: "Carousel",    description: "Multi-slide story with AI copy per slide", icon: iconFor("carousel"), platforms: "Instagram" },
  { tab: "ad_maker",  title: "Ad",          description: "Product photo placed in an AI scene",   icon: iconFor("ad_maker") },
  { tab: "stories",   title: "Stories",     description: "3 to 5 connected story slides",         icon: iconFor("stories"), platforms: "Instagram" },
  { tab: "blog",      title: "Blog Post",   description: "SEO article with AI suggestions",       icon: iconFor("blog") },
  { tab: "hooks",     title: "Hooks",       description: "Scroll-stopping opening lines, max 8 words", icon: iconFor("hooks") },
  { tab: "content",   title: "Deep Content", description: "Reel scripts, ad copy, email sequences and more", icon: iconFor("content") },
  { tab: "images",    title: "Visuals",     description: "AI-generated images in your brand style", icon: iconFor("images") },
  { tab: "repurpose", title: "Repurpose",   description: "Turn existing content into multiple formats", icon: iconFor("repurpose") },
]

export function CreatePicker({ onSelect }: CreatePickerProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">What do you want to create?</h2>
        <p className="mt-1 text-sm text-muted-foreground">Pick a format to get started. You can always switch later.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PRIMARY_CARDS.map((card) => {
          const Icon = card.icon
          return (
            <button
              key={card.title}
              type="button"
              disabled={card.comingSoon}
              onClick={() => onSelect(card.tab!, card.presetReelScript ? { presetReelScript: true } : undefined)}
              className={cn(
                "flex flex-col items-start gap-3 rounded-xl border bg-card p-6 text-left shadow-sm transition-all duration-200",
                card.comingSoon
                  ? "cursor-not-allowed opacity-60"
                  : "hover:-translate-y-1 hover:border-violet-300 hover:shadow-lg hover:shadow-violet-100"
              )}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-50">
                <Icon className="h-6 w-6 text-violet-600" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-semibold text-foreground">{card.title}</p>
                  {card.comingSoon && <ComingSoonBadge />}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{card.description}</p>
              </div>
              {card.platforms && <p className="text-[11px] text-muted-foreground">{card.platforms}</p>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
