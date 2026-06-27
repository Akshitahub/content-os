"use client"

import { useState, useRef, useEffect } from "react"
import {
  FileText, Film, LayoutGrid, Zap, BookOpen, Megaphone,
  RefreshCw, Copy, Check,
} from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { GeneratingState } from "@/components/shared/GeneratingState"
import { useGenerateContent, ApiResponseError, type ContentResult } from "@/hooks/useGeneration"
import { useGenerationStore } from "@/stores/generationStore"
import type { ProductRow } from "@/types/database"
import type { ContentFormat, Platform } from "@/types/app"

// ─── Format config ───────────────────────────────────────────────────────────

const FORMAT_CONFIGS: {
  value: ContentFormat
  label: string
  icon: React.ElementType
  description: string
}[] = [
  { value: "social_post", label: "Social post",  icon: FileText,    description: "Caption with CTA + hashtags" },
  { value: "reel_script", label: "Reel script",  icon: Film,        description: "Scene-by-scene 15–30 sec script" },
  { value: "carousel",    label: "Carousel",     icon: LayoutGrid,  description: "Swipeable slide deck" },
  { value: "story",       label: "Story",        icon: Zap,         description: "Text overlay + sticker idea" },
  { value: "blog_post",   label: "Blog post",    icon: BookOpen,    description: "400–600 word article" },
  { value: "ad_copy",     label: "Ad copy",      icon: Megaphone,   description: "Meta-ready headline + body" },
]

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: "instagram", label: "Instagram" },
  { value: "tiktok",    label: "TikTok" },
  { value: "facebook",  label: "Facebook" },
  { value: "youtube",   label: "YouTube" },
  { value: "linkedin",  label: "LinkedIn" },
  { value: "twitter",   label: "Twitter / X" },
]

// ─── Copy button ─────────────────────────────────────────────────────────────

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  async function handleCopy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <Button variant="ghost" size="icon" className={cn("h-7 w-7 shrink-0 text-muted-foreground", className)} onClick={handleCopy}>
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  )
}

// ─── Output renderers ────────────────────────────────────────────────────────

function HashtagLine({ tags }: { tags: string[] }) {
  if (!tags.length) return null
  return <p className="text-xs text-muted-foreground">{tags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}</p>
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</p>
}

