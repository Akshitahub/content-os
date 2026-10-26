"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { ChevronLeft, ChevronRight, Copy, Check, Loader2, RefreshCw, Download, AlertCircle, Image, Sparkles, Move } from "lucide-react"
import { ProductPicker, type PickedProduct } from "@/components/shared/ProductPicker"
import { VibePicker, type Vibe } from "@/components/shared/VibePicker"
import { ScheduleAction } from "@/components/shared/ScheduleAction"
import { useBrand } from "@/hooks/useBrand"
import { downloadCarouselSlideAsImage, downloadCarouselSlidesAsImages, type CarouselExportSlide } from "@/lib/utils/carousel-export"
import { GenerationWarning } from "@/components/shared/GenerationWarning"
import { UsageLimitBanner } from "@/components/generate/UsageLimitBanner"
import { TopicSuggestButton } from "@/components/shared/TopicSuggestButton"
import { isApiError } from "@/types/api"
import { ApiResponseError } from "@/hooks/useGeneration"
import { useGenerationStore } from "@/stores/generationStore"
import { usePromptWriter } from "@/hooks/usePromptWriter"
import { PromptWriterField } from "@/components/generate/PromptWriterField"
import { CAROUSEL as CAROUSEL_CREDIT_COST, CAROUSEL_SLIDE_AI_BACKGROUND } from "@/lib/usage/credit-costs"
import { CAROUSEL_BG_STYLES, type CarouselBackgroundStyle } from "@/lib/design/carousel-slide-styles"
import { cssBackgroundFromColors, ColorWheelPicker } from "@/components/shared/ColorWheelPicker"
import { useDraggableText, type TextPosition } from "@/components/shared/useDraggableText"
import { resolveFonts, DEFAULT_FONT_ID, TEXT_SIZE_OPTIONS, DEFAULT_TEXT_SIZE_SCALE } from "@/lib/design/fonts"
import type { FontId } from "@/lib/design/fonts"
import { PREVIEW_FONT_CLASS } from "@/lib/design/preview-fonts"
import { runSlideBackgroundJobs, slideBackgroundErrorForStatus, type SlideBackgroundOutcome } from "@/lib/utils/slide-backgrounds"
import type { ProductRow } from "@/types/database"
import Link from "next/link"
import { readJsonResponse } from "@/lib/utils/read-json-response"

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
  /** Client-only, set alongside image_url above from the same
   * /api/v1/ai/carousel/slide-image/generate response — which provider
   * actually produced it. Used by SlidePreview to skip the redundant
   * productImage corner overlay for an "openai" background, since an OpenAI
   * image-to-image reference generation already has the real product
   * realistically placed in the scene itself (unlike "pollinations",
   * which has no image-to-image capability and still needs that
   * overlay). Same field/reasoning as Stories' StorySlide.background_image_provider. */
  background_image_provider?: "pollinations" | "openai"
  /** Set when this slide (or, from the "Custom color" Vibe option, every
   * slide in the carousel at once) uses an exact user-picked flat/gradient
   * color instead of an AI-generated image or a named background_style --
   * a genuinely different rendering path (a real CSS gradient/color, not
   * an image URL or an enum key), so it gets its own field rather than
   * overloading background_style's existing enum. 1 hex = solid, 2 = a
   * gradient (see ColorWheelPicker). Takes rendering priority over both
   * image_url and background_style wherever slides are shown. */
  custom_background_colors?: string[] | null
  /** Free-drag override for where the headline/body text block sits on
   * the slide -- confirmed live (2026-08-29, same finding as Stories):
   * text always dead-centered looks awkward against an AI-generated
   * background whose busy areas vary per generation. Absent on every
   * slide until dragged (SlidePreview then falls back to the previous
   * dead-center default, x=50/y=50). Percentages (0-100 of the full
   * slide, not pixels) so one stored position renders identically at
   * the small editor preview's size and the real captured/exported
   * image -- see components/shared/useDraggableText.ts. x/y mark the
   * block's horizontal/vertical CENTER, matching the CSS
   * `left/top + translate(-50%,-50%)` anchor SlidePreview renders it
   * with. */
  text_position_x?: number
  text_position_y?: number
  /** CTA slide only -- confirmed live (2026-08-29) as ANOTHER instance of
   * this exact "what's saved doesn't match what was generated" bug class:
   * withCtaSlideMerged/mergeCtaSlideIntoSlides (the client and server
   * copies of the same merge) only ever copied `headline` from the AI's
   * separate cta_slide object onto this slide -- `cta` (the actual
   * call-to-action line, e.g. "Follow for more tips like this") and
   * `handle` (e.g. "@brand") were silently dropped every time, on every
   * save, because CarouselSlideRich had nowhere to hold them. The
   * carousels DB row has no separate cta_slide column at all (see
   * types/database.ts) -- `slides` is the only thing ever persisted or
   * read back, so this data was permanently lost the moment a carousel
   * was first saved, not just on a later reload. Added here so the merge
   * functions have somewhere to actually put it. */
  cta?: string
  handle?: string
  /** Which curated font (lib/design/fonts.ts) renders this slide's text --
   * absent means the compositor's own DEFAULT_FONT_ID (Anton). Per-slide,
   * same as custom_background_colors above -- picking a font on one slide
   * never touches its siblings. */
  font_id?: FontId | null
  /** Uniform font-size multiplier for this slide -- absent means 1.0 (the
   * compositor's pre-existing fixed sizes). Per-slide, same convention as
   * font_id above. */
  text_size_scale?: number | null
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

