"use client"

import { useState, useRef, useEffect } from "react"
import Link from "next/link"
import { FileText, Copy, Check, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { GeneratingState } from "@/components/shared/GeneratingState"
import { useGenerateCaption } from "@/hooks/useGeneration"
import { useGenerationStore } from "@/stores/generationStore"
import type { ProductRow } from "@/types/database"
import type { Platform, ContentType } from "@/types/app"

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "facebook", label: "Facebook" },
  { value: "youtube", label: "YouTube" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "twitter", label: "Twitter / X" },
]

const CONTENT_TYPES: { value: ContentType; label: string }[] = [
  { value: "reel", label: "Reel" },
  { value: "post", label: "Post" },
  { value: "story", label: "Story" },
  { value: "carousel", label: "Carousel" },
  { value: "thread", label: "Thread" },
]

interface CaptionGeneratorProps {
  brandId: string
  products: ProductRow[]
}

export function CaptionGenerator({ brandId, products }: CaptionGeneratorProps) {
  const { mutate: generateCaption, isPending } = useGenerateCaption()
  const {
    selectedHook, selectedPlatform, setSelectedPlatform,
    selectedProductId, setSelectedProductId,
    captions, addCaption,
  } = useGenerationStore()
  const [contentType, setContentType] = useState<ContentType>("reel")
  const [additionalContext, setAdditionalContext] = useState("")
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Restore captions from sessionStorage
  useEffect(() => {
    if (captions.length === 0) {
      const saved = sessionStorage.getItem(`captions_${brandId}`)
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          if (Array.isArray(parsed)) {
            parsed.forEach((c) => addCaption(c))
          }
        } catch {}
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId])

  useEffect(() => {
    if (captions.length > 0) {
      sessionStorage.setItem(`captions_${brandId}`, JSON.stringify(captions))
    }
  }, [captions, brandId])

  useEffect(() => {
    return () => abortControllerRef.current?.abort()
  }, [])

  function handleGenerate() {
    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()
    setJustSaved(false)

    generateCaption(
      {
        brandId,
        productId: selectedProductId ?? undefined,
        hookId: selectedHook?.id ?? undefined,
        hookText: selectedHook?.hook_text,
        platform: selectedPlatform,
        contentType,
        additionalContext: additionalContext || undefined,
      },
      {
        onSuccess: (data) => {
          addCaption(data)
          setJustSaved(true)
          setTimeout(() => setJustSaved(false), 5000)
        },
      }
    )
  }

  async function handleCopy(text: string, id: string) {
    await navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <div className="space-y-6">
      {selectedHook ? (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
          <p className="text-xs font-medium text-primary mb-1">Using hook:</p>
          <p className="text-sm">{selectedHook.hook_text}</p>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-4 text-center">
          <p className="text-sm text-muted-foreground">Select a hook from the left to use as your opening line, or generate a caption without one.</p>
        </div>
      )}

      <div className="rounded-lg border bg-card p-5 space-y-4">
        <h3 className="text-sm font-semibold">Caption Settings</h3>

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
          <Label className="text-xs">Content type</Label>
          <div className="flex flex-wrap gap-1.5">
            {CONTENT_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setContentType(t.value)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  contentType === t.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Additional context (optional)</Label>
          <textarea
            rows={2}
            placeholder="e.g. 'For Diwali campaign' or 'Mention the discount code SAVE20'"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            value={additionalContext}
            onChange={(e) => setAdditionalContext(e.target.value)}
          />
        </div>

        <Button className="w-full" onClick={handleGenerate} disabled={isPending}>
          {isPending ? (
            <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Writing caption…</>
          ) : (
            <><FileText className="h-4 w-4 mr-2" /> Generate caption</>
          )}
        </Button>
      </div>

      {isPending && <GeneratingState message="Writing your caption..." />}

      {justSaved && (
        <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <div className="flex items-center gap-2 text-green-700">
            <Check className="h-4 w-4 shrink-0" />
            <span className="text-sm font-medium">Caption saved to My Content</span>
          </div>
          <Link
            href={`/brands/${brandId}/library?tab=captions`}
            className="text-xs font-medium text-green-700 underline underline-offset-2 hover:text-green-900 shrink-0"
          >
            View in My Content →
          </Link>
        </div>
      )}

      {!isPending && captions.length > 0 && (
        <div className="space-y-4">
          <p className="text-sm font-medium">{captions.length} caption{captions.length > 1 ? "s" : ""} generated</p>

          {/* Phone mockup preview of most recent caption */}
          {captions[0] && (
            <div className="flex justify-center py-2">
              <div className="relative" style={{ width: 260 }}>
                {/* Phone outer frame */}
                <div className="pointer-events-none absolute inset-0 z-10 rounded-[36px] border-[6px] border-zinc-800 shadow-xl" />
                {/* Notch */}
                <div className="pointer-events-none absolute left-1/2 top-0 z-20 h-5 w-24 -translate-x-1/2 rounded-b-2xl bg-zinc-800" />
                {/* Home indicator */}
                <div className="pointer-events-none absolute bottom-1.5 left-1/2 z-20 h-1 w-16 -translate-x-1/2 rounded-full bg-zinc-600" />
                {/* Screen */}
                <div className="overflow-hidden rounded-[30px] bg-white" style={{ minHeight: 360 }}>
                  {/* Instagram-style post header */}
                  <div className="flex items-center gap-2 border-b px-3 py-2 pt-6">
                    <div className="h-7 w-7 rounded-full bg-gradient-to-br from-pink-400 via-fuchsia-500 to-purple-600" />
                    <span className="text-[11px] font-semibold text-zinc-900">your_brand</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">now</span>
                  </div>
                  {/* Caption */}
                  <div className="px-3 py-2">
                    <p className="text-[11px] leading-relaxed text-zinc-900 whitespace-pre-wrap line-clamp-6">
                      {captions[0].caption_text}
                    </p>
                    {captions[0].cta && (
                      <p className="mt-1 text-[11px] font-semibold text-zinc-900">{captions[0].cta}</p>
                    )}
                    {captions[0].hashtags.length > 0 && (
                      <p className="mt-1 text-[10px] text-blue-500 line-clamp-2">
                        {captions[0].hashtags.slice(0, 8).map((h) => `#${h.replace(/^#/, "")}`).join(" ")}
                      </p>
                    )}
                  </div>
                  {/* Engagement row */}
                  <div className="border-t px-3 py-1.5 flex items-center gap-3">
                    <span className="text-[10px] text-muted-foreground">❤️ 128</span>
                    <span className="text-[10px] text-muted-foreground">💬 24</span>
                    <span className="text-[10px] text-muted-foreground">↗️ Share</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Caption cards */}
          {captions.map((caption, i) => {
            const captionId = caption.id ?? `caption-${i}`
            const fullText = `${caption.caption_text}\n\n${caption.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}`
            return (
              <div key={captionId} className="rounded-lg border bg-card p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm leading-relaxed whitespace-pre-wrap flex-1">{caption.caption_text}</p>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-muted-foreground"
                    onClick={() => handleCopy(fullText, captionId)}
                  >
                    {copiedId === captionId
                      ? <Check className="h-3.5 w-3.5 text-green-500" />
                      : <Copy className="h-3.5 w-3.5" />
                    }
                  </Button>
                </div>
                {caption.cta && (
                  <p className="text-sm font-medium text-primary">{caption.cta}</p>
                )}
                {caption.hashtags.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {caption.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">{caption.character_count} characters</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