function ResultOutput({ result }: { result: ContentResult }) {
  if (result.format === "social_post") {
    const c = result.content
    const full = `${c.caption_text}\n\n${c.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}`
    return (
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm leading-relaxed whitespace-pre-wrap flex-1">{c.caption_text}</p>
          <CopyButton text={full} />
        </div>
        {c.cta && <p className="text-sm font-medium text-primary">{c.cta}</p>}
        <HashtagLine tags={c.hashtags} />
        <p className="text-xs text-muted-foreground">{c.character_count} characters</p>
      </div>
    )
  }

  if (result.format === "reel_script") {
    const c = result.content
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
          <SectionLabel>Hook</SectionLabel>
          <p className="mt-1 text-sm">{c.hook}</p>
        </div>
        {c.scenes.map((scene, i) => (
          <div key={i} className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">Scene {i + 1}</span>
              <span className="text-xs text-muted-foreground">{scene.duration_seconds}s</span>
            </div>
            <div>
              <SectionLabel>Visual</SectionLabel>
              <p className="mt-0.5 text-sm text-muted-foreground">{scene.visual_direction}</p>
            </div>
            <div>
              <SectionLabel>VO / On-screen text</SectionLabel>
              <p className="mt-0.5 text-sm">{scene.voiceover_or_text_overlay}</p>
            </div>
          </div>
        ))}
        <div className="rounded-lg border p-3 space-y-2">
          <SectionLabel>Caption</SectionLabel>
          <p className="text-sm">{c.caption}</p>
          <HashtagLine tags={c.hashtags} />
        </div>
      </div>
    )
  }

  if (result.format === "carousel") {
    const c = result.content
    return (
      <div className="space-y-2">
        {c.slides.map((slide) => (
          <div key={slide.slide_number} className="rounded-lg border p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                {slide.slide_number}
              </span>
              <p className="text-sm font-semibold">{slide.headline}</p>
            </div>
            <p className="pl-7 text-sm text-muted-foreground">{slide.body}</p>
          </div>
        ))}
        <div className="rounded-lg border p-3 space-y-2">
          <SectionLabel>Caption</SectionLabel>
          <p className="text-sm">{c.caption}</p>
          <HashtagLine tags={c.hashtags} />
        </div>
      </div>
    )
  }

  if (result.format === "story") {
    const c = result.content
    return (
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div>
          <SectionLabel>Text overlay</SectionLabel>
          <p className="mt-1 text-sm">{c.text}</p>
        </div>
        <Separator />
        <div>
          <SectionLabel>Sticker suggestion</SectionLabel>
          <p className="mt-1 text-sm">{c.sticker_suggestion}</p>
        </div>
      </div>
    )
  }

  if (result.format === "blog_post") {
    const c = result.content
    const full = `${c.title}\n\n${c.body}`
    return (
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-semibold leading-snug">{c.title}</h3>
          <CopyButton text={full} />
        </div>
        <p className="border-l-2 pl-3 text-xs italic text-muted-foreground">{c.meta_description}</p>
        <Separator />
        <div className="max-h-96 overflow-y-auto">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{c.body}</p>
        </div>
      </div>
    )
  }

  if (result.format === "ad_copy") {
    const c = result.content
    const fields: { label: string; value: string; limit?: number }[] = [
      { label: "Headline",     value: c.headline,     limit: 40 },
      { label: "Primary text", value: c.primary_text, limit: 125 },
      { label: "Description",  value: c.description },
      { label: "CTA button",   value: c.cta_button },
    ]
    return (
      <div className="rounded-lg border bg-card p-4 space-y-4">
        {fields.map(({ label, value, limit }) => (
          <div key={label}>
            <div className="flex items-center justify-between mb-0.5">
              <SectionLabel>{label}</SectionLabel>
              {limit && (
                <span className={cn("text-xs", value.length > limit ? "text-destructive" : "text-muted-foreground")}>
                  {value.length}/{limit}
                </span>
              )}
            </div>
            <p className="text-sm">{value}</p>
          </div>
        ))}
      </div>
    )
  }

  return null
}

// ─── Main component ──────────────────────────────────────────────────────────

interface ContentTypeGeneratorProps {
  brandId: string
  products: ProductRow[]
}

