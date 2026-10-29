/**
 * Content-matched text layouts -- the single source of truth for how text
 * sits on an image in every format (carousel slides, story frames, posts,
 * Ad Maker variations).
 *
 * planTextLayout() turns a layout + content + fonts + text_style into
 * positioned primitives (text runs, rects, lines, dots) at the real canvas
 * size. Every renderer draws those same primitives -- the server
 * compositors as SVG (resvg), the builder previews as the same SVG in the
 * browser, FullPost's overlay export and Ad Maker as canvas calls -- and
 * wrapping is char-count based (per-font glyph ratios), so line breaks and
 * positions are identical everywhere: preview = download = scheduled image.
 *
 * Pure and client-safe. Content without a text_layout never reaches this
 * file -- it keeps each renderer's existing drawing exactly as before.
 */
import { z } from "zod"
import { DEFAULT_FONT_ID, type FontId } from "./fonts"
import { TEXT_STYLE_PALETTE, backingRgba, type TextStyle } from "./text-style"
import { wrapWords } from "./slide-text-layout"
import { sanitizeTextForCompositing } from "@/lib/image/sanitize-text-for-compositing"

export const TEXT_LAYOUT_IDS = [
  "bold_stack", "editorial", "numbered", "bottom_card", "split_panel", "quote", "minimal_caption", "offer_badge",
] as const
export type TextLayoutId = (typeof TEXT_LAYOUT_IDS)[number]
export const textLayoutIdSchema = z.enum(TEXT_LAYOUT_IDS)

export function isTextLayoutId(value: unknown): value is TextLayoutId {
  return typeof value === "string" && (TEXT_LAYOUT_IDS as readonly string[]).includes(value)
}

export const TEXT_LAYOUT_LABELS: Record<TextLayoutId, string> = {
  bold_stack: "Bold stack",
  editorial: "Editorial",
  numbered: "Numbered",
  bottom_card: "Bottom card",
  split_panel: "Split panel",
  quote: "Quote",
  minimal_caption: "Minimal caption",
  offer_badge: "Offer badge",
}

/** The layout fields stored on a slide / frame / post result / ad variation. */
export interface TextLayoutFields {
  text_layout?: TextLayoutId | null
  /** <= 4 words above the headline (optional). */
  kicker?: string | null
  /** An exact substring of the headline, drawn in the accent colour (optional). */
  highlight?: string | null
  /** "user" once picked in an editor -- the auto-pick never overrides it. */
  text_layout_source?: "auto" | "user" | null
}

export const textLayoutFieldsSchema = z.object({
  text_layout: textLayoutIdSchema.nullish(),
  kicker: z.string().max(60).nullish(),
  highlight: z.string().max(120).nullish(),
  text_layout_source: z.enum(["auto", "user"]).nullish(),
})

// ─── Copy sanitizing (model output) ─────────────────────────────────────────

