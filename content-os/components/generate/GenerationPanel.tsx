"use client"

import { useState } from "react"
import { FileText, Sparkles, Layers, ImageIcon, X } from "lucide-react"
import { FullPostGenerator } from "./FullPostGenerator"
import { HookGenerator } from "./HookGenerator"
import { ContentTypeGenerator } from "./ContentTypeGenerator"
import { ImageGenerator } from "./ImageGenerator"
import { useGenerationStore } from "@/stores/generationStore"
import type { ProductRow } from "@/types/database"

interface GenerationPanelProps {
  brandId: string
  products: ProductRow[]
}

type Tab = "full_post" | "hooks" | "content" | "images"

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

      <div className="flex rounded-lg border overflow-hidden">
        <button
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors ${activeTab === "full_post" ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}
          onClick={() => setActiveTab("full_post")}
        >
          <FileText className="h-3.5 w-3.5" /> Full Post
        </button>
        <button
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors ${activeTab === "hooks" ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}
          onClick={() => setActiveTab("hooks")}
        >
          <Sparkles className="h-3.5 w-3.5" /> Hooks
        </button>
        <button
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors ${activeTab === "content" ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}
          onClick={() => setActiveTab("content")}
        >
          <Layers className="h-3.5 w-3.5" /> Content
        </button>
        <button
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors ${activeTab === "images" ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}
          onClick={() => setActiveTab("images")}
        >
          <ImageIcon className="h-3.5 w-3.5" /> Images
        </button>
      </div>

      {activeTab === "full_post" && <FullPostGenerator brandId={brandId} products={products} />}
      {activeTab === "hooks"     && <HookGenerator     brandId={brandId} products={products} />}
      {activeTab === "content"   && <ContentTypeGenerator brandId={brandId} products={products} />}
      {activeTab === "images"    && <ImageGenerator    brandId={brandId} products={products} />}
    </div>
  )
}