// Shared by the "Save as PNG"/"Download all slides" buttons and
// ScheduleAction below — all three need the same slide data handed to the
// server-side compositor (lib/image/carousel-compositor.ts via
// lib/utils/carousel-export.ts), just for a different number of slides at
// a time. Prefers the CTA slide's own persisted cta/handle fields (see
// CarouselSlideRich.cta/.handle's own comment) over the separate ctaSlide
// prop -- both should agree once withCtaSlideMerged runs, but the slide's
// own fields are what's actually in the database, so they're the more
// trustworthy source here specifically (this function's whole job is
// producing what gets exported/persisted).
function toExportSlide(slide: CarouselSlideRich, ctaSlide: CtaSlide | undefined, productImage: string | null): CarouselExportSlide {
  return {
    type: slide.type,
    headline: slide.headline,
    subtext: slide.type === "cover" ? slide.subtext : undefined,
    points: slide.type === "content" ? slide.points : undefined,
    ctaText: slide.type === "cta" ? (slide.cta ?? ctaSlide?.cta) : undefined,
    ctaHandle: slide.type === "cta" ? (slide.handle ?? ctaSlide?.handle) : undefined,
    background_style: slide.background_style,
    image_url: slide.image_url,
    custom_background_colors: slide.custom_background_colors,
    text_position_x: slide.text_position_x,
    text_position_y: slide.text_position_y,
    productImageSource: productImage,
    font_id: slide.font_id,
    text_size_scale: slide.text_size_scale,
  }
}

// The API returns `slides` already merged with the CTA slide (see the
// generate route's own mergeCtaSlideIntoSlides) in the normal case, so
// this is usually a no-op pass-through -- kept as a defensive fallback for
// data shaped by something older (e.g. a sessionStorage-restored carousel
// generated before that server-side merge existed).
function withCtaSlideMerged(data: GeneratedCarousel): GeneratedCarousel {
  if (!data.cta_slide) return data

  const existingIndex = data.slides.findIndex((s) => s.type === "cta")
  if (existingIndex !== -1) {
    // CONFIRMED live (2026-08-29), same finding as the server-side
    // mergeCtaSlideIntoSlides: the model doesn't reliably keep the CTA
    // out of `slides` the way the prompt asks, so an existing cta-type
    // slide here might still be missing `cta`/`handle` (a model-authored
    // inline cta slide only ever follows the plain headline/points/
    // background_style shape) -- backfill from the separate cta_slide
    // object instead of treating "already present" as "already correct".
    const existing = data.slides[existingIndex]!
    if (existing.cta && existing.handle) return data
    const slides = [...data.slides]
    slides[existingIndex] = { ...existing, cta: existing.cta ?? data.cta_slide.cta, handle: existing.handle ?? data.cta_slide.handle }
    return { ...data, slides }
  }

  const ctaSlide: CarouselSlideRich = {
    slide_number: data.slides.length + 1,
    type: "cta",
    background_style: "gradient_dark",
    headline: data.cta_slide.headline,
    // See CarouselSlideRich.cta/.handle's own comment -- these used to be
    // dropped here entirely, so the database's `slides` column (the only
    // thing ever persisted or read back for a saved carousel) never had
    // the CTA's actual line/handle at all.
    cta: data.cta_slide.cta,
    handle: data.cta_slide.handle,
  }
  return { ...data, slides: [...data.slides, ctaSlide] }
}

