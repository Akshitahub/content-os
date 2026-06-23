"use client"

import { useState, useEffect, useCallback } from "react"
import { Sparkles, RefreshCw, Copy, Check, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { useGenerateFullPost, ApiResponseError } from "@/hooks/useGeneration"
import { useGenerationStore } from "@/stores/generationStore"
import type { FullPostResult, ContentResult } from "@/hooks/useGeneration"
import type { ProductRow } from "@/types/database"
import type { ContentFormat, Platform, GeneratedHook, GeneratedCaption, ReelScript, CarouselContent, BlogPost, AdCopy } from "@/types/app"

const FORMATS: { value: ContentFormat; label: string }[] = [
  { value: "social_post", label: "Instagram Post" },
  { value: "carousel", label: "Carousel" },
  { value: "reel_script", label: "Reel Script" },
  { value: "blog_post", label: "Blog Post" },
  { value: "ad_copy", label: "Ad Copy" },
]

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "facebook", label: "Facebook" },
  { value: "youtube", label: "YouTube" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "twitter", label: "Twitter / X" },
]

interface Props {
  brandId: string
  products: ProductRow[]
}

export function FullPostGenerator({ brandId, products }: Props) {
  const { mutate: generate, isPending, error } = useGenerateFullPost()
  const {
    fullPostResult,
    setFullPostResult,
    selectedProductId,
    setSelectedProductId,
    selectedPlatform,
    setSelectedPlatform,
    occasionContext,
  } = useGenerationStore()

  const [format, setFormat] = useState<ContentFormat>("social_post")
  const [additionalContext, setAdditionalContext] = useState("")
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    if (occasionContext) setAdditionalContext(occasionContext.angle)
  }, [occasionContext])

  const copy = useCallback((text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }, [])

  function downloadCard(html: string) {
    const blob = new Blob([html], { type: "text/html" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "post-card.html"
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleGenerate() {
    generate(
      {
        brandId,
        productId: selectedProductId ?? undefined,
        format,
        platform: selectedPlatform,
        additionalContext: additionalContext || undefined,
      },
      { onSuccess: setFullPostResult }
    )
  }

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="rounded-lg border bg-card p-5 space-y-4">
        <h3 className="text-sm font-semibold">Full Post Settings</h3>

        {/* Format */}
        <div className="space-y-1.5">
          <Label className="text-xs">Content format</Label>
          <div className="flex flex-wrap gap-1.5">
            {FORMATS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFormat(f.value)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  format === f.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

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

        {/* Product */}
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

        {/* Additional context */}
        <div className="space-y-1.5">
          <Label className="text-xs">Additional context (optional)</Label>
          <textarea
            rows={2}
            placeholder="e.g. 'Weekend flash sale — 20% off' or 'New packaging launch'"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            value={additionalContext}
            onChange={(e) => setAdditionalContext(e.target.value)}
          />
        </div>

        <Button className="w-full" onClick={handleGenerate} disabled={isPending}>
          {isPending ? (
            <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Generating full post…</>
          ) : (
            <><Sparkles className="h-4 w-4 mr-2" /> Generate full post</>
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
      {fullPostResult && (
        <FullPostResults
          result={fullPostResult}
          copied={copied}
          onCopy={copy}
          onDownload={downloadCard}
        />
      )}
    </div>
  )
}

// ─── Result components ───────────────────────────────────────────────────────

function CopyBtn({ text, id, copied, onCopy }: { text: string; id: string; copied: string | null; onCopy: (t: string, k: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onCopy(text, id)}
      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied === id ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
      {copied === id ? "Copied" : "Copy"}
    </button>
  )
}

function HookSection({ hook, copied, onCopy }: { hook: GeneratedHook; copied: string | null; onCopy: (t: string, k: string) => void }) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Hook</span>
        <CopyBtn text={hook.hook_text} id="hook" copied={copied} onCopy={onCopy} />
      </div>
      <p className="text-sm font-semibold leading-relaxed">{hook.hook_text}</p>
      <p className="text-xs text-muted-foreground italic">{hook.reasoning}</p>
    </div>
  )
}

function ContentDisplay({ content, copied, onCopy }: { content: ContentResult; copied: string | null; onCopy: (t: string, k: string) => void }) {
  if (content.format === "social_post") {
    const c = content.content as GeneratedCaption
    const full = `${c.caption_text}\n\n${c.hashtags.map((h) => `#${h}`).join(" ")}`
    return (
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Caption</span>
          <CopyBtn text={full} id="caption" copied={copied} onCopy={onCopy} />
        </div>
        <p className="text-sm whitespace-pre-wrap leading-relaxed">{c.caption_text}</p>
        {c.hashtags.length > 0 && (
          <p className="text-xs text-primary font-medium">{c.hashtags.map((h) => `#${h}`).join(" ")}</p>
        )}
        {c.cta && <p className="text-xs text-muted-foreground">CTA: {c.cta}</p>}
      </div>
    )
  }

  if (content.format === "reel_script") {
    const c = content.content as ReelScript
    return (
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Reel Script</span>
          <CopyBtn
            text={`HOOK: ${c.hook}\n\n${c.scenes.map((s, i) => `Scene ${i + 1} (${s.duration_seconds}s)\nVisual: ${s.visual_direction}\nVoiceover: ${s.voiceover_or_text_overlay}`).join("\n\n")}\n\nCAPTION:\n${c.caption}\n\n${c.hashtags.map((h) => `#${h}`).join(" ")}`}
            id="reel"
            copied={copied}
            onCopy={onCopy}
          />
        </div>
        <p className="text-xs font-semibold text-muted-foreground">Hook</p>
        <p className="text-sm font-medium">{c.hook}</p>
        <div className="space-y-2">
          {c.scenes.map((scene, i) => (
            <div key={i} className="rounded-md bg-secondary/50 p-3 space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">Scene {i + 1} · {scene.duration_seconds}s</p>
              <p className="text-xs"><span className="font-medium">Visual:</span> {scene.visual_direction}</p>
              <p className="text-xs"><span className="font-medium">Voiceover:</span> {scene.voiceover_or_text_overlay}</p>
            </div>
          ))}
        </div>
        {c.hashtags.length > 0 && (
          <p className="text-xs text-primary font-medium">{c.hashtags.map((h) => `#${h}`).join(" ")}</p>
        )}
      </div>
    )
  }

  if (content.format === "carousel") {
    const c = content.content as CarouselContent
    return (
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Carousel · {c.slides.length} slides</span>
          <CopyBtn
            text={c.slides.map((s) => `Slide ${s.slide_number}: ${s.headline}\n${s.body}`).join("\n\n")}
            id="carousel"
            copied={copied}
            onCopy={onCopy}
          />
        </div>
        <div className="space-y-2">
          {c.slides.map((slide) => (
            <div key={slide.slide_number} className="rounded-md bg-secondary/50 p-3 space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">Slide {slide.slide_number}</p>
              <p className="text-sm font-semibold">{slide.headline}</p>
              <p className="text-xs text-muted-foreground">{slide.body}</p>
            </div>
          ))}
        </div>
        {c.hashtags.length > 0 && (
          <p className="text-xs text-primary font-medium">{c.hashtags.map((h) => `#${h}`).join(" ")}</p>
        )}
      </div>
    )
  }

  if (content.format === "blog_post") {
    const c = content.content as BlogPost
    return (
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Blog Post</span>
          <CopyBtn text={`${c.title}\n\n${c.body}`} id="blog" copied={copied} onCopy={onCopy} />
        </div>
        <p className="text-base font-bold leading-snug">{c.title}</p>
        <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{c.body}</p>
        <div className="rounded-md bg-secondary/50 p-3">
          <p className="text-xs font-semibold text-muted-foreground mb-1">Meta description</p>
          <p className="text-xs">{c.meta_description}</p>
        </div>
      </div>
    )
  }

  if (content.format === "ad_copy") {
    const c = content.content as AdCopy
    const full = `Headline: ${c.headline}\n\n${c.primary_text}\n\n${c.description}\n\nCTA: ${c.cta_button}`
    return (
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ad Copy</span>
          <CopyBtn text={full} id="adcopy" copied={copied} onCopy={onCopy} />
        </div>
        <div className="space-y-2">
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-0.5">Headline</p>
            <p className="text-sm font-bold">{c.headline}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-0.5">Primary text</p>
            <p className="text-sm">{c.primary_text}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-0.5">Description</p>
            <p className="text-sm text-muted-foreground">{c.description}</p>
          </div>
          <div className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1">
            <p className="text-xs font-semibold text-primary">{c.cta_button}</p>
          </div>
        </div>
      </div>
    )
  }

  return null
}

function PostCardPreview({ html, onDownload }: { html: string; onDownload: (html: string) => void }) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Post Graphic</span>
        <button
          type="button"
          onClick={() => onDownload(html)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Download className="h-3.5 w-3.5" /> Download HTML
        </button>
      </div>
      <div
        style={{ width: 360, height: 360, overflow: "hidden", borderRadius: 8, flexShrink: 0 }}
        className="border"
      >
        <iframe
          srcDoc={html}
          sandbox="allow-same-origin"
          title="Post graphic preview"
          style={{
            width: 1080,
            height: 1080,
            border: "none",
            transform: "scale(0.333)",
            transformOrigin: "top left",
          }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Download the HTML file and open in a browser to screenshot at 1080×1080px.
      </p>
    </div>
  )
}

function FullPostResults({
  result,
  copied,
  onCopy,
  onDownload,
}: {
  result: FullPostResult
  copied: string | null
  onCopy: (text: string, key: string) => void
  onDownload: (html: string) => void
}) {
  return (
    <div className="space-y-4">
      <HookSection hook={result.hook} copied={copied} onCopy={onCopy} />
      <ContentDisplay content={result.content} copied={copied} onCopy={onCopy} />
      {result.postCardHtml && (
        <PostCardPreview html={result.postCardHtml} onDownload={onDownload} />
      )}
    </div>
  )
}
