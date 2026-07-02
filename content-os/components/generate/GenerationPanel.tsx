"use client"

import { useState } from "react"
import { FileText, Sparkles, Layers, ImageIcon, X, RefreshCw, Wand2, LayoutGrid, Smartphone, Laugh } from "lucide-react"
import { FullPostGenerator } from "./FullPostGenerator"
import { HookGenerator } from "./HookGenerator"
import { ContentTypeGenerator } from "./ContentTypeGenerator"
import { ImageGenerator } from "./ImageGenerator"
import { SceneComposer } from "./SceneComposer"
import { ContentRepurposer } from "./ContentRepurposer"
import { AdMaker } from "./AdMaker"
import { CarouselBuilder } from "./CarouselBuilder"
import { StorySequence } from "./StorySequence"
import { MemeMaker } from "./MemeMaker"
import { useGenerationStore } from "@/stores/generationStore"
import type { ProductRow } from "@/types/database"

interface GenerationPanelProps {
  brandId: string
  products: ProductRow[]
}

type Tab = "ad_maker" | "full_post" | "carousel" | "stories" | "memes" | "hooks" | "content" | "images" | "repurpose"

const TAB_DESCRIPTIONS: Record<Tab, string> = {
  ad_maker:  "Upload your product photo and place it in an AI-generated scene. Perfect for Instagram ads.",
  full_post: "Generate a complete post — hook, caption, hashtags and visual direction in one click.",
  carousel:  "Create a multi-slide carousel for Instagram or LinkedIn with AI-written content per slide.",
  stories:   "Generate 3-5 connected Instagram stories that tell a narrative arc.",
  memes:     "Create brand-specific memes in popular formats. Memes get 3x more shares.",
  hooks:     "Generate scroll-stopping opening lines for your posts. Max 8 words, maximum impact.",
  content:   "Write reel scripts, email sequences, product descriptions and long-form content.",
  images:    "Generate brand-consistent visuals and product photos with AI.",
  repurpose: "Turn one piece of content into multiple formats across platforms.",
}

const TABS: { id: Tab; label: string; icon: React.ElementType; tooltip: string }[] = [
  { id: "ad_maker",  label: "Ad Maker ✨",      icon: Wand2,       tooltip: "Create product ads with AI-generated scenes" },
  { id: "full_post", label: "Post Builder",      icon: FileText,    tooltip: "Build a complete post: hook + caption + visual" },
  { id: "carousel",  label: "Carousel 🎠",       icon: LayoutGrid,  tooltip: "Visual carousel builder with slide preview" },
  { id: "stories",   label: "Stories 📱",        icon: Smartphone,  tooltip: "Connected Instagram story sequence" },
  { id: "memes",     label: "Memes 😂",          icon: Laugh,       tooltip: "Brand memes that get shared 3× more" },
  { id: "hooks",     label: "Scroll Stoppers",   icon: Sparkles,    tooltip: "Hook-only generator for viral openers" },
  { id: "content",   label: "Deep Content",      icon: Layers,      tooltip: "Reels, carousels, ad copy, email sequences" },
  { id: "images",    label: "Visuals",           icon: ImageIcon,   tooltip: "AI-generated images in your brand style" },
  { id: "repurpose", label: "Repurpose",         icon: RefreshCw,   tooltip: "Turn existing content into multiple formats" },
]

export function GenerationPanel({ brandId, products }: GenerationPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>("ad_maker")
  const [transitioning, setTransitioning] = useState(false)
  const [barComplete, setBarComplete] = useState(false)
  const { occasionContext, setOccasionContext } = useGenerationStore()

  function handleTabChange(tab: Tab) {
    if (tab === activeTab) return
    setActiveTab(tab)
    setTransitioning(true)
    setBarComplete(false)
    setTimeout(() => setBarComplete(true), 10)
    setTimeout(() => { setTransitioning(false); setBarComplete(false) }, 450)
  }

  return (
    <div className="relative space-y-6">
      {transitioning && (
        <div className="absolute inset-x-0 top-0 z-10 h-0.5 bg-violet-100">
          <div
            className="h-full bg-violet-600"
            style={{ width: barComplete ? "100%" : "0%", transition: "width 0.4s ease-out" }}
          />
        </div>
      )}
      {occasionContext && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 flex items-start justify-between gap-3">
          <p className="text-sm">
            <span className="mr-1">✨</span>
            <span className="font-semibold">Creating content for {occasionContext.name}</span>
            <span className="text-muted-foreground"> — {occasionContext.angle}</span>
          </p>
          <button
            type="button"
            onClick={() => setOccasionContext(null)}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Dismiss occasion"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Pill tabs — horizontally scrollable on mobile */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabChange(tab.id)}
              title={tab.tooltip}
              className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-150 ${
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-transparent"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground mt-2 mb-4 px-1">{TAB_DESCRIPTIONS[activeTab]}</p>

      {activeTab === "ad_maker"  && <AdMaker brandId={brandId} />}
      {activeTab === "full_post" && <FullPostGenerator brandId={brandId} products={products} />}
      {activeTab === "carousel"  && <CarouselBuilder brandId={brandId} />}
      {activeTab === "stories"   && <StorySequence brandId={brandId} />}
      {activeTab === "memes"     && <MemeMaker brandId={brandId} />}
      {activeTab === "hooks"     && <HookGenerator brandId={brandId} products={products} />}
      {activeTab === "content"   && <ContentTypeGenerator brandId={brandId} products={products} />}
      {activeTab === "images"    && (
        <div className="space-y-8">
          <ImageGenerator brandId={brandId} products={products} />
          <div className="border-t pt-8">
            <SceneComposer brandId={brandId} />
          </div>
        </div>
      )}
      {activeTab === "repurpose" && <ContentRepurposer brandId={brandId} />}
    </div>
  )
}
