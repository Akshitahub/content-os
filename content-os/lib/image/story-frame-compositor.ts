import sharp from "sharp"
import { Resvg } from "@resvg/resvg-js"
import type * as fontkit from "fontkit"
import { getFont, getFontPath, handArrow, measureTextWidth } from "@/lib/image/post-compositor"
import { regionLuminance, type RegionStats } from "@/lib/image/text-contrast"
import { bestContrast, ensureContrast, hexContrast, hexLuminance, mixHex, AA_BODY, AA_GRAPHIC } from "@/lib/design/contrast-math"
import { FONT_FAMILY_NAME, DEFAULT_FONT_ID, isFontId, type FontId } from "@/lib/design/fonts"
import { NEUTRAL_PALETTE, paletteRoles, type BrandPalette } from "@/lib/design/color-themes"
import { sanitizeTextForCompositing } from "@/lib/image/sanitize-text-for-compositing"
import type { StoryFrame, StoryFrameFields } from "@/lib/ai/story-frames"
import { frameDisplayFont } from "@/lib/design/carousel-frames"
import { plainBackgroundColor, resolveSubjectBoxes, type SubjectBox } from "@/lib/image/subject-boxes"

/** Feed post designs (lib/design/post-templates.ts bold_statement / product_focus / quote_card / minimal). */
export type PostFrame = "post_bold" | "post_product" | "post_quote" | "post_minimal" | "post_listicle" | "post_festive" | "post_review"
/** Carousel middle slides: photo-led and type-led, alternating (lib/ai/carousel-frames.ts). */
export type SlideFrame = "slide_photo" | "slide_type"
export type FrameKind = StoryFrame | PostFrame | SlideFrame

/**
 * Story frames (lib/ai/story-frames.ts), drawn on a 1080x1920 canvas:
 * always a full-bleed photo (or, without one, the brand palette) with type
 * layered straight on it -- never a dark text panel. Text over the photo
 * gets a soft local shadow (light text) or glow (dark text), sized to the
 * letters, nothing more. Instagram's top and bottom ~250px stay clear of
 * text. Small rotations / offsets and the photo grain come from the
 * frame's seed, so a frame renders the same every time -- the editor
 * preview, a download and the published image are this one render.
 * Colours come from the brand's 4-role palette (resolveBrandPalette): the
 * script lines, callouts and arrows in pop or accent (whichever reads over
 * the strip of photo they sit on), the CTA pill on the accent band, and the hook's last display line in accent / pop -- or white
 * with an accent underline when neither reads. The hook and cta frames carry
 * the brand's logo (or its name) small, inside the safe area.
 */

/** The canvas a frame is drawn on, and the margins text stays inside. */
export interface FrameCanvas {
  w: number
  h: number
  /** Kept clear of text at the top / bottom (Instagram's own UI on stories). */
  safeTop: number
  safeBottom: number
  side: number
  /** A text region cut out of a bigger canvas (around the subject): one zone, the whole region. */
  single?: boolean
  /** How text aligns in this region: left in a left region, right in a right one, centred in a full-width band. */
  align?: Align
}

export type Align = "start" | "middle" | "end"

/** Stories: 1080x1920; Instagram's profile row and reply bar cover ~250px at the top and bottom. */
export const STORY_CANVAS: FrameCanvas = { w: 1080, h: 1920, safeTop: 250, safeBottom: 250, side: 72 }
/** Feed posts and carousel slides: 1080x1350 (4:5), no UI over the image -- just a comfortable margin. */
export const FEED_CANVAS: FrameCanvas = { w: 1080, h: 1350, safeTop: 96, safeBottom: 96, side: 72 }
const SCRIPT_FONT: FontId = "caveat"
const BOX_FONT: FontId = "inter"

export interface StoryFrameSlide extends Omit<StoryFrameFields, "frame"> {
  frame: FrameKind
  /** Carousel slides: up to 12 words of body text under the display words. */
  body?: string | null
  /** The frame's primary copy as mirrored by finalizeStoryFrames -- the fallback when a field is empty. */
  text?: string
  background_image_url?: string | null
  font_id?: FontId | null
  palette?: BrandPalette | null
  /** Brand presence on the hook and cta frames: the logo, or the name in the heading font without one. */
  brand_name?: string | null
  logo_url?: string | null
  /** The logo's contrast variant (light for a dark logo, dark for a light one -- brands.logo_variant_url). */
  logo_variant_url?: string | null
  /** Where the logo goes (brands.logo_position); "auto" = the free corner farthest from the text. */
  logo_position?: LogoPosition | null
  /** false = no logo / name on this frame (brands.logo_on_posts). */
  show_logo?: boolean | null
  /** Where the photo's subject is (lib/image/subject-boxes.ts); absent = stored or detected at render. */
  subject_boxes?: SubjectBox[] | null
  /** "full" keeps a studio / catalogue shot full-bleed; default: cut out onto the brand colour. */
  photo_treatment?: "cutout" | "full" | null
}

// ─── Small utilities ────────────────────────────────────────────────────────

/** mulberry32 -- a tiny deterministic PRNG, one stream per frame seed. */
function prng(seed: number): () => number {
  let a = (seed >>> 0) || 1
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
const r1 = (n: number) => Math.round(n * 10) / 10
/**
 * Copy as drawn: sanitized for the fonts' glyphs, with a real em dash for
 * "—" or a typed "--" (every curated font has U+2014 -- checked; the
 * sanitizer flattens dashes for the other compositors).
 */
const EM_DASH_MARK = "@@EMDASH@@"
const clean = (s: string | null | undefined) =>
  sanitizeTextForCompositing((s ?? "").trim().replace(/\s*(?:--|—)\s*/g, EM_DASH_MARK)).split(EM_DASH_MARK).join(" — ").trim()

async function fetchImage(source: string): Promise<Buffer | null> {
  try {
    if (source.startsWith("data:")) {
      const b64 = source.split(",")[1]
      return b64 ? Buffer.from(b64, "base64") : null
    }
    const res = await fetch(source, { signal: AbortSignal.timeout(20_000) })
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null
  } catch {
    return null
  }
}

/** Wraps `text` into lines no wider than maxW at `size`. */
function wrap(font: fontkit.Font, text: string, size: number, maxW: number): string[] {
  const lines: string[] = []
  let cur = ""
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word
    if (cur && measureTextWidth(font, next, size) > maxW) {
      lines.push(cur)
      cur = word
    } else cur = next
  }
  if (cur) lines.push(cur)
  return lines
}

// ─── Background: the photo placed around its subject, plus grain ───────────

/** A rectangle on the canvas, in pixels. */
export interface Rect { x0: number; y0: number; x1: number; y1: number }
/**
 * How the frame is laid out around the photo's subject:
 * full = no subject found, the whole canvas (as always);
 * free = text in the largest subject-free part of the full-bleed photo;
 * cutout = a studio / catalogue shot's subject cut out onto the brand colour, the text beside it;
 * split = the photo in a column, the text on a brand-colour panel beside it;
 * band = the photo below / above, the text on a brand-colour band.
 */
export type FrameLayout = "full" | "free" | "cutout" | "split" | "band"

interface Composed {
  base: Buffer
  photo: boolean
  /** The subject boxes on the canvas, margin included. */
  subjects: Rect[]
  /** Where every piece of text goes. */
  region: Rect
  layout: FrameLayout
}

/** Clear space kept between text and the subject. */
const SUBJECT_MARGIN = 0.04

const rw = (r: Rect) => r.x1 - r.x0
const rh = (r: Rect) => r.y1 - r.y0
export const rectsIntersect = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1

/** The palette gradient (no photo): deep into accent, never a flat preset. */
function paletteGradient(p: BrandPalette, cv: FrameCanvas): Buffer {
  const svg = `<svg width="${cv.w}" height="${cv.h}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0%" stop-color="${p.deep}"/><stop offset="100%" stop-color="${mixHex(p.deep, p.accent, 0.55)}"/></linearGradient></defs><rect width="${cv.w}" height="${cv.h}" fill="url(#g)"/></svg>`
  return Buffer.from(new Resvg(svg).render().asPng())
}

/**
 * The photo covering `area`, cropped so its subject stays in frame (centred
 * on it); without a subject, sharp's attention crop. Returns the image and
 * the subject boxes in canvas pixels, margin added.
 */
async function placePhoto(src: Buffer, srcW: number, srcH: number, allBoxes: SubjectBox[], area: Rect, cv: FrameCanvas): Promise<{ img: Buffer; subjects: Rect[] }> {
  const aw = rw(area), ah = rh(area)
  // The subject, not a bystander: a person box far smaller than the main
  // one is background (a passer-by); products always count.
  const biggest = Math.max(0, ...allBoxes.map((b) => b.w * b.h))
  const boxes = allBoxes.filter((b) => b.label === "product" || b.w * b.h >= biggest * 0.12)
  if (boxes.length === 0) {
    return { img: await sharp(src).resize(aw, ah, { fit: "cover", position: "attention" }).removeAlpha().png().toBuffer(), subjects: [] }
  }
  const scale = Math.max(aw / srcW, ah / srcH)
  const sw = Math.round(srcW * scale), sh = Math.round(srcH * scale)
  const ux0 = Math.min(...boxes.map((b) => b.x)), ux1 = Math.max(...boxes.map((b) => b.x + b.w))
  const uy0 = Math.min(...boxes.map((b) => b.y)), uy1 = Math.max(...boxes.map((b) => b.y + b.h))
  const left = Math.max(0, Math.min(sw - aw, Math.round(((ux0 + ux1) / 2) * sw - aw / 2)))
  const top = Math.max(0, Math.min(sh - ah, Math.round(((uy0 + uy1) / 2) * sh - ah / 2)))
  const img = await sharp(src).resize(sw, sh).extract({ left, top, width: aw, height: ah }).removeAlpha().png().toBuffer()
  const m = Math.round(SUBJECT_MARGIN * cv.w)
  const subjects = boxes
    .map((b) => ({
      x0: Math.max(area.x0, area.x0 + b.x * sw - left - m),
      y0: Math.max(area.y0, area.y0 + b.y * sh - top - m),
      x1: Math.min(area.x1, area.x0 + (b.x + b.w) * sw - left + m),
      y1: Math.min(area.y1, area.y0 + (b.y + b.h) * sh - top + m),
    }))
    .filter((r) => r.x1 > r.x0 && r.y1 > r.y0)
    .map((r) => ({ x0: Math.round(r.x0), y0: Math.round(r.y0), x1: Math.round(r.x1), y1: Math.round(r.y1) }))
  return { img, subjects }
}