// Deliberately doesn't send the slide's headline --
// lib/ai/carousel-slide-background.ts no longer quotes it into the image
// prompt at all (confirmed live: doing so caused the model to render the
// headline as real on-image text, which then visually duplicated the
// actual overlaid <h2> in SlidePreview).
//
// Every slide's background (hook, CTA and the middle "body" slides) goes
// through this one call and is run by lib/utils/slide-backgrounds.ts's
// runSlideBackgroundJobs (3 at a time, one automatic retry, stops once
// credits run out). Never throws: a 429 is "insufficient_credits", a 403
// (a plan without carouselCtaAiBackground asking for the CTA slide) is
// "restricted", anything else is "failed".
async function fetchSlideBackgroundResult(
  brandId: string,
  vibe: Vibe | undefined,
  role: CarouselBgRole,
  productImageUrl?: string | null,
  slideType?: SlideType,
  customPrompt?: string
): Promise<SlideBackgroundOutcome> {
  try {
    const res = await fetch("/api/v1/ai/carousel/slide-image/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Converts a null productImageUrl (no product selected) to
      // undefined so JSON.stringify omits the key entirely.
      body: JSON.stringify({ brandId, vibe, role, productImageUrl: productImageUrl ?? undefined, slideType, customPrompt: customPrompt || undefined }),
    })
    if (!res.ok) return { error: slideBackgroundErrorForStatus(res.status) }
    const json = await readJsonResponse(res) as { data?: { public_url?: string; provider?: "openai" } }
    return json.data?.public_url ? { url: json.data.public_url, provider: json.data.provider } : { error: "failed" }
  } catch {
    return { error: "failed" }
  }
}

type CarouselBgRole = "hook" | "cta" | "body"

// First slide = hook, last slide (of 2+) = CTA, everything between = body.
function carouselBgRole(index: number, count: number): CarouselBgRole {
  if (index === 0) return "hook"
  if (count > 1 && index === count - 1) return "cta"
  return "body"
}

const SLIDE_TYPE_FOR_BG_ROLE: Record<CarouselBgRole, SlideType> = { hook: "cover", cta: "cta", body: "content" }

// ─── Draggable text positioning ────────────────────────────────────────────────