/** <= 4 words, single line, no surrounding quotes; empty -> null. */
export function sanitizeKicker(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const words = raw.replace(/["“”]/g, "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean)
  if (words.length === 0) return null
  return words.slice(0, 4).join(" ")
}

/**
 * The highlight only counts when it's a real 1-4 word substring of the
 * headline (case-insensitive, same rule as checklist_highlighted_phrase);
 * returns the headline's own casing of it, otherwise null.
 */
export function sanitizeHighlight(raw: unknown, headline: string | null | undefined): string | null {
  if (typeof raw !== "string" || !headline) return null
  const phrase = raw.replace(/\s+/g, " ").trim()
  const words = phrase.split(" ").filter(Boolean)
  if (words.length === 0 || words.length > 4) return null
  const normalized = headline.replace(/\s+/g, " ")
  const at = normalized.toLowerCase().indexOf(phrase.toLowerCase())
  return at < 0 ? null : normalized.slice(at, at + phrase.length)
}

// ─── Picking a layout (deterministic) ───────────────────────────────────────

export type LayoutFormat = "carousel" | "story" | "post" | "ad"

/** The brand's default family, from its typography and vibe. */
export function brandLayoutFamily(brand: { vibe?: string | null }, headingFont: FontId): "editorial" | "bold_stack" | "bottom_card" {
  const vibe = (brand.vibe ?? "").replace(/_/g, " ").toLowerCase()
  if (/serif|elegant|editorial|professional|luxur|minimal|classic|refined/.test(vibe)) return "editorial"
  if (/bold|trendy|gen ?z|dramatic|edgy|street|loud/.test(vibe)) return "bold_stack"
  if (/playful|fun|cozy|warm|cute|friendly/.test(vibe)) return "bottom_card"
  if (headingFont === "playfair") return "editorial"
  if (headingFont === "anton") return "bold_stack"
  if (headingFont === "caveat" || headingFont === "quicksand") return "bottom_card"
  return "editorial"
}

export interface PickItem {
  /** Narrative role (carousel arc role, story frame type, "hook" / "cta"). */
  role?: string | null
  /** Carousel slide type, when there is one. */
  slideType?: "cover" | "content" | "cta" | null
  visualKind?: string | null
  /** Set once the background exists. */
  textStyle?: TextStyle | null
  /** Ads: the strategy angle. */
  angle?: string | null
}

const IS_STEP = /\bstep|how[- ]?to|process|stage|tip\b/
const IS_COMPARISON = /comparison|compare|versus|\bvs\b|before|after|myth/
const IS_QUOTE = /testimonial|quote|review/
const DETAIL_KINDS = new Set(["detail_closeup", "product_scene"])
const SPLIT_KINDS = new Set(["side_by_side", "before_after"])
const OWN_BACKING = new Set<TextLayoutId>(["bottom_card", "split_panel"])

/** One item's layout from its content, ignoring the sequence rules. */
function contentLayout(item: PickItem, family: TextLayoutId, format: LayoutFormat): TextLayoutId {
  const role = (item.role ?? "").toLowerCase()
  const isHook = role === "hook" || item.slideType === "cover"
  const isCta = role === "cta" || role === "takeaway" || item.slideType === "cta"
  let pick: TextLayoutId
  if (IS_QUOTE.test(role)) pick = "quote"
  else if (IS_STEP.test(role)) pick = "numbered"
  else if (IS_COMPARISON.test(role) || (item.visualKind && SPLIT_KINDS.has(item.visualKind))) pick = "split_panel"
  else if (isCta) pick = "bold_stack"
  else if (isHook) pick = family === "editorial" ? "editorial" : "bold_stack"
  else if (item.visualKind && DETAIL_KINDS.has(item.visualKind) && format !== "carousel") pick = family === "bottom_card" ? "bottom_card" : "minimal_caption"
  else pick = family
  // A busy background needs a layout with its own backing.
  if (item.textStyle?.needs_backing && !OWN_BACKING.has(pick)) pick = pick === "numbered" || pick === "quote" ? pick : "bottom_card"
  return pick
}

/**
 * Carousel / story: one layout family per sequence, at most two layouts.
 * The family comes from the brand; each item's content-based pick is kept
 * only if it's the family or the single most common other pick (ties go to
 * the hook/cta's bold variant); everything else falls back to the family.
 */
export function pickSequenceLayouts(
  items: PickItem[],
  brand: { vibe?: string | null },
  headingFont: FontId,
  format: "carousel" | "story",
): TextLayoutId[] {
  const family = brandLayoutFamily(brand, headingFont)
  const picks = items.map((item) => contentLayout(item, family, format))
  const counts = new Map<TextLayoutId, number>()
  picks.forEach((p, i) => {
    if (p === family) return
    const boost = p === "bold_stack" && (items[i]?.role === "hook" || items[i]?.role === "cta" || items[i]?.slideType === "cover" || items[i]?.slideType === "cta") ? 0.5 : 0
    counts.set(p, (counts.get(p) ?? 0) + 1 + boost)
  })
  const second = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  return picks.map((p) => (p === family || p === second ? p : family))
}

/** Post / ad: one layout per item. Offer badge only with a real offer. */
export function pickTextLayout(input: PickItem & {
  format: "post" | "ad"
  brand: { vibe?: string | null }
  headingFont: FontId
  offer?: string | null
  proof?: string | null
}): TextLayoutId {
  const family = brandLayoutFamily(input.brand, input.headingFont)
  if (input.format === "ad") {
    let pick: TextLayoutId
    if (input.offer) pick = "offer_badge"
    else if (input.angle === "pain_point" || input.angle === "benefit") pick = "bold_stack"
    else if (input.angle === "demonstration") pick = "bottom_card"
    else if (input.angle === "proof" && input.proof) pick = "quote"
    else pick = family
    if (input.textStyle?.needs_backing && pick !== "offer_badge" && !OWN_BACKING.has(pick)) pick = "bottom_card"
    return pick
  }
  return contentLayout(input, family, "post")
}

/** The layouts an editor offers (offer badge only where there's a real offer). */
export function availableLayouts(hasOffer: boolean): TextLayoutId[] {
  return TEXT_LAYOUT_IDS.filter((id) => id !== "offer_badge" || hasOffer)
}

// ─── Planning: layout + content -> primitives ───────────────────────────────

export interface LayoutContent {
  kicker?: string | null
  headline: string
  highlight?: string | null
  subtext?: string | null
  points?: string[] | null
  cta?: string | null
  handle?: string | null
  /** numbered: the step number shown. */
  number?: number | null
  /** offer_badge: the offer text from the facts. Null = the layout falls back to bold_stack. */
  offer?: string | null
}

export type LayoutPrim =
  | { kind: "rect"; x: number; y: number; w: number; h: number; r: number; fill: string }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; stroke: string; width: number }
  | { kind: "circle"; cx: number; cy: number; r: number; fill: string }
  | {
      kind: "text"; x: number; y: number; size: number; weight: number; font: "heading" | "body"
      anchor: "start" | "middle" | "end"; italic?: boolean; spacing?: number; runs: { text: string; color: string }[]
    }

export interface LayoutPlan {
  prims: LayoutPrim[]
  /** Text only fits past the smallest sizes -- report "text_overflow". */
  overflow: boolean
  /** Whether the renderer should still lay text_style's uniform scrim over the image. */
  fullScrim: boolean
  /** The layout actually drawn (offer_badge without an offer draws bold_stack). */
  layout: TextLayoutId
  /** Colour for small chrome outside the block (the carousel brand line). */
  chrome: string
}

export interface PlanOptions {
  layout: TextLayoutId
  width: number
  height: number
  content: LayoutContent
  fonts: { heading: FontId; body: FontId }
  textStyle?: TextStyle | null
  /** Text colours over a flat preset / custom colour background (no text_style). */
  baseColors?: { text: string; sub: string } | null
  /** Overrides the text colour (story custom_text_color). */
  textColorOverride?: string | null
  brandColor?: string | null
  scale?: number | null
  /** Where the block sits vertically (story text_position, Ad Maker textPosition). */
  position?: "top" | "center" | "bottom" | null
  /** Story safe zone in px at this canvas (top and bottom); default 6% of height. */
  safeY?: number
  /** Extra space kept clear at the bottom (e.g. the carousel brand line). */
  reserveBottom?: number
}

// Average advance of each curated face as a fraction of its font size --
// deliberately on the wide side so estimated lines never outrun the real ones.
const GLYPH_RATIO: Record<FontId, number> = { anton: 0.5, inter: 0.58, playfair: 0.57, quicksand: 0.57, caveat: 0.46 }
const UPPER_FACTOR = 1.14
const SIZE_STEPS = [1, 0.92, 0.85, 0.78, 0.72, 0.66, 0.6]

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim())
  return m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : null
}