/** The part of a region text may use: inside the safe area. */
function usable(r: Rect, cv: FrameCanvas): Rect {
  return { x0: r.x0, y0: Math.max(r.y0, cv.safeTop), x1: r.x1, y1: Math.min(r.y1, cv.h - cv.safeBottom) }
}

/** The smallest headline size that still reads: feed posts / slides, story frames. */
export const READABLE_HEADLINE_PX = { feed: 64, story: 84 } as const
const readablePx = (cv: FrameCanvas) => (cv.h >= 1900 ? READABLE_HEADLINE_PX.story : READABLE_HEADLINE_PX.feed)

/** The headline size a region allows (lib/image/story-frame-compositor.ts displayBlock's own fit). */
export type HeadlineMeasure = (w: number, h: number) => number

/**
 * A region holds the text readably: room for the script / body beside the
 * headline, and -- measured with the real words -- the headline at a
 * readable size. Without a measure, the old size rule.
 */
function textSize(r: Rect, cv: FrameCanvas, measure?: HeadlineMeasure): number {
  const u = usable(r, cv)
  if (rw(u) < cv.w * 0.36 || rh(u) < cv.h * 0.24) return 0
  if (!measure) {
    const band = rw(u) >= cv.w * 0.9 && rh(u) >= cv.h * 0.3
    const column = rw(u) >= cv.w * 0.4 && rh(u) >= cv.h * 0.55
    return band || column ? readablePx(cv) : 0
  }
  return measure(rw(u) - 72, rh(u) * 0.42)
}

/**
 * The subject-free region where the headline reads biggest (inside the safe
 * area), or null when none holds it at a readable size.
 */
export function freeRegion(subjects: Rect[], cv: FrameCanvas, measure?: HeadlineMeasure): Rect | null {
  if (subjects.length === 0) return { x0: 0, y0: 0, x1: cv.w, y1: cv.h }
  const u = { x0: Math.min(...subjects.map((r) => r.x0)), y0: Math.min(...subjects.map((r) => r.y0)), x1: Math.max(...subjects.map((r) => r.x1)), y1: Math.max(...subjects.map((r) => r.y1)) }
  const candidates: Rect[] = [
    { x0: 0, y0: 0, x1: cv.w, y1: u.y0 },
    { x0: 0, y0: u.y1, x1: cv.w, y1: cv.h },
    { x0: 0, y0: 0, x1: u.x0, y1: cv.h },
    { x0: u.x1, y0: 0, x1: cv.w, y1: cv.h },
  ]
  const sized = candidates
    .filter((r) => !subjects.some((sub) => rectsIntersect(r, sub)))
    .map((r) => ({ r, size: textSize(r, cv, measure) }))
    .filter((c) => c.size >= readablePx(cv))
  if (sized.length === 0) return null
  return sized.reduce((a, b) => (b.size > a.size * 1.04 || (b.size >= a.size * 0.96 && rw(usable(b.r, cv)) * rh(usable(b.r, cv)) > rw(usable(a.r, cv)) * rh(usable(a.r, cv))) ? b : a)).r
}

/**
 * A studio / catalogue shot's subject without its plain background: the
 * background is everything connected to the photo's edge in (nearly) the
 * border colour -- so a white shirt inside the subject stays. Returns the
 * subject as an RGBA PNG trimmed to it, or null if nothing is left.
 */
