"use client"

import { useState } from "react"
import { Sparkles, Layers, ImageIcon } from "lucide-react"
import { HookGenerator } from "./HookGenerator"
import { ContentTypeGenerator } from "./ContentTypeGenerator"
import { ImageGenerator } from "./ImageGenerator"
import type { ProductRow } from "@/types/database"

interface GenerationPanelProps {
  brandId: string
  products: ProductRow[]
}

type Tab = "hooks" | "content" | "images"

export function GenerationPanel({ brandId, products }: GenerationPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>("hooks")

  return (
    <div className="space-y-6">
      <div className="flex rounded-lg border overflow-hidden">
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

      {activeTab === "hooks"   && <HookGenerator          brandId={brandId} products={products} />}
      {activeTab === "content" && <ContentTypeGenerator   brandId={brandId} products={products} />}
      {activeTab === "images"  && <ImageGenerator         brandId={brandId} products={products} />}
    </div>
  )
}
