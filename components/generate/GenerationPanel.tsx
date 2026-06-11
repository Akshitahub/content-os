"use client"

import { useState } from "react"
import { Sparkles, FileText } from "lucide-react"
import { HookGenerator } from "./HookGenerator"
import { CaptionGenerator } from "./CaptionGenerator"
import type { ProductRow } from "@/types/database"

interface GenerationPanelProps {
  brandId: string
  products: ProductRow[]
}

type Tab = "hooks" | "captions"

export function GenerationPanel({ brandId, products }: GenerationPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>("hooks")

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Left — Hooks */}
      <div>
        <div className="mb-4 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">Hooks</h2>
        </div>
        <HookGenerator brandId={brandId} products={products} />
      </div>

      {/* Right — Captions */}
      <div>
        <div className="mb-4 flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">Captions</h2>
        </div>
        <CaptionGenerator brandId={brandId} products={products} />
      </div>

      {/* Mobile tabs */}
      <div className="lg:hidden col-span-full">
        <div className="flex rounded-lg border overflow-hidden mb-4">
          <button
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${activeTab === "hooks" ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}
            onClick={() => setActiveTab("hooks")}
          >
            Hooks
          </button>
          <button
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${activeTab === "captions" ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}
            onClick={() => setActiveTab("captions")}
          >
            Captions
          </button>
        </div>
      </div>
    </div>
  )
}