export async function cutOut(src: Buffer, bg: [number, number, number]): Promise<{ png: Buffer; w: number; h: number } | null> {
  const SAMPLE = 360
  const { data, info } = await sharp(src).resize({ width: SAMPLE }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const w = info.width, h = info.height
  const isBg = new Uint8Array(w * h)
  // Studio backdrops fall off gently (vignette, floor): the fill follows
  // small steps from pixel to pixel, within a looser bound of the border colour.
  const toBg = (i: number) => Math.max(Math.abs(data[i * 3]! - bg[0]), Math.abs(data[i * 3 + 1]! - bg[1]), Math.abs(data[i * 3 + 2]! - bg[2]))
  const step = (i: number, j: number) => Math.max(Math.abs(data[i * 3]! - data[j * 3]!), Math.abs(data[i * 3 + 1]! - data[j * 3 + 1]!), Math.abs(data[i * 3 + 2]! - data[j * 3 + 2]!))
  const stack: number[] = []
  const seed = (i: number) => { if (!isBg[i] && toBg(i) <= 8) { isBg[i] = 1; stack.push(i) } }
  const grow = (from: number, j: number) => { if (!isBg[j] && step(from, j) <= 3 && toBg(j) <= 40) { isBg[j] = 1; stack.push(j) } }
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1) }
  while (stack.length) {
    const i = stack.pop()!
    const x = i % w, y = (i / w) | 0
    if (x > 0) grow(i, i - 1)
    if (x < w - 1) grow(i, i + 1)
    if (y > 0) grow(i, i - w)
    if (y < h - 1) grow(i, i + w)
  }
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  const alpha = Buffer.alloc(w * h)
  for (let i = 0; i < w * h; i++) {
    // Faint floor shadow / halo next to the backdrop goes too; the box is
    // what clearly differs from it.
    if (isBg[i] || toBg(i) <= 12) continue
    alpha[i] = 255
    if (toBg(i) <= 30) continue
    const x = i % w, y = (i / w) | 0
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  if (x1 < x0 || (x1 - x0) * (y1 - y0) < w * h * 0.02) return null
  const meta = await sharp(src).metadata()
  const W = meta.width!, H = meta.height!
  // A soft edge, at full size.
  const mask = await sharp(alpha, { raw: { width: w, height: h, channels: 1 } }).blur(0.8).resize(W, H).extractChannel(0).raw().toBuffer()
  const rgb = await sharp(src).removeAlpha().raw().toBuffer()
  const px = Buffer.alloc(W * H * 4)
  for (let i = 0; i < W * H; i++) {
    px[i * 4] = rgb[i * 3]!
    px[i * 4 + 1] = rgb[i * 3 + 1]!
    px[i * 4 + 2] = rgb[i * 3 + 2]!
    px[i * 4 + 3] = mask[i]!
  }
  const rgba = await sharp(px, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer()
  const left = Math.floor((x0 / w) * W), top = Math.floor((y0 / h) * H)
  const width = Math.min(W - left, Math.ceil(((x1 - x0 + 1) / w) * W)), height = Math.min(H - top, Math.ceil(((y1 - y0 + 1) / h) * H))
  return { png: await sharp(rgba).extract({ left, top, width, height }).png().toBuffer(), w: width, h: height }
}

/**
 * The cutout layout: the brand colour, the cut-out subject standing on one
 * side (the seed picks which) with a soft floor shadow, the other side free
 * for the text -- the annotated_product look for catalogue photography.
 */
async function cutoutCanvas(cut: { png: Buffer; w: number; h: number }, p: BrandPalette, rnd: () => number, cv: FrameCanvas): Promise<{ base: Buffer; subject: Rect }> {
  const right = rnd() < 0.6
  // Room for a 40% text column beside it, margin included.
  const areaW = Math.round(cv.w * 0.52)
  const maxH = cv.h - cv.safeTop - Math.round(cv.safeBottom * 0.4)
  const scale = Math.min(areaW / cut.w, maxH / cut.h)
  const sw = Math.max(1, Math.round(cut.w * scale)), sh = Math.max(1, Math.round(cut.h * scale))
  const left = right ? cv.w - sw - Math.round(cv.w * 0.02) : Math.round(cv.w * 0.02)
  const top = cv.h - Math.round(cv.safeBottom * 0.4) - sh
  const img = await sharp(cut.png).resize(sw, sh).png().toBuffer()
  const floor = mixHex(p.base, p.deep, 0.35)
  const shadow = `<svg width="${cv.w}" height="${cv.h}" xmlns="http://www.w3.org/2000/svg"><defs><filter id="b"><feGaussianBlur stdDeviation="22"/></filter></defs><ellipse cx="${left + sw / 2}" cy="${top + sh - 6}" rx="${sw * 0.42}" ry="${Math.max(18, sh * 0.025)}" fill="${floor}" fill-opacity="0.55" filter="url(#b)"/></svg>`
  const wash = `<svg width="${cv.w}" height="${cv.h}" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="g" cx="${right ? 0.7 : 0.3}" cy="0.45" r="0.8"><stop offset="0%" stop-color="${mixHex(p.base, "#ffffff", 0.35)}"/><stop offset="100%" stop-color="${p.base}"/></radialGradient></defs><rect width="${cv.w}" height="${cv.h}" fill="url(#g)"/></svg>`
  const base = await sharp(Buffer.from(new Resvg(wash).render().asPng()))
    .composite([{ input: Buffer.from(new Resvg(shadow).render().asPng()) }, { input: img, left, top }]).png().toBuffer()
  return { base, subject: { x0: left, y0: top, x1: left + sw, y1: top + sh } }
}

/** Light film grain (seeded), overlay-blended around mid grey. */
async function withGrain(base: Buffer, amount: number, rnd: () => number, cv: FrameCanvas): Promise<Buffer> {
  const grain = Buffer.alloc(cv.w * cv.h * 3)
  for (let i = 0; i < cv.w * cv.h; i++) {
    const v = 128 + Math.round((rnd() - 0.5) * 2 * amount)
    grain[i * 3] = v
    grain[i * 3 + 1] = v
    grain[i * 3 + 2] = v
  }
  return sharp(base).composite([{ input: grain, raw: { width: cv.w, height: cv.h, channels: 3 }, blend: "overlay" }]).png().toBuffer()
}

/**
 * The frame's background and where its text goes. The photo is placed
 * around its subject (faces, torsos, hips, the product -- lib/image/
 * subject-boxes.ts); text goes only in the largest subject-free region.
 * When none holds the text at a readable size, the layout changes instead
 * of covering the subject: a tall subject gets the photo in a column with
 * the text on a brand-colour panel beside it (split), a wide one the text
 * on a band above or below it (band).
 */
async function compose(slide: StoryFrameSlide, p: BrandPalette, rnd: () => number, cv: FrameCanvas, measure?: HeadlineMeasure): Promise<Composed> {
  const full: Rect = { x0: 0, y0: 0, x1: cv.w, y1: cv.h }
  const raw = slide.background_image_url ? await fetchImage(slide.background_image_url) : null
  let oriented: { data: Buffer; info: sharp.OutputInfo } | null = null
  if (raw) {
    try {
      oriented = await sharp(raw).rotate().png().toBuffer({ resolveWithObject: true })
    } catch {
      oriented = null
    }
  }
  if (!oriented) return { base: await withGrain(paletteGradient(p, cv), 16, rnd, cv), photo: false, subjects: [], region: full, layout: "full" }

  const src = oriented.data
  const { width: W, height: H } = oriented.info

  // A studio / catalogue shot is never used full-bleed: its subject is cut
  // out onto the brand colour, the text beside it.
  const plain = slide.photo_treatment === "full" ? null : await plainBackgroundColor(src).catch(() => null)
  const cut = plain ? await cutOut(src, plain).catch((err) => { console.error("[story-frame-compositor] cutout failed (full-bleed instead):", err instanceof Error ? err.message : err); return null }) : null
  if (cut) {
    const { base, subject } = await cutoutCanvas(cut, p, rnd, cv)
    const m = Math.round(SUBJECT_MARGIN * cv.w)
    const subjects = [{ x0: Math.max(0, subject.x0 - m), y0: Math.max(0, subject.y0 - m), x1: Math.min(cv.w, subject.x1 + m), y1: Math.min(cv.h, subject.y1 + m) }]
    const sub = subjects[0]!
    const onRight = (sub.x0 + sub.x1) / 2 > cv.w / 2
    const region = freeRegion(subjects, cv, measure) ?? (onRight ? { x0: 0, y0: 0, x1: sub.x0, y1: cv.h } : { x0: sub.x1, y0: 0, x1: cv.w, y1: cv.h })
    return { base: await withGrain(base, 14, rnd, cv), photo: true, subjects, region, layout: "cutout" }
  }

  const boxes = await resolveSubjectBoxes(slide.background_image_url, src, slide.subject_boxes)
  const placed = await placePhoto(src, W, H, boxes, full, cv)
  const free = freeRegion(placed.subjects, cv, measure)
  if (free) {
    const base = await withGrain(placed.img, 22, rnd, cv)
    return { base, photo: true, subjects: placed.subjects, region: free, layout: placed.subjects.length ? "free" : "full" }
  }

  // No room beside the subject: re-lay the frame out around it.
  const ux0 = Math.min(...placed.subjects.map((r) => r.x0)), ux1 = Math.max(...placed.subjects.map((r) => r.x1))
  const uy0 = Math.min(...placed.subjects.map((r) => r.y0)), uy1 = Math.max(...placed.subjects.map((r) => r.y1))
  const tall = uy1 - uy0 > (ux1 - ux0) * 1.1
  let panel: Rect, area: Rect
  if (tall) {
    const pw = Math.round(cv.w * 0.46)
    const panelLeft = (ux0 + ux1) / 2 > cv.w / 2
    panel = panelLeft ? { x0: 0, y0: 0, x1: pw, y1: cv.h } : { x0: cv.w - pw, y0: 0, x1: cv.w, y1: cv.h }
    area = panelLeft ? { x0: pw, y0: 0, x1: cv.w, y1: cv.h } : { x0: 0, y0: 0, x1: cv.w - pw, y1: cv.h }
  } else {
    const bh = Math.round(cv.h * 0.4)
    const bandTop = (uy0 + uy1) / 2 > cv.h / 2
    panel = bandTop ? { x0: 0, y0: 0, x1: cv.w, y1: bh } : { x0: 0, y0: cv.h - bh, x1: cv.w, y1: cv.h }
    area = bandTop ? { x0: 0, y0: bh, x1: cv.w, y1: cv.h } : { x0: 0, y0: 0, x1: cv.w, y1: cv.h - bh }
  }
  const inArea = await placePhoto(src, W, H, boxes, area, cv)
  const canvas = await sharp({ create: { width: cv.w, height: cv.h, channels: 3, background: p.base } })
    .composite([{ input: inArea.img, left: area.x0, top: area.y0 }]).png().toBuffer()
  return { base: await withGrain(canvas, 18, rnd, cv), photo: true, subjects: inArea.subjects, region: panel, layout: tall ? "split" : "band" }
}

/** A flat brand-colour canvas with light grain (type-led carousel slides). */
async function flatBackground(color: string, rnd: () => number, cv: FrameCanvas): Promise<{ base: Buffer; photo: boolean }> {
  const flat = await sharp({ create: { width: cv.w, height: cv.h, channels: 3, background: color } }).png().toBuffer()
  const grain = Buffer.alloc(cv.w * cv.h * 3)
  for (let i = 0; i < cv.w * cv.h; i++) {
    const v = 128 + Math.round((rnd() - 0.5) * 2 * 12)
    grain[i * 3] = v
    grain[i * 3 + 1] = v
    grain[i * 3 + 2] = v
  }
  return { base: await sharp(flat).composite([{ input: grain, raw: { width: cv.w, height: cv.h, channels: 3 }, blend: "overlay" }]).png().toBuffer(), photo: false }
}

// ─── Text treatment over the photo ──────────────────────────────────────────

type Zone = "top" | "bottom"
function zones(cv: FrameCanvas): Record<Zone, { y0: number; y1: number }> {
  // A region beside the subject is already the calm part: all of it, either way.
  if (cv.single) {
    const all = { y0: cv.safeTop + 10, y1: cv.h - cv.safeBottom - 10 }
    return { top: all, bottom: all }
  }
  return {
    top: { y0: cv.safeTop + 30, y1: Math.round(cv.h * 0.5) },
    bottom: { y0: Math.round(cv.h * 0.5), y1: cv.h - cv.safeBottom - 30 },
  }
}

interface Ink {
  /** Text colour and the filter id that sets it off the photo. */
  color: string
  filter: "sh" | "glow"
  light: boolean
}

/** Light text on a dark region (soft shadow), dark text on a bright one (soft glow). */
function inkFor(stats: RegionStats | null, p: BrandPalette): Ink {
  const light = !stats || stats.high < 0.62 || stats.mean < 0.42
  return light ? { color: "#ffffff", filter: "sh", light } : { color: ensureContrast(p.deep, "#f2f2f2", AA_BODY), filter: "glow", light }
}

const BANDS = 8

/** The photo's luminance per horizontal band of `area` (fractions of the canvas). */
async function bandStats(base: Buffer, area = { x: 0, y: 0, w: 1, h: 1 }): Promise<(RegionStats | null)[]> {
  const out: (RegionStats | null)[] = []
  for (let i = 0; i < BANDS; i++) out.push(await regionLuminance(base, { x: area.x + area.w * 0.04, y: area.y + (area.h * i) / BANDS, w: area.w * 0.92, h: area.h / BANDS }).catch(() => null))
  return out
}

/** Combined stats for the bands a span [y0, y1] covers: brightest high, darkest low, average mean, widest spread. */
function spanStats(bands: (RegionStats | null)[], y0: number, y1: number, cv: FrameCanvas): RegionStats | null {
  const from = Math.max(0, Math.floor((Math.min(y0, y1) / cv.h) * BANDS))
  const to = Math.min(BANDS - 1, Math.floor((Math.max(y0, y1) / cv.h) * BANDS))
  const hit = bands.slice(from, to + 1).filter((b): b is RegionStats => !!b)
  if (hit.length === 0) return null
  return {
    mean: hit.reduce((a, b) => a + b.mean, 0) / hit.length,
    std: Math.max(...hit.map((b) => b.std)),
    low: Math.min(...hit.map((b) => b.low)),
    high: Math.max(...hit.map((b) => b.high)),
  }
}

const FILTERS = `<defs>
<filter id="sh" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur in="SourceAlpha" stdDeviation="16"/><feOffset dy="5" result="b"/><feFlood flood-color="#000000" flood-opacity="0.5"/><feComposite in2="b" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur in="SourceAlpha" stdDeviation="14" result="b"/><feFlood flood-color="#ffffff" flood-opacity="0.75"/><feComposite in2="b" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="drop" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceAlpha" stdDeviation="9"/><feOffset dy="7" result="b"/><feFlood flood-color="#000000" flood-opacity="0.32"/><feComposite in2="b" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>`

// ─── Fonts ──────────────────────────────────────────────────────────────────

interface Fonts {
  displayId: FontId
  display: fontkit.Font
  script: fontkit.Font
  box: fontkit.Font
}

const family = (id: FontId) => `'${FONT_FAMILY_NAME[id]}', sans-serif`
/** Condensed display faces read as posters in caps; the others keep their case. */
const displayCase = (id: FontId, s: string) => (id === "anton" ? s.toUpperCase() : s)
const displayLineHeight = (id: FontId) => (id === "anton" ? 0.94 : 1.04)

// ─── Display words: 1-3 huge words, 25-35% of the frame height ─────────────

interface Block {
  svg: string
  top: number
  bottom: number
  left: number
  right: number
  align: Align
}

/**
 * The headline's line breaks and size: at most `maxLines` lines with
 * balanced lengths (the split that keeps the longest line shortest), at
 * the size that fills `maxW` x `maxH` -- fewer lines unless more are
 * clearly bigger. Exported for the tests and the region choice.
 */
export function fitHeadline(font: fontkit.Font, displayId: FontId, text: string, maxW: number, maxH: number, maxLines = 3): { lines: string[]; size: number } {
  const words = displayCase(displayId, text).split(/\s+/).filter(Boolean)
  if (words.length === 0 || maxW <= 0 || maxH <= 0) return { lines: [], size: 0 }
  const lh = displayLineHeight(displayId)
  const width = (line: string) => Math.max(1, measureTextWidth(font, line, 1))
  let best = { lines: [words.join(" ")], size: 0 }
  for (let n = 1; n <= Math.min(maxLines, words.length); n++) {
    const lines = balancedLines(words, n, width)
    const size = Math.min(maxW / Math.max(...lines.map(width)), maxH / (n * lh))
    if (size > best.size * 1.06) best = { lines, size }
  }
  return { lines: best.lines, size: Math.floor(best.size) }
}

/** `words` in exactly `n` lines, the longest as short as possible (small DP -- headlines are short). */
function balancedLines(words: string[], n: number, width: (line: string) => number): string[] {
  const m = words.length
  const seg = (i: number, j: number) => width(words.slice(i, j).join(" "))
  // cost[k][j]: best max width putting words[0..j) on k lines.
  const cost: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(Infinity))
  const cut: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0))
  cost[0]![0] = 0
  for (let k = 1; k <= n; k++) {
    for (let j = k; j <= m; j++) {
      for (let i = k - 1; i < j; i++) {
        const c = Math.max(cost[k - 1]![i]!, seg(i, j))
        if (c < cost[k]![j]!) { cost[k]![j] = c; cut[k]![j] = i }
      }
    }
  }
  const lines: string[] = []
  let j = m
  for (let k = n; k >= 1; k--) {
    const i = cut[k]![j]!
    lines.unshift(words.slice(i, j).join(" "))
    j = i
  }
  return lines
}