export function ContentTypeGenerator({ brandId, products }: ContentTypeGeneratorProps) {
  const { mutate: generate, isPending, error } = useGenerateContent()
  const {
    selectedHook,
    selectedPlatform,
    setSelectedPlatform,
    selectedProductId,
    setSelectedProductId,
    contentFormat: selectedFormat,
    setContentFormat,
    contentAdditionalContext: additionalContext,
    setContentAdditionalContext,
    contentResult: result,
    setContentResult,
  } = useGenerationStore()
  const [justSaved, setJustSaved] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Restore from sessionStorage on mount
  useEffect(() => {
    if (!result) {
      const saved = sessionStorage.getItem(`content_${brandId}`)
      if (saved) {
        try { setContentResult(JSON.parse(saved)) } catch {}
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId])

  // Persist to sessionStorage when result changes
  useEffect(() => {
    if (result) {
      sessionStorage.setItem(`content_${brandId}`, JSON.stringify(result))
    }
  }, [result, brandId])

  // Cleanup on unmount
  useEffect(() => {
    return () => abortControllerRef.current?.abort()
  }, [])

  function handleFormatChange(format: ContentFormat) {
    setContentFormat(format)
    setContentResult(null)
  }

  function handleGenerate() {
    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()
    setJustSaved(false)

    generate(
      {
        brandId,
        productId: selectedProductId ?? undefined,
        format: selectedFormat,
        platform: selectedFormat === "social_post" ? selectedPlatform : undefined,
        hookText: selectedFormat === "social_post" ? (selectedHook?.hook_text ?? undefined) : undefined,
        additionalContext: additionalContext || undefined,
      },
      {
        onSuccess: (data) => {
          setContentResult(data)
          setJustSaved(true)
          setTimeout(() => setJustSaved(false), 5000)
        },
      }
    )
  }

  const activeConfig = FORMAT_CONFIGS.find((f) => f.value === selectedFormat)!

  return (
    <div className="space-y-6">
      {/* Format picker */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {FORMAT_CONFIGS.map(({ value, label, icon: Icon, description }) => (
          <button
            key={value}
            type="button"
            onClick={() => handleFormatChange(value)}
            className={cn(
              "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
              selectedFormat === value
                ? "border-primary bg-primary/5"
                : "border-input hover:bg-secondary/50"
            )}
          >
            <Icon className={cn("h-4 w-4", selectedFormat === value ? "text-primary" : "text-muted-foreground")} />
            <span className="text-sm font-medium">{label}</span>
            <span className="text-xs leading-snug text-muted-foreground">{description}</span>
          </button>
        ))}
      </div>

      {/* Hook context banner — social post only */}
      {selectedFormat === "social_post" && (
        selectedHook ? (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
            <p className="text-xs font-medium text-primary mb-1">Using hook:</p>
            <p className="text-sm">{selectedHook.hook_text}</p>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-3 text-center">
            <p className="text-xs text-muted-foreground">Select a hook from the Hooks tab to use as your opening line, or generate without one.</p>
          </div>
        )
      )}

      {/* Controls */}
      <div className="rounded-lg border bg-card p-5 space-y-4">
        <h3 className="text-sm font-semibold">{activeConfig.label} settings</h3>

        {products.length > 0 && (
          <div className="space-y-1.5">
            <Label className="text-xs">Product</Label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={selectedProductId ?? ""}
              onChange={(e) => setSelectedProductId(e.target.value || null)}
            >
              <option value="">No specific product</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}

        {/* Platform picker — social post only */}
        {selectedFormat === "social_post" && (
          <div className="space-y-1.5">
            <Label className="text-xs">Platform</Label>
            <div className="flex flex-wrap gap-1.5">
              {PLATFORMS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setSelectedPlatform(p.value)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    selectedPlatform === p.value
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs">Additional context (optional)</Label>
          <textarea
            rows={2}
            placeholder={
              selectedFormat === "blog_post"
                ? "e.g. 'Topic: 5 reasons to switch to natural skincare'"
                : selectedFormat === "ad_copy"
                ? "e.g. 'Campaign angle: monsoon sale, urgency messaging'"
                : "e.g. 'For Diwali campaign' or 'Highlight the new packaging'"
            }
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            value={additionalContext}
            onChange={(e) => setContentAdditionalContext(e.target.value)}
          />
        </div>

        <Button className="w-full" onClick={handleGenerate} disabled={isPending}>
          {isPending ? (
            <><RefreshCw className="h-4 w-4 animate-spin" /> Generating…</>
          ) : (
            <><activeConfig.icon className="h-4 w-4" /> Generate {activeConfig.label.toLowerCase()}</>
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

      {isPending && <GeneratingState message={`Writing your ${activeConfig.label.toLowerCase()}…`} />}

      {justSaved && (
        <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <div className="flex items-center gap-2 text-green-700">
            <Check className="h-4 w-4 shrink-0" />
            <span className="text-sm font-medium">Content saved to My Content</span>
          </div>
          <Link
            href={`/brands/${brandId}/library?tab=content`}
            className="text-xs font-medium text-green-700 underline underline-offset-2 hover:text-green-900 shrink-0"
          >
            View in My Content →
          </Link>
        </div>
      )}

      {/* Result */}
      {result && !isPending && (
        <div className="space-y-3">
          <ResultOutput result={result} />
        </div>
      )}
    </div>
  )
}
