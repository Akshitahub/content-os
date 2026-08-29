"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { ChevronLeft, ChevronRight, Copy, Check, Loader2, RefreshCw, Download, AlertCircle, Image, Sparkles } from "lucide-react"
import { ProductPicker, type PickedProduct } from "@/components/shared/ProductPicker"
import { VibePicker, type Vibe } from "@/components/shared/VibePicker"
import { ScheduleAction } from "@/components/shared/ScheduleAction"
import { useBrand } from "@/hooks/useBrand"
import { downloadElementAsImage, downloadMultipleAsImages } from "@/lib/utils/download-as-image"
import { GenerationWarning } from "@/components/shared/GenerationWarning"
import { getFriendlyError } from "@/lib/utils/error-messages"
import { TopicSuggestButton } from "@/components/shared/TopicSuggestButton"
import { isApiError } from "@/types/api"
import { ApiResponseError } from "@/hooks/useGeneration"
import { useGenerationStore } from "@/stores/generationStore"
import { CAROUSEL as CAROUSEL_CREDIT_COST, CAROUSEL_SLIDE_AI_BACKGROUND } from "@/lib/usage/credit-costs"
import { CAROUSEL_BG_STYLES, type CarouselBackgroundStyle } from "@/lib/design/carousel-slide-styles"
import { cssBackgroundFromColors, ColorWheelPicker } from "@/components/shared/ColorWheelPicker"
import Link from "next/link"

// ─── Types ─────────────────────────────────────────────────────────────────────

type SlideType = "cover" | "content" | "cta"
type BackgroundStyle = CarouselBackgroundStyle

interface CarouselSlideRich {
  slide_number: number
  type: SlideType
  headline: string
  subtext?: string
  title?: string
  points?: string[]
  background_style: BackgroundStyle
  /** AI-generated background, persisted here (hook/CTA slides only) once
   * fetchSlideBackground resolves — previously only ever held in the
   * hookBackgroundUrl/ctaBackgroundUrl React state below and never written
   * back to the carousels row, so a saved carousel in the Library never
   * actually had its images in the database. */
  image_url?: string | null
  /** Set when this slide (or, from the "Custom color" Vibe option, every
   * slide in the carousel at once) uses an exact user-picked flat/gradient
   * color instead of an AI-generated image or a named background_style --
   * a genuinely different rendering path (a real CSS gradient/color, not
   * an image URL or an enum key), so it gets its own field rather than
   * overloading background_style's existing enum. 1 hex = solid, 2 = a
   * gradient (see ColorWheelPicker). Takes rendering priority over both
   * image_url and background_style wherever slides are shown. */
  custom_background_colors?: string[] | null
}

interface CtaSlide {
  headline: string
  cta: string
  handle: string
}

interface GeneratedCarousel {
  /** The carousels row id this generation persisted to — null if that
   * insert failed (non-fatal, see the generate route). Needed to PUT
   * slide image URLs back once they're generated. */
  id?: string | null
  title: string
  cover_hook: string
  slides: CarouselSlideRich[]
  cta_slide?: CtaSlide
  hashtags: string[]
}

// The API returns `slides` (cover + content only, i.e. slideCount - 1 items)
// and a separate `cta_slide` object — the CTA was never part of `slides`,
// so the UI always showed one fewer slide than the user picked. Append it
// as a real slide so slide count/navigation/thumbnails all include it.
function withCtaSlideMerged(data: GeneratedCarousel): GeneratedCarousel {
  if (!data.cta_slide || data.slides.some((s) => s.type === "cta")) return data
  const ctaSlide: CarouselSlideRich = {
    slide_number: data.slides.length + 1,
    type: "cta",
    background_style: "gradient_dark",
    headline: data.cta_slide.headline,
  }
  return { ...data, slides: [...data.slides, ctaSlide] }
}