/** Where a line placed beside a block starts and how it anchors, following the block's alignment. */
function besideBlock(block: Block, offset: number): { x: number; anchor: Align } {
  if (block.align === "end") return { x: block.right - offset, anchor: "end" }
  if (block.align === "middle") return { x: (block.left + block.right) / 2, anchor: "middle" }
  return { x: block.left + offset, anchor: "start" }
}

/**
 * The display words: at most 3 lines with balanced lengths, sized to fill
 * the zone (up to `heightShare` of the frame -- more in a region cut out
 * beside the subject, which is all the headline's), aligned to the region
 * (cv.align: left, right or centred), anchored to the zone's top or bottom
 * and rotated a couple of degrees.
 */
function displayBlock(cv: FrameCanvas, f: Fonts, words: string, zone: { y0: number; y1: number }, anchor: Zone, ink: Ink, rnd: () => number, heightShare = 0.3, accent?: { color: string | null; underline: string }): Block {
  const share = cv.single ? Math.max(heightShare, 0.42) : heightShare
  const maxW = cv.w - cv.side * 2 - 12
  const { lines, size } = fitHeadline(f.display, f.displayId, words, maxW, Math.min(cv.h * share, zone.y1 - zone.y0))
  const lh = displayLineHeight(f.displayId)
  const blockH = lines.length * size * lh
  const widths = lines.map((l) => measureTextWidth(f.display, l, size))
  const blockW = widths.length ? Math.max(...widths) : 0
  const align: Align = cv.align ?? "start"
  const jitter = Math.max(0, Math.round(rnd() * 24))
  const left = align === "middle" ? (cv.w - blockW) / 2 : align === "end" ? cv.w - cv.side - blockW - jitter : cv.side + jitter
  const top = anchor === "top" ? zone.y0 + Math.round(rnd() * 30) : zone.y1 - blockH - Math.round(rnd() * 30)
  const angle = (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 1.2)
  const cx = left + blockW / 2
  const cy = top + blockH / 2
  // The brand-colour word: the last line in accent / pop when it reads, else
  // white with an accent underline beneath it.
  const last = lines.length - 1
  let underline = ""
  const text = lines.map((l, i) => {
    const x = align === "middle" ? left + (blockW - widths[i]!) / 2 : align === "end" ? left + blockW - widths[i]! : left
    const y = top + size * (i * lh + 0.86)
    const fill = accent && i === last && accent.color ? accent.color : ink.color
    if (accent && i === last && !accent.color) underline = `<rect x="${r1(x)}" y="${r1(y + size * 0.08)}" width="${r1(widths[i]!)}" height="${r1(Math.max(10, size * 0.09))}" rx="${r1(size * 0.04)}" fill="${accent.underline}"/>`
    return `<text x="${r1(x)}" y="${r1(y)}" font-family="${family(f.displayId)}" font-size="${size}" font-weight="700" fill="${fill}">${esc(l)}</text>`
  }).join("")
  return { svg: `<g transform="rotate(${r1(angle)} ${r1(cx)} ${r1(cy)})" filter="url(#${ink.filter})">${underline}${text}</g>`, top, bottom: top + blockH, left, right: left + blockW, align }
}

/** One handwritten line in the script face, rotated a few degrees. */
function scriptLine(cv: FrameCanvas, f: Fonts, text: string, x: number, y: number, color: string, filter: string, rnd: () => number, size = 88, anchor: Align = "start"): { svg: string; width: number } {
  const t = clean(text)
  if (!t) return { svg: "", width: 0 }
  // From where it starts to the frame's edge; too long for one line at a
  // readable size (a narrow region beside the subject) -> two lines.
  const room = Math.max(120, anchor === "middle" ? cv.w - cv.side * 2 : (anchor === "end" ? x : cv.w - x) - cv.side)
  let s = size
  while (s > 56 && measureTextWidth(f.script, t, s) > room) s -= 4
  let lines = [t]
  if (measureTextWidth(f.script, t, s) > room) {
    s = Math.max(48, s)
    lines = wrap(f.script, t, s, room).slice(0, 2)
    while (s > 40 && lines.some((l) => measureTextWidth(f.script, l, s) > room)) { s -= 4; lines = wrap(f.script, t, s, room).slice(0, 2) }
  }
  const width = Math.max(...lines.map((l) => measureTextWidth(f.script, l, s)))
  const angle = (rnd() < 0.5 ? -1 : 1) * (2 + rnd() * 3)
  const ax = anchor === "end" ? x - width : anchor === "middle" ? x - width / 2 : x
  // A wrapped line in the lower half grows upward, away from what sits under it.
  // Then the whole thing inside the safe area -- glyphs rise ~0.8 of the size above the baseline.
  const grown = y > cv.h / 2 ? y - (lines.length - 1) * s * 0.98 : y
  const firstY = Math.min(Math.max(grown, cv.safeTop + s * 0.85), cv.h - cv.safeBottom - s * 0.3 - (lines.length - 1) * s * 0.98)
  const svgLines = lines.map((l, i) => `<text x="${r1(anchor === "end" ? ax + width - measureTextWidth(f.script, l, s) : anchor === "middle" ? ax + (width - measureTextWidth(f.script, l, s)) / 2 : ax)}" y="${r1(firstY + i * s * 0.98)}" font-family="${family(SCRIPT_FONT)}" font-size="${s}" font-weight="700" fill="${color}">${esc(l)}</text>`).join("")
  return {
    svg: `<g transform="rotate(${r1(angle)} ${r1(ax + width / 2)} ${r1(y)})" filter="url(#${filter})">${svgLines}</g>`,
    width,
  }
}

/** Whether `color` clears 3:1 against the photo strip it crosses (light text vs its brightest parts, dark vs its darkest). */
function readsOver(color: string, ink: Ink, stats: RegionStats | null, fallbackBg: string): boolean {
  if (!stats) return hexContrast(color, fallbackBg) >= AA_GRAPHIC
  const L = hexLuminance(color)
  const against = ink.light ? stats.high : stats.low
  const ratio = (Math.max(L, against) + 0.05) / (Math.min(L, against) + 0.05)
  return (ink.light ? L > against : L < against) && ratio >= AA_GRAPHIC
}

/**
 * A brand colour for script lines / arrows / an accent word: pop when it
 * reads, else pop deepened (on light) or lifted (on dark) until it does,
 * else accent -- the brand colour is always there, not plain ink.
 */
function brandColorOver(p: BrandPalette, ink: Ink, stats: RegionStats | null): string | null {
  // Without a photo the frame is the palette gradient (deep into accent).
  const bg = mixHex(p.deep, p.accent, 0.3)
  if (readsOver(p.pop, ink, stats, bg)) return p.pop
  // Pop first even when it needs deepening / lifting to read; then accent.
  const behind = ink.light ? (stats ? mixHex("#000000", "#ffffff", Math.min(stats.high, 0.35)) : bg) : (stats ? mixHex("#000000", "#ffffff", Math.max(stats.low, 0.85)) : "#f2f2f2")
  const adjusted = ensureContrast(p.pop, behind, AA_GRAPHIC + 0.5)
  if (readsOver(adjusted, ink, stats, bg)) return adjusted
  return readsOver(p.accent, ink, stats, bg) ? p.accent : null
}

/** The script line's colour: the brand's pop or accent when one reads over the photo it crosses, else the ink. */
function scriptColor(p: BrandPalette, ink: Ink, stats: RegionStats | null): string {
  return brandColorOver(p, ink, stats) ?? ink.color
}

/** Clamp a text block's vertical span into the safe area. */
const clampY = (cv: FrameCanvas, y: number) => Math.max(cv.safeTop + 20, Math.min(cv.h - cv.safeBottom - 20, y))

// ─── Decorations ────────────────────────────────────────────────────────────

/** A hand-drawn arrow from (x1,y1) toward (x2,y2) -- annotated_product's own drawing, thicker. */
const arrow = (x1: number, y1: number, x2: number, y2: number, bow: number, color: string, filter: string) =>
  `<g filter="url(#${filter})">${handArrow(x1, y1, x2, y2, bow, color, 7)}</g>`

