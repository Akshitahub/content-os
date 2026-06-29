"use client"

import { useState, useCallback, useEffect } from "react"
import { ChevronLeft, ChevronRight, Copy, Check, Loader2, RefreshCw, Download, AlertCircle, Image } from "lucide-react"
import { VibePicker, type Vibe } from "@/components/shared/VibePicker"
import { useBrand } from "@/hooks/useBrand"
import { downloadElementAsImage, downloadMultipleAsImages } from "@/lib/utils/download-as-image"
import { GenerationWarning } from "@/components/shared/GenerationWarning"
import { getFriendlyError } from "@/lib/utils/error-messages"

// ─── Types ─────────────────────────────────────────────────────────────────────

type SlideType = "cover" | "content" | "cta"
type BackgroundStyle = "gradient_dark" | "gradient_light" | "white_violet" | "dark_navy"

interface CarouselSlideRich {
  slide_number: number
  type: SlideType
  headline: string
  subtext?: string
  title?: string
  points?: string[]
  background_style: BackgroundStyle
}

interface CtaSlide {
  headline: string
  cta: string
  handle: string
}

interface GeneratedCarousel {
  title: string
  cover_hook: string
  slides: CarouselSlideRich[]
  cta_slide?: CtaSlide
  hashtags: string[]
}

// ─── Slide background styles ───────────────────────────────────────────────────

const BG_STYLES: Record<BackgroundStyle, { bg: string; text: string; subtext: string; num: string }> = {
  gradient_dark:  { bg: "bg-gradient-to-br from-violet-900 via-purple-900 to-indigo-950", text: "text-white", subtext: "text-white/70", num: "text-white/30" },
  gradient_light: { bg: "bg-gradient-to-br from-violet-50 via-indigo-50 to-white", text: "text-gray-900", subtext: "text-gray-500", num: "text-gray-200" },
  white_violet:   { bg: "bg-white border border-violet-100", text: "text-gray-900", subtext: "text-gray-500", num: "text-violet-100" },
  dark_navy:      { bg: "bg-gradient-to-br from-gray-900 via-slate-900 to-black", text: "text-white", subtext: "text-white/60", num: "text-white/20" },
}

// ─── Slide renderer ────────────────────────────────────────────────────────────

function SlidePreview({
  slide,
  ctaSlide,
  brandName,
  size = "full",
  isLastSlide,
  elementId,
}: {
  slide: CarouselSlideRich
  ctaSlide?: CtaSlide
  brandName: string
  size?: "full" | "thumb"
  isLastSlide?: boolean
  elementId?: string
}) {
  const s = BG_STYLES[slide.background_style] ?? BG_STYLES.gradient_dark
  const isThumb = size === "thumb"
  const isCta = slide.type === "cta" && isLastSlide && ctaSlide

  return (
    <div
      id={elementId}
      className={`relative flex flex-col overflow-hidden rounded-xl ${s.bg} ${
        isThumb ? "h-20 w-14 shrink-0" : "aspect-square w-full max-w-md"
      }`}
    >
      {/* Slide number */}
      <span className={`absolute left-2 top-2 font-black ${s.num} ${isThumb ? "text-[10px]" : "text-5xl"} leading-none select-none`}>
        {String(slide.slide_number).padStart(2, "0")}
      </span>

      {/* Content */}
      <div className={`flex h-full flex-col justify-center ${isThumb ? "p-1.5" : "p-8"}`}>
        {slide.type === "cover" && (
          <>
            <h2 className={`font-extrabold leading-tight ${s.text} ${isThumb ? "text-[8px] line-clamp-2" : "text-3xl"}`}>
              {slide.headline}
            </h2>
            {!isThumb && slide.subtext && (
              <p className={`mt-3 text-base font-medium ${s.subtext}`}>{slide.subtext}</p>
            )}
          </>
        )}

        {slide.type === "content" && !isCta && (
          <>
            <h3 className={`font-bold leading-snug ${s.text} ${isThumb ? "text-[7px] line-clamp-2" : "text-xl mb-4"}`}>
              {slide.headline}
            </h3>
            {!isThumb && slide.points?.map((point, i) => (
              <div key={i} className="mb-2 flex items-start gap-2">
                <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" />
                <p className={`text-sm leading-relaxed ${s.subtext}`}>{point}</p>
              </div>
            ))}
          </>
        )}

        {isCta && (
          <>
            <h2 className={`font-extrabold leading-tight ${s.text} ${isThumb ? "text-[8px] line-clamp-2" : "text-2xl mb-3"}`}>
              {ctaSlide.headline}
            </h2>
            {!isThumb && (
              <>
                <p className={`text-base font-medium ${s.subtext} mb-2`}>{ctaSlide.cta}</p>
                <p className={`text-sm font-bold ${s.text}`}>{ctaSlide.handle}</p>
              </>
            )}
          </>
        )}
      </div>

      {/* Brand name bottom right */}
      {!isThumb && (
        <div className={`absolute bottom-3 right-4 text-xs font-medium ${s.subtext}`}>
          {brandName}
        </div>
      )}
    </div>
  )
}

