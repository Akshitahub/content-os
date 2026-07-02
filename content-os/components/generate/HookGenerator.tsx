"use client"

import { useState, useRef, useEffect } from "react"
import Link from "next/link"
import { Sparkles, RefreshCw, Check, ChevronLeft, ChevronRight, Copy, RotateCcw, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { GeneratingState } from "@/components/shared/GeneratingState"
import { PostPreviewCard } from "@/components/shared/PostPreviewCard"
import { QuickCopyButton } from "@/components/shared/QuickCopyButton"
import { useGenerateHooks, ApiResponseError } from "@/hooks/useGeneration"
import { useGenerationStore } from "@/stores/generationStore"
import { useBrand } from "@/hooks/useBrand"
import { scoreHook, scoreLabel, scoreColor } from "@/lib/utils/content-score"
import { HOOK_TYPE_COLORS, TEMPLATE_NAMES } from "@/lib/design/constants"
import type { PreviewTemplate } from "@/components/shared/PostPreviewCard"
import type { ProductRow } from "@/types/database"
import type { HookType, Platform } from "@/types/app"
import { TopicSuggestButton } from "@/components/shared/TopicSuggestButton"

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

function ScoreBadge({ score }: { score: number }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${scoreColor(score)}`}>
      {score}/10 · {scoreLabel(score)}
    </span>
  )
}

function HookTypeBadge({ type }: { type: string }) {
  const color = HOOK_TYPE_COLORS[type] ?? "bg-muted text-muted-foreground"
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${color}`}>
      {type.replace(/_/g, " ")}
    </span>
  )
}