// ─── Frames ─────────────────────────────────────────────────────────────────

interface Ctx {
  /** The canvas this frame is drawn on (story or feed). */
  cv: FrameCanvas
  f: Fonts
  p: BrandPalette
  rnd: () => number
  stats: Record<Zone, RegionStats | null>
  bands: (RegionStats | null)[]
}


export const LOGO_POSITIONS = ["auto", "top-left", "top-right", "bottom-left", "bottom-right"] as const
export type LogoPosition = (typeof LOGO_POSITIONS)[number]

/** The logo's box: about 8% of the canvas width; a wide wordmark gets up to twice that, kept as short. */
function logoBox(cv: FrameCanvas, aspect: number): { w: number; h: number } {
  const unit = Math.round(cv.w * 0.08)
  const w = aspect > 2 ? Math.min(unit * 2, Math.round(unit * 0.55 * aspect)) : unit
  return { w, h: Math.max(1, Math.round(w / aspect)) }
}

/** A logo file at its mark size, and its mean luminance (0 dark .. 1 light). Null if unreadable. */
async function logoImage(url: string | null | undefined, cv: FrameCanvas): Promise<{ png: Buffer; w: number; h: number; lum: number } | null> {
  if (!url) return null
  const bytes = await fetchImage(url)
  if (!bytes) return null
  try {
    const meta = await sharp(bytes).metadata()
    const { w, h } = logoBox(cv, (meta.width ?? 1) / Math.max(1, meta.height ?? 1))
    const png = await sharp(bytes).resize(w, h, { fit: "inside" }).ensureAlpha().png().toBuffer()
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
    let sum = 0, n = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! < 128) continue
      sum += (0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) / 255
      n++
    }
    return { png, w: info.width, h: info.height, lum: n ? sum / n : 0.5 }
  } catch {
    return null
  }
}

/**
 * The brand mark, placed after the text: the logo (or the brand's name
 * without one) in a corner inside the safe area that has no text and no
 * subject in it -- the chosen position when it's free, else ("auto") the
 * free corner farthest from the text. No free corner = no mark (it never
 * covers the text, a face or the product). The logo or its contrast
 * variant, whichever reads on the photo there.
 */
async function placeMark(slide: StoryFrameSlide, overlay: Buffer, base: Buffer, subjects: Rect[], cv: FrameCanvas, displayId: FontId, display: fontkit.Font, fontFiles: string[]): Promise<Buffer> {
  const logo = await logoImage(slide.logo_url, cv)
  const variant = logo ? await logoImage(slide.logo_variant_url, cv) : null
  const name = logo ? "" : clean(slide.brand_name)
  if (!logo && !name) return overlay
  const nameSize = Math.round(cv.w * 0.034)
  const mw = logo ? logo.w : Math.min(Math.round(measureTextWidth(display, displayCase(displayId, name), nameSize)), Math.round(cv.w * 0.3))
  const mh = logo ? logo.h : Math.round(nameSize * 1.1)
  const m = Math.round(cv.w * 0.06)
  const xs = { left: Math.max(m, 40), right: cv.w - Math.max(m, 40) - mw }
  const ys = { top: cv.safeTop + 20, bottom: cv.h - cv.safeBottom - 20 - mh }
  const corners: { pos: LogoPosition; r: Rect }[] = [
    { pos: "top-left", r: { x0: xs.left, y0: ys.top, x1: xs.left + mw, y1: ys.top + mh } },
    { pos: "top-right", r: { x0: xs.right, y0: ys.top, x1: xs.right + mw, y1: ys.top + mh } },
    { pos: "bottom-left", r: { x0: xs.left, y0: ys.bottom, x1: xs.left + mw, y1: ys.bottom + mh } },
    { pos: "bottom-right", r: { x0: xs.right, y0: ys.bottom, x1: xs.right + mw, y1: ys.bottom + mh } },
  ]
  // Where the text is: its pixels (a little margin around each corner box).
  const { data, info } = await sharp(overlay).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const pad = 24
  const busy = (r: Rect) => {
    for (let y = Math.max(0, r.y0 - pad); y < Math.min(info.height, r.y1 + pad); y += 2) {
      for (let x = Math.max(0, r.x0 - pad); x < Math.min(info.width, r.x1 + pad); x += 2) if (data[(y * info.width + x) * 4 + 3]! > 40) return true
    }
    return false
  }
  let sx = 0, sy = 0, n = 0
  for (let y = 0; y < info.height; y += 6) for (let x = 0; x < info.width; x += 6) if (data[(y * info.width + x) * 4 + 3]! > 40) { sx += x; sy += y; n++ }
  const text = n ? { x: sx / n, y: sy / n } : { x: cv.w / 2, y: cv.h / 2 }
  const free = corners.filter((c) => !busy(c.r) && !subjects.some((sub) => rectsIntersect(c.r, sub)))
  if (free.length === 0) return overlay
  const wanted = slide.logo_position && slide.logo_position !== "auto" ? free.find((c) => c.pos === slide.logo_position) : undefined
  const dist = (c: { r: Rect }) => Math.hypot((c.r.x0 + c.r.x1) / 2 - text.x, (c.r.y0 + c.r.y1) / 2 - text.y)
  const at = wanted ?? free.reduce((a, b) => (dist(b) > dist(a) ? b : a))
  // The photo under the corner decides light or dark.
  const under = await regionLuminance(base, { x: at.r.x0 / cv.w, y: at.r.y0 / cv.h, w: mw / cv.w, h: mh / cv.h }).catch(() => null)
  const bgLum = under?.mean ?? 0.5
  if (logo) {
    const pick = variant && Math.abs(variant.lum - bgLum) > Math.abs(logo.lum - bgLum) ? variant : logo
    return sharp(overlay).composite([{ input: pick.png, left: Math.round(at.r.x0 + (mw - pick.w) / 2), top: Math.round(at.r.y0 + (mh - pick.h) / 2) }]).png().toBuffer()
  }
  const color = bgLum < 0.5 ? "#ffffff" : "#111111"
  const svg = `<svg width="${cv.w}" height="${cv.h}" xmlns="http://www.w3.org/2000/svg"><text x="${at.r.x0}" y="${r1(at.r.y0 + nameSize * 0.9)}" font-family="${family(displayId)}" font-size="${nameSize}" font-weight="700" fill="${color}">${esc(displayCase(displayId, name))}</text></svg>`
  const layer = Buffer.from(new Resvg(svg, { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: FONT_FAMILY_NAME[displayId] } }).render().asPng())
  return sharp(overlay).composite([{ input: layer }]).png().toBuffer()
}

/** Ink + stats for the text span [y0, y1]. */
function inkAt(ctx: Ctx, y0: number, y1: number): { ink: Ink; stats: RegionStats | null } {
  const stats = spanStats(ctx.bands, y0, y1, ctx.cv)
  return { ink: inkFor(stats, ctx.p), stats }
}

/** A script line at (x, y), inked for the strip it sits on. */
function scriptAt(ctx: Ctx, text: string, x: number, y: number, size = 88, anchor: Align = "start"): { svg: string; width: number; color: string; filter: string } {
  const { cv } = ctx
  const { ink, stats } = inkAt(ctx, y - size, y + size * 0.3)
  const color = scriptColor(ctx.p, ink, stats)
  return { ...scriptLine(cv, ctx.f, text, x, y, color, ink.filter, ctx.rnd, size, anchor), color, filter: ink.filter }
}

/** A script line beside a display block, aligned with it. */
function scriptBeside(ctx: Ctx, block: Block, text: string, offset: number, y: number, size = 88): { svg: string; width: number; color: string; filter: string } {
  const { x, anchor } = besideBlock(block, offset)
  return scriptAt(ctx, text, x, y, size, anchor)
}

/** The calmer of the two zones for the main text (lower luminance spread). */
function calmZone(ctx: Ctx, prefer?: Zone): Zone {
  const { top, bottom } = ctx.stats
  if (!top || !bottom) return prefer ?? (ctx.rnd() < 0.5 ? "top" : "bottom")
  if (Math.abs(top.std - bottom.std) < 0.03 && prefer) return prefer
  return top.std <= bottom.std ? "top" : "bottom"
}

function hookFrame(ctx: Ctx, s: StoryFrameSlide): string {
  const { cv } = ctx
  const zone = calmZone(ctx)
  const ink = inkFor(ctx.stats[zone], ctx.p)
  // Every sequence has a hook, so its last display line carries the brand colour.
  const accent = { color: brandColorOver(ctx.p, ink, ctx.stats[zone]), underline: ctx.p.accent }
  const block = displayBlock(cv, ctx.f, clean(s.big_words) || clean(s.text), zones(cv)[zone], zone, ink, ctx.rnd, 0.3, accent)
  const scriptY = zone === "top" ? clampY(cv, block.bottom + 130) : clampY(cv, block.top - 50)
  const script = scriptBeside(ctx, block, s.script_line ?? "", 18 + Math.round(ctx.rnd() * 40), scriptY, 96)
  // The mark sits in the corner away from the words.
  return block.svg + script.svg
}

