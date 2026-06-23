"use client"

import { useState } from "react"
import { Sparkles, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { HookCard } from "./HookCard"
import { useGenerateHooks, ApiResponseError } from "@/hooks/useGeneration"
import { useGenerationStore } from "@/stores/generationStore"
import type { ProductRow } from "@/types/database"
import type { HookType, Platform } from "@/types/app"

const HOOK_TYPES: { value: HookType; label: string }[] = [
  { value: "question", label: "Question" },
  { value: "bold_statement", label: "Bold Statement" },
  { value: "story", label: "Story" },
  { value: "statistic", label: "Statistic" },
  { value: "controversial", label: "Controversial" },
  { value: "how_to", label: "How-To" },
]

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "facebook", label: "Facebook" },
  { value: "youtube", label: "YouTube" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "twitter", label: "Twitter / X" },
]

interface HookGeneratorProps {
  brandId: string
  products: ProductRow[]
}

export function HookGenerator({ brandId, products }: HookGeneratorProps) {
  const { mutate: generateHooks, isPending, error } = useGenerateHooks()
  const { hooks, selectedHook, setHooks, setSelectedHook, selectedPlatform, setSelectedPlatform, selectedProductId, setSelectedProductId, hookAdditionalContext: additionalContext, setHookAdditionalContext: setAdditionalContext } = useGenerationStore()
  const [selectedHookTypes, setSelectedHookTypes] = useState<HookType[]>(["question", "bold_statement", "story"])
  const [count, setCount] = useState(5)

  function toggleHookType(type: HookType) {
    setSelectedHookTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    )
  }

  function handleGenerate() {
    generateHooks(
      {
        brandId,
        productId: selectedProductId ?? undefined,
        hookTypes: selectedHookTypes,
        count,
        platform: selectedPlatform,
        additionalContext: additionalContext || undefined,
      },
      {
        onSuccess: (data) => setHooks(data),
      }
    )
  }

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="rounded-lg border bg-card p-5 space-y-4">
        <h3 className="text-sm font-semibold">Hook Settings</h3>

        {/* Product selector */}
        {products.length > 0 && (
          <div className="space-y-1.5">
            <Label className="text-xs">Product (optional)</Label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={selectedProductId ?? ""}
              onChange={(e) => setSelectedProductId(e.target.value || null)}
            >
              <option value="">No specific product</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Platform */}
        <div className="space-y-1.5">
          <Label className="text-xs">Platform</Label>
          <div className="flex flex-wrap gap-1.5">
            {PLATFORMS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setSelectedPlatform(p.value)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  selectedPlatform === p.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Hook types */}
        <div className="space-y-1.5">
          <Label className="text-xs">Hook types</Label>
          <div className="flex flex-wrap gap-1.5">
            {HOOK_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => toggleHookType(t.value)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  selectedHookTypes.includes(t.value)
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Count */}
        <div className="flex items-center gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Number of hooks</Label>
            <select
              className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            >
              {[3, 5, 7, 10].map((n) => <option key={n} value={n}>{n} hooks</option>)}
            </select>
          </div>
        </div>

        {/* Extra context */}
        <div className="space-y-1.5">
          <Label className="text-xs">Additional context (optional)</Label>
          <textarea
            rows={2}
            placeholder="e.g. 'For a flash sale this weekend' or 'Targeting new moms'"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            value={additionalContext}
            onChange={(e) => setAdditionalContext(e.target.value)}
          />
        </div>

        <Button
          className="w-full"
          onClick={handleGenerate}
          disabled={isPending || selectedHookTypes.length === 0}
        >
          {isPending ? (
            <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Generating…</>
          ) : (
            <><Sparkles className="h-4 w-4 mr-2" /> Generate hooks</>
          )}
        </Button>

        {error && (
          error instanceof ApiResponseError && error.code === "USAGE_LIMIT_EXCEEDED" ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-50 p-3 text-center space-y-0.5">
              <p className="text-sm font-semibold text-amber-900">{error.message}</p>
              <p className="text-xs text-amber-700">Upgrade your plan to keep creating.</p>
            </div>
          ) : (
            <p className="text-xs text-destructive">{error.message}</p>
          )
        )}
      </div>

      {/* Results */}
      {hooks.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{hooks.length} hooks generated</p>
            <p className="text-xs text-muted-foreground">Click a hook to use it for captions</p>
          </div>
          {hooks.map((hook, i) => (
            <HookCard
              key={hook.id ?? i}
              hook={hook}
              isSelected={selectedHook?.hook_text === hook.hook_text}
              onSelect={setSelectedHook}
            />
          ))}
        </div>
      )}
    </div>
  )
}