// Deliberately doesn't send the slide's headline --
// lib/ai/carousel-slide-background.ts no longer quotes it into the image
// prompt at all (confirmed live: doing so caused the model to render the
// headline as real on-image text, which then visually duplicated the
// actual overlaid <h2> in SlidePreview).
//
// "body" slides (the opt-in "AI background for every slide" mode) spend
// real credits per call, unlike hook/cta -- so unlike the old
// swallow-everything version, a caller needs to tell "ran out of
// credits, stop asking for more" apart from "this one attempt failed,
// try the next slide anyway." fetchSlideBackgroundResult keeps that
// distinction; fetchSlideBackground wraps it back down to the simpler
// null-on-any-failure shape hook/cta (which are never credit-gated) have
// always used.
type SlideBackgroundResult = { url: string } | { error: "insufficient_credits" | "failed" }

async function fetchSlideBackgroundResult(brandId: string, vibe: Vibe | undefined, role: "hook" | "cta" | "body"): Promise<SlideBackgroundResult> {
  try {
    const res = await fetch("/api/v1/ai/carousel/slide-image/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brandId, vibe, role }),
    })
    if (res.status === 429) return { error: "insufficient_credits" }
    if (!res.ok) return { error: "failed" }
    const json = await res.json() as { data?: { public_url?: string } }
    return json.data?.public_url ? { url: json.data.public_url } : { error: "failed" }
  } catch {
    return { error: "failed" }
  }
}

// Best-effort AI background fetch for the hook/CTA slides — never throws,
// and resolves to null (falls back to the existing flat vibe-color
// background) on any HTTP error, network failure, or plan restriction
// (e.g. a plan without carouselCtaAiBackground requesting the CTA slide's
// background gets a 403, handled the same as any other failure here
// rather than as a special case). Neither role is credit-gated, so the
// insufficient_credits/failed distinction never matters here.
async function fetchSlideBackground(brandId: string, vibe: Vibe | undefined, role: "hook" | "cta"): Promise<string | null> {
  const result = await fetchSlideBackgroundResult(brandId, vibe, role)
  return "url" in result ? result.url : null
}

// ─── Slide renderer ────────────────────────────────────────────────────────────

