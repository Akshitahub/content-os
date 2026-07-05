"use client"

import { useState } from "react"
import { X, ChevronLeft } from "lucide-react"
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
import { CreatePicker } from "./CreatePicker"
import { TAB_DESCRIPTIONS, type Tab } from "./tabsConfig"
import { useGenerationStore } from "@/stores/generationStore"
import type { ProductRow } from "@/types/database"

interface GenerationPanelProps {
  brandId: string
  products: ProductRow[]
}

export function GenerationPanel({ brandId, products }: GenerationPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab | null>(null)
  const [transitioning, setTransitioning] = useState(false)
  const [barComplete, setBarComplete] = useState(false)
  const { occasionContext, setOccasionContext, setContentFormat } = useGenerationStore()

  function handleTabChange(tab: Tab) {
    if (tab === activeTab) return
    setActiveTab(tab)
    setTransitioning(true)
    setBarComplete(false)
    setTimeout(() => setBarComplete(true), 10)
    setTimeout(() => { setTransitioning(false); setBarComplete(false) }, 450)
  }

  function handlePickerSelect(tab: Tab, options?: { presetReelScript?: boolean }) {
    if (options?.presetReelScript) {
      setContentFormat("reel_script")
    }
    handleTabChange(tab)
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

      {activeTab === null && <CreatePicker onSelect={handlePickerSelect} />}

      {activeTab !== null && (
        <>
          <button
            type="button"
            onClick={() => setActiveTab(null)}
            className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" /> Change type
          </button>
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
        </>
      )}
    </div>
  )
}