function offerFrame(ctx: Ctx, s: StoryFrameSlide): string {
  const { cv } = ctx
  // Display line in the calmer zone; the badge in the other half, overlapping the photo like a sticker.
  const zone = calmZone(ctx, "bottom")
  const ink = inkFor(ctx.stats[zone], ctx.p)
  const block = displayBlock(cv, ctx.f, clean(s.big_words) || clean(s.text), zones(cv)[zone], zone, ink, ctx.rnd, 0.22)
  // Sized to the frame (a narrow region beside the subject included), and
  // kept inside it with room for its tilt and shadow.
  const r = Math.max(110, Math.min(205, (cv.w - cv.side * 2) / 2 - 24))
  const inset = cv.side + r + 14
  const bx = Math.min(cv.w - inset, Math.max(inset, ctx.rnd() < 0.5 ? cv.w - inset - Math.round(ctx.rnd() * 30) : inset + Math.round(ctx.rnd() * 30)))
  const by = zone === "bottom" ? cv.safeTop + r + 60 + Math.round(ctx.rnd() * 60) : cv.h - cv.safeBottom - r - 60 - Math.round(ctx.rnd() * 60)
  const fill = ctx.p.pop
  const ink2 = bestContrast(fill, ["#ffffff", ctx.p.deep, "#111111"])
  const words = displayCase(ctx.f.displayId, clean(s.badge)).split(/\s+/).filter(Boolean)
  // No real offer, no badge (story-frames.ts only keeps a number the topic / product gives).
  if (words.length === 0) return block.svg + scriptBeside(ctx, block, s.script_line ?? "", 24, zone === "top" ? clampY(cv, block.bottom + 120) : clampY(cv, block.top - 46), 88).svg
  // Number on top, the rest below -- each line fitted inside the circle.
  const lines = words.length > 1 ? [words[0]!, words.slice(1).join(" ")] : words
  const sizes = lines.map((l, i) => Math.floor(Math.min((i === 0 ? 1.55 : 1.25) * r / Math.max(1, measureTextWidth(ctx.f.display, l, 1)), i === 0 ? r * 0.82 : r * 0.42)))
  const lh = displayLineHeight(ctx.f.displayId)
  const totalH = sizes.reduce((a, b) => a + b * lh, 0)
  let y = by - totalH / 2
  const text = lines.map((l, i) => {
    const size = sizes[i]!
    y += size * lh
    return `<text x="${bx}" y="${r1(y - size * 0.14)}" text-anchor="middle" font-family="${family(ctx.f.displayId)}" font-size="${size}" font-weight="700" fill="${ink2}">${esc(l)}</text>`
  }).join("")
  const angle = (ctx.rnd() < 0.5 ? -1 : 1) * (7 + ctx.rnd() * 7)
  const badge = `<g transform="rotate(${r1(angle)} ${bx} ${by})" filter="url(#drop)"><circle cx="${bx}" cy="${by}" r="${r}" fill="${fill}"/><circle cx="${bx}" cy="${by}" r="${r - 18}" fill="none" stroke="${ink2}" stroke-opacity="0.55" stroke-width="4" stroke-dasharray="10 12"/>${text}</g>`
  const scriptY = zone === "top" ? clampY(cv, block.bottom + 120) : clampY(cv, block.top - 46)
  const script = scriptBeside(ctx, block, s.script_line ?? "", 24, scriptY, 88)
  return badge + block.svg + script.svg
}

function productFrame(ctx: Ctx, s: StoryFrameSlide): string {
  const { cv } = ctx
  const out: string[] = []
  // Two handwritten callouts, upper-left and lower-right, arrows curving in
  // toward the middle of the photo where the product is.
  const callouts = (s.callouts ?? []).map(clean).filter(Boolean).slice(0, 2)
  // Within the frame's width (a narrow region beside the subject included).
  const maxW = Math.min(700, cv.w - cv.side * 2 - 20)
  const size = maxW < 520 ? 64 : 86
  const targets = [{ x: cv.w * 0.47, y: cv.h * 0.43 }, { x: cv.w * 0.55, y: cv.h * 0.58 }]
  callouts.forEach((c, i) => {
    // Two lines only when one won't fit -- then split near the middle, never one word alone.
    const full = measureTextWidth(ctx.f.script, c, size)
    const lines = full <= maxW ? [c] : wrap(ctx.f.script, c, size, Math.min(maxW, Math.max(full / 2 + 40, 260))).slice(0, 2)
    const lw = Math.max(...lines.map((l) => measureTextWidth(ctx.f.script, l, size)))
    const right = i === 1
    // In from the margin: the script face overhangs its advance width.
    const x = right ? cv.w - cv.side - 14 - Math.round(ctx.rnd() * 30) : cv.side + Math.round(ctx.rnd() * 30)
    const y0 = right ? Math.round(cv.h * 0.66) + Math.round(ctx.rnd() * 60) : cv.safeTop + 120 + Math.round(ctx.rnd() * 60)
    const { ink, stats } = inkAt(ctx, y0 - size, y0 + lines.length * size)
    const color = scriptColor(ctx.p, ink, stats)
    const angle = (right ? 1 : -1) * (2 + ctx.rnd() * 3)
    const text = lines.map((l, k) => `<text x="${x}" y="${y0 + k * size * 1.02}" text-anchor="${right ? "end" : "start"}" font-family="${family(SCRIPT_FONT)}" font-size="${size}" font-weight="700" fill="${color}">${esc(l)}</text>`).join("")
    const tx = right ? x - lw : x
    out.push(`<g transform="rotate(${r1(angle)} ${r1(tx + lw / 2)} ${y0})" filter="url(#${ink.filter})">${text}</g>`)
    // Arrow from just past the text toward the product, stopping short of it.
    const sx = right ? x - lw * 0.55 : x + lw * 0.55
    const sy = right ? y0 - size * 0.95 : y0 + (lines.length - 1) * size + size * 0.45
    const t = targets[i]!
    const ex = sx + (t.x - sx) * 0.62
    const ey = sy + (t.y - sy) * 0.62
    out.push(arrow(sx, sy, ex, ey, right ? -55 : 55, color, ink.filter))
  })
  // The display words, low on the frame -- plain type, no label behind them.
  const label = displayCase(ctx.f.displayId, clean(s.big_words) || clean(s.text))
  if (label) {
    // Fits the frame (a narrow region beside the subject included), aligned to it.
    let fs = 104
    while (fs > 36 && measureTextWidth(ctx.f.display, label, fs) > cv.w - cv.side * 2 - 16) fs -= 4
    const tw = measureTextWidth(ctx.f.display, label, fs)
    const h = fs * 1.42
    const align = cv.align ?? "start"
    const cx = align === "middle" ? cv.w / 2 : align === "end" ? cv.w - cv.side - tw / 2 : cv.side + tw / 2
    const cy = cv.h - cv.safeBottom - h / 2 - 150 - Math.round(ctx.rnd() * 50)
    const angle = (ctx.rnd() < 0.5 ? -1 : 1) * (1 + ctx.rnd() * 1.5)
    const { ink } = inkAt(ctx, cy - h / 2, cy + h / 2)
    out.push(`<g transform="rotate(${r1(angle)} ${r1(cx)} ${r1(cy)})"><text x="${r1(cx)}" y="${r1(cy + fs * 0.34)}" text-anchor="middle" font-family="${family(ctx.f.displayId)}" font-size="${fs}" font-weight="700" fill="${ink.color}" filter="url(#${ink.filter})">${esc(label)}</text></g>`)
  }
  return out.join("")
}

/** Instagram's own text tool: each line on a rounded, solid highlight, the lines merged into one shape. */
function proofFrame(ctx: Ctx, s: StoryFrameSlide): string {
  const { cv } = ctx
  const quote = clean(s.quote) || clean(s.text)
  const padX = 32
  // Wrapped to the frame (a narrow region beside the subject included),
  // smaller rather than clipped.
  // Room for the box padding and its small sideways nudge.
  const maxW = Math.min(840, cv.w - cv.side * 2 - padX * 2 - 70)
  let size = 74
  let lines = wrap(ctx.f.box, quote, size, maxW)
  while (size > 40 && (lines.length > 6 || lines.some((l) => measureTextWidth(ctx.f.box, l, size) > maxW))) { size -= 4; lines = wrap(ctx.f.box, quote, size, maxW) }
  const lineH = size * 1.4
  const fill = "#ffffff"
  const ink = ensureContrast(ctx.p.deep, fill, AA_BODY)
  const zone = calmZone(ctx, "top")
  const totalH = lines.length * lineH
  const top = clampY(cv, zone === "top" ? Math.round(cv.h * 0.3) : Math.round(cv.h * 0.56)) + Math.round(ctx.rnd() * 40)
  const cx = cv.w / 2 + Math.round((ctx.rnd() - 0.5) * 40)
  const rects: string[] = []
  const texts: string[] = []
  lines.forEach((l, i) => {
    const lw = measureTextWidth(ctx.f.box, l, size)
    const y = top + i * lineH
    rects.push(`<rect x="${r1(cx - lw / 2 - padX)}" y="${r1(y - 4)}" width="${r1(lw + padX * 2)}" height="${r1(lineH + 8)}" rx="22" fill="${fill}"/>`)
    texts.push(`<text x="${r1(cx)}" y="${r1(y + lineH * 0.7)}" text-anchor="middle" font-family="${family(BOX_FONT)}" font-size="${size}" font-weight="700" fill="${ink}">${esc(l)}</text>`)
  })
  const angle = (ctx.rnd() < 0.5 ? -1 : 1) * (1 + ctx.rnd() * 1.5)
  const widest = Math.max(...lines.map((l) => measureTextWidth(ctx.f.box, l, size)))
  const markColor = ensureContrast(ctx.p.pop, "#202020", AA_GRAPHIC)
  // The big quote glyph rises ~0.8 of its size above its baseline: kept inside the safe area.
  const mark = `<text x="${r1(Math.max(cv.side, cx - widest / 2 - padX - 10))}" y="${r1(Math.max(top + 40, cv.safeTop + 200))}" font-family="${family(SCRIPT_FONT)}" font-size="240" font-weight="700" fill="${markColor}" filter="url(#drop)">&#8220;</text>`
  return `<g transform="rotate(${r1(angle)} ${r1(cx)} ${r1(top + totalH / 2)})"><g filter="url(#drop)">${rects.join("")}</g>${texts.join("")}</g>${mark}`
}

