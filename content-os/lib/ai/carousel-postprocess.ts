// Post-processing every generated carousel goes through before it's saved
// -- moved out of app/api/v1/ai/carousel/generate/route.ts so Autopilot
// (lib/ai/fastlane.ts generateSlotContent) runs the exact same steps on the
// same generator's output instead of a second, drifting copy.
import type { BrandRow } from "@/types/database"
import type { CarouselBackgroundStyle } from "@/lib/design/carousel-slide-styles"
import { findContentQualityIssues, normalizeHashtags, sanitizeLeakedArtifacts } from "@/lib/ai/content-quality-check"
import { resolveTypography, type BrandTypography } from "@/lib/design/fonts"
import { stampSequenceLayouts } from "@/lib/design/text-layouts"
import { getPrimaryColor } from "@/lib/design/post-card-generator"

// Confirmed live (2026-08-28): the LLM's `background_style` choice was
// effectively vibe-blind — two generations with vibe="professional" and
// vibe="fun_playful" produced byte-for-byte identical background_style
// (and rendered CSS) for every content slide, and the prompt's own
// "BACKGROUND STYLES (rotate through these...)" instruction ties each of
// the 4 fixed options to slide role ("for cover and CTA", "for content
// slides"), never to vibe — vibe is only ever mentioned once as loose
// context ("Visual Vibe: X"). Same root cause and same fix as
// VIBE_TO_STORY_BACKGROUND in app/api/v1/ai/stories/generate/route.ts:
// background_style is now assigned deterministically in code from the
// selected vibe, overriding the LLM's own (role-based) choice on every
// slide. No-op when no vibe was selected, preserving the prior default.
export const VIBE_TO_CAROUSEL_BACKGROUND: Record<string, CarouselBackgroundStyle> = {
  fun_playful: "vibe_fun_playful",
  clean_minimal: "white_violet",
  bold_dramatic: "gradient_dark",
  warm_cozy: "vibe_warm_cozy",
  professional: "vibe_professional",
  trendy_genz: "vibe_trendy_genz",
}
// Mirrors CarouselBuilder.tsx's withCtaSlideMerged() -- the AI response's
// CTA slide is a separate `cta_slide` field, never part of `slides`, and
// until now the ONLY path that ever wrote it back to the database was the
// background-image enrichment step in CarouselBuilder.tsx (~line 421-444),
// which only PUTs the full slides array back if at least one of its two
// best-effort AI background fetches happens to succeed. If both fail
// (rate-limiting, an image-provider outage, etc.) or the user navigates away first,
// the CTA slide never reaches
// the database at all -- confirmed live as the root cause of Library
// carousels showing 6 slides instead of 7. Doing the same merge here,
// server-side, before the insert below, means the row is complete and
// correct from the moment it's created, independent of that later,
// optional, best-effort step.
// Confirmed live (2026-08-29) as its own real bug, found while tracing
// why a published carousel's CTA slide was missing its actual
// call-to-action line: this only ever copied `headline` from the AI's
// cta_slide object, silently dropping `cta` (the CTA line itself, e.g.
// "Follow for more tips like this") and `handle` (e.g. "@brand") --
// permanently, since the carousels table has no separate cta_slide
// column (see types/database.ts) and `slides` is the only thing ever
// persisted or read back. Every carousel ever saved lost this text the
// moment it was first generated, not just on a later reload. Now copies
// all three fields, mirroring CarouselBuilder.tsx's identical client-side
// withCtaSlideMerged() fix.
export function mergeCtaSlideIntoSlides(slides: unknown[], ctaSlide: unknown, realHandle?: string): unknown[] {
  if (!ctaSlide || typeof ctaSlide !== "object") return slides
  const cta = ctaSlide as { headline?: unknown; cta?: unknown; handle?: unknown; role?: unknown; visual?: unknown }
  // The model's own `handle` is never trusted over the brand's real,
  // code-known handle when one exists -- same "don't ask the LLM to echo
  // back a value the caller already has" reasoning as background_style's
  // deterministic override below. The prompt's own JSON example now shows
  // a plain "@yourhandle" placeholder (previously the real handle was
  // interpolated directly into that example, which is what a model this
  // route asks not to use placeholders inconsistently taught was actually
  // "real, expected text" rather than illustrative shape) — this override
  // makes the actual field correct regardless of which the model produced.
  const handle = realHandle ?? (typeof cta.handle === "string" ? cta.handle : undefined)
  const existingIndex = slides.findIndex((s) => s && typeof s === "object" && (s as { type?: unknown }).type === "cta")

  if (existingIndex !== -1) {
    // CONFIRMED live (2026-08-29): the model doesn't reliably stick to
    // "slides holds only cover+content, the CTA is the separate cta_slide
    // field" -- a real generation included its own type:"cta" entry
    // directly inside `slides` AS WELL AS a separate cta_slide object.
    // The old code treated any existing cta-type slide as "already
    // merged, nothing to do" and returned early -- but a model-authored
    // inline cta slide only ever follows the plain headline/points/
    // background_style shape, never `cta`/`handle` (those aren't part of
    // a regular slide's schema), so this silently persisted a CTA slide
    // with no actual call-to-action line or handle, exactly the reported
    // defect. Now backfills them from the separate cta_slide object
    // instead of skipping, without duplicating the slide.
    const existing = slides[existingIndex] as Record<string, unknown>
    if (typeof existing.cta === "string" && typeof existing.handle === "string" && realHandle === undefined) return slides
    const merged = [...slides]
    merged[existingIndex] = {
      ...existing,
      cta: typeof existing.cta === "string" ? existing.cta : (typeof cta.cta === "string" ? cta.cta : undefined),
      handle: handle ?? (typeof existing.handle === "string" ? existing.handle : undefined),
      role: typeof existing.role === "string" ? existing.role : (typeof cta.role === "string" ? cta.role : "cta"),
      visual: existing.visual ?? cta.visual,
    }
    return merged
  }

  return [
    ...slides,
    {
      slide_number: slides.length + 1,
      type: "cta",
      // The cta_slide's narrative role (narrative_plan's last arc entry).
      role: typeof cta.role === "string" ? cta.role : "cta",
      background_style: "gradient_dark",
      headline: typeof cta.headline === "string" ? cta.headline : "",
      cta: typeof cta.cta === "string" ? cta.cta : undefined,
      handle,
      visual: cta.visual,
    },
  ]
}

