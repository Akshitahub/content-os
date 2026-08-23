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
import { BlogPostGenerator } from "./BlogPostGenerator"
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
            <span className="text-muted-foreground">: {occasionContext.angle}</span>
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

      {activeTab === null && <CreatePicker brandId={brandId} onSelect={handlePickerSelect} />}

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
        </>
      )}

      {/* Every tab component stays mounted for the life of this panel,
          hidden via CSS rather than conditionally rendered -- deliberately
          NOT nested inside the `activeTab !== null` block above, since the
          only way to move between two tabs is via "Change type" -> the
          CreatePicker screen (activeTab briefly null) -> pick the next tab,
          so gating this on activeTab !== null would still unmount (and
          lose the state of) every tab on each switch, the exact bug this
          is fixing. Conditional mounting (`activeTab === "x" && <Comp/>`)
          fully unmounted whichever tab wasn't selected, discarding any
          in-flight generation's local state (loading flag, result, error)
          the moment its promise resolved after the switch, since React
          silently drops setState calls on an unmounted component. Each
          tab's local useState now survives a tab switch for free, no store
          lifting needed. Checked all 10 tab components for a top-level
          useEffect(..., []) that does real work on mount before this
          change -- none exist; every one only restores/persists to
          sessionStorage (cheap, local, idempotent), so mounting all of them
          upfront (even before a tab is first picked) doesn't newly trigger
          any network calls or timers. */}
      <div style={{ display: activeTab === "ad_maker" ? undefined : "none" }}><AdMaker brandId={brandId} /></div>
      <div style={{ display: activeTab === "full_post" ? undefined : "none" }}><FullPostGenerator brandId={brandId} products={products} /></div>
      <div style={{ display: activeTab === "carousel" ? undefined : "none" }}><CarouselBuilder brandId={brandId} /></div>
      <div style={{ display: activeTab === "stories" ? undefined : "none" }}><StorySequence brandId={brandId} /></div>
      <div style={{ display: activeTab === "hooks" ? undefined : "none" }}><HookGenerator brandId={brandId} products={products} /></div>
      <div style={{ display: activeTab === "content" ? undefined : "none" }}><ContentTypeGenerator brandId={brandId} products={products} /></div>
      <div style={{ display: activeTab === "images" ? undefined : "none" }} className="space-y-8">
        <ImageGenerator brandId={brandId} products={products} />
        <div className="border-t pt-8">
          <SceneComposer brandId={brandId} />
        </div>
      </div>
      <div style={{ display: activeTab === "repurpose" ? undefined : "none" }}><ContentRepurposer brandId={brandId} /></div>
      <div style={{ display: activeTab === "blog" ? undefined : "none" }}><BlogPostGenerator brandId={brandId} /></div>
    </div>
  )
}