function SlidePreview({
  slide,
  ctaSlide,
  brandName,
  size = "full",
  isLastSlide,
  elementId,
  productImage,
  backgroundImageUrl,
}: {
  slide: CarouselSlideRich
  ctaSlide?: CtaSlide
  brandName: string
  size?: "full" | "thumb"
  isLastSlide?: boolean
  elementId?: string
  productImage?: string
  /** AI-generated background for the hook/CTA slides only — see
   * generateSlideBackgrounds in the main component. Falls back to the flat
   * BG_STYLES gradient below when absent (still-loading, failed, or a
   * middle slide that never gets one). */
  backgroundImageUrl?: string | null
}) {
  const s = CAROUSEL_BG_STYLES[slide.background_style] ?? CAROUSEL_BG_STYLES.gradient_dark
  const isThumb = size === "thumb"
  const isCta = slide.type === "cta" && isLastSlide && ctaSlide
  const hasBg = !!backgroundImageUrl
  // Custom color takes priority over the named background_style (but
  // never over a real AI photo, which can't happen alongside custom
  // color today anyway -- picking "Custom color" skips AI generation
  // entirely for every slide, see generate()) -- see
  // CarouselSlideRich.custom_background_colors's own comment for why this
  // is a separate field/rendering path rather than routed through
  // background_style.
  const customBg = !hasBg ? cssBackgroundFromColors(slide.custom_background_colors) : undefined
  // A photo or custom-color background's own contrast can't be predicted
  // the way the flat BG_STYLES swatches can, so text always goes
  // white-on-scrim instead of following the slide's normal light/dark
  // text pairing.
  const textColor = hasBg || customBg ? "text-white" : s.text
  const subtextColor = hasBg || customBg ? "text-white/70" : s.subtext

  return (
    <div
      id={elementId}
      className={`relative flex flex-col overflow-hidden rounded-xl bg-cover bg-center ${hasBg || customBg ? "" : s.bg} ${
        // 4:5 (1080x1350) — matches PORTRAIT_DIMENSIONS in
        // lib/ai/carousel-slide-background.ts, so the full generated
        // background is actually shown, not cropped to a square. One
        // shared className for every slide type (cover/content/cta) and
        // both AI-background and flat-color slides, so all slides in a
        // carousel stay visually uniform at the same ratio.
        isThumb ? "h-20 w-14 shrink-0" : "aspect-[4/5] w-full max-w-md"
      }`}
      style={hasBg ? { backgroundImage: `url(${backgroundImageUrl})` } : customBg ? { background: customBg } : undefined}
    >
      {/* Dark scrim so text stays readable over an AI-generated or custom
       * color/gradient background -- same treatment for both, since a
       * light custom pick (e.g. a pastel gradient) needs it just as much
       * as a photo does for the white text both use. */}
      {(hasBg || customBg) && (
        <div className="absolute inset-0 z-0 bg-gradient-to-t from-black/75 via-black/25 to-black/45" />
      )}

      {/* Product image — cover: right side; content: top-right badge; cta: centered top */}
      {productImage && !isThumb && (
        <>
          {slide.type === "cover" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={productImage}
              alt=""
              className="absolute right-4 bottom-10 z-10 object-contain drop-shadow-2xl"
              style={{ width: "42%", maxHeight: "58%" }}
            />
          )}
          {slide.type === "content" && !isCta && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={productImage}
              alt=""
              className="absolute top-3 right-3 z-10 object-contain rounded-lg"
              style={{ width: "22%", maxHeight: "22%", background: "rgba(255,255,255,0.12)", padding: 4 }}
            />
          )}
          {isCta && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={productImage}
              alt=""
              className="absolute top-6 left-1/2 z-10 -translate-x-1/2 object-contain drop-shadow-xl"
              style={{ width: "36%", maxHeight: "36%" }}
            />
          )}
        </>
      )}

      {/* Content */}
      <div className={`relative z-10 flex h-full flex-col justify-center ${isThumb ? "p-1.5" : "p-8"}`}>
        {slide.type === "cover" && (
          <>
            <h2 className={`font-extrabold leading-tight ${textColor} ${isThumb ? "text-[8px] line-clamp-2" : "text-3xl line-clamp-3"} ${productImage && !isThumb ? "max-w-[55%]" : ""}`}>
              {slide.headline}
            </h2>
            {!isThumb && slide.subtext && (
              <p className={`mt-3 text-base font-medium line-clamp-2 ${subtextColor} ${productImage ? "max-w-[55%]" : ""}`}>{slide.subtext}</p>
            )}
          </>
        )}

        {slide.type === "content" && !isCta && (
          <>
            <h3 className={`font-bold leading-snug ${textColor} ${isThumb ? "text-[7px] line-clamp-2" : "text-xl mb-4 line-clamp-2"}`}>
              {slide.headline}
            </h3>
            {!isThumb && slide.points?.map((point, i) => (
              <div key={i} className="mb-2 flex items-start gap-2">
                <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" />
                <p className={`text-sm leading-relaxed line-clamp-2 ${subtextColor}`}>{point}</p>
              </div>
            ))}
          </>
        )}

        {isCta && (
          <>
            <h2 className={`font-extrabold leading-tight ${textColor} ${isThumb ? "text-[8px] line-clamp-2" : "text-2xl mb-3 line-clamp-3"} ${productImage && !isThumb ? "mt-[40%]" : ""}`}>
              {ctaSlide.headline}
            </h2>
            {!isThumb && (
              <>
                <p className={`text-base font-medium line-clamp-2 ${subtextColor} mb-2`}>{ctaSlide.cta}</p>
                <p className={`text-sm font-bold ${textColor}`}>{ctaSlide.handle}</p>
              </>
            )}
          </>
        )}
      </div>

      {/* Brand name bottom right */}
      {!isThumb && (
        <div className={`absolute bottom-3 right-4 z-10 text-xs font-medium ${subtextColor}`}>
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
          {/* Custom color is a per-slide choice, stored on this slide's own
              custom_background_colors -- NOT broadcast to every slide the
              way picking "Custom color" at generation time is (that still
              exists as a quick starting point for the whole carousel, see
              generate()'s isCustomColorMode branch; this is what lets a
              person change one slide afterward without touching its
              siblings). Which UI shows is derived from the slide's own
              data (does it already have custom colors set?) rather than
              separate local state, so there's one source of truth. */}
          <div className="mt-0.5 flex gap-2">
            <button
              type="button"
              onClick={() => onChange({ ...slide, custom_background_colors: null })}
              className={`flex-1 rounded-md border-2 py-1.5 text-xs font-semibold transition-all ${
                !slide.custom_background_colors?.length ? "border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-950/30" : "border-border hover:border-violet-300"
              }`}
            >
              Preset
            </button>
            <button
              type="button"
              onClick={() => {
                if (slide.custom_background_colors?.length) return
                // Seeds with a real image_url cleared -- a custom color
                // pick should actually take visual effect immediately,
                // and SlidePreview's hasBg check takes priority over
                // customBg whenever both are present.
                onChange({ ...slide, custom_background_colors: ["#6366F1", "#EC4899"], image_url: null })
              }}
              className={`flex-1 rounded-md border-2 py-1.5 text-xs font-semibold transition-all ${
                slide.custom_background_colors?.length ? "border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-950/30" : "border-border hover:border-violet-300"
              }`}
            >
              Custom color
            </button>
          </div>

          {slide.custom_background_colors?.length ? (
            <div className="mt-2">
              <ColorWheelPicker
                colors={slide.custom_background_colors}
                onChange={(colors) => onChange({ ...slide, custom_background_colors: colors, image_url: null })}
              />
            </div>
          ) : (
            <select
              value={slide.background_style}
              onChange={(e) => onChange({ ...slide, background_style: e.target.value as BackgroundStyle })}
              className="mt-2 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="gradient_dark">Dark Violet</option>
              <option value="gradient_light">Light Violet</option>
              <option value="white_violet">White</option>
              <option value="dark_navy">Dark Navy</option>
            </select>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CarouselBuilder({ brandId }: { brandId: string }) {
  const { data: brand } = useBrand(brandId)
  const { pendingTopic, setPendingTopic } = useGenerationStore()
  const STORAGE_KEY = `carousel_${brandId}`

  // Settings
  const [topic, setTopic] = useState("")
  const [slideCount, setSlideCount] = useState(7)
  const [vibe, setVibe] = useState<Vibe | undefined>()
  // Only meaningful when vibe === "custom_color" -- see VibePicker's
  // customColors prop and CarouselSlideRich.custom_background_colors.
  const [customColors, setCustomColors] = useState<string[]>([])
  // Extends the hook/CTA-only AI background to every content slide too --
  // opt-in since, unlike hook/cta, each one spends real credits (see
  // CAROUSEL_SLIDE_AI_BACKGROUND). Only meaningful alongside a real vibe
  // (custom_color already means "flat color everywhere, no AI, ever" --
  // mutually exclusive with this, not layered on top of it).
  const [allSlidesAiBg, setAllSlidesAiBg] = useState(false)
  const [bodyBgProgress, setBodyBgProgress] = useState<{ current: number; total: number } | null>(null)
  const [bodyBgWarning, setBodyBgWarning] = useState<string | null>(null)
  const [selectedProduct, setSelectedProduct] = useState<PickedProduct | null>(null)
  const productImage = selectedProduct?.imageUrl ?? null

  // Generation state
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [apiError, setApiError] = useState<unknown>(null)
  const [carousel, setCarousel] = useState<GeneratedCarousel | null>(null)

  // Navigation
  const [activeSlide, setActiveSlide] = useState(0)
  const [showEditor, setShowEditor] = useState(false)

  const [showSuccess, setShowSuccess] = useState(false)
  const [showStaleCue, setShowStaleCue] = useState(false)
  const prevCarouselRef = useRef<GeneratedCarousel | null>(null)

  // Copy state
  const [copied, setCopied] = useState(false)

  // AI-generated backgrounds for the hook (all plans) and CTA (Starter+)
  // slides — filled in by generate() as a best-effort follow-up after text
  // generation succeeds. null (still loading, failed, or plan-restricted)
  // means SlidePreview falls back to the flat vibe-color background.
  const [hookBackgroundUrl, setHookBackgroundUrl] = useState<string | null>(null)
  const [ctaBackgroundUrl, setCtaBackgroundUrl] = useState<string | null>(null)

  // Autosave for slide edits made after the initial generation -- headline/
  // subtext/points/background_style (everything wired through updateSlide)
  // previously only ever updated local React state; the ONLY PUT this
  // component ever made was the one-time background-image persist below,
  // so any edit made after that (in practice, almost always -- it resolves
  // within seconds) was silently lost the moment the user navigated away.
  // lastPersistedSlidesRef tracks what the server already has (updated by
  // both this debounce effect AND the background-image PUT below) so the
  // debounce effect never re-PUTs slides that are already saved -- without
  // it, every background-image completion would also immediately trigger a
  // second, redundant autosave PUT of the identical data.
  const lastPersistedSlidesRef = useRef<string | null>(null)
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")

  const allSlides = carousel?.slides ?? []
  const currentSlide = allSlides[activeSlide]
  const isLastSlide = activeSlide === allSlides.length - 1

  // Restore from sessionStorage -- confirmed live (2026-08-29): this
  // dropped the carousel's own `id` entirely (never read from `parsed`,
  // never passed into the restored object), even though the persist
  // effect right below always writes it. A restored carousel's `id`
  // therefore silently came back undefined after any reload/tab
  // revisit, and the debounced autosave effect's very first guard
  // (`if (!carousel?.id ...) return`) means every edit made afterward
  // -- headline, points, background, the new per-slide custom color --
  // looked like it saved (no error, no different UI) but was quietly
  // never persisted. Reproduced directly: opened a real saved carousel,
  // changed a slide's color, waited well past the 1.5s debounce, and
  // confirmed via the database that nothing had been written.
  useEffect(() => {
    const saved = sessionStorage.getItem(STORAGE_KEY)
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { id?: string | null; slides?: CarouselSlideRich[]; topic?: string; title?: string; cover_hook?: string; cta_slide?: CtaSlide; hashtags?: string[] }
        if (parsed.slides && parsed.slides.length > 0) {
          setCarousel(withCtaSlideMerged({ id: parsed.id, title: parsed.title ?? "", cover_hook: parsed.cover_hook ?? "", slides: parsed.slides, cta_slide: parsed.cta_slide, hashtags: parsed.hashtags ?? [] }))
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

  // Debounced autosave for slide edits made via updateSlide (headline,
  // subtext, points, background_style) -- the only real save path for
  // ongoing edits; see lastPersistedSlidesRef's declaration above for why
  // this doesn't also double-save right when the background-image PUT
  // above completes. 1.5s after the last edit, not on every keystroke, so
  // a fast typist doesn't fire a PUT per character.
  useEffect(() => {
    if (!carousel?.id || carousel.slides.length === 0) return
    const serialized = JSON.stringify(carousel.slides)
    if (serialized === lastPersistedSlidesRef.current) return

    setAutosaveStatus("saving")
    const carouselId = carousel.id
    const timer = setTimeout(() => {
      fetch(`/api/v1/brands/${brandId}/carousels/${carouselId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slides: JSON.parse(serialized) }),
      })
        .then((res) => {
          if (!res.ok) throw new Error("Save failed")
          lastPersistedSlidesRef.current = serialized
          setAutosaveStatus("saved")
          setTimeout(() => setAutosaveStatus((s) => (s === "saved" ? "idle" : s)), 2000)
        })
        .catch(() => setAutosaveStatus("error"))
    }, 1500)
    return () => clearTimeout(timer)
  }, [carousel?.id, carousel?.slides, brandId])

  // Consume a topic handed off from another generator, if any
  useEffect(() => {
    if (pendingTopic) {
      setTopic(pendingTopic)
      setPendingTopic(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function generate() {
    if (!topic.trim()) { setError("Please enter a topic for your carousel."); return }
    const hadPrevCarousel = carousel !== null
    prevCarouselRef.current = carousel
    setLoading(true)
    setError("")
    setApiError(null)
    setShowStaleCue(false)
    setCarousel(null)
    setActiveSlide(0)
    // "custom_color" is a client-only rendering mode, never a real vibe
    // the text-generation prompt should see (it would show up as the
    // nonsensical "Visual Vibe: custom_color" line) -- omitted from the
    // request entirely in that case rather than sent literally.
    const isCustomColorMode = vibe === "custom_color"
    try {
      const res = await fetch("/api/v1/ai/carousel/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, topic: topic.trim(), slideCount, platform: "instagram", vibe: isCustomColorMode ? undefined : vibe }),
      })
      const json = await res.json() as { data?: GeneratedCarousel; error?: { code?: string; message?: string } }
      if (!res.ok || !json.data) {
        if (isApiError(json)) throw new ApiResponseError(json.error.code, json.error.message)
        throw new Error(json.error?.message ?? "Generation failed")
      }
      const merged = withCtaSlideMerged(json.data)
      setCarousel(merged)
      // Already persisted -- the generate route's own insert wrote these
      // exact slides -- so the autosave effect below doesn't immediately
      // re-PUT the same data the instant this render commits.
      lastPersistedSlidesRef.current = JSON.stringify(merged.slides)
      setActiveSlide(0)
      setShowSuccess(true)
      setTimeout(() => setShowSuccess(false), 4000)

      // Best-effort AI backgrounds for the hook and CTA slides, fired after
      // text succeeds so a slow/failed image call never blocks or breaks
      // carousel generation itself — each independently falls back to the
      // flat vibe-color slide (fetchSlideBackground resolves to null, never
      // throws). Cleared first so a regenerate doesn't show the previous
      // carousel's images while the new ones are still in flight.
      setHookBackgroundUrl(null)
      setCtaBackgroundUrl(null)
      setBodyBgProgress(null)
      setBodyBgWarning(null)
      const hookSlide = merged.slides[0]
      const ctaSlideEntry = merged.slides[merged.slides.length - 1]
      const hasCtaSlide = !!ctaSlideEntry && merged.slides.length > 1
      const bodyIndices = allSlidesAiBg
        ? merged.slides.map((_, i) => i).filter((i) => i !== 0 && !(hasCtaSlide && i === merged.slides.length - 1))
        : []

      if (isCustomColorMode) {
        // The whole point of Custom color is an instant, zero-AI-cost
        // background -- applied uniformly to every slide (hook, body, and
        // cta alike), not just hook/cta the way AI backgrounds are.
        // Deliberately does NOT update lastPersistedSlidesRef: these
        // colors were never sent to /api/v1/ai/carousel/generate (the
        // route has no idea about them), so the debounced autosave effect
        // above needs to see this as a real, unsaved change and persist
        // it on its own -- no separate PUT needed here.
        const coloredSlides = merged.slides.map((s) => ({ ...s, custom_background_colors: customColors }))
        setCarousel((prev) => (prev && prev.id === merged.id ? { ...prev, slides: coloredSlides } : prev))
      } else {
        (async () => {
          const [hookBg, ctaBg] = await Promise.all([
            hookSlide ? fetchSlideBackground(brandId, vibe, "hook") : Promise.resolve(null),
            hasCtaSlide ? fetchSlideBackground(brandId, vibe, "cta") : Promise.resolve(null),
          ])
          setHookBackgroundUrl(hookBg)
          setCtaBackgroundUrl(ctaBg)

          // Body slides are credit-metered (unlike hook/cta above), so
          // they're requested one at a time rather than all at once —
          // partly to fail fast and stop asking once credits run out
          // instead of firing a batch of doomed requests, and partly
          // because Pollinations itself only allows one in-flight request
          // per IP (confirmed live: concurrent hook+cta calls already
          // occasionally 429 each other), so real parallelism here would
          // mostly just trade one slow path for a bunch of failed ones.
          const bodyUpdates: Record<number, string> = {}
          for (let n = 0; n < bodyIndices.length; n++) {
            setBodyBgProgress({ current: n + 1, total: bodyIndices.length })
            const result = await fetchSlideBackgroundResult(brandId, vibe, "body")
            if ("url" in result) {
              bodyUpdates[bodyIndices[n]!] = result.url
            } else if (result.error === "insufficient_credits") {
              setBodyBgWarning(
                `Ran out of credits after ${n} of ${bodyIndices.length} extra slide backgrounds — the rest kept their flat color.`
              )
              break
            }
            // A plain "failed" (transient generation error) doesn't stop
            // the loop -- that one slide just keeps its flat color, same
            // best-effort fallback hook/cta already have.
          }
          setBodyBgProgress(null)

          if (!merged.id || (!hookBg && !ctaBg && Object.keys(bodyUpdates).length === 0)) return

          const slidesWithImages = merged.slides.map((s, i) => {
            if (i === 0 && hookBg) return { ...s, image_url: hookBg }
            if (i === merged.slides.length - 1 && hasCtaSlide && ctaBg) return { ...s, image_url: ctaBg }
            if (bodyUpdates[i]) return { ...s, image_url: bodyUpdates[i] }
            return s
          })
          setCarousel((prev) => (prev && prev.id === merged.id ? { ...prev, slides: slidesWithImages } : prev))
          // Same reasoning as the generation-time assignment above -- this
          // PUT is about to persist exactly this slides array, so the
          // autosave effect shouldn't treat it as an unsaved edit too.
          lastPersistedSlidesRef.current = JSON.stringify(slidesWithImages)

          fetch(`/api/v1/brands/${brandId}/carousels/${merged.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slides: slidesWithImages }),
          }).catch(() => {
            // Best-effort — the carousel itself already generated fine; a
            // failed persist here just means the Library won't show its
            // image, not a user-facing generation failure.
          })
        })()
      }
    } catch (e) {
      setApiError(e)
      if (hadPrevCarousel && prevCarouselRef.current) {
        setCarousel(prevCarouselRef.current)
        setShowStaleCue(true)
      }
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

  // Only the first (hook) and last (CTA) slides ever get an AI background —
  // everything in between keeps the flat vibe-color treatment. The slide's
  // own persisted image_url is the real source of truth (set once the
  // generate-time fetch resolves, and restored from sessionStorage/a saved
  // Library carousel on reload) -- hookBackgroundUrl/ctaBackgroundUrl are
  // only a transient in-flight cache for the brief window between
  // generation finishing and that fetch resolving. Reading state alone
  // here (the previous behavior) meant a restored carousel's real AI photo
  // silently vanished on every page reload, back to the flat color, even
  // though the photo was correctly saved.
  function backgroundUrlForSlide(index: number): string | null {
    const slide = allSlides[index]
    if (slide?.image_url) return slide.image_url
    if (index === 0) return hookBackgroundUrl
    if (index === allSlides.length - 1 && allSlides.length > 1) return ctaBackgroundUrl
    return null
  }

  function downloadAllText() {
    if (!carousel) return
    const lines: string[] = [`${carousel.title}\n${"─".repeat(40)}\n`]
    // The cta-type slide (if merged via withCtaSlideMerged) is skipped here
    // since its full headline/cta/handle is already printed from cta_slide
    // below — including it in this loop too would duplicate the headline.
    carousel.slides.filter((slide) => slide.type !== "cta").forEach((slide) => {
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
              <TopicSuggestButton
                brandId={brandId}
                contentType="carousel"
                currentInput={topic}
                onSelectTopic={(t) => { setTopic(t); setError("") }}
              />
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
              <label className="text-xs font-medium">Vibe</label>
              <VibePicker
                selected={vibe}
                onSelect={setVibe}
                compact
                customColors={customColors}
                onCustomColorsChange={setCustomColors}
              />
            </div>

            {/* Optional per-carousel upgrade: AI photo backgrounds for
                every content slide, not just the hook/CTA that already get
                one free. Only offered alongside a real vibe -- Custom
                color already means "flat color everywhere, no AI", so the
                two are mutually exclusive rather than combinable. */}
            {vibe && vibe !== "custom_color" && (
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-sm transition-colors hover:bg-secondary/40">
                <input
                  type="checkbox"
                  checked={allSlidesAiBg}
                  onChange={(e) => setAllSlidesAiBg(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-input"
                />
                <div>
                  <p className="font-medium">AI background for every slide</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Generates a real photo background for each content slide too, not just the cover and closing slide —{" "}
                    {CAROUSEL_SLIDE_AI_BACKGROUND} credits per slide, charged only for slides that actually generate one.
                  </p>
                </div>
              </label>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium">Product photo (optional)</label>
              <ProductPicker
                brandId={brandId}
                selected={selectedProduct}
                onSelect={setSelectedProduct}
                label="Select product photo (appears on each slide)"
              />
            </div>

            <GenerationWarning isPending={loading} />
            <button
              onClick={generate}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 py-3 text-sm font-semibold text-white shadow-md transition hover:from-violet-700 hover:to-indigo-700 disabled:opacity-60"
            >
              {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</> : "✨ Generate carousel"}
            </button>

            {!!apiError && (
              apiError instanceof ApiResponseError && apiError.code === "USAGE_LIMIT_EXCEEDED" ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-50 p-3 text-center space-y-0.5">
                  <p className="text-sm font-semibold text-amber-900">{apiError.message}</p>
                  <p className="text-xs text-amber-700">Upgrade your plan to keep creating.</p>
                </div>
              ) : (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-3">
                  <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm text-amber-900 font-medium">{getFriendlyError(apiError)}</p>
                    <button onClick={generate} className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-amber-700 hover:text-amber-900">
                      🔄 Try again
                    </button>
                  </div>
                </div>
              )
            )}
            {showStaleCue && carousel !== null && (
              <p className="text-xs text-amber-600">Showing your last successful result below.</p>
            )}
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

          {showSuccess && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 animate-in fade-in duration-300">
              <div className="flex items-center gap-2 text-green-700">
                <Sparkles className="h-4 w-4 shrink-0" />
                <span className="text-sm font-medium">✓ Carousel generated and saved to My Content · {CAROUSEL_CREDIT_COST} credits used</span>
              </div>
              <Link
                href={`/brands/${brandId}/library?tab=carousels`}
                className="text-xs font-medium text-green-700 underline underline-offset-2 hover:text-green-900 shrink-0"
              >
                View in My Content →
              </Link>
            </div>
          )}

          {bodyBgProgress && (
            <div className="flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-700">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              Generating slide background {bodyBgProgress.current} of {bodyBgProgress.total}…
            </div>
          )}

          {bodyBgWarning && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              {bodyBgWarning}
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
                    productImage={productImage ?? undefined}
                    backgroundImageUrl={backgroundUrlForSlide(i)}
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
                <p className="text-xs text-muted-foreground">{allSlides.length} slides · Instagram</p>
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
                  productImage={productImage ?? undefined}
                  backgroundImageUrl={backgroundUrlForSlide(activeSlide)}
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
                      backgroundImageUrl={backgroundUrlForSlide(i)}
                    />
                  </button>
                ))}
              </div>

              {/* Edit toggle */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowEditor((v) => !v)}
                  className="text-xs font-medium text-violet-600 hover:underline"
                >
                  {showEditor ? "Hide editor" : "✏️ Edit this slide"}
                </button>
                {/* Subtle, not a toast -- edits autosave 1.5s after the
                 * last change (see the debounce effect above); this just
                 * makes that trustworthy instead of silent. */}
                {autosaveStatus === "saving" && (
                  <span className="text-xs text-muted-foreground">Saving…</span>
                )}
                {autosaveStatus === "saved" && (
                  <span className="text-xs text-green-600">✓ Saved</span>
                )}
                {autosaveStatus === "error" && (
                  <span className="text-xs text-destructive">Couldn&apos;t save — check your connection</span>
                )}
              </div>

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

              <ScheduleAction
                brandId={brandId}
                slideElementIds={allSlides.map((_, i) => `carousel-slide-${i}`)}
                contentFormat="carousel"
                itemLabel="slide"
                caption={carousel.cover_hook || carousel.title}
                hashtags={carousel.hashtags}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