export function HookGenerator({ brandId, products }: HookGeneratorProps) {
  const { mutate: generateHooks, isPending, error } = useGenerateHooks()
  const {
    hooks, selectedHook, setHooks, setSelectedHook,
    selectedPlatform, setSelectedPlatform,
    selectedProductId, setSelectedProductId,
    hookAdditionalContext: additionalContext,
    setHookAdditionalContext: setAdditionalContext,
  } = useGenerationStore()
  const { data: brand } = useBrand(brandId)
  const [selectedHookTypes, setSelectedHookTypes] = useState<HookType[]>(["question", "bold_statement", "story"])
  const [count, setCount] = useState(3)
  const [justSaved, setJustSaved] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [focusedIdx, setFocusedIdx] = useState(0)
  const [previewTemplate, setPreviewTemplate] = useState<PreviewTemplate>(1)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Derive brand colors for preview
  const palette = brand?.color_palette as Record<string, unknown> | null | undefined
  const paletteColors = palette ? Object.values(palette).filter((v): v is string => typeof v === "string") : []
  const primaryColor = paletteColors[0] ?? "#6366f1"
  const secondaryColor = paletteColors[1] ?? "#818cf8"
  const brandName = brand?.name ?? "Brand"

  // Restore from sessionStorage on mount
  useEffect(() => {
    if (hooks.length === 0) {
      const saved = sessionStorage.getItem(`hooks_${brandId}`)
      if (saved) {
        try { setHooks(JSON.parse(saved)) } catch {}
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId])

  // Persist to sessionStorage when hooks change
  useEffect(() => {
    if (hooks.length > 0) {
      sessionStorage.setItem(`hooks_${brandId}`, JSON.stringify(hooks))
    }
  }, [hooks, brandId])

  // Cleanup on unmount
  useEffect(() => {
    return () => abortControllerRef.current?.abort()
  }, [])

  // Reset focus index when hooks change
  useEffect(() => {
    setFocusedIdx(0)
  }, [hooks])

  function toggleHookType(type: HookType) {
    setSelectedHookTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    )
  }

  function handleGenerate() {
    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()
    setJustSaved(false)

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
        onSuccess: (data) => {
          setHooks(data)
          setJustSaved(true)
          setTimeout(() => setJustSaved(false), 5000)
          setShowSuccess(true)
          setTimeout(() => setShowSuccess(false), 4000)
        },
      }
    )
  }

  const focusedHook = hooks[focusedIdx]
  const focusedScore = focusedHook ? scoreHook(focusedHook.hook_text) : 0

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="rounded-lg border bg-card p-5 space-y-4">
        <h3 className="text-sm font-semibold">Hook Settings</h3>

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

        <div className="space-y-1.5">
          <Label className="text-xs">Additional context (optional)</Label>
          <textarea
            rows={2}
            placeholder="e.g. 'For a flash sale this weekend' or 'Targeting new moms'"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            value={additionalContext}
            onChange={(e) => setAdditionalContext(e.target.value)}
          />
          <TopicSuggestButton
            brandId={brandId}
            productId={selectedProductId}
            contentType="hook"
            currentInput={additionalContext}
            onSelectTopic={setAdditionalContext}
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
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-3">
              <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-amber-900 font-medium">{error.message}</p>
                <button onClick={handleGenerate} className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-amber-700 hover:text-amber-900">
                  🔄 Try again
                </button>
              </div>
            </div>
          )
        )}
        {error && !(error instanceof ApiResponseError && error.code === "USAGE_LIMIT_EXCEEDED") && hooks.length > 0 && (
          <p className="text-xs text-amber-600">Showing your last successful result below.</p>
        )}
      </div>

      {/* Loading state */}
      {isPending && <GeneratingState message="Writing hooks for your brand..." />}

      {/* Success banner */}
      {showSuccess && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 animate-in fade-in duration-300">
          <Check className="h-4 w-4 text-green-500 shrink-0" />
          <span className="text-sm font-medium text-green-700">✓ Generated successfully — scroll down to see your content</span>
        </div>
      )}

      {/* Save confirmation */}
      {justSaved && hooks.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <div className="flex items-center gap-2 text-green-700">
            <Check className="h-4 w-4 shrink-0" />
            <span className="text-sm font-medium">{hooks.length} hook{hooks.length > 1 ? "s" : ""} generated and saved to My Content</span>
          </div>
          <Link
            href={`/brands/${brandId}/library?tab=hooks`}
            className="text-xs font-medium text-green-700 underline underline-offset-2 hover:text-green-900 shrink-0"
          >
            View in My Content →
          </Link>
        </div>
      )}

      {/* Results */}
      {!isPending && hooks.length > 0 && (
        <div className="space-y-4">
          {/* Navigation header */}
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{hooks.length} hooks generated</p>
            <div className="flex items-center gap-1.5">
              {/* Template picker */}
              <select
                value={previewTemplate}
                onChange={e => setPreviewTemplate(Number(e.target.value) as PreviewTemplate)}
                className="rounded-md border bg-background px-2 py-1 text-xs"
              >
                {([1, 2, 3, 4, 5, 6] as PreviewTemplate[]).map(n => (
                  <option key={n} value={n}>{TEMPLATE_NAMES[n]}</option>
                ))}
              </select>
              <button
                onClick={() => setFocusedIdx(Math.max(0, focusedIdx - 1))}
                disabled={focusedIdx === 0}
                className="flex h-7 w-7 items-center justify-center rounded-md border bg-background text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs text-muted-foreground tabular-nums">{focusedIdx + 1} / {hooks.length}</span>
              <button
                onClick={() => setFocusedIdx(Math.min(hooks.length - 1, focusedIdx + 1))}
                disabled={focusedIdx === hooks.length - 1}
                className="flex h-7 w-7 items-center justify-center rounded-md border bg-background text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Featured hook with visual preview */}
          {focusedHook && (
            <div className="rounded-xl border bg-card p-4">
              <div className="flex gap-4">
                <PostPreviewCard
                  hookText={focusedHook.hook_text}
                  brandName={brandName}
                  primaryColor={primaryColor}
                  secondaryColor={secondaryColor}
                  template={previewTemplate}
                  size="md"
                  className="border"
                />
                <div className="flex-1 flex flex-col justify-between min-w-0">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <HookTypeBadge type={focusedHook.hook_type} />
                      <ScoreBadge score={focusedScore} />
                      {selectedHook?.hook_text === focusedHook.hook_text && (
                        <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                          <Sparkles className="h-3 w-3" /> Selected
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium leading-relaxed">{focusedHook.hook_text}</p>
                    {focusedHook.reasoning && (
                      <p className="text-xs text-muted-foreground italic">{focusedHook.reasoning}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t">
                    <Button
                      size="sm"
                      onClick={() => setSelectedHook(focusedHook)}
                      variant={selectedHook?.hook_text === focusedHook.hook_text ? "secondary" : "default"}
                    >
                      <Sparkles className="h-3.5 w-3.5 mr-1" />
                      Use for Caption
                    </Button>
                    <QuickCopyButton
                      text={focusedHook.hook_text}
                      platform={selectedPlatform ?? undefined}
                      label="Copy"
                    />
                    <button
                      onClick={() => {
                        setAdditionalContext(`Inspired by: ${focusedHook.hook_text.slice(0, 80)}`)
                        handleGenerate()
                      }}
                      className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Regenerate similar
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Compact hook list */}
          <div className="space-y-2">
            {hooks.map((hook, i) => {
              const score = scoreHook(hook.hook_text)
              const tmpl = ((i % 6) + 1) as PreviewTemplate
              return (
                <div
                  key={hook.id ?? i}
                  onClick={() => setFocusedIdx(i)}
                  className={`flex items-center gap-3 rounded-lg border bg-card p-3 cursor-pointer transition-all hover:shadow-sm ${
                    i === focusedIdx ? "ring-2 ring-primary border-primary/30" : ""
                  }`}
                >
                  <PostPreviewCard
                    hookText={hook.hook_text}
                    brandName={brandName}
                    primaryColor={primaryColor}
                    secondaryColor={secondaryColor}
                    template={previewTemplate}
                    size="sm"
                    className="shrink-0 border"
                  />
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-sm line-clamp-2 leading-snug">{hook.hook_text}</p>
                    <div className="flex items-center gap-1.5">
                      <HookTypeBadge type={hook.hook_type} />
                    </div>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-2">
                    <ScoreBadge score={score} />
                    <button
                      onClick={async (e) => {
                        e.stopPropagation()
                        await navigator.clipboard.writeText(hook.hook_text)
                      }}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
