"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { Sparkles, RefreshCw, Copy, Check, Download, ExternalLink, Archive, Loader2, AlertCircle, CalendarClock } from "lucide-react"
import { ProductPicker, type PickedProduct } from "@/components/shared/ProductPicker"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { isApiError } from "@/types/api"
import Link from "next/link"
import { GeneratingState } from "@/components/shared/GeneratingState"
import { PostPreviewCard, generatePreviewHtml } from "@/components/shared/PostPreviewCard"
import type { PreviewTemplate } from "@/components/shared/PostPreviewCard"
import { TEMPLATE_NAMES } from "@/lib/design/constants"
import { useGenerateFullPost, useGenerateImage, ApiResponseError } from "@/hooks/useGeneration"
import { useGenerationStore } from "@/stores/generationStore"
import { useBrand } from "@/hooks/useBrand"
import type { FullPostResult, ContentResult } from "@/hooks/useGeneration"
import type { ProductRow } from "@/types/database"
import type { ContentFormat, Platform, GeneratedHook, GeneratedCaption, ReelScript, CarouselContent, BlogPost, AdCopy, ImageStyle, AspectRatio } from "@/types/app"

// ─── Canvas compositing helpers ──────────────────────────────────────────────

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

async function compositeProductCard(
  productImageUrl: string,
  hookText: string,
  primaryColor: string,
  secondaryColor: string,
  brandName: string,
): Promise<string> {
  const size = 1080
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext("2d")!

  // Gradient background
  const grad = ctx.createLinearGradient(0, 0, size, size)
  grad.addColorStop(0, primaryColor)
  grad.addColorStop(1, secondaryColor)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)

  // Dark overlay for text legibility
  ctx.fillStyle = "rgba(0,0,0,0.28)"
  ctx.fillRect(0, 0, size, size)

  // Product image — upper 62% of the card
  try {
    const img = await loadImage(productImageUrl)
    const pad = 100
    const maxW = size - pad * 2
    const maxH = size * 0.58
    const ratio = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight)
    const w = img.naturalWidth * ratio
    const h = img.naturalHeight * ratio
    ctx.drawImage(img, (size - w) / 2, size * 0.06, w, h)
  } catch {
    // skip — CORS or load failure; still render the branded text card
  }

  // Hook text — bottom third, word-wrapped to 2 lines
  ctx.fillStyle = "#ffffff"
  ctx.textAlign = "center"
  ctx.textBaseline = "top"
  ctx.font = `bold 68px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
  const words = hookText.split(" ")
  const lines: string[] = []
  let cur = ""
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word
    if (ctx.measureText(test).width > size - 140) {
      if (cur) lines.push(cur)
      cur = word
      if (lines.length >= 1) break
    } else {
      cur = test
    }
  }
  if (cur && lines.length < 2) lines.push(cur)
  const lineH = 82
  const textY = size * 0.70
  lines.forEach((line, i) => ctx.fillText(line, size / 2, textY + i * lineH))

  // Brand name — bottom
  ctx.font = `34px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
  ctx.fillStyle = "rgba(255,255,255,0.60)"
  ctx.fillText(brandName, size / 2, size * 0.93)

  return canvas.toDataURL("image/jpeg", 0.90)
}

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
  const { mutate: generateImage, isPending: imageGenerating } = useGenerateImage()
  const {
    fullPostResult,
    setFullPostResult,
    selectedProductId,
    setSelectedProductId,
    selectedPlatform,
    setSelectedPlatform,
    occasionContext,
  } = useGenerationStore()
  const { data: brand } = useBrand(brandId)

  const palette = brand?.color_palette as Record<string, unknown> | null | undefined
  const paletteColors = palette ? Object.values(palette).filter((v): v is string => typeof v === "string") : []
  const primaryColor = paletteColors[0] ?? "#6366f1"
  const secondaryColor = paletteColors[1] ?? "#818cf8"
  const brandName = brand?.name ?? "Brand"

  const [format, setFormat] = useState<ContentFormat>("social_post")
  const [additionalContext, setAdditionalContext] = useState("")
  const [copied, setCopied] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<PreviewTemplate>(1)
  const [postImageUrl, setPostImageUrl] = useState<string | null>(null)
  const [selectedProduct, setSelectedProduct] = useState<PickedProduct | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const previewHtml = useMemo(() => {
    if (!fullPostResult) return undefined
    return generatePreviewHtml(
      fullPostResult.hook.hook_text,
      brandName,
      primaryColor,
      secondaryColor,
      selectedTemplate,
    )
  }, [fullPostResult, brandName, primaryColor, secondaryColor, selectedTemplate])

  useEffect(() => {
    if (occasionContext) setAdditionalContext(occasionContext.angle)
  }, [occasionContext])

  // Restore from sessionStorage on mount
  useEffect(() => {
    if (!fullPostResult) {
      const saved = sessionStorage.getItem(`fullpost_${brandId}`)
      if (saved) {
        try { setFullPostResult(JSON.parse(saved)) } catch {}
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId])

  // Persist to sessionStorage when result changes
  useEffect(() => {
    if (fullPostResult) {
      sessionStorage.setItem(`fullpost_${brandId}`, JSON.stringify(fullPostResult))
    }
  }, [fullPostResult, brandId])

  // Cleanup on unmount
  useEffect(() => {
    return () => abortControllerRef.current?.abort()
  }, [])

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
    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()
    setJustSaved(false)
    setPostImageUrl(null)

    generate(
      {
        brandId,
        productId: selectedProductId ?? undefined,
        format,
        platform: selectedPlatform,
        additionalContext: additionalContext || undefined,
      },
      {
        onSuccess: (data) => {
          setFullPostResult(data)
          setJustSaved(true)
          setTimeout(() => setJustSaved(false), 5000)
          if (selectedProduct?.imageUrl) {
            compositeProductCard(
              selectedProduct.imageUrl,
              data.hook.hook_text,
              primaryColor,
              secondaryColor,
              brandName,
            )
              .then((dataUrl) => setPostImageUrl(dataUrl))
              .catch(() => {
                if (selectedProduct.imageUrl) setPostImageUrl(selectedProduct.imageUrl)
              })
          } else {
            generateImage(
              {
                brandId,
                prompt: data.hook.hook_text,
                style: "product_photography" as ImageStyle,
                aspectRatio: "1:1" as AspectRatio,
              },
              { onSuccess: (imgData) => setPostImageUrl(imgData.public_url) }
            )
          }
        },
      }
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

        {/* Product image for post graphic */}
        <div className="space-y-1.5">
          <Label className="text-xs">Product image for post graphic (optional)</Label>
          <ProductPicker
            brandId={brandId}
            selected={selectedProduct}
            onSelect={setSelectedProduct}
            label="Add product photo — composites on your post graphic"
          />
        </div>

        {/* Template selector */}
        <div className="space-y-1.5">
          <Label className="text-xs">Post graphic template</Label>
          <div className="grid grid-cols-4 gap-2">
            {([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as PreviewTemplate[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setSelectedTemplate(t)}
                className={`relative overflow-hidden rounded-lg border-2 transition-all ${
                  selectedTemplate === t ? "border-primary shadow-md" : "border-muted hover:border-primary/40"
                }`}
              >
                <PostPreviewCard
                  hookText={brandName}
                  brandName={brandName}
                  primaryColor={primaryColor}
                  secondaryColor={secondaryColor}
                  template={t}
                  px={90}
                />
                <div className="absolute inset-x-0 bottom-0 bg-black/60 py-1 px-1">
                  <p className="truncate text-center text-[9px] font-medium text-white">{TEMPLATE_NAMES[t]}</p>
                </div>
                {selectedTemplate === t && (
                  <div className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary">
                    <Check className="h-2.5 w-2.5 text-white" />
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

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
      </div>

      {isPending && <GeneratingState message="Writing your full post…" />}

      {justSaved && (
        <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <div className="flex items-center gap-2 text-green-700">
            <Check className="h-4 w-4 shrink-0" />
            <span className="text-sm font-medium">✓ Generated successfully — scroll down to see your content</span>
          </div>
          <Link
            href={`/brands/${brandId}/library`}
            className="text-xs font-medium text-green-700 underline underline-offset-2 hover:text-green-900 shrink-0"
          >
            View →
          </Link>
        </div>
      )}

      {/* Results */}
      {fullPostResult && !isPending && (
        <FullPostResults
          result={fullPostResult}
          previewHtml={previewHtml}
          copied={copied}
          onCopy={copy}
          onDownload={downloadCard}
          brandId={brandId}
          postImageUrl={postImageUrl}
          imageGenerating={imageGenerating}
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
    const full = `${c.caption_text}\n\n${c.hashtags.map((h) => `#${h.replace(/^#+/, "")}`).join(" ")}`
    return (
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Caption</span>
          <CopyBtn text={full} id="caption" copied={copied} onCopy={onCopy} />
        </div>
        <p className="text-sm whitespace-pre-wrap leading-relaxed">{c.caption_text}</p>
        {c.hashtags.length > 0 && (
          <p className="text-xs text-primary font-medium">{c.hashtags.map((h) => `#${h.replace(/^#+/, "")}`).join(" ")}</p>
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
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Reel Script · Storyboard</span>
          <CopyBtn
            text={`HOOK: ${c.hook}\n\n${c.scenes.map((s, i) => `Scene ${i + 1} (${s.duration_seconds}s)\nVisual: ${s.visual_direction}\nVoiceover: ${s.voiceover_or_text_overlay}`).join("\n\n")}\n\nCAPTION:\n${c.caption}\n\n${c.hashtags.map((h) => `#${h.replace(/^#+/, "")}`).join(" ")}`}
            id="reel"
            copied={copied}
            onCopy={onCopy}
          />
        </div>
        <div className="rounded-md bg-primary/5 border border-primary/10 p-3">
          <p className="text-xs font-semibold text-muted-foreground mb-1">Opening Hook</p>
          <p className="text-sm font-semibold">{c.hook}</p>
        </div>
        {/* Storyboard scene cards */}
        <div className="grid gap-3 sm:grid-cols-2">
          {c.scenes.map((scene, i) => {
            const imgPrompt = encodeURIComponent(`${scene.visual_direction}, cinematic, vertical video frame, 9:16`)
            const imgUrl = `https://image.pollinations.ai/prompt/${imgPrompt}?width=360&height=640&seed=${i + 1}&nologo=true&model=flux`
            return (
              <div key={i} className="rounded-md border overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imgUrl}
                  alt={`Scene ${i + 1}`}
                  width={360}
                  height={180}
                  className="w-full object-cover"
                  style={{ height: 120 }}
                  loading="lazy"
                />
                <div className="p-2.5 space-y-1 bg-secondary/30">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold">Scene {i + 1}</p>
                    <span className="text-xs text-muted-foreground">{scene.duration_seconds}s</span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{scene.voiceover_or_text_overlay}</p>
                  <p className="text-xs text-muted-foreground/70 italic line-clamp-1">{scene.visual_direction}</p>
                </div>
              </div>
            )
          })}
        </div>
        {c.caption && (
          <div className="rounded-md bg-secondary/50 p-3">
            <p className="text-xs font-semibold text-muted-foreground mb-1">Caption</p>
            <p className="text-xs">{c.caption}</p>
          </div>
        )}
        {c.hashtags.length > 0 && (
          <p className="text-xs text-primary font-medium">{c.hashtags.map((h) => `#${h.replace(/^#+/, "")}`).join(" ")}</p>
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
          <p className="text-xs text-primary font-medium">{c.hashtags.map((h) => `#${h.replace(/^#+/, "")}`).join(" ")}</p>
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
      <div className="rounded-lg border bg-card p-4 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ad Copy</span>
          <CopyBtn text={full} id="adcopy" copied={copied} onCopy={onCopy} />
        </div>
        {/* Facebook/Instagram-style ad mockup */}
        <div className="mx-auto max-w-xs overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center gap-2.5 border-b px-3 py-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-[10px] font-bold text-white">AD</div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-900">Your Brand</p>
              <p className="text-[10px] text-gray-400">Sponsored · 🌐</p>
            </div>
            <span className="text-base text-gray-300 leading-none">···</span>
          </div>
          <div className="px-3 py-2">
            <p className="line-clamp-3 text-xs text-gray-800">{c.primary_text}</p>
          </div>
          <div className="flex h-36 w-full items-center justify-center bg-gradient-to-br from-violet-50 to-indigo-50">
            <p className="text-[10px] font-medium text-gray-400">Ad creative goes here</p>
          </div>
          <div className="flex items-center justify-between gap-2 border-t bg-gray-50 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[9px] uppercase tracking-wide text-gray-400">{c.description}</p>
              <p className="truncate text-xs font-bold text-gray-900">{c.headline}</p>
            </div>
            <span className="shrink-0 rounded-md bg-blue-600 px-2.5 py-1 text-[10px] font-semibold text-white">{c.cta_button}</span>
          </div>
        </div>
        <div className="space-y-2 text-sm">
          <div><p className="text-xs font-semibold text-muted-foreground mb-0.5">Headline <span className="font-normal">({c.headline.length}/40 chars)</span></p><p className="font-bold">{c.headline}</p></div>
          <div><p className="text-xs font-semibold text-muted-foreground mb-0.5">Primary text</p><p>{c.primary_text}</p></div>
          <div><p className="text-xs font-semibold text-muted-foreground mb-0.5">Description</p><p className="text-muted-foreground">{c.description}</p></div>
          <div className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1"><p className="text-xs font-semibold text-primary">{c.cta_button}</p></div>
        </div>
      </div>
    )
  }

  return null
}

function PostCardPreview({ html, onDownload }: { html: string; onDownload: (html: string) => void }) {
  function openInBrowser() {
    const blob = new Blob([html], { type: "text/html" })
    const url = URL.createObjectURL(blob)
    window.open(url, "_blank")
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Post Graphic</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={openInBrowser}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Open full size
          </button>
          <button
            type="button"
            onClick={() => onDownload(html)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Download className="h-3.5 w-3.5" /> Download HTML
          </button>
        </div>
      </div>
      <div
        style={{ width: "100%", maxWidth: 360, height: 360, overflow: "hidden", borderRadius: 8, flexShrink: 0 }}
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
        Click &quot;Open full size&quot; to view at 1080×1080px, or download the HTML file.
      </p>
    </div>
  )
}

// ─── Schedule to Instagram/Facebook ──────────────────────────────────────────

function getScheduleCaption(result: FullPostResult): { text: string; hashtags: string[] } | null {
  if (result.content.format === "social_post") {
    const c = result.content.content as GeneratedCaption
    return { text: c.caption_text, hashtags: c.hashtags }
  }
  if (result.content.format === "reel_script") {
    const c = result.content.content as ReelScript
    if (!c.caption) return null
    return { text: c.caption, hashtags: c.hashtags }
  }
  // Carousel/blog/ad copy don't map to a single caption+image Instagram
  // post — scheduling those needs separate client-side rendering work.
  return null
}

interface ConnectionStatus {
  connected: boolean
  facebook_connected: boolean
  instagram_connected: boolean
}

function ScheduleAction({
  brandId,
  imageUrl,
  caption,
  hashtags,
}: {
  brandId: string
  imageUrl: string
  caption: string
  hashtags: string[]
}) {
  const [open, setOpen] = useState(false)
  const [connection, setConnection] = useState<ConnectionStatus | null>(null)
  const [checkingConnection, setCheckingConnection] = useState(false)
  const [connectionError, setConnectionError] = useState(false)
  const [platform, setPlatform] = useState<"instagram" | "facebook">("instagram")
  const [date, setDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return d.toISOString().split("T")[0]
  })
  const [time, setTime] = useState("10:00")
  const [submitState, setSubmitState] = useState<"idle" | "loading" | "success" | "error">("idle")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successInfo, setSuccessInfo] = useState<{ platform: string; date: string; time: string } | null>(null)

  const checkConnection = useCallback(async () => {
    setCheckingConnection(true)
    setConnectionError(false)
    try {
      const res = await fetch(`/api/v1/brands/${brandId}/social-connections`)
      const json: unknown = await res.json()
      if (res.ok && !isApiError(json)) {
        const data = (json as { data: ConnectionStatus }).data
        setConnection(data)
        setPlatform(data.instagram_connected ? "instagram" : "facebook")
      } else {
        setConnectionError(true)
      }
    } catch {
      setConnectionError(true)
    } finally {
      setCheckingConnection(false)
    }
  }, [brandId])

  const openPanel = useCallback(() => {
    setOpen(true)
    if (!connection && !checkingConnection) checkConnection()
  }, [connection, checkingConnection, checkConnection])

  const closePanel = useCallback(() => {
    setOpen(false)
    setSubmitState("idle")
    setErrorMsg(null)
    setSuccessInfo(null)
  }, [])

  const handleConfirm = useCallback(async () => {
    setSubmitState("loading")
    setErrorMsg(null)
    try {
      const res = await fetch("/api/v1/calendar/schedule-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          platform,
          imageUrl,
          caption,
          hashtags: hashtags.map((h) => h.replace(/^#+/, "")),
          scheduledDate: date,
          scheduledTime: time,
        }),
      })
      const json: unknown = await res.json()
      if (!res.ok || isApiError(json)) {
        const msg = isApiError(json) ? json.error.message : "Failed to schedule post."
        setErrorMsg(msg)
        setSubmitState("error")
        return
      }
      setSuccessInfo({ platform, date, time })
      setSubmitState("success")
    } catch {
      setErrorMsg("Network error. Please try again.")
      setSubmitState("error")
    }
  }, [brandId, platform, imageUrl, caption, hashtags, date, time])

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={openPanel} className="flex items-center gap-1.5">
        <CalendarClock className="h-3.5 w-3.5" /> Schedule to Instagram/Facebook
      </Button>
    )
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Schedule post</span>
        <button type="button" onClick={closePanel} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          Close
        </button>
      </div>

      {checkingConnection && (
        <p className="text-sm text-muted-foreground">Checking your connection…</p>
      )}

      {!checkingConnection && connectionError && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-1.5">
          <p className="text-sm text-amber-900">Couldn&apos;t check your connection status.</p>
          <button
            type="button"
            onClick={checkConnection}
            className="text-xs font-semibold text-amber-700 underline underline-offset-2 hover:text-amber-900"
          >
            Try again
          </button>
        </div>
      )}

      {!checkingConnection && !connectionError && connection && !connection.connected && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-1.5">
          <p className="text-sm text-amber-900">Connect Instagram or Facebook first to schedule posts.</p>
          <Link
            href={`/brands/${brandId}`}
            className="text-xs font-semibold text-amber-700 underline underline-offset-2 hover:text-amber-900"
          >
            Go to brand settings →
          </Link>
        </div>
      )}

      {!checkingConnection && !connectionError && connection?.connected && submitState !== "success" && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Platform</Label>
            <div className="flex gap-1.5">
              <button
                type="button"
                disabled={!connection.instagram_connected}
                onClick={() => setPlatform("instagram")}
                title={!connection.instagram_connected ? "No Instagram Business account linked" : undefined}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  platform === "instagram" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}
              >
                Instagram
              </button>
              <button
                type="button"
                disabled={!connection.facebook_connected}
                onClick={() => setPlatform("facebook")}
                title={!connection.facebook_connected ? "Facebook not connected" : undefined}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  platform === "facebook" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}
              >
                Facebook
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Time</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>

          <Button size="sm" className="w-full" onClick={handleConfirm} disabled={submitState === "loading"}>
            {submitState === "loading" ? "Scheduling…" : "Confirm schedule"}
          </Button>

          {submitState === "error" && errorMsg && (
            <p className="text-sm text-destructive">{errorMsg}</p>
          )}
        </div>
      )}

      {submitState === "success" && successInfo && (
        <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2">
          <Check className="h-4 w-4 text-green-500 shrink-0" />
          <span className="text-sm font-medium text-green-700">
            Scheduled for {successInfo.platform === "instagram" ? "Instagram" : "Facebook"} on {successInfo.date} at {successInfo.time}
          </span>
        </div>
      )}
    </div>
  )
}

function FullPostResults({
  result,
  previewHtml,
  copied,
  onCopy,
  onDownload,
  brandId,
  postImageUrl,
  imageGenerating,
}: {
  result: FullPostResult
  previewHtml?: string
  copied: string | null
  onCopy: (text: string, key: string) => void
  onDownload: (html: string) => void
  brandId: string
  postImageUrl?: string | null
  imageGenerating?: boolean
}) {
  const scheduleCaption = getScheduleCaption(result)

  return (
    <div className="space-y-4">
      <HookSection hook={result.hook} copied={copied} onCopy={onCopy} />
      <ContentDisplay content={result.content} copied={copied} onCopy={onCopy} />

      {/* Auto-generated post image */}
      {imageGenerating && (
        <div className="rounded-lg border bg-card p-4 flex items-center gap-3">
          <Loader2 className="h-4 w-4 animate-spin text-violet-500 shrink-0" />
          <p className="text-sm text-muted-foreground">Generating post image…</p>
        </div>
      )}
      {postImageUrl && !imageGenerating && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Post Image</span>
            <a
              href={postImageUrl}
              download="post-image.jpg"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Download className="h-3.5 w-3.5" /> Download
            </a>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={postImageUrl}
            alt="Generated post image"
            className="w-full rounded-lg object-cover"
            style={{ maxHeight: 360 }}
          />
        </div>
      )}

      {postImageUrl && !imageGenerating && scheduleCaption && (
        <ScheduleAction
          brandId={brandId}
          imageUrl={postImageUrl}
          caption={scheduleCaption.text}
          hashtags={scheduleCaption.hashtags}
        />
      )}

      {(previewHtml ?? result.postCardHtml) && (
        <PostCardPreview html={(previewHtml ?? result.postCardHtml)!} onDownload={onDownload} />
      )}
      <div className="flex justify-end">
        <Link
          href={`/brands/${brandId}/library`}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Archive className="h-3.5 w-3.5" />
          View in library →
        </Link>
      </div>
    </div>
  )
}
