"use client"

import { useState } from "react"
import { FileText, Sparkles, Layers, ImageIcon, X } from "lucide-react"
import { FullPostGenerator } from "./FullPostGenerator"
import { HookGenerator } from "./HookGenerator"
import { ContentTypeGenerator } from "./ContentTypeGenerator"
import { ImageGenerator } from "./ImageGenerator"
import { SceneComposer } from "./SceneComposer"
import { useGenerationStore } from "@/stores/generationStore"
import type { ProductRow } from "@/types/database"

interface GenerationPanelProps {
  brandId: string
  products: ProductRow[]
}

type Tab = "full_post" | "hooks" | "content" | "images"

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "full_post", label: "Post Builder", icon: FileText },
  { id: "hooks", label: "Scroll Stoppers", icon: Sparkles },
  { id: "content", label: "Deep Content", icon: Layers },
  { id: "images", label: "Visuals", icon: ImageIcon },
]

export function GenerationPanel({ brandId, products }: GenerationPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>("full_post")
  const { occasionContext, setOccasionContext } = useGenerationStore()

  return (
    <div className="space-y-6">
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

      {/* Pill tabs */}
      <div className="flex flex-wrap gap-1.5">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
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

      {activeTab === "full_post" && <FullPostGenerator brandId={brandId} products={products} />}
      {activeTab === "hooks" && <HookGenerator brandId={brandId} products={products} />}
      {activeTab === "content" && <ContentTypeGenerator brandId={brandId} products={products} />}
      {activeTab === "images" && (
        <div className="space-y-8">
          <ImageGenerator brandId={brandId} products={products} />
          <div className="border-t pt-8">
            <SceneComposer brandId={brandId} />
          </div>
        </div>
      )}
    </div>
  )
}