// ─── Slide editor (inline text editing) ───────────────────────────────────────

function SlideEditor({
  slide,
  onChange,
}: {
  slide: CarouselSlideRich
  onChange: (updated: CarouselSlideRich) => void
}) {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Edit Slide {slide.slide_number}
      </p>
      <div className="space-y-2">
        <div>
          <label className="text-xs text-muted-foreground">Headline</label>
          <input
            value={slide.headline}
            onChange={(e) => onChange({ ...slide, headline: e.target.value })}
            className="mt-0.5 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        {slide.subtext !== undefined && (
          <div>
            <label className="text-xs text-muted-foreground">Subtext</label>
            <input
              value={slide.subtext ?? ""}
              onChange={(e) => onChange({ ...slide, subtext: e.target.value })}
              className="mt-0.5 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        )}
        {slide.points?.map((point, i) => (
          <div key={i}>
            <label className="text-xs text-muted-foreground">Bullet {i + 1}</label>
            <input
              value={point}
              onChange={(e) => {
                const newPoints = [...(slide.points ?? [])]
                newPoints[i] = e.target.value
                onChange({ ...slide, points: newPoints })
              }}
              className="mt-0.5 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        ))}
        <div>
          <label className="text-xs text-muted-foreground">Background</label>
          <select
            value={slide.background_style}
            onChange={(e) => onChange({ ...slide, background_style: e.target.value as BackgroundStyle })}
            className="mt-0.5 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="gradient_dark">Dark Violet</option>
            <option value="gradient_light">Light Violet</option>
            <option value="white_violet">White</option>
            <option value="dark_navy">Dark Navy</option>
          </select>
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CarouselBuilder({ brandId }: { brandId: string }) {
  const { data: brand } = useBrand(brandId)
  const STORAGE_KEY = `carousel_${brandId}`

  // Settings
  const [topic, setTopic] = useState("")
  const [slideCount, setSlideCount] = useState(7)
  const [platform, setPlatform] = useState<"instagram" | "linkedin">("instagram")
  const [vibe, setVibe] = useState<Vibe | undefined>()

  // Generation state
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [carousel, setCarousel] = useState<GeneratedCarousel | null>(null)

  // Navigation
  const [activeSlide, setActiveSlide] = useState(0)
  const [showEditor, setShowEditor] = useState(false)

  // Copy state
  const [copied, setCopied] = useState(false)

  const allSlides = carousel?.slides ?? []
  const currentSlide = allSlides[activeSlide]
  const isLastSlide = activeSlide === allSlides.length - 1

  // Restore from sessionStorage
  useEffect(() => {
    const saved = sessionStorage.getItem(STORAGE_KEY)
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { slides?: CarouselSlideRich[]; topic?: string; title?: string; cover_hook?: string; cta_slide?: CtaSlide; hashtags?: string[] }
        if (parsed.slides && parsed.slides.length > 0) {
          setCarousel({ title: parsed.title ?? "", cover_hook: parsed.cover_hook ?? "", slides: parsed.slides, cta_slide: parsed.cta_slide, hashtags: parsed.hashtags ?? [] })
          if (parsed.topic) setTopic(parsed.topic)
        }
      } catch {}
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId])

  // Persist to sessionStorage
  useEffect(() => {
    if (carousel && carousel.slides.length > 0) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...carousel, topic }))
    }
  }, [carousel, topic, STORAGE_KEY])

  async function generate() {
    if (!topic.trim()) { setError("Please enter a topic for your carousel."); return }
    setLoading(true)
    setError("")
    setCarousel(null)
    setActiveSlide(0)
    try {
      const res = await fetch("/api/v1/ai/carousel/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, topic: topic.trim(), slideCount, platform, vibe }),
      })
      const json = await res.json() as { data?: GeneratedCarousel; error?: { message?: string } }
      if (!res.ok || !json.data) throw new Error(json.error?.message ?? "Generation failed")
      setCarousel(json.data)
      setActiveSlide(0)
    } catch (e) {
      setError(getFriendlyError(e))
    } finally {
      setLoading(false)
    }
  }

  const updateSlide = useCallback((idx: number, updated: CarouselSlideRich) => {
    setCarousel((prev) => {
      if (!prev) return prev
      const slides = [...prev.slides]
      slides[idx] = updated
      return { ...prev, slides }
    })
  }, [])

  function copySlideText() {
    if (!currentSlide) return
    const parts = [currentSlide.headline]
    if (currentSlide.subtext) parts.push(currentSlide.subtext)
    if (currentSlide.points) parts.push(...currentSlide.points.map((p) => `• ${p}`))
    navigator.clipboard.writeText(parts.join("\n"))
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  function downloadAllText() {
    if (!carousel) return
    const lines: string[] = [`${carousel.title}\n${"─".repeat(40)}\n`]
    carousel.slides.forEach((slide) => {
      lines.push(`Slide ${slide.slide_number}: ${slide.headline}`)
      if (slide.subtext) lines.push(`  ${slide.subtext}`)
      if (slide.points) slide.points.forEach((p) => lines.push(`  • ${p}`))
      lines.push("")
    })
    if (carousel.cta_slide) {
      lines.push(`CTA: ${carousel.cta_slide.headline}`)
      lines.push(`     ${carousel.cta_slide.cta}`)
      lines.push(`     ${carousel.cta_slide.handle}`)
      lines.push("")
    }
    lines.push(`Hashtags: ${carousel.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}`)
    const blob = new Blob([lines.join("\n")], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a"); a.href = url; a.download = `${carousel.title}.txt`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-5">
        {/* ─ LEFT PANEL: Settings — full width on mobile, 2/5 on desktop ── */}
        <div className="space-y-5 lg:col-span-2">
          <div className="rounded-xl border bg-card p-5 space-y-4">
            <h3 className="text-sm font-semibold">Carousel Settings</h3>

            <div className="space-y-1.5">
              <label className="text-xs font-medium">What&apos;s your carousel about?</label>
              <textarea
                rows={3}
                value={topic}
                onChange={(e) => { setTopic(e.target.value); if (error) setError("") }}
                placeholder="e.g. 5 mistakes new entrepreneurs make&#10;or How to style a saree 5 ways&#10;or Why our product is different"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
              {error && (
                <div className="flex items-center gap-1.5 text-xs text-destructive">
                  <AlertCircle className="h-3.5 w-3.5" /> {error}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium">Number of slides</label>
              <div className="flex gap-2">
                {[5, 7, 10].map((n) => (
                  <button key={n} type="button" onClick={() => setSlideCount(n)}
                    className={`flex-1 rounded-lg border-2 py-2 text-sm font-semibold transition-all ${slideCount === n ? "border-violet-500 bg-violet-50 text-violet-700" : "border-border hover:border-violet-300"}`}>
                    {n} slides
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium">Platform</label>
              <div className="flex gap-2">
                {([["instagram", "📸 Instagram"], ["linkedin", "💼 LinkedIn"]] as const).map(([id, label]) => (
                  <button key={id} type="button" onClick={() => setPlatform(id)}
                    className={`flex-1 rounded-lg border-2 py-2 text-sm font-medium transition-all ${platform === id ? "border-violet-500 bg-violet-50 text-violet-700" : "border-border hover:border-violet-300"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium">Vibe</label>
              <VibePicker selected={vibe} onSelect={setVibe} compact />
            </div>

            <GenerationWarning isPending={loading} />
            <button
              onClick={generate}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 py-3 text-sm font-semibold text-white shadow-md transition hover:from-violet-700 hover:to-indigo-700 disabled:opacity-60"
            >
              {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</> : "✨ Generate carousel"}
            </button>
          </div>
        </div>

        {/* ─ RIGHT PANEL: Preview ─────────────────────────────── */}
        <div className="space-y-4 lg:col-span-3">
          {!carousel && !loading && (
            <div className="flex h-80 flex-col items-center justify-center rounded-xl border-2 border-dashed text-center p-8 gap-3">
              <span className="text-4xl">🎠</span>
              <p className="text-sm font-medium text-muted-foreground">Your slide preview will appear here</p>
              <p className="text-xs text-muted-foreground">Enter a topic and click Generate</p>
            </div>
          )}

          {loading && (
            <div className="flex h-80 flex-col items-center justify-center rounded-xl border bg-card gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
              <p className="text-sm font-medium">Creating your {slideCount}-slide carousel…</p>
              <p className="text-xs text-muted-foreground">This takes about 10 seconds</p>
            </div>
          )}

          {/* Hidden off-screen renders for all-slides PNG download */}
          {carousel && (
            <div aria-hidden="true" style={{ position: "fixed", left: "-9999px", top: 0, pointerEvents: "none" }}>
              {allSlides.map((slide, i) => (
                i !== activeSlide ? (
                  <SlidePreview
                    key={slide.slide_number}
                    slide={slide}
                    ctaSlide={carousel.cta_slide}
                    brandName={brand?.name ?? ""}
                    isLastSlide={i === allSlides.length - 1}
                    elementId={`carousel-slide-${i}`}
                  />
                ) : null
              ))}
            </div>
          )}

          {carousel && currentSlide && (
            <div className="space-y-4">
              {/* Title */}
              <div>
                <p className="text-sm font-semibold">{carousel.title}</p>
                <p className="text-xs text-muted-foreground">{allSlides.length} slides · {platform}</p>
              </div>

              {/* Slide navigator */}
              <div className="flex items-center justify-between gap-3">
                <button
                  onClick={() => setActiveSlide((i) => Math.max(0, i - 1))}
                  disabled={activeSlide === 0}
                  className="flex h-8 w-8 items-center justify-center rounded-full border hover:bg-secondary disabled:opacity-30"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-xs font-medium text-muted-foreground">
                  Slide {activeSlide + 1} of {allSlides.length}
                </span>
                <button
                  onClick={() => setActiveSlide((i) => Math.min(allSlides.length - 1, i + 1))}
                  disabled={activeSlide === allSlides.length - 1}
                  className="flex h-8 w-8 items-center justify-center rounded-full border hover:bg-secondary disabled:opacity-30"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              {/* Main slide preview */}
              <div className="mx-auto max-w-sm">
                <SlidePreview
                  slide={currentSlide}
                  ctaSlide={carousel.cta_slide}
                  brandName={brand?.name ?? ""}
                  isLastSlide={isLastSlide}
                  elementId={`carousel-slide-${activeSlide}`}
                />
              </div>

              {/* Thumbnail row */}
              <div className="flex gap-2 overflow-x-auto py-1">
                {allSlides.map((slide, i) => (
                  <button
                    key={slide.slide_number}
                    onClick={() => setActiveSlide(i)}
                    className={`shrink-0 overflow-hidden rounded-lg border-2 transition-all ${activeSlide === i ? "border-violet-500 ring-2 ring-violet-200" : "border-border hover:border-violet-300"}`}
                  >
                    <SlidePreview
                      slide={slide}
                      ctaSlide={carousel.cta_slide}
                      brandName={brand?.name ?? ""}
                      size="thumb"
                      isLastSlide={i === allSlides.length - 1}
                    />
                  </button>
                ))}
              </div>

              {/* Edit toggle */}
              <button
                onClick={() => setShowEditor((v) => !v)}
                className="text-xs font-medium text-violet-600 hover:underline"
              >
                {showEditor ? "Hide editor" : "✏️ Edit this slide"}
              </button>

              {showEditor && (
                <SlideEditor
                  slide={currentSlide}
                  onChange={(updated) => updateSlide(activeSlide, updated)}
                />
              )}

              {/* Hashtags */}
              {carousel.hashtags.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {carousel.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}
                </p>
              )}

              {/* Action buttons */}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => downloadElementAsImage(`carousel-slide-${activeSlide}`, `carousel-slide-${activeSlide + 1}`)}
                  className="flex items-center gap-1.5 rounded-full border border-input px-4 py-2 text-xs font-medium hover:bg-secondary"
                >
                  <Image className="h-3.5 w-3.5" /> Save slide as PNG
                </button>
                <button
                  onClick={() => downloadMultipleAsImages(allSlides.map((_, i) => `carousel-slide-${i}`), "carousel")}
                  className="flex items-center gap-1.5 rounded-full border border-input px-4 py-2 text-xs font-medium hover:bg-secondary"
                >
                  <Download className="h-3.5 w-3.5" /> Download all slides
                </button>
                <button
                  onClick={downloadAllText}
                  className="flex items-center gap-1.5 rounded-full border border-input px-4 py-2 text-xs font-medium hover:bg-secondary"
                >
                  <Download className="h-3.5 w-3.5" /> Text file
                </button>
                <button
                  onClick={copySlideText}
                  className="flex items-center gap-1.5 rounded-full border border-input px-4 py-2 text-xs font-medium hover:bg-secondary"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  Copy slide text
                </button>
                <button
                  onClick={generate}
                  disabled={loading}
                  className="flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-4 py-2 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Regenerate
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