/** An Instagram-style pill button with a hand-drawn arrow pointing at it. */
function ctaFrame(ctx: Ctx, s: StoryFrameSlide): string {
  const { cv } = ctx
  const inkTop = inkFor(ctx.stats.top, ctx.p)
  const block = displayBlock(cv, ctx.f, clean(s.big_words) || clean(s.text), zones(cv).top, "top", inkTop, ctx.rnd, 0.24)
  const label = clean(s.cta_label) || "Shop now"
  // ~1.5x the first version (54px / 124px): the button is the frame's point.
  // The padding shrinks with the type, so the pill always fits its frame.
  let fs = 80
  while (fs > 36 && measureTextWidth(ctx.f.box, label, fs) + fs * 2.4 > cv.w - cv.side * 2) fs -= 2
  const tw = measureTextWidth(ctx.f.box, label, fs)
  const pw = Math.min(tw + fs * 2.4, cv.w - cv.side * 2)
  const ph = Math.round(fs * 2.3)
  const px = (cv.w - pw) / 2
  // Room under the pill for the brand mark, still inside the safe area.
  const py = cv.h - cv.safeBottom - ph - 140 - Math.round(ctx.rnd() * 30)
  const { band: pillFill, bandText: pillInk } = paletteRoles(ctx.p)
  const pill = `<g filter="url(#drop)"><rect x="${r1(px)}" y="${r1(py)}" width="${r1(pw)}" height="${ph}" rx="${ph / 2}" fill="${pillFill}"/></g><text x="${cv.w / 2}" y="${r1(py + ph / 2 + fs * 0.36)}" text-anchor="middle" font-family="${family(BOX_FONT)}" font-size="${fs}" font-weight="700" fill="${pillInk}">${esc(label)}</text>`
  // The script line above-left, its arrow curving down to the pill.
  const sy = clampY(cv, py - 250 - Math.round(ctx.rnd() * 40))
  const sx = cv.side + 10 + Math.round(ctx.rnd() * 40)
  const script = scriptAt(ctx, s.script_line ?? "", sx, sy, 92)
  return block.svg + script.svg + pill
}

// ─── Feed posts (1080x1350) ─────────────────────────────────────────────────
// The story frame language on a feed post: full-bleed photo, 1-4 huge
// display words + one script line, slight rotation, the brand mark and
// colours -- nothing purely decorative. post_bold is the hook frame itself.

/** product_focus: the photo carries the product; the display words low on the frame, a script line above them. */
function postProductFrame(ctx: Ctx, s: StoryFrameSlide): string {
  const { cv } = ctx
  const zone = calmZone(ctx, "bottom")
  const ink = inkFor(ctx.stats[zone], ctx.p)
  const accent = { color: brandColorOver(ctx.p, ink, ctx.stats[zone]), underline: ctx.p.accent }
  const block = displayBlock(cv, ctx.f, clean(s.big_words) || clean(s.text), zones(cv)[zone], zone, ink, ctx.rnd, 0.2, accent)
  const scriptY = zone === "top" ? clampY(cv, block.bottom + 100) : clampY(cv, block.top - 40)
  const script = scriptBeside(ctx, block, s.script_line ?? "", 10, scriptY, 84)
  return block.svg + script.svg
}

/** quote_card: a big brand-coloured quote mark, the display words, a script line. */
function postQuoteFrame(ctx: Ctx, s: StoryFrameSlide): string {
  const { cv } = ctx
  const zone = calmZone(ctx, "top")
  const ink = inkFor(ctx.stats[zone], ctx.p)
  const accent = { color: brandColorOver(ctx.p, ink, ctx.stats[zone]), underline: ctx.p.accent }
  const z = zones(cv)[zone]
  const block = displayBlock(cv, ctx.f, clean(s.big_words) || clean(s.text), { y0: z.y0 + 120, y1: z.y1 }, zone, ink, ctx.rnd, 0.26, accent)
  const markColor = brandColorOver(ctx.p, ink, ctx.stats[zone]) ?? ink.color
  const quote = `<text x="${r1(block.left - 10)}" y="${r1(block.top + 40)}" font-family="${family(SCRIPT_FONT)}" font-size="260" font-weight="700" fill="${markColor}" filter="url(#${ink.filter})">&#8220;</text>`
  const scriptY = zone === "top" ? clampY(cv, block.bottom + 110) : clampY(cv, block.top - 40)
  const script = scriptBeside(ctx, block, s.script_line ?? "", 30, scriptY, 84)
  return quote + block.svg + script.svg
}

/** minimal: the quiet option -- small display words in the brand colour, a small script line, the mark. */
function postMinimalFrame(ctx: Ctx, s: StoryFrameSlide): string {
  const { cv } = ctx
  const zone = calmZone(ctx, "bottom")
  const ink = inkFor(ctx.stats[zone], ctx.p)
  const color = brandColorOver(ctx.p, ink, ctx.stats[zone])
  const block = displayBlock(cv, ctx.f, clean(s.big_words) || clean(s.text), zones(cv)[zone], zone, color ? { ...ink, color } : ink, ctx.rnd, 0.13, color ? undefined : { color: null, underline: ctx.p.accent })
  const scriptY = zone === "top" ? clampY(cv, block.bottom + 80) : clampY(cv, block.top - 30)
  const script = scriptBeside(ctx, block, s.script_line ?? "", 6, scriptY, 64)
  return block.svg + script.svg
}

/**
 * listicle_cover: the real item count as a big numeral in the brand colour,
 * the title, and the items themselves, numbered -- the number only means
 * something because the list is right there. Without items it isn't chosen
 * (lib/design/post-design-fields.ts).
 */
function postListicleFrame(ctx: Ctx, s: StoryFrameSlide): string {
  const { cv } = ctx
  const zone = calmZone(ctx, "top")
  const ink = inkFor(ctx.stats[zone], ctx.p)
  const color = brandColorOver(ctx.p, ink, ctx.stats[zone]) ?? ink.color
  const items = (s.callouts ?? []).map(clean).filter(Boolean)
  const z = zones(cv)[zone]
  const numSize = Math.round(Math.min(cv.h * 0.2, (cv.w - cv.side * 2) * 0.5))
  const top = z.y0 + 10
  // Aligned with the region like the headline; in from the margin for the numeral's overhang.
  const numW = measureTextWidth(ctx.f.display, clean(s.badge) || String(items.length), numSize)
  const align = cv.align ?? "start"
  const numX = align === "end" ? cv.w - cv.side - 10 - numW : align === "middle" ? (cv.w - numW) / 2 : cv.side + 10
  const num = `<text x="${r1(numX)}" y="${r1(top + numSize * 0.86)}" font-family="${family(ctx.f.displayId)}" font-size="${numSize}" font-weight="700" fill="${color}" filter="url(#${ink.filter})">${esc(clean(s.badge) || String(items.length))}</text>`
  const block = displayBlock(cv, ctx.f, clean(s.big_words) || clean(s.text), { y0: top + numSize + 10, y1: z.y1 }, "top", ink, ctx.rnd, 0.16)
  let y = block.bottom + 26
  const list = items.slice(0, 7).map((item, i) => {
    const at = besideBlock(block, 4)
    const line = bodyLines(ctx, `${i + 1}. ${item}`, at.x, y, ink.color, ink.filter, at.anchor)
    y += line.height + 6
    return line.svg
  }).join("")
  return num + block.svg + list
}

/**
 * festive_poster: the occasion's name as a small kicker in the brand
 * colour, the greeting as display words, a script line, the mark -- only
 * drawn for a real occasion (the server checks the topic / date).
 */
function postFestiveFrame(ctx: Ctx, s: StoryFrameSlide): string {
  const { cv } = ctx
  const zone = calmZone(ctx, "top")
  const ink = inkFor(ctx.stats[zone], ctx.p)
  const accent = { color: brandColorOver(ctx.p, ink, ctx.stats[zone]), underline: ctx.p.accent }
  const z = zones(cv)[zone]
  const kickerSize = 56
  const label = displayCase(ctx.f.displayId, clean(s.badge))
  const block = displayBlock(cv, ctx.f, clean(s.big_words) || clean(s.text), { y0: z.y0 + (label ? kickerSize + 30 : 0), y1: z.y1 }, "top", ink, ctx.rnd, 0.24, accent)
  const kickerAt = besideBlock(block, 0)
  const kicker = label ? `<text x="${r1(kickerAt.x)}" y="${r1(block.top - 24)}" text-anchor="${kickerAt.anchor}" font-family="${family(ctx.f.displayId)}" font-size="${kickerSize}" font-weight="700" letter-spacing="4" fill="${accent.color ?? ink.color}" filter="url(#${ink.filter})">${esc(label)}</text>` : ""
  const script = scriptBeside(ctx, block, s.script_line ?? "", 24, clampY(cv, block.bottom + 100), 84)
  return kicker + block.svg + script.svg
}

/**
 * review_card: a real customer's words in white boxed lines (the proof
 * frame), the reviewer's name as a script line when the review gives one,
 * the mark. Only drawn for review text that exists (the server checks).
 */
function postReviewFrame(ctx: Ctx, s: StoryFrameSlide): string {
  const { cv } = ctx
  const zone = calmZone(ctx, "top")
  const author = clean(s.script_line)
  const by = zone === "top" ? Math.round(cv.h * 0.3) + 360 : Math.round(cv.h * 0.56) - 90
  const script = author ? scriptAt(ctx, `— ${author}`, cv.w / 2 - 120, clampY(cv, by), 72).svg : ""
  return proofFrame(ctx, { ...s, quote: clean(s.quote) || clean(s.big_words) }) + script
}

// ─── Carousel middle slides (1080x1350) ─────────────────────────────────────