// No safe-zone concept pre-existed for Carousel the way Stories has one
// (Instagram doesn't overlay carousel images the way it does Stories) --
// this is just clear of the slide-number/swipe label pinned top-right and
// the brand name pinned bottom-right (see buildSlideSvg/SlidePreview's own
// fixed corner labels), with real anti-clip margin handled dynamically by
// useDraggableText's measureRef, same as Stories.
const CAROUSEL_TEXT_BOUNDS = { minX: 15, maxX: 85, minY: 12, maxY: 85 }
const CAROUSEL_DEFAULT_TEXT_POSITION: TextPosition = { x: 50, y: 50 }

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
  onPositionCommit,
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
  /** Present only on the one interactive, full-size, on-screen preview
   * (not the thumbnail strip, not the off-screen hidden renders used for
   * bulk PNG export) -- enables the drag handle and commits a dragged
   * position back to this slide via the caller's updateSlide. The text
   * block itself is always rendered at slide.text_position_x/y (falling
   * back to dead-center) regardless of whether this is provided, so the
   * off-screen export renders still reflect a dragged position correctly
   * -- only the interactive handle itself is conditional. */
  onPositionCommit?: (position: TextPosition) => void
}) {
  const s = CAROUSEL_BG_STYLES[slide.background_style] ?? CAROUSEL_BG_STYLES.gradient_dark
  const isThumb = size === "thumb"
  const isCta = slide.type === "cta" && isLastSlide && ctaSlide
  const hasBg = !!backgroundImageUrl
  const frameRef = useRef<HTMLDivElement>(null)
  const textBlockRef = useRef<HTMLDivElement>(null)
  const storedPosition: TextPosition | null =
    slide.text_position_x !== undefined && slide.text_position_y !== undefined
      ? { x: slide.text_position_x, y: slide.text_position_y }
      : null
  const { onPointerDown: onDragHandleDown, current: textPos } = useDraggableText({
    containerRef: frameRef,
    measureRef: textBlockRef,
    position: storedPosition ?? CAROUSEL_DEFAULT_TEXT_POSITION,
    bounds: CAROUSEL_TEXT_BOUNDS,
    onCommit: (p) => onPositionCommit?.(p),
  })
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
      ref={frameRef}
      className={`relative flex flex-col overflow-hidden rounded-xl bg-cover bg-center ${PREVIEW_FONT_CLASS[slide.font_id ?? DEFAULT_FONT_ID]} ${hasBg || customBg ? "" : s.bg} ${
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

      {/* Product image — cover: right side; content: top-right badge; cta: centered top.
       * Skipped for an "openai" background: that image already has the real
       * product realistically placed in the scene itself (see
       * lib/ai/carousel-slide-background.ts's reference-image path), so
       * this corner overlay would just double it up. "pollinations" (no
       * image-to-image capability) and slides with no AI background at
       * all render this exactly as before. */}
      {productImage && !isThumb && slide.background_image_provider !== "openai" && (
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

      {/* Content -- thumb stays the old full-width, vertically-centered
          flow (a 56x80px nav thumbnail has no room for free positioning
          to matter); full size is free-drag positioned instead (see
          useDraggableText), replacing the old fixed dead-center-only
          layout. left/top are percentages of this slide card itself
          (frameRef) -- the same box html-to-image captures for
          download/schedule -- so textPos renders correctly both here and
          in the real exported PNG. */}
      <div
        ref={textBlockRef}
        className={isThumb ? "relative z-10 flex h-full flex-col justify-center p-1.5" : "absolute z-10 flex flex-col"}
        style={isThumb ? undefined : {
          left: `${textPos.x}%`,
          top: `${textPos.y}%`,
          transform: "translate(-50%, -50%)",
          width: "max-content",
          maxWidth: "calc(100% - 64px)",
          touchAction: "none",
        }}
      >
        {/* Drag handle -- separate hit target from the text (SlideEditor,
            not inline editing here, handles headline/body text changes),
            and marked data-export-ignore so it never leaks into the real
            downloaded/scheduled PNG (see download-as-image.ts's filter --
            CarouselBuilder's real export is a DOM screenshot of this
            exact element, unlike Stories' server-side compositor, so
            anything visible here that shouldn't ship has to be excluded
            explicitly). Only rendered on the one interactive full-size
            preview (onPositionCommit provided) -- thumbnails and the
            off-screen bulk-export renders don't get it, though both still
            render the text at the correct dragged position. */}
        {!isThumb && onPositionCommit && (
          <button
            type="button"
            data-export-ignore
            onPointerDown={onDragHandleDown}
            title="Drag to reposition"
            className="mb-1.5 flex h-5 w-8 shrink-0 cursor-grab items-center justify-center self-center rounded-full bg-black/40 text-white transition-colors hover:bg-black/60 active:cursor-grabbing"
          >
            <Move className="h-3 w-3" />
          </button>
        )}
        {slide.type === "cover" && (
          <>
            <h2 className={`font-extrabold leading-tight ${textColor} ${isThumb ? "text-[8px] line-clamp-2" : "text-3xl line-clamp-3"} ${productImage && !isThumb && slide.background_image_provider !== "openai" ? "max-w-[55%]" : ""}`}>
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
            <h2 className={`font-extrabold leading-tight ${textColor} ${isThumb ? "text-[8px] line-clamp-2" : "text-2xl mb-3 line-clamp-3"} ${productImage && !isThumb && slide.background_image_provider !== "openai" ? "mt-[40%]" : ""}`}>
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

        {/* Font family + text size -- same per-slide onChange({...slide, ...})
            pattern as Background above, just picking font_id/text_size_scale
            instead of a color. Pill buttons rather than a select/swatch grid
            since these are plain labeled options, not colors. The curated
            @fontsource files are only ever loaded server-side
            (lib/image/carousel-compositor.ts) -- there's no live in-browser
            preview of the actual typeface here, same as Post Maker's
            identical picker. */}
        <div>
          <label className="text-xs text-muted-foreground">Font</label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {resolveFonts().map((font) => (
              <button
                key={font.id}
                type="button"
                onClick={() => onChange({ ...slide, font_id: font.id })}
                className={`rounded-full border-2 px-2.5 py-1 text-xs font-medium transition-all ${
                  (slide.font_id ?? DEFAULT_FONT_ID) === font.id ? "border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-950/30" : "border-border hover:border-violet-300"
                }`}
              >
                {font.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs text-muted-foreground">Text size</label>
          <div className="mt-1 flex gap-1.5">
            {TEXT_SIZE_OPTIONS.map((size) => (
              <button
                key={size.scale}
                type="button"
                onClick={() => onChange({ ...slide, text_size_scale: size.scale })}
                className={`flex-1 rounded-full border-2 py-1 text-xs font-medium transition-all ${
                  (slide.text_size_scale ?? DEFAULT_TEXT_SIZE_SCALE) === size.scale ? "border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-950/30" : "border-border hover:border-violet-300"
                }`}
              >
                {size.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CarouselBuilder({ brandId }: { brandId: string }) {
  const { data: brand } = useBrand(brandId)
  const { pendingTopic, setPendingTopic, pendingProductId, setPendingProductId } = useGenerationStore()
  const STORAGE_KEY = `carousel_${brandId}`

  // Settings
  const [topic, setTopic] = useState("")
  const [slideCount, setSlideCount] = useState(7)
  // Vibe is no longer a primary picker -- the generate route's LLM is
  // effectively vibe-blind for actual carousel content (two vibes produce
  // byte-identical text), so it now picks its own vibe as part of the same
  // JSON response (suggested_vibe). Kept as state + surfaced only inside
  // the "Customize" disclosure below for anyone who wants to force one.
  const [vibe, setVibe] = useState<Vibe | undefined>()
  // Only meaningful when vibe === "custom_color" -- see VibePicker's
  // customColors prop and CarouselSlideRich.custom_background_colors.
  const [customColors, setCustomColors] = useState<string[]>([])
  const [showCustomize, setShowCustomize] = useState(false)
  // SocioPosts-authored (and possibly user-edited) visual scene prompt for
  // this carousel's hook/cta/body backgrounds -- shared across every slide
  // the same way vibe already is. See usePromptWriter and generate()'s own
  // write-then-confirm gate below.
  const [visualPrompt, setVisualPrompt] = useState("")
  const promptWriter = usePromptWriter(setVisualPrompt)
  // The user's own typed idea, captured ONCE the first time writeVisualPrompt
  // runs for this session (see writeVisualPrompt below) -- kept stable and
  // reused as rawInput on every subsequent Rewrite, instead of re-reading
  // `visualPrompt` itself, which by then holds the PREVIOUS AI-authored
  // output. Feeding that back in as "refine this" just padded/reworded the
  // same base, since the writer is instructed to refine-and-complete a
  // provided description rather than discard it.
  const visualPromptSeedRef = useRef<string | null>(null)
  // Extends the hook/CTA AI background to every content slide too. On by
  // default (a set of flat middle slides looked unfinished), but each
  // middle slide spends CAROUSEL_SLIDE_AI_BACKGROUND credits, so the
  // toggle stays visible and the extra cost is shown next to Generate.
  // Not used with custom_color ("flat color everywhere, no AI, ever").
  const [allSlidesAiBg, setAllSlidesAiBg] = useState(true)
  const [bgProgress, setBgProgress] = useState<{ settled: number; total: number } | null>(null)
  const [bodyBgWarning, setBodyBgWarning] = useState<string | null>(null)
  // Slides whose background failed twice (first try + automatic retry) --
  // shown as "N of M backgrounds failed -- Retry" so no slide is left flat
  // without an explanation. bgAttempted is M.
  const [failedBgSlides, setFailedBgSlides] = useState<number[]>([])
  const [bgAttempted, setBgAttempted] = useState(0)
  // Bumped by every generate(); a background run from an older generation
  // sees the mismatch and stops (and never writes into the new carousel).
  const bgRunRef = useRef(0)
  // Covers the WHOLE background-image step -- the always-on hook/cta
  // Promise.all AND (when allSlidesAiBg is on) the body-slide loop that
  // follows it -- so there's one continuous, hard-to-miss "still working"
  // indicator from the moment text generation finishes through the moment
  // every slide's background is actually ready. bodyBgProgress alone only
  // ever covered the opt-in body-slide loop; this fills the gap during the
  // hook/cta fetch that used to have no visible indicator at all. Never
  // set in Custom color mode (that branch of generate() skips this whole
  // async block entirely) -- explicitly reset at the top of every
  // generate() call so a stale true from an abandoned prior run can never
  // leak into a fresh one. Mirrors StorySequence.tsx's identical fix
  // exactly.
  const [imagesGenerating, setImagesGenerating] = useState(false)
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
  // Middle slides = slideCount minus the cover and CTA slides.
  const extraBgCredits =
    ((allSlidesAiBg ? Math.max(0, slideCount - 2) : 0) + (productImage ? 2 : 0)) * CAROUSEL_SLIDE_AI_BACKGROUND
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

  // Consume a product handed off from a product card's "Generate Carousel"
  // deep-link (?tab=carousel&productId=...), if any. Unlike pendingTopic
  // above, this can't key off `[]` (mount-once): GenerationPanel reads the
  // productId query param and calls setPendingProductId in its OWN effect,
  // which -- since CarouselBuilder is its child and every tab mounts
  // eagerly (see GenerationPanel's own comment) -- fires AFTER this
  // component has already mounted, not before like pendingTopic's other
  // producers (which write to the store pre-navigation). Depending on
  // pendingProductId instead lets this effect react once that write lands.
  // CarouselBuilder has no products list prop (unlike FullPostGenerator/
  // HookGenerator/ContentTypeGenerator), so the product is fetched by id
  // rather than looked up client-side.
  useEffect(() => {
    if (!pendingProductId) return
    const productId = pendingProductId
    setPendingProductId(null)
    fetch(`/api/v1/brands/${brandId}/products/${productId}`)
      .then((res) => res.json())
      .then((json: { data?: ProductRow }) => {
        if (!json.data) return
        const product = json.data
        setSelectedProduct({
          name: product.name,
          imageUrl: product.image_urls?.[0],
          description: product.description ?? undefined,
        })
      })
      .catch(() => {
        // silent -- matches this file's other best-effort fetches
      })
  }, [pendingProductId, brandId, setPendingProductId])

  function writeVisualPrompt() {
    // First write this session: capture whatever the user has typed right
    // now as the stable seed. Every later call (the Rewrite button, or this
    // same function re-firing from generate()'s gate below) reuses that
    // exact seed instead of the field's current (by-then AI-authored)
    // content -- see visualPromptSeedRef's own comment above.
    const isFirstWrite = promptWriter.stage === "idle"
    if (isFirstWrite) visualPromptSeedRef.current = visualPrompt.trim() || null

    setShowCustomize(true)
    promptWriter.write({
      flow: "carousel",
      brandId,
      product: selectedProduct ? { name: selectedProduct.name, description: selectedProduct.description } : undefined,
      rawInput: visualPromptSeedRef.current,
      isRewrite: !isFirstWrite,
      constraints: {
        styleLabel: vibe && vibe !== "custom_color" ? vibe : undefined,
        hasProductReference: !!productImage,
      },
    })
  }

  // Runs AI backgrounds for the given slide indices of carousel `carouselId`
  // (3 at a time, one automatic retry each, stops on running out of
  // credits) and writes each success onto its slide. Saved by the
  // debounced autosave effect above, like any other slide change. Returns
  // false if a newer generate() superseded this run.
  async function runCarouselBackgrounds(carouselId: string | null, count: number, indices: number[]): Promise<boolean> {
    const runId = bgRunRef.current
    const isCurrent = () => bgRunRef.current === runId
    setImagesGenerating(true)
    setBgProgress({ settled: 0, total: indices.length })
    setBgAttempted(indices.length)
    setFailedBgSlides([])
    const { succeeded, failed, outOfCredits } = await runSlideBackgroundJobs(
      indices.map((i) => {
        const role = carouselBgRole(i, count)
        // productImageUrl/slideType only actually sent when a product is
        // selected -- fetchSlideBackgroundResult drops a null productImageUrl.
        return { key: i, run: () => fetchSlideBackgroundResult(brandId, vibe, role, productImage ?? undefined, productImage ? SLIDE_TYPE_FOR_BG_ROLE[role] : undefined, visualPrompt) }
      }),
      { onProgress: (settled, total) => { if (isCurrent()) setBgProgress({ settled, total }) }, isCancelled: () => !isCurrent() }
    )
    if (!isCurrent()) return false
    setBgProgress(null)
    setImagesGenerating(false)
    setFailedBgSlides([...failed].sort((x, y) => x - y))
    if (outOfCredits.length > 0) {
      setBodyBgWarning(`Ran out of credits — ${outOfCredits.length} slide background${outOfCredits.length === 1 ? "" : "s"} weren't generated and kept their flat color.`)
    }
    if (succeeded.size > 0) {
      setCarousel((prev) => (prev && prev.id === carouselId
        ? { ...prev, slides: prev.slides.map((s, i) => { const bg = succeeded.get(i); return bg ? { ...s, image_url: bg.url, background_image_provider: bg.provider } : s }) }
        : prev))
    }
    return true
  }

  // "Retry" on the "N of M backgrounds failed" note -- regenerates only
  // those slides. Each failed attempt was refunded server-side.
  function retryFailedBackgrounds() {
    if (!carousel || failedBgSlides.length === 0 || imagesGenerating) return
    setBodyBgWarning(null)
    void runCarouselBackgrounds(carousel.id ?? null, carousel.slides.length, failedBgSlides)
  }

  async function generate() {
    if (!topic.trim()) { setError("Please enter a topic for your carousel."); return }
    // "custom_color" is a client-only rendering mode that skips AI image
    // generation entirely, so there's nothing for SocioPosts to author a
    // visual prompt for in that mode -- the write-then-confirm gate below
    // only applies otherwise. Declared before the write gate (unlike the
    // rest of this function's setup) so a real vibe's first "Generate
    // carousel" click authors the prompt and pauses for review/edit before
    // the actual text+image generation call fires below, same pattern as
    // every other image-generation flow now goes through.
    const isCustomColorMode = vibe === "custom_color"
    if (!isCustomColorMode) {
      if (promptWriter.stage === "writing") return
      if (promptWriter.stage === "idle" || !visualPrompt.trim()) {
        writeVisualPrompt()
        return
      }
    }
    const hadPrevCarousel = carousel !== null
    prevCarouselRef.current = carousel
    setLoading(true)
    setError("")
    setApiError(null)
    setShowStaleCue(false)
    setCarousel(null)
    setActiveSlide(0)
    setImagesGenerating(false)
    bgRunRef.current++
    setBgProgress(null)
    try {
      const res = await fetch("/api/v1/ai/carousel/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, topic: topic.trim(), slideCount, platform: "instagram", vibe: isCustomColorMode ? undefined : vibe }),
      })
      const json = await readJsonResponse(res) as { data?: GeneratedCarousel; error?: { code?: string; message?: string } }
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

      // Cleared first so a regenerate doesn't show the previous carousel's
      // warnings while the new backgrounds are still in flight.
      setBodyBgWarning(null)
      setFailedBgSlides([])

      if (isCustomColorMode) {
        // Custom color has no image step at all -- text+color is the whole
        // generation, so success shows immediately, same as before this
        // fix (only the AI-background branch below needed to wait longer).
        setShowSuccess(true)
        setTimeout(() => setShowSuccess(false), 4000)

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
        // Best-effort AI backgrounds, fired after text succeeds so a slow or
        // failed image call never blocks carousel generation itself. Hook
        // and CTA go first (always on), then the middle slides when "AI
        // background for every slide" is on. "✓ generated and saved"
        // waits for the whole image step.
        const count = merged.slides.length
        const indices = merged.slides.map((_, i) => i)
        const hookAndCta = indices.filter((i) => carouselBgRole(i, count) !== "body")
        const middle = allSlidesAiBg ? indices.filter((i) => carouselBgRole(i, count) === "body") : []
        void runCarouselBackgrounds(merged.id ?? null, count, [...hookAndCta, ...middle]).then((finished) => {
          if (!finished) return
          setShowSuccess(true)
          setTimeout(() => setShowSuccess(false), 4000)
        })
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

  // The slide's own image_url is the only source: runCarouselBackgrounds
  // writes each AI background straight onto its slide (and it's restored
  // from sessionStorage / a saved Library carousel on reload).
  function backgroundUrlForSlide(index: number): string | null {
    return allSlides[index]?.image_url ?? null
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

            {/* Vibe used to be a primary picker; the generate route's LLM
                ignores it for actual content, so it now picks its own vibe
                (suggested_vibe in the same JSON). This is just a manual
                override for anyone who wants to force one. */}
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => setShowCustomize((v) => !v)}
                className="text-xs font-medium text-violet-600 hover:text-violet-700"
              >
                {showCustomize ? "Hide options" : "Customize (optional)"}
              </button>
              {showCustomize && (
                <div className="space-y-3 pt-1">
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
                  {vibe && vibe !== "custom_color" && (
                    <PromptWriterField
                      label="Visual scene (optional)"
                      prompt={visualPrompt}
                      onChange={setVisualPrompt}
                      stage={promptWriter.stage}
                      error={promptWriter.error}
                      onRewrite={writeVisualPrompt}
                      placeholder="Describe the hook/CTA background scene, or leave blank and let SocioPosts write one from your topic and vibe"
                    />
                  )}
                </div>
              )}
            </div>

            {/* AI photo backgrounds for every content slide, not just the
                hook/CTA. On by default and shown whenever AI backgrounds
                run at all -- including when no vibe is picked (the model
                picks one) -- so the user can always see and switch off what
                they're paying for. Hidden only for Custom color ("flat
                color everywhere, no AI"). */}
            {vibe !== "custom_color" && (
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
            {/* Total cost before clicking: the carousel itself plus, at
                most, one background per middle slide (when the toggle is
                on) and the hook/CTA backgrounds when a product photo is
                attached (those are charged too). "Up to" because failed
                backgrounds are refunded. */}
            {vibe !== "custom_color" && extraBgCredits > 0 && (
              <p className="text-center text-xs text-muted-foreground">
                {CAROUSEL_CREDIT_COST} credits + up to {extraBgCredits} for AI slide backgrounds
              </p>
            )}
            <button
              onClick={generate}
              disabled={loading || promptWriter.stage === "writing"}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 py-3 text-sm font-semibold text-white shadow-md transition hover:from-violet-700 hover:to-indigo-700 disabled:opacity-60"
            >
              {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</> : promptWriter.stage === "writing" ? <><Loader2 className="h-4 w-4 animate-spin" /> Writing your visual prompt…</> : "✨ Generate carousel"}
            </button>

            {!!apiError && <UsageLimitBanner error={apiError} onRetry={generate} />}
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

          {/* Covers the whole background-image step -- the always-on hook/cta
              fetch (no per-item progress to show, just "in progress") and,
              once that hands off to it, the opt-in body-slide loop's own
              X-of-Y progress -- so there's continuous visible feedback with
              no gap between "text is ready" and "every slide's image is
              ready," which is also exactly when the success banner above
              now waits to appear. */}
          {imagesGenerating && (
            <div className="flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-700">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              {bgProgress && bgProgress.total > 0
                ? `Generating slide backgrounds… ${bgProgress.settled} of ${bgProgress.total} done`
                : "Generating carousel backgrounds…"}
            </div>
          )}

          {failedBgSlides.length > 0 && !imagesGenerating && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  {failedBgSlides.length} of {bgAttempted} background{bgAttempted === 1 ? "" : "s"} failed (slide{failedBgSlides.length === 1 ? "" : "s"} {failedBgSlides.map((i) => i + 1).join(", ")}) — kept the flat color. No credits were used for them.
                </span>
              </div>
              <button
                type="button"
                onClick={retryFailedBackgrounds}
                className="flex shrink-0 items-center gap-1 rounded-full border border-amber-300 bg-white px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </button>
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
                  onPositionCommit={(p) => updateSlide(activeSlide, { ...currentSlide, text_position_x: p.x, text_position_y: p.y })}
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
                  onClick={() => currentSlide && downloadCarouselSlideAsImage(brand?.name ?? "", toExportSlide(currentSlide, carousel.cta_slide, productImage), `carousel-slide-${activeSlide + 1}`)}
                  className="flex items-center gap-1.5 rounded-full border border-input px-4 py-2 text-xs font-medium hover:bg-secondary"
                >
                  <Image className="h-3.5 w-3.5" /> Save slide as PNG
                </button>
                <button
                  onClick={() => downloadCarouselSlidesAsImages(brand?.name ?? "", allSlides.map((s) => toExportSlide(s, carousel.cta_slide, productImage)), "carousel")}
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
                carouselSlides={allSlides.map((s) => toExportSlide(s, carousel.cta_slide, productImage))}
                brandName={brand?.name ?? ""}
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