// Lightweight sanity pass over every real text field before it's persisted
// or returned — see lib/ai/content-quality-check.ts for what this catches
// (leaked "✓"/"✗" formatting markers, unfilled "[Placeholder]" brackets,
// raw template expressions, a stray unattached "x"). Mechanical
// fix-in-place rather than a second model call: this route doesn't have
// captions.ts's validate-and-retry infrastructure, and re-generating an
// entire 7-slide carousel over one bad word in one field would be a much
// heavier fix than the problem warrants. Logged loudly whenever it
// actually changes something, never a silent rewrite.
export function sanitizeCarouselText(value: string | undefined): string | undefined {
  if (typeof value !== "string" || !value) return value
  if (findContentQualityIssues(value).length === 0) return value
  const cleaned = sanitizeLeakedArtifacts(value)
  console.error(`[carousel-postprocess] stripped leaked artifact(s) from generated text: ${JSON.stringify(value)} -> ${JSON.stringify(cleaned)}`)
  return cleaned
}

export function sanitizeCarouselSlides(slides: unknown[]): unknown[] {
  return slides.map((slide) => {
    if (!slide || typeof slide !== "object") return slide
    const s = slide as Record<string, unknown>
    return {
      ...s,
      headline: typeof s.headline === "string" ? sanitizeCarouselText(s.headline) : s.headline,
      subtext: typeof s.subtext === "string" ? sanitizeCarouselText(s.subtext) : s.subtext,
      points: Array.isArray(s.points) ? s.points.map((p) => (typeof p === "string" ? sanitizeCarouselText(p) : p)) : s.points,
      cta: typeof s.cta === "string" ? sanitizeCarouselText(s.cta) : s.cta,
    }
  })
}

/**
 * The route's full sequence on generateCarouselWithRetry's output: CTA slide
 * merged in, vibe-derived backgrounds, the brand's typography stamped on
 * every slide, leaked artifacts stripped, then content-matched layouts.
 * Saving the typography to the brand (rememberBrandTypography) is left to
 * the caller, which has the database client.
 */
export function finishGeneratedCarousel(
  d: Record<string, unknown>,
  brand: BrandRow,
  opts: { vibe?: string; realHandle?: string },
): { slides: Record<string, unknown>[]; typography: BrandTypography; title: unknown; coverHook: unknown; hashtags: string[] } {
  let slides = mergeCtaSlideIntoSlides(d.slides as unknown[], d.cta_slide, opts.realHandle)

  // Override every slide's background_style with one deterministic,
  // vibe-derived value -- see VIBE_TO_CAROUSEL_BACKGROUND above. Applied
  // after the CTA merge so a synthesized CTA slide (which otherwise
  // always hardcodes "gradient_dark") also reflects the selected vibe. A
  // caller-supplied vibe (the Customize override) wins; otherwise the
  // model's own suggested_vibe from the same JSON response.
  const effectiveVibe = opts.vibe || (d.suggested_vibe as string | undefined)
  const vibeBackground = effectiveVibe ? VIBE_TO_CAROUSEL_BACKGROUND[effectiveVibe] : undefined
  if (vibeBackground) {
    slides = slides.map((s) => (s && typeof s === "object" ? { ...s, background_style: vibeBackground } : s))
  }

  // Brand-level typography (lib/design/fonts.ts resolveTypography): the
  // same heading/body pair for every carousel, story and post of this
  // brand -- lists make the body "dense".
  const typography = resolveTypography(brand, {
    density: slides.some((s) => s && typeof s === "object" && Array.isArray((s as { points?: unknown }).points) && ((s as { points: unknown[] }).points.length > 0)) ? "dense" : "normal",
    suggested: d.suggested_font_id,
  })
  slides = slides.map((s) => (s && typeof s === "object" ? { ...s, font_id: typography.heading, body_font_id: typography.body } : s))

  slides = sanitizeCarouselSlides(slides)
  // Content-matched text layouts (lib/design/text-layouts.ts): one family
  // per carousel, max two layouts, stamped with the kicker / highlight.
  const stamped = stampSequenceLayouts(slides as Record<string, unknown>[], {
    format: "carousel", brand, headingFont: typography.heading, accentColor: getPrimaryColor(brand), headlineKey: "headline",
    toPick: (s) => ({ role: typeof s.role === "string" ? s.role : null, slideType: s.type as "cover" | "content" | "cta", visualKind: (s.visual as { kind?: string } | undefined)?.kind ?? null }),
  })
  return {
    slides: stamped,
    typography,
    title: typeof d.title === "string" ? sanitizeCarouselText(d.title) : d.title,
    coverHook: typeof d.cover_hook === "string" ? sanitizeCarouselText(d.cover_hook) : d.cover_hook,
    hashtags: normalizeHashtags(d.hashtags),
  }
}