/** Body text (<= 12 words) as up to 3 short lines in the clean face. */
function bodyLines(ctx: Ctx, text: string, x: number, y: number, color: string, filter: string | null, align: Align = "start"): { svg: string; height: number } {
  const t = clean(text)
  if (!t) return { svg: "", height: 0 }
  // Smaller in a narrow region rather than cut: every word stays.
  const maxW = Math.max(160, align === "middle" ? ctx.cv.w - ctx.cv.side * 2 : align === "end" ? x - ctx.cv.side - 20 : ctx.cv.w - ctx.cv.side - x - 20)
  let size = 46
  let lines = wrap(ctx.f.box, t, size, maxW)
  while (size > 32 && lines.length > 3) { size -= 2; lines = wrap(ctx.f.box, t, size, maxW) }
  lines = lines.slice(0, 4)
  const lh = size * 1.3
  const svg = lines.map((l, i) => `<text x="${r1(x)}" y="${r1(y + size + i * lh)}" text-anchor="${align}" font-family="${family(BOX_FONT)}" font-size="${size}" font-weight="700" fill="${color}"${filter ? ` filter="url(#${filter})"` : ""}>${esc(l)}</text>`).join("")
  return { svg, height: lines.length * lh + size * 0.3 }
}

/** Photo-led: the photo, display words in its calmer half, the body under them. */
function slidePhotoFrame(ctx: Ctx, s: StoryFrameSlide): string {
  const { cv } = ctx
  const zone = calmZone(ctx)
  const ink = inkFor(ctx.stats[zone], ctx.p)
  const z = zones(cv)[zone]
  // Leave room for the body under the words.
  // The last display line in the brand colour, as on the hook.
  const accent = { color: brandColorOver(ctx.p, ink, ctx.stats[zone]), underline: ctx.p.accent }
  // Room for the body under the words, wherever they sit (a short band beside the subject included).
  const bodyRoom = s.body ? 190 : 0
  const block = displayBlock(cv, ctx.f, clean(s.big_words) || clean(s.text), zone === "top" && !cv.single ? z : { y0: z.y0, y1: Math.max(z.y0 + 80, z.y1 - bodyRoom) }, cv.single ? "top" : zone, ink, ctx.rnd, 0.2, accent)
  const at = besideBlock(block, 4)
  const body = bodyLines(ctx, s.body ?? "", at.x, block.bottom + 18, ink.color, ink.filter, at.anchor)
  return block.svg + body.svg
}

/** Type-led: no photo -- the brand's base colour, big deep-ink words with an accent line, the body, a tape strip. */
function slideTypeFrame(ctx: Ctx, s: StoryFrameSlide): string {
  const { cv } = ctx
  const roles = paletteRoles(ctx.p)
  const bg = ctx.p.base
  const ink: Ink = { color: roles.ink, filter: "glow", light: false }
  // Pop first (deepened / lifted to read on the base), then accent.
  const accentColor = [ctx.p.pop, ensureContrast(ctx.p.pop, bg, AA_GRAPHIC + 0.5), ctx.p.accent].find((c) => hexContrast(c, bg) >= AA_GRAPHIC + 0.5) ?? null
  const block = displayBlock(cv, ctx.f, clean(s.big_words) || clean(s.text), { y0: cv.safeTop + 140, y1: Math.round(cv.h * 0.66) }, "top", ink, ctx.rnd, 0.28, { color: accentColor, underline: ctx.p.accent })
  const at = besideBlock(block, 4)
  const body = bodyLines(ctx, s.body ?? "", at.x, block.bottom + 30, roles.inkMuted, null, at.anchor)
  return block.svg + body.svg
}

const DRAW: Record<FrameKind, (ctx: Ctx, s: StoryFrameSlide) => string> = {
  hook: hookFrame,
  offer: offerFrame,
  product: productFrame,
  proof: proofFrame,
  cta: ctaFrame,
  post_bold: hookFrame,
  post_product: postProductFrame,
  post_quote: postQuoteFrame,
  post_minimal: postMinimalFrame,
  post_listicle: postListicleFrame,
  post_festive: postFestiveFrame,
  post_review: postReviewFrame,
  slide_photo: slidePhotoFrame,
  slide_type: slideTypeFrame,
}

/** Renders one story frame to a 1080x1920 JPEG. Throws only if the canvas itself can't be drawn. */
export function renderStoryFrame(slide: StoryFrameSlide): Promise<Buffer> {
  return renderFrame(slide, STORY_CANVAS)
}

/** What renderFrame draws, in layers -- scripts/test-text-placement.ts checks the text layer against the subject. */
export interface FrameLayers {
  base: Buffer
  /** The text, stickers, tape and mark only (transparent PNG, canvas size). */
  overlay: Buffer
  subjects: Rect[]
  region: Rect
  layout: FrameLayout
}

/** The frame as layers: its background, its text layer, and where the subject and text region are. */
export async function renderFrameLayers(slide: StoryFrameSlide, cv: FrameCanvas, opts: { plain?: boolean } = {}): Promise<FrameLayers> {
  const p = slide.palette ?? NEUTRAL_PALETTE
  const rnd = prng(typeof slide.seed === "number" ? slide.seed : 1)
  const displayId: FontId = frameDisplayFont(isFontId(slide.font_id) ? slide.font_id : DEFAULT_FONT_ID)
  const { display, script, box, fontFiles } = await loadFonts(displayId)
  const composed: Composed = slide.frame === "slide_type"
    ? { ...(await flatBackground(p.base, rnd, cv)), subjects: [], region: { x0: 0, y0: 0, x1: cv.w, y1: cv.h }, layout: "full" }
    : await compose(slide, p, rnd, cv, (w, h) => fitHeadline(display, displayId, clean(slide.big_words) || clean(slide.text) || clean(slide.quote), w, h).size)
  const { base, photo, region, layout } = composed
  // The frame draws on its region as if it were the canvas: full = the
  // canvas itself; otherwise a sub-canvas keeping what's left of the safe area.
  const sub: FrameCanvas = layout === "full" ? cv : {
    w: rw(region),
    h: rh(region),
    safeTop: Math.max(0, cv.safeTop - region.y0) + 24,
    safeBottom: Math.max(0, region.y1 - (cv.h - cv.safeBottom)) + 24,
    // Room for the headline's small rotation inside the safe edge.
    side: 44,
    single: true,
    // Left in a left region, right in a right one, centred in a full-width band.
    align: region.x0 <= 1 && region.x1 < cv.w - 1 ? "start" : region.x0 > 1 && region.x1 >= cv.w - 1 ? "end" : "middle",
  }
  const frac = { x: region.x0 / cv.w, y: region.y0 / cv.h, w: rw(region) / cv.w, h: rh(region) / cv.h }
  // Where text sits and how it's inked depends on the photo under it.
  const stats = photo
    ? layout === "full"
      ? {
          top: await regionLuminance(base, { x: 0.05, y: cv.safeTop / cv.h, w: 0.9, h: 0.36 }).catch(() => null),
          bottom: await regionLuminance(base, { x: 0.05, y: 0.5, w: 0.9, h: 0.36 }).catch(() => null),
        }
      : await (async () => { const all = await regionLuminance(base, { x: frac.x + frac.w * 0.04, y: frac.y + frac.h * 0.04, w: frac.w * 0.92, h: frac.h * 0.92 }).catch(() => null); return { top: all, bottom: all } })()
    : { top: null, bottom: null }
  const bands = photo ? await bandStats(base, frac) : Array<RegionStats | null>(BANDS).fill(null)
  // The mark: every post; a carousel / story's opening hook and its cta
  // (brand_mark, stamped per sequence; a slide from before the flag: any
  // hook / cta) -- unless the brand turned the logo off.
  const isPost = slide.frame.startsWith("post_")
  const wantsMark = slide.show_logo !== false && (isPost || (slide.brand_mark ?? (slide.frame === "hook" || slide.frame === "cta"))) && !!(slide.logo_url || slide.brand_name)
  const ctx: Ctx = { cv: sub, f: { displayId, display, script, box }, p, rnd, stats, bands }
  const raw = (DRAW[slide.frame] ?? hookFrame)(ctx, slide)
  // The tests measure the glyphs themselves, without their soft shadow / glow.
  const drawn = opts.plain ? raw.replace(/ filter="url\(#[a-z]+\)"/g, "") : raw
  // Anything drawn past the region's edge is clipped -- text never reaches the subject.
  const body = layout === "full" ? drawn : `<clipPath id="region"><rect x="0" y="0" width="${rw(region)}" height="${rh(region)}"/></clipPath><g transform="translate(${region.x0} ${region.y0})" clip-path="url(#region)">${drawn}</g>`
  const svg = `<svg width="${cv.w}" height="${cv.h}" xmlns="http://www.w3.org/2000/svg">${FILTERS}${body}</svg>`
  const textLayer = Buffer.from(new Resvg(svg, { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: FONT_FAMILY_NAME[displayId] } }).render().asPng())
  const overlay = wantsMark ? await placeMark(slide, textLayer, base, composed.subjects, cv, displayId, display, fontFiles) : textLayer
  return { base, overlay, subjects: composed.subjects, region, layout }
}

/** Renders one frame on `cv` to a JPEG. Throws only if the canvas itself can't be drawn. */
export async function renderFrame(slide: StoryFrameSlide, cv: FrameCanvas): Promise<Buffer> {
  const { base, overlay } = await renderFrameLayers(slide, cv)
  // JPEG: a grainy full-bleed photo is ~5MB as PNG and well under 1MB as
  // JPEG -- the preview, downloads and publishing all carry this one image.
  return sharp(base).composite([{ input: overlay, top: 0, left: 0 }]).jpeg({ quality: 90, mozjpeg: true }).toBuffer()
}

// The woff2 decoder behind getFont / getFontPath isn't safe to run
// concurrently (a sequence renders its frames in parallel), so font loading
// goes through one queue.
let fontQueue: Promise<unknown> = Promise.resolve()
function loadFonts(displayId: FontId): Promise<{ display: fontkit.Font; script: fontkit.Font; box: fontkit.Font; fontFiles: string[] }> {
  const run = fontQueue.then(async () => {
    const display = await getFont(displayId)
    const script = await getFont(SCRIPT_FONT)
    const box = await getFont(BOX_FONT)
    const fontFiles = [...new Set([await getFontPath(displayId), await getFontPath(SCRIPT_FONT), await getFontPath(BOX_FONT)])]
    return { display, script, box, fontFiles }
  })
  fontQueue = run.catch(() => undefined)
  return run
}