function luminance(hex: string): number | null {
  const rgb = hexToRgb(hex)
  if (!rgb) return null
  const lin = rgb.map((c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!
}

function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** The brand colour when it reads against the backdrop (>= 3:1), else a safe default. */
function accentFor(backdropL: number, brandColor?: string | null): string {
  const brandL = brandColor ? luminance(brandColor) : null
  if (brandL != null && contrast(brandL, backdropL) >= 3) return brandColor!
  return backdropL < 0.3 ? "#FCD34D" : "#6D28D9"
}

type ElementKind = "kicker" | "rule" | "number" | "quote_mark" | "headline" | "subtext" | "points" | "cta" | "handle" | "badge"

interface ElementSpec {
  kind: ElementKind
  texts: string[]
  /** Size as a fraction of canvas width. */
  size: number
  font: "heading" | "body"
  weight: number
  maxLines: number
  leading: number
  gap: number
  upper?: boolean
  spacing?: number
  italic?: boolean
  color: "text" | "sub" | "accent"
  floor: "headline" | "body"
}

interface Fitted extends ElementSpec {
  px: number
  lines: string[][]
  height: number
}

function charsFor(widthPx: number, sizePx: number, font: FontId, upper: boolean, spacingEm: number): number {
  const per = sizePx * (GLYPH_RATIO[font] * (upper ? UPPER_FACTOR : 1) + spacingEm)
  return Math.max(4, Math.floor(widthPx / per))
}

interface Frame {
  /** Block left edge and width (px). */
  x: number
  w: number
  /** Vertical range the block must stay in (px). */
  top: number
  bottom: number
  anchor: "top" | "center" | "bottom"
  /** Target y for the anchor (px). */
  y: number
  align: "start" | "middle"
}

function fit(specs: ElementSpec[], frame: Frame, W: number, fonts: PlanOptions["fonts"], scale: number): { els: Fitted[]; height: number; overflow: boolean } {
  let last: { els: Fitted[]; height: number } | null = null
  for (const step of SIZE_STEPS) {
    let height = 0
    let fits = true
    let any = false
    const els = specs.map((spec) => {
      const base = spec.size * W * scale
      const floor = spec.floor === "headline" ? base * 0.75 : Math.min(base, (24 * W) / 1080)
      const px = Math.max(floor, Math.round(base * step))
      const font = fonts[spec.font]
      const pointIndent = spec.kind === "points" ? px * 1.1 : 0
      const badgePad = spec.kind === "badge" ? px * 1.6 : 0
      const width = frame.w - pointIndent - badgePad
      const lines = spec.kind === "rule" ? [[""]] : spec.texts.map((t) => (t.trim() ? wrapWords(spec.upper ? t.toUpperCase() : t, charsFor(width, px, font, !!spec.upper, spec.spacing ?? 0)) : []))
      if (spec.kind !== "rule" && lines.some((l) => l.length > spec.maxLines)) fits = false
      const count = spec.kind === "rule" ? 1 : lines.reduce((n, l) => n + l.length, 0)
      const itemGaps = spec.kind === "points" ? Math.max(0, lines.filter((l) => l.length).length - 1) * px * 0.35 : 0
      const elHeight = spec.kind === "rule" ? (4 * W) / 1080 : spec.kind === "badge" ? count * px * spec.leading + px * 1.1 : count * px * spec.leading + itemGaps
      const gap = any ? spec.gap * W : 0
      if (count > 0) { height += gap + elHeight; any = true }
      return { ...spec, px, lines, height: count > 0 ? elHeight : 0, gap: count > 0 ? gap / W : 0 }
    })
    if (fits && height <= frame.bottom - frame.top) return { els, height, overflow: false }
    last = { els, height }
  }
  return { ...last!, overflow: true }
}

function blockTop(frame: Frame, height: number): number {
  const raw = frame.anchor === "top" ? frame.y : frame.anchor === "bottom" ? frame.y - height : frame.y - height / 2
  if (height >= frame.bottom - frame.top) return frame.top
  return Math.min(frame.bottom - height, Math.max(frame.top, raw))
}

/** Split one wrapped line into colour runs for the highlight phrase. */
function runsFor(line: string, lineStart: number, hl: { start: number; end: number } | null, color: string, accent: string): { text: string; color: string }[] {
  if (!hl) return [{ text: line, color }]
  const a = Math.max(0, hl.start - lineStart)
  const b = Math.min(line.length, hl.end - lineStart)
  if (b <= 0 || a >= line.length || a >= b) return [{ text: line, color }]
  return [
    { text: line.slice(0, a), color },
    { text: line.slice(a, b), color: accent },
    { text: line.slice(b), color },
  ].filter((r) => r.text.length > 0)
}

const W_RATIO = (opts: PlanOptions) => opts.width / opts.height

/** Element sizes per layout (fractions of width) -- per-canvas tweaks applied below. */
function elementSpecs(layout: TextLayoutId, c: LayoutContent, isSquare: boolean): ElementSpec[] {
  const head = (size: number, extra: Partial<ElementSpec> = {}): ElementSpec => ({
    kind: "headline", texts: [c.headline], size, font: "heading", weight: 800, maxLines: 5, leading: 1.08, gap: 0.022, color: "text", floor: "headline", ...extra,
  })
  const kicker: ElementSpec = { kind: "kicker", texts: [c.kicker ?? ""], size: 0.027, font: "body", weight: 700, maxLines: 1, leading: 1.2, gap: 0.016, upper: true, spacing: 0.16, color: "accent", floor: "body" }
  const sub = (size = 0.035): ElementSpec => ({ kind: "subtext", texts: [c.subtext ?? ""], size, font: "body", weight: 500, maxLines: 4, leading: 1.35, gap: 0.026, color: "sub", floor: "body" })
  const points = (size = 0.031): ElementSpec => ({ kind: "points", texts: c.points ?? [], size, font: "body", weight: 400, maxLines: 3, leading: 1.35, gap: 0.03, color: "sub", floor: "body" })
  const cta = (size = 0.035): ElementSpec => ({ kind: "cta", texts: [c.cta ?? ""], size, font: "body", weight: 600, maxLines: 2, leading: 1.3, gap: 0.026, color: "sub", floor: "body" })
  const handle = (size = 0.03): ElementSpec => ({ kind: "handle", texts: [c.handle ?? ""], size, font: "body", weight: 700, maxLines: 1, leading: 1.3, gap: 0.016, color: "text", floor: "body" })
  const sq = isSquare ? 0.9 : 1

  switch (layout) {
    case "bold_stack":
      return [kicker, head(0.1 * sq, { leading: 1.0, spacing: -0.01, weight: 900 }), sub(), points(), cta(), handle()]
    case "editorial":
      return [kicker, { kind: "rule", texts: [], size: 0.02, font: "body", weight: 400, maxLines: 1, leading: 1, gap: 0.018, color: "accent", floor: "body" },
        head(0.07 * sq, { gap: 0.024, leading: 1.12, weight: 700 }), sub(0.033), points(0.03), cta(0.032), handle(0.028)]
    case "numbered":
      return [{ kind: "number", texts: [String(c.number ?? 1).padStart(2, "0")], size: 0.18 * sq, font: "heading", weight: 900, maxLines: 1, leading: 0.95, gap: 0, color: "accent", floor: "headline" },
        kicker, head(0.064 * sq, { gap: 0.016 }), sub(0.033), points(0.03), cta(0.032), handle(0.028)]
    case "bottom_card":
    case "split_panel":
      return [kicker, head((layout === "split_panel" ? 0.056 : 0.06) * sq, { gap: 0.014, leading: 1.12, weight: 800 }), sub(0.031), points(0.029), cta(0.031), handle(0.027)]
    case "quote":
      return [{ kind: "quote_mark", texts: ["“"], size: 0.22, font: "heading", weight: 900, maxLines: 1, leading: 0.62, gap: 0, color: "accent", floor: "headline" },
        head(0.056 * sq, { font: "body", italic: true, weight: 500, leading: 1.25, gap: 0.01 }),
        { kind: "subtext", texts: [c.subtext ?? ""], size: 0.026, font: "body", weight: 700, maxLines: 2, leading: 1.3, gap: 0.03, upper: true, spacing: 0.14, color: "sub", floor: "body" },
        points(0.029), cta(0.031), handle(0.027)]
    case "minimal_caption":
      return [{ ...kicker, size: 0.024 }, head(0.046, { gap: 0.012, leading: 1.15, weight: 700, maxLines: 4 }), sub(0.029), points(0.027), cta(0.029), handle(0.025)]
    case "offer_badge":
      return [{ kind: "badge", texts: [c.offer ?? ""], size: 0.034, font: "body", weight: 800, maxLines: 2, leading: 1.2, gap: 0, upper: true, spacing: 0.06, color: "accent", floor: "body" },
        kicker, head(0.092 * sq, { gap: 0.03, leading: 1.02, weight: 900 }), sub(), cta(), handle()]
  }
}

/** Where each layout's block goes on this canvas. */
function frameFor(layout: TextLayoutId, opts: PlanOptions): Frame {
  const W = opts.width
  const H = opts.height
  const mx = W * 0.08
  const safeY = opts.safeY ?? H * 0.06
  const top = safeY
  const bottom = H - safeY - (opts.reserveBottom ?? 0)
  const tall = H / W > 1.5
  const pos = opts.position ?? null
  const posFrame = (fallback: Frame["anchor"], fallbackY: number): Pick<Frame, "anchor" | "y"> =>
    pos === "top" ? { anchor: "top", y: top + H * 0.03 } : pos === "bottom" ? { anchor: "bottom", y: bottom - H * 0.02 } : pos === "center" ? { anchor: "center", y: H / 2 } : { anchor: fallback, y: fallbackY }

  switch (layout) {
    case "editorial":
      return { x: W * 0.1, w: W * (tall ? 0.8 : 0.74), top, bottom, align: "start", ...posFrame("center", H * 0.56) }
    case "numbered":
      return { x: W * 0.1, w: W * 0.78, top, bottom, align: "start", ...posFrame("center", H * 0.5) }
    case "minimal_caption":
      return { x: mx, w: W * (tall ? 0.74 : 0.62), top, bottom, align: "start", ...posFrame("bottom", bottom - H * 0.01) }
    case "bottom_card": {
      const pad = W * 0.06
      return { x: mx + pad, w: W - 2 * mx - 2 * pad, top: top + pad, bottom: bottom - pad, align: "start", ...(pos === "top" ? { anchor: "top" as const, y: top + pad } : pos === "center" ? { anchor: "center" as const, y: H / 2 } : { anchor: "bottom" as const, y: bottom - pad }) }
    }
    case "split_panel":
      if (tall) {
        const panelTop = H * 0.6
        return { x: mx, w: W - 2 * mx, top: panelTop + H * 0.04, bottom, align: "start", anchor: "center", y: (panelTop + H * 0.04 + bottom) / 2 }
      }
      return { x: W * 0.07, w: W * 0.46 - W * 0.13, top: top + H * 0.02, bottom: bottom - H * 0.02, align: "start", anchor: "center", y: H / 2 }
    case "quote":
    case "bold_stack":
    case "offer_badge":
    default:
      return { x: mx, w: W - 2 * mx, top, bottom, align: "middle", ...posFrame("center", H * 0.5) }
  }
}

/** Every string through the compositing sanitizer (fonts are Latin subsets) -- here, so all renderers wrap the same text. */
function sanitizeContent(c: LayoutContent): LayoutContent {
  const clean = (t: string | null | undefined) => (t ? sanitizeTextForCompositing(t) : t ?? null)
  return {
    ...c,
    kicker: clean(c.kicker), headline: sanitizeTextForCompositing(c.headline), highlight: clean(c.highlight),
    subtext: clean(c.subtext), points: c.points?.map((p) => sanitizeTextForCompositing(p)) ?? null,
    cta: clean(c.cta), handle: clean(c.handle), offer: clean(c.offer),
  }
}

export function planTextLayout(rawOpts: PlanOptions): LayoutPlan {
  const opts = { ...rawOpts, content: sanitizeContent(rawOpts.content) }
  // An offer badge needs a real offer; without one it is the bold stack.
  const layout: TextLayoutId = opts.layout === "offer_badge" && !opts.content.offer?.trim() ? "bold_stack" : opts.layout
  const W = opts.width
  const H = opts.height
  const scale = opts.scale ?? 1
  const frame = frameFor(layout, opts)
  const specs = elementSpecs(layout, opts.content, Math.abs(W_RATIO(opts) - 1) < 0.05)
  const { els, height, overflow } = fit(specs, frame, W, opts.fonts, scale)
  const top = blockTop(frame, height)
  const prims: LayoutPrim[] = []

  // ── Colours: card/panel layouts carry their own backing; the rest follow text_style.
  const style = opts.textStyle ?? null
  let textColor: string
  let subColor: string
  let backdropL: number
  let fullScrim = true
  if (layout === "bottom_card") {
    const lightCard = style?.text_color === "dark" || (!style && !!opts.baseColors && (luminance(opts.baseColors.text) ?? 1) < 0.2)
    textColor = lightCard ? "#111827" : "#ffffff"
    subColor = lightCard ? "rgba(17,24,39,0.82)" : "rgba(255,255,255,0.86)"
    backdropL = lightCard ? 0.9 : 0.02
    fullScrim = false
    const pad = W * 0.06
    prims.push({ kind: "rect", x: frame.x - pad, y: top - pad, w: frame.w + 2 * pad, h: height + 2 * pad, r: W * 0.035, fill: lightCard ? "rgba(255,255,255,0.92)" : "rgba(17,17,17,0.82)" })
  } else if (layout === "split_panel") {
    const panel = opts.brandColor && hexToRgb(opts.brandColor) ? opts.brandColor : "#1F2937"
    backdropL = luminance(panel) ?? 0.02
    const darkText = backdropL > 0.4
    textColor = darkText ? "#111827" : "#ffffff"
    subColor = darkText ? "rgba(17,24,39,0.82)" : "rgba(255,255,255,0.86)"
    fullScrim = false
    if (H / W > 1.5) prims.push({ kind: "rect", x: 0, y: H * 0.6, w: W, h: H * 0.4, r: 0, fill: panel })
    else prims.push({ kind: "rect", x: 0, y: 0, w: W * 0.46, h: H, r: 0, fill: panel })
  } else {
    const palette = style ? TEXT_STYLE_PALETTE[style.text_color] : null
    textColor = palette?.text ?? opts.baseColors?.text ?? "#ffffff"
    subColor = palette?.sub ?? opts.baseColors?.sub ?? "rgba(255,255,255,0.85)"
    backdropL = (luminance(textColor) ?? 1) > 0.5 ? 0.03 : 0.9
    if (style?.needs_backing) {
      const pad = W * 0.045
      const widest = frame.align === "middle"
        ? Math.min(frame.w, Math.max(...els.flatMap((e) => e.lines.flat().map((l) => l.length * e.px * GLYPH_RATIO[opts.fonts[e.font]] * (e.upper ? UPPER_FACTOR : 1)))))
        : frame.w
      const x = frame.align === "middle" ? frame.x + frame.w / 2 - widest / 2 : frame.x
      prims.push({ kind: "rect", x: x - pad, y: top - pad, w: widest + 2 * pad, h: height + 2 * pad, r: W * 0.03, fill: backingRgba(style) })
      backdropL = style.text_color === "light" ? 0.03 : 0.9
    }
  }
  if (opts.textColorOverride) { textColor = opts.textColorOverride; subColor = opts.textColorOverride }
  const accent = layout === "split_panel"
    ? (contrast(luminance("#FCD34D")!, backdropL) >= 3 ? "#FCD34D" : contrast(luminance("#6D28D9")!, backdropL) >= 3 ? "#6D28D9" : textColor)
    : accentFor(backdropL, opts.brandColor)
  const colorOf = (c: ElementSpec["color"]) => (c === "accent" ? accent : c === "sub" ? subColor : textColor)

  // ── Highlight range inside the (whitespace-normalized) headline.
  const headlineNorm = opts.content.headline.replace(/\s+/g, " ").trim()
  const hlText = opts.content.highlight ? sanitizeHighlight(opts.content.highlight, headlineNorm) : null
  const hlAt = hlText ? headlineNorm.toLowerCase().indexOf(hlText.toLowerCase()) : -1
  const hl = hlAt >= 0 ? { start: hlAt, end: hlAt + hlText!.length } : null

  const x = frame.align === "middle" ? frame.x + frame.w / 2 : frame.x
  let cursor = top
  for (const el of els) {
    if (el.height === 0) continue
    cursor += el.gap * W
    if (el.kind === "rule") {
      prims.push({ kind: "line", x1: frame.align === "middle" ? x - W * 0.06 : x, y1: cursor + el.height / 2, x2: frame.align === "middle" ? x + W * 0.06 : x + W * 0.12, y2: cursor + el.height / 2, stroke: accent, width: el.height })
      cursor += el.height
      continue
    }
    const lineH = el.px * el.leading
    const base = (i: number) => cursor + i * lineH + el.px * (el.kind === "quote_mark" ? 0.78 : 0.82)
    if (el.kind === "badge") {
      const lines = el.lines.flat()
      const textW = Math.max(...lines.map((l) => l.length * el.px * (GLYPH_RATIO[opts.fonts.body] * UPPER_FACTOR + (el.spacing ?? 0))))
      const padX = el.px * 0.8
      const bw = textW + padX * 2
      const bh = el.height
      const bx = frame.align === "middle" ? x - bw / 2 : x
      const pillL = luminance(accent) ?? 0.5
      prims.push({ kind: "rect", x: bx, y: cursor, w: bw, h: bh, r: bh / 2, fill: accent })
      const pillText = pillL > 0.4 ? "#111827" : "#ffffff"
      lines.forEach((l, i) => prims.push({ kind: "text", x: frame.align === "middle" ? x : bx + padX, y: cursor + el.px * 0.55 + i * lineH + el.px * 0.82, size: el.px, weight: el.weight, font: el.font, anchor: frame.align, spacing: (el.spacing ?? 0) * el.px, runs: [{ text: l, color: pillText }] }))
      cursor += el.height
      continue
    }
    if (el.kind === "points") {
      // Left-aligned list, one dot per point on its first line (a wrapped
      // point continues under its own text, not as a second bullet).
      let y = cursor
      el.lines.filter((lines) => lines.length).forEach((lines, item) => {
        if (item > 0) y += el.px * 0.35
        lines.forEach((l, li) => {
          const baseline = y + el.px * 0.82
          if (li === 0) prims.push({ kind: "circle", cx: frame.x + el.px * 0.3, cy: baseline - el.px * 0.33, r: Math.max(3, el.px * 0.16), fill: accent })
          prims.push({ kind: "text", x: frame.x + el.px * 1.1, y: baseline, size: el.px, weight: el.weight, font: el.font, anchor: "start", runs: [{ text: l, color: colorOf(el.color) }] })
          y += lineH
        })
      })
      cursor += el.height
      continue
    }
    // Plain text elements (kicker, number, quote mark, headline, subtext, cta, handle).
    let offset = 0
    el.lines.flat().forEach((l, i) => {
      const runs = el.kind === "headline"
        ? runsFor(l, offset, hl, colorOf(el.color), accent)
        : [{ text: l, color: colorOf(el.color) }]
      offset += l.length + 1
      prims.push({ kind: "text", x, y: base(i), size: el.px, weight: el.weight, font: el.font, anchor: frame.align, italic: el.italic, spacing: el.spacing ? el.spacing * el.px : undefined, runs })
    })
    cursor += el.height
  }

  const chrome = fullScrim ? subColor : style ? TEXT_STYLE_PALETTE[style.text_color].sub : "rgba(255,255,255,0.85)"
  return { prims, overflow, fullScrim, layout, chrome }
}

/** The fields a layout plan needs from a stored item, normalized. */
export function layoutContentFrom(fields: TextLayoutFields & { headline: string }, rest: Omit<LayoutContent, "headline" | "kicker" | "highlight">): LayoutContent {
  return { ...rest, headline: fields.headline, kicker: fields.kicker ?? null, highlight: fields.highlight ?? null }
}

// ─── Shared per-format mapping (server compositors and previews alike) ─────

/** Text colours of the flat background presets (mirrors the compositors' preset maps). */
export const CAROUSEL_PRESET_TEXT: Record<string, { text: string; sub: string }> = {
  gradient_dark: { text: "#ffffff", sub: "rgba(255,255,255,0.7)" },
  gradient_light: { text: "#111827", sub: "#6b7280" },
  white_violet: { text: "#111827", sub: "#6b7280" },
  dark_navy: { text: "#ffffff", sub: "rgba(255,255,255,0.6)" },
  vibe_fun_playful: { text: "#ffffff", sub: "rgba(255,255,255,0.7)" },
  vibe_warm_cozy: { text: "#ffffff", sub: "rgba(255,255,255,0.7)" },
  vibe_professional: { text: "#ffffff", sub: "rgba(255,255,255,0.7)" },
  vibe_trendy_genz: { text: "#ffffff", sub: "rgba(255,255,255,0.8)" },
}

export const STORY_PRESET_TEXT: Record<string, { text: string; sub: string }> = {
  gradient_violet: { text: "#ffffff", sub: "rgba(255,255,255,0.7)" },
  gradient_pink: { text: "#ffffff", sub: "rgba(255,255,255,0.7)" },
  gradient_dark: { text: "#ffffff", sub: "rgba(255,255,255,0.6)" },
  gradient_warm: { text: "#ffffff", sub: "rgba(255,255,255,0.7)" },
  white: { text: "#111827", sub: "#6b7280" },
  vibe_fun_playful: { text: "#ffffff", sub: "rgba(255,255,255,0.7)" },
  vibe_professional: { text: "#ffffff", sub: "rgba(255,255,255,0.7)" },
  vibe_trendy_genz: { text: "#ffffff", sub: "rgba(255,255,255,0.8)" },
  checklist_cream: { text: "#1A1A1A", sub: "#57534E" },
}

const WHITE_ON_SCRIM = { text: "#ffffff", sub: "rgba(255,255,255,0.7)" }

/** A photo / custom colour gets white-on-scrim; a named preset its own pairing. */
export function presetBaseColors(map: Record<string, { text: string; sub: string }>, preset: string | null | undefined, onPhotoOrCustom: boolean, fallbackPreset: string) {
  return onPhotoOrCustom ? WHITE_ON_SCRIM : map[preset ?? ""] ?? map[fallbackPreset]!
}

/** 1-based number of each content slide (null for cover/cta) -- the numbered layout's step. */
export function carouselStepNumbers(slides: { type: string }[]): (number | null)[] {
  let n = 0
  return slides.map((s) => (s.type === "content" ? ++n : null))
}

/** 1-based number of each reveal/buildup frame (null for hook/cta). */
export function storyStepNumbers(frames: { type: string }[]): (number | null)[] {
  let n = 0
  return frames.map((f) => (f.type === "reveal" || f.type === "buildup" ? ++n : null))
}

export function carouselLayoutContent(s: {
  type: "cover" | "content" | "cta"; headline: string; subtext?: string | null; points?: string[] | null
  ctaText?: string | null; ctaHandle?: string | null; kicker?: string | null; highlight?: string | null
}, number: number | null): LayoutContent {
  return {
    kicker: s.kicker ?? null,
    headline: s.headline,
    highlight: s.highlight ?? null,
    subtext: s.type === "cover" ? s.subtext ?? null : null,
    points: s.type === "content" ? s.points ?? null : null,
    cta: s.type === "cta" ? s.ctaText ?? null : null,
    handle: s.type === "cta" ? s.ctaHandle ?? null : null,
    number,
  }
}

export function storyLayoutContent(s: {
  text: string; subtext?: string | null; has_poll?: boolean; poll_options?: string[] | null; kicker?: string | null; highlight?: string | null
}, number: number | null): LayoutContent {
  return {
    kicker: s.kicker ?? null,
    headline: s.text,
    highlight: s.highlight ?? null,
    subtext: s.subtext ?? null,
    cta: s.has_poll && s.poll_options?.length ? s.poll_options.join("  ·  ") : null,
    number,
  }
}

/** Server-side family names for the SVG renderer (resvg loads these faces). */
export function svgFamilies(names: Record<FontId, string>, fonts: { heading: FontId; body: FontId }): { heading: string; body: string } {
  return { heading: `'${names[fonts.heading]}', sans-serif`, body: `'${names[fonts.body]}', sans-serif` }
}

/** Canvas size of the 1080-wide layout canvas for a format. */
export const LAYOUT_CANVAS = {
  carousel: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
} as const

/** The carousel slide fields a layout plan reads (the compositor's CarouselCompositeSlide and the builder's export slide both fit). */
export interface CarouselLayoutSlide extends TextLayoutFields {
  type: "cover" | "content" | "cta"
  headline: string
  subtext?: string | null
  points?: string[] | null
  ctaText?: string | null
  ctaHandle?: string | null
  background_style?: string | null
  custom_background_colors?: string[] | null
  font_id?: FontId | null
  body_font_id?: FontId | null
  text_size_scale?: number | null
  text_style?: TextStyle | null
  accent_color?: string | null
}

/** The plan a layout slide renders from -- carousel compositor and CarouselBuilder's preview alike. */
export function carouselSlidePlan(slide: CarouselLayoutSlide, stepNumber: number | null, hasPhoto: boolean): LayoutPlan {
  const heading = slide.font_id ?? DEFAULT_FONT_ID
  return planTextLayout({
    layout: slide.text_layout!,
    ...LAYOUT_CANVAS.carousel,
    content: carouselLayoutContent(slide, stepNumber),
    fonts: { heading, body: slide.body_font_id ?? heading },
    textStyle: hasPhoto ? slide.text_style ?? null : null,
    baseColors: presetBaseColors(CAROUSEL_PRESET_TEXT, slide.background_style, hasPhoto || !!slide.custom_background_colors?.filter(Boolean).length, "gradient_dark"),
    brandColor: slide.accent_color ?? null,
    scale: slide.text_size_scale ?? 1,
    // Clear of the brand line on the bottom safe edge.
    reserveBottom: 50,
  })
}

/** The story frame fields a layout plan reads. */
export interface StoryLayoutFrame extends TextLayoutFields {
  text: string
  subtext?: string | null
  background?: string | null
  text_position?: "top" | "center" | "bottom" | null
  has_poll?: boolean
  poll_options?: string[] | null
  custom_background_colors?: string[] | null
  custom_text_color?: string | null
  font_id?: FontId | null
  body_font_id?: FontId | null
  text_size_scale?: number | null
  text_style?: TextStyle | null
  accent_color?: string | null
}

/** The plan a layout frame renders from -- story compositor and StorySequence's preview alike. */
export function storyFramePlan(frame: StoryLayoutFrame, stepNumber: number | null, hasPhoto: boolean): LayoutPlan {
  const heading = frame.font_id ?? DEFAULT_FONT_ID
  return planTextLayout({
    layout: frame.text_layout!,
    ...LAYOUT_CANVAS.story,
    content: storyLayoutContent(frame, stepNumber),
    fonts: { heading, body: frame.body_font_id ?? heading },
    textStyle: hasPhoto ? frame.text_style ?? null : null,
    baseColors: presetBaseColors(STORY_PRESET_TEXT, frame.background, hasPhoto || !!frame.custom_background_colors?.filter(Boolean).length, "gradient_violet"),
    textColorOverride: frame.custom_text_color ?? null,
    brandColor: frame.accent_color ?? null,
    scale: frame.text_size_scale ?? 1,
    position: frame.text_position ?? null,
    // Instagram's own top/bottom chrome (story-compositor's SAFE_ZONE).
    safeY: 250,
  })
}

/** One post / ad image's layout input (the overlay headline plus its fields). */
export interface SingleLayoutInput extends TextLayoutFields {
  headline: string
  subtext?: string | null
  handle?: string | null
  offer?: string | null
  fonts: { heading: FontId; body: FontId }
  textStyle?: TextStyle | null
  brandColor?: string | null
  position?: "top" | "center" | "bottom" | null
  scale?: number | null
  /** Space kept clear at the bottom (Ad Maker's handle line). */
  reserveBottom?: number
  /** An explicit text colour pick (Ad Maker White / Dark / Violet). */
  textColorOverride?: string | null
}

/** The plan for a post overlay or an ad variation at its real canvas size. */
export function singleImagePlan(input: SingleLayoutInput, width: number, height: number): LayoutPlan {
  return planTextLayout({
    layout: input.text_layout!,
    width,
    height,
    content: { headline: input.headline, kicker: input.kicker ?? null, highlight: input.highlight ?? null, subtext: input.subtext ?? null, handle: input.handle ?? null, offer: input.offer ?? null },
    fonts: input.fonts,
    textStyle: input.textStyle ?? null,
    brandColor: input.brandColor ?? null,
    position: input.position ?? null,
    scale: input.scale ?? 1,
    textColorOverride: input.textColorOverride ?? null,
    // Square/portrait: 6% safe edge; 9:16: the story safe zone.
    safeY: height / width > 1.6 ? height * (250 / 1920) : undefined,
    reserveBottom: input.reserveBottom,
  })
}

// ─── Prompt rules (shared by every copy prompt that writes on-image text) ───

/** The kicker / highlight rule for an item whose on-image text is its `headlineField`. */
export function kickerHighlightRule(headlineField = "headline"): string {
  return `- "kicker" (optional): 4 words or fewer shown small above the ${headlineField} — a label such as a category, step or audience — or null.
- "highlight" (optional): 1-4 words copied EXACTLY from the ${headlineField} to show in the accent colour — or null.`
}

/**
 * Stamps a carousel's slides / a story's frames at generation: sanitized
 * kicker + highlight, the auto-picked text_layout (one family, max two
 * layouts) and the brand accent colour. `skip` items (checklist frames)
 * get no layout. Items keep every other field.
 */
export function stampSequenceLayouts<T extends Record<string, unknown>>(items: T[], opts: {
  format: "carousel" | "story"
  brand: { vibe?: string | null }
  headingFont: FontId
  accentColor: string | null
  headlineKey: "headline" | "text"
  toPick: (item: T) => PickItem
  skip?: (item: T) => boolean
}): (T & TextLayoutFields & { accent_color?: string | null })[] {
  const live = items.map((item) => !opts.skip?.(item))
  const layouts = pickSequenceLayouts(items.filter((_, i) => live[i]).map(opts.toPick), opts.brand, opts.headingFont, opts.format)
  let n = 0
  return items.map((item, i) => {
    if (!live[i]) return item
    const headline = typeof item[opts.headlineKey] === "string" ? (item[opts.headlineKey] as string) : ""
    return {
      ...item,
      kicker: sanitizeKicker(item.kicker),
      highlight: sanitizeHighlight(item.highlight, headline),
      text_layout: layouts[n++]!,
      text_layout_source: "auto",
      accent_color: opts.accentColor,
    }
  })
}

/** A post's on-image fields at generation: sanitized kicker / highlight + the auto-picked layout. */
export function stampPostLayout(item: { kicker?: unknown; highlight?: unknown }, headline: string | null | undefined, opts: {
  brand: { vibe?: string | null }
  headingFont: FontId
  visualKind?: string | null
  accentColor: string | null
}): { kicker: string | null; highlight: string | null; text_layout: TextLayoutId; text_layout_source: "auto"; accent_color: string | null } {
  return {
    kicker: sanitizeKicker(item.kicker),
    highlight: sanitizeHighlight(item.highlight, headline),
    text_layout: pickTextLayout({ format: "post", brand: opts.brand, headingFont: opts.headingFont, visualKind: opts.visualKind ?? null }),
    text_layout_source: "auto",
    accent_color: opts.accentColor,
  }
}

/** The carousel brand line (bottom-right on the safe edge) as a primitive -- compositor and preview alike. */
export function carouselBrandPrim(brandName: string, plan: LayoutPlan): LayoutPrim | null {
  const name = sanitizeTextForCompositing(brandName).trim()
  if (!name) return null
  const { width, height } = LAYOUT_CANVAS.carousel
  return { kind: "text", x: width * 0.94, y: height * 0.94, size: 26, weight: 500, font: "body", anchor: "end", runs: [{ text: name, color: plan.chrome }] }
}

/**
 * Re-picks auto layouts once backgrounds (and their text_style) exist --
 * a busy background moves a slide to a layout with its own backing. User
 * picks are never touched; content without layouts is returned as is.
 */
export function repickSequenceLayouts<T extends TextLayoutFields>(items: T[], opts: {
  format: "carousel" | "story"
  brand: { vibe?: string | null }
  headingFont: FontId
  toPick: (item: T) => PickItem
}): T[] {
  if (!items.some((i) => i.text_layout && i.text_layout_source !== "user")) return items
  const live = items.map((i) => !!i.text_layout)
  const picks = pickSequenceLayouts(items.filter((_, k) => live[k]).map(opts.toPick), opts.brand, opts.headingFont, opts.format)
  let n = 0
  return items.map((item, k) => {
    if (!live[k]) return item
    const pick = picks[n++]!
    return item.text_layout_source === "user" || item.text_layout === pick ? item : { ...item, text_layout: pick }
  })
}

/** A scheduled post's saved overlay layout (calendar platform_specific_data.overlay_layout). */
export const savedOverlayLayoutSchema = textLayoutFieldsSchema.extend({
  offer: z.string().max(120).nullish(),
  body_font_id: z.enum(["anton", "inter", "playfair", "quicksand", "caveat"]).nullish(),
  brand_color: z.string().max(32).nullish(),
  text_style: z.object({ text_color: z.enum(["light", "dark"]), scrim_opacity: z.number().min(0).max(0.75), needs_backing: z.boolean() }).nullish(),
})
