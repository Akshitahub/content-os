import sharp from "sharp"
import { Resvg } from "@resvg/resvg-js"
import type * as fontkit from "fontkit"
import { getFont, getFontPath, handArrow, measureTextWidth } from "@/lib/image/post-compositor"
import { regionLuminance, type RegionStats } from "@/lib/image/text-contrast"
import { bestContrast, ensureContrast, hexContrast, hexLuminance, mixHex, AA_BODY, AA_GRAPHIC } from "@/lib/design/contrast-math"
import { FONT_FAMILY_NAME, DEFAULT_FONT_ID, isFontId, type FontId } from "@/lib/design/fonts"
import { NEUTRAL_PALETTE, type BrandPalette } from "@/lib/design/color-themes"
import { sanitizeTextForCompositing } from "@/lib/image/sanitize-text-for-compositing"
import type { StoryFrame, StoryFrameFields } from "@/lib/ai/story-frames"

/**
 * Story frames (lib/ai/story-frames.ts), drawn on a 1080x1920 canvas:
 * always a full-bleed photo (or, without one, the brand palette) with type
 * layered straight on it -- never a dark text panel. Text over the photo
 * gets a soft local shadow (light text) or glow (dark text), sized to the
 * letters, nothing more. Instagram's top and bottom ~250px stay clear of
 * text. Small rotations / offsets and the photo grain come from the
 * frame's seed, so a frame renders the same every time -- the editor
 * preview, a download and the published image are this one render.
 * Colours come from the brand's 4-role palette (resolveBrandPalette).
 */

const W = 1080
const H = 1920
/** Instagram's own UI (profile row, reply bar) covers about this much at the top and bottom. */
const SAFE = 250
const SIDE = 72
const SCRIPT_FONT: FontId = "caveat"
const BOX_FONT: FontId = "inter"

export interface StoryFrameSlide extends StoryFrameFields {
  frame: StoryFrame
  /** The frame's primary copy as mirrored by finalizeStoryFrames -- the fallback when a field is empty. */
  text?: string
  background_image_url?: string | null
  font_id?: FontId | null
  palette?: BrandPalette | null
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
const clean = (s: string | null | undefined) => sanitizeTextForCompositing((s ?? "").trim())

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

// ─── Background: photo (cover) or the palette, plus grain ──────────────────

async function background(slide: StoryFrameSlide, p: BrandPalette, rnd: () => number): Promise<{ base: Buffer; photo: boolean }> {
  const src = slide.background_image_url ? await fetchImage(slide.background_image_url) : null
  let base: Buffer | null = null
  if (src) {
    try {
      base = await sharp(src).rotate().resize(W, H, { fit: "cover", position: "attention" }).removeAlpha().png().toBuffer()
    } catch {
      base = null
    }
  }
  const photo = !!base
  if (!base) {
    // No photo: the palette, deep into accent, never a flat preset.
    const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0%" stop-color="${p.deep}"/><stop offset="100%" stop-color="${mixHex(p.deep, p.accent, 0.55)}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/></svg>`
    base = Buffer.from(new Resvg(svg).render().asPng())
  }
  // Light film grain (seeded), overlay-blended around mid grey.
  const grain = Buffer.alloc(W * H * 3)
  const amount = photo ? 22 : 16
  for (let i = 0; i < W * H; i++) {
    const v = 128 + Math.round((rnd() - 0.5) * 2 * amount)
    grain[i * 3] = v
    grain[i * 3 + 1] = v
    grain[i * 3 + 2] = v
  }
  const withGrain = await sharp(base).composite([{ input: grain, raw: { width: W, height: H, channels: 3 }, blend: "overlay" }]).png().toBuffer()
  return { base: withGrain, photo }
}

// ─── Text treatment over the photo ──────────────────────────────────────────

type Zone = "top" | "bottom"
const ZONES: Record<Zone, { y0: number; y1: number }> = {
  top: { y0: SAFE + 30, y1: Math.round(H * 0.5) },
  bottom: { y0: Math.round(H * 0.5), y1: H - SAFE - 30 },
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

/** The photo's luminance per horizontal band. */
async function bandStats(base: Buffer): Promise<(RegionStats | null)[]> {
  const out: (RegionStats | null)[] = []
  for (let i = 0; i < BANDS; i++) out.push(await regionLuminance(base, { x: 0.04, y: i / BANDS, w: 0.92, h: 1 / BANDS }).catch(() => null))
  return out
}

/** Combined stats for the bands a span [y0, y1] covers: brightest high, darkest low, average mean, widest spread. */
function spanStats(bands: (RegionStats | null)[], y0: number, y1: number): RegionStats | null {
  const from = Math.max(0, Math.floor((Math.min(y0, y1) / H) * BANDS))
  const to = Math.min(BANDS - 1, Math.floor((Math.max(y0, y1) / H) * BANDS))
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
}

/**
 * The display words, one word per line (a very short word joins the next),
 * sized so the block is ~30% of the frame height -- smaller only when the
 * longest line wouldn't fit the width. Anchored to the top or bottom of
 * `zone`, left-aligned or centred, rotated a couple of degrees.
 */
function displayBlock(f: Fonts, words: string, zone: { y0: number; y1: number }, anchor: Zone, ink: Ink, rnd: () => number, heightShare = 0.3): Block {
  const raw = displayCase(f.displayId, words).split(/\s+/).filter(Boolean)
  const lines: string[] = []
  for (const w of raw) {
    const prev = lines[lines.length - 1]
    if (prev && (prev.length <= 3 || w.length <= 2)) lines[lines.length - 1] = `${prev} ${w}`
    else lines.push(w)
  }
  const lh = displayLineHeight(f.displayId)
  const maxW = W - SIDE * 2
  const byHeight = (H * heightShare) / (lines.length * lh)
  const byWidth = Math.min(...lines.map((l) => maxW / Math.max(1, measureTextWidth(f.display, l, 1))))
  const size = Math.floor(Math.min(byHeight, byWidth, (zone.y1 - zone.y0) / (lines.length * lh)))
  const blockH = lines.length * size * lh
  const widths = lines.map((l) => measureTextWidth(f.display, l, size))
  const blockW = Math.max(...widths)
  const centred = rnd() < 0.45
  const jitterX = Math.round((rnd() - 0.5) * 40)
  const left = centred ? (W - blockW) / 2 + jitterX : SIDE + Math.max(0, Math.round(rnd() * 34))
  const top = anchor === "top" ? zone.y0 + Math.round(rnd() * 30) : zone.y1 - blockH - Math.round(rnd() * 30)
  const angle = (rnd() < 0.5 ? -1 : 1) * (0.8 + rnd() * 1.8)
  const cx = left + blockW / 2
  const cy = top + blockH / 2
  const text = lines.map((l, i) => {
    const x = centred ? left + (blockW - widths[i]!) / 2 : left
    const y = top + size * (i * lh + 0.86)
    return `<text x="${r1(x)}" y="${r1(y)}" font-family="${family(f.displayId)}" font-size="${size}" font-weight="700" fill="${ink.color}">${esc(l)}</text>`
  }).join("")
  return { svg: `<g transform="rotate(${r1(angle)} ${r1(cx)} ${r1(cy)})" filter="url(#${ink.filter})">${text}</g>`, top, bottom: top + blockH, left, right: left + blockW }
}

/** One handwritten line in the script face, rotated a few degrees. */
function scriptLine(f: Fonts, text: string, x: number, y: number, color: string, filter: string, rnd: () => number, size = 88, anchor: "start" | "end" = "start"): { svg: string; width: number } {
  const t = clean(text)
  if (!t) return { svg: "", width: 0 }
  let s = size
  while (s > 56 && measureTextWidth(f.script, t, s) > W - SIDE * 2) s -= 4
  const width = measureTextWidth(f.script, t, s)
  const angle = (rnd() < 0.5 ? -1 : 1) * (2 + rnd() * 3)
  const ax = anchor === "end" ? x - width : x
  return {
    svg: `<g transform="rotate(${r1(angle)} ${r1(ax + width / 2)} ${r1(y)})" filter="url(#${filter})"><text x="${r1(ax)}" y="${r1(y)}" font-family="${family(SCRIPT_FONT)}" font-size="${s}" font-weight="700" fill="${color}">${esc(t)}</text></g>`,
    width,
  }
}

/** The script line's colour: the brand pop when it clears 3:1 against the photo it crosses, else the ink. */
function scriptColor(p: BrandPalette, ink: Ink, stats: RegionStats | null): string {
  if (!stats) return hexContrast(p.pop, p.deep) >= AA_GRAPHIC ? p.pop : ink.color
  const L = hexLuminance(p.pop)
  // Light text crosses the region's brightest parts, dark text its darkest.
  const against = ink.light ? stats.high : stats.low
  const ratio = (Math.max(L, against) + 0.05) / (Math.min(L, against) + 0.05)
  const sameSide = ink.light ? L > against : L < against
  return sameSide && ratio >= AA_GRAPHIC ? p.pop : ink.color
}

/** Clamp a text block's vertical span into the safe area. */
const clampY = (y: number) => Math.max(SAFE + 20, Math.min(H - SAFE - 20, y))

// ─── Decorations ────────────────────────────────────────────────────────────

/** A torn-edged strip of tape: zig-zag short ends, translucent. */
function tapePath(w: number, h: number, rnd: () => number): string {
  const teeth = 6
  const pts: string[] = []
  for (let i = 0; i <= teeth; i++) pts.push(`${r1((i % 2 ? 9 : 0) + rnd() * 5)},${r1((h / teeth) * i)}`)
  for (let i = teeth; i >= 0; i--) pts.push(`${r1(w - (i % 2 ? 9 : 0) - rnd() * 5)},${r1((h / teeth) * i)}`)
  return pts.join(" ")
}

function tapeStrip(cx: number, cy: number, w: number, h: number, angle: number, fill: string, rnd: () => number, opacity = 0.82): string {
  return `<g transform="translate(${r1(cx - w / 2)} ${r1(cy - h / 2)}) rotate(${r1(angle)} ${r1(w / 2)} ${r1(h / 2)})" filter="url(#drop)"><polygon points="${tapePath(w, h, rnd)}" fill="${fill}" fill-opacity="${opacity}"/></g>`
}

/** A hand-drawn arrow from (x1,y1) toward (x2,y2) -- annotated_product's own drawing, thicker. */
const arrow = (x1: number, y1: number, x2: number, y2: number, bow: number, color: string, filter: string) =>
  `<g filter="url(#${filter})">${handArrow(x1, y1, x2, y2, bow, color, 7)}</g>`

// ─── Frames ─────────────────────────────────────────────────────────────────

interface Ctx {
  f: Fonts
  p: BrandPalette
  rnd: () => number
  stats: Record<Zone, RegionStats | null>
  bands: (RegionStats | null)[]
}

/** Ink + stats for the text span [y0, y1]. */
function inkAt(ctx: Ctx, y0: number, y1: number): { ink: Ink; stats: RegionStats | null } {
  const stats = spanStats(ctx.bands, y0, y1)
  return { ink: inkFor(stats, ctx.p), stats }
}

/** A script line at (x, y), inked for the strip it sits on. */
function scriptAt(ctx: Ctx, text: string, x: number, y: number, size = 88): { svg: string; width: number; color: string; filter: string } {
  const { ink, stats } = inkAt(ctx, y - size, y + size * 0.3)
  const color = scriptColor(ctx.p, ink, stats)
  return { ...scriptLine(ctx.f, text, x, y, color, ink.filter, ctx.rnd, size), color, filter: ink.filter }
}

/** The calmer of the two zones for the main text (lower luminance spread). */
function calmZone(ctx: Ctx, prefer?: Zone): Zone {
  const { top, bottom } = ctx.stats
  if (!top || !bottom) return prefer ?? (ctx.rnd() < 0.5 ? "top" : "bottom")
  if (Math.abs(top.std - bottom.std) < 0.03 && prefer) return prefer
  return top.std <= bottom.std ? "top" : "bottom"
}

function hookFrame(ctx: Ctx, s: StoryFrameSlide): string {
  const zone = calmZone(ctx)
  const ink = inkFor(ctx.stats[zone], ctx.p)
  const block = displayBlock(ctx.f, clean(s.big_words) || clean(s.text), ZONES[zone], zone, ink, ctx.rnd)
  const scriptY = zone === "top" ? clampY(block.bottom + 130) : clampY(block.top - 50)
  const script = scriptAt(ctx, s.script_line ?? "", block.left + 18 + Math.round(ctx.rnd() * 60), scriptY, 96)
  return block.svg + script.svg + (s.tape ? tapeStrip(zone === "top" ? W - 210 : 220, zone === "top" ? H - SAFE - 40 : SAFE + 40, 330, 92, zone === "top" ? -24 : -32, ctx.p.base, ctx.rnd) : "")
}

function offerFrame(ctx: Ctx, s: StoryFrameSlide): string {
  // Display line in the calmer zone; the badge in the other half, overlapping the photo like a sticker.
  const zone = calmZone(ctx, "bottom")
  const ink = inkFor(ctx.stats[zone], ctx.p)
  const block = displayBlock(ctx.f, clean(s.big_words) || clean(s.text), ZONES[zone], zone, ink, ctx.rnd, 0.22)
  const r = 205
  const bx = ctx.rnd() < 0.5 ? W - SIDE - r - Math.round(ctx.rnd() * 30) : SIDE + r + Math.round(ctx.rnd() * 30)
  const by = zone === "bottom" ? SAFE + r + 60 + Math.round(ctx.rnd() * 60) : H - SAFE - r - 60 - Math.round(ctx.rnd() * 60)
  const fill = ctx.p.pop
  const ink2 = bestContrast(fill, ["#ffffff", ctx.p.deep, "#111111"])
  const words = displayCase(ctx.f.displayId, clean(s.badge)).split(/\s+/).filter(Boolean)
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
  const scriptY = zone === "top" ? clampY(block.bottom + 120) : clampY(block.top - 46)
  const script = scriptAt(ctx, s.script_line ?? "", block.left + 24, scriptY, 88)
  return badge + block.svg + script.svg
}

function productFrame(ctx: Ctx, s: StoryFrameSlide): string {
  const out: string[] = []
  // Two handwritten callouts, upper-left and lower-right, arrows curving in
  // toward the middle of the photo where the product is.
  const callouts = (s.callouts ?? []).map(clean).filter(Boolean).slice(0, 2)
  const size = 86
  const maxW = 700
  const targets = [{ x: W * 0.47, y: H * 0.43 }, { x: W * 0.55, y: H * 0.58 }]
  callouts.forEach((c, i) => {
    // Two lines only when one won't fit -- then split near the middle, never one word alone.
    const full = measureTextWidth(ctx.f.script, c, size)
    const lines = full <= maxW ? [c] : wrap(ctx.f.script, c, size, Math.max(full / 2 + 40, 260)).slice(0, 2)
    const lw = Math.max(...lines.map((l) => measureTextWidth(ctx.f.script, l, size)))
    const right = i === 1
    const x = right ? W - SIDE - Math.round(ctx.rnd() * 30) : SIDE + Math.round(ctx.rnd() * 30)
    const y0 = right ? Math.round(H * 0.66) + Math.round(ctx.rnd() * 60) : SAFE + 120 + Math.round(ctx.rnd() * 60)
    const { ink } = inkAt(ctx, y0 - size, y0 + lines.length * size)
    const angle = (right ? 1 : -1) * (2 + ctx.rnd() * 3)
    const text = lines.map((l, k) => `<text x="${x}" y="${y0 + k * size * 1.02}" text-anchor="${right ? "end" : "start"}" font-family="${family(SCRIPT_FONT)}" font-size="${size}" font-weight="700" fill="${ink.color}">${esc(l)}</text>`).join("")
    const tx = right ? x - lw : x
    out.push(`<g transform="rotate(${r1(angle)} ${r1(tx + lw / 2)} ${y0})" filter="url(#${ink.filter})">${text}</g>`)
    // Arrow from just past the text toward the product, stopping short of it.
    const sx = right ? x - lw * 0.55 : x + lw * 0.55
    const sy = right ? y0 - size * 0.95 : y0 + (lines.length - 1) * size + size * 0.45
    const t = targets[i]!
    const ex = sx + (t.x - sx) * 0.62
    const ey = sy + (t.y - sy) * 0.62
    out.push(arrow(sx, sy, ex, ey, right ? -55 : 55, ink.color, ink.filter))
  })
  // The torn-tape label with the display words, low on the frame.
  const label = displayCase(ctx.f.displayId, clean(s.big_words) || clean(s.text))
  if (label) {
    let fs = 104
    while (fs > 60 && measureTextWidth(ctx.f.display, label, fs) > W - SIDE * 2 - 120) fs -= 4
    const tw = measureTextWidth(ctx.f.display, label, fs)
    const w = tw + 110
    const h = fs * 1.42
    const cx = SIDE + w / 2 + Math.round(ctx.rnd() * 40)
    const cy = H - SAFE - h / 2 - 150 - Math.round(ctx.rnd() * 50)
    const angle = (ctx.rnd() < 0.5 ? -1 : 1) * (2 + ctx.rnd() * 3)
    const tapeFill = mixHex(ctx.p.base, "#ffffff", 0.35)
    const textColor = ensureContrast(ctx.p.deep, tapeFill, AA_BODY)
    out.push(`<g transform="rotate(${r1(angle)} ${r1(cx)} ${r1(cy)})">${tapeStrip(cx, cy, w, h, 0, tapeFill, ctx.rnd, 0.94)}<text x="${r1(cx)}" y="${r1(cy + fs * 0.34)}" text-anchor="middle" font-family="${family(ctx.f.displayId)}" font-size="${fs}" font-weight="700" fill="${textColor}">${esc(label)}</text></g>`)
  }
  return out.join("")
}

/** Instagram's own text tool: each line on a rounded, solid highlight, the lines merged into one shape. */
function proofFrame(ctx: Ctx, s: StoryFrameSlide): string {
  const quote = clean(s.quote) || clean(s.text)
  const size = 74
  const lines = wrap(ctx.f.box, quote, size, 840)
  const padX = 32
  const lineH = size * 1.4
  const fill = "#ffffff"
  const ink = ensureContrast(ctx.p.deep, fill, AA_BODY)
  const zone = calmZone(ctx, "top")
  const totalH = lines.length * lineH
  const top = clampY(zone === "top" ? Math.round(H * 0.3) : Math.round(H * 0.56)) + Math.round(ctx.rnd() * 40)
  const cx = W / 2 + Math.round((ctx.rnd() - 0.5) * 60)
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
  const mark = `<text x="${r1(cx - widest / 2 - padX - 10)}" y="${r1(top + 40)}" font-family="${family(SCRIPT_FONT)}" font-size="240" font-weight="700" fill="${markColor}" filter="url(#drop)">&#8220;</text>`
  return `<g transform="rotate(${r1(angle)} ${r1(cx)} ${r1(top + totalH / 2)})"><g filter="url(#drop)">${rects.join("")}</g>${texts.join("")}</g>${mark}`
}

/** An Instagram-style pill button with a hand-drawn arrow pointing at it. */
function ctaFrame(ctx: Ctx, s: StoryFrameSlide): string {
  const inkTop = inkFor(ctx.stats.top, ctx.p)
  const block = displayBlock(ctx.f, clean(s.big_words) || clean(s.text), ZONES.top, "top", inkTop, ctx.rnd, 0.24)
  const label = clean(s.cta_label) || "Shop now"
  let fs = 54
  while (fs > 38 && measureTextWidth(ctx.f.box, label, fs) > W - SIDE * 2 - 160) fs -= 2
  const tw = measureTextWidth(ctx.f.box, label, fs)
  const pw = tw + 130
  const ph = 124
  const px = (W - pw) / 2
  const py = H - SAFE - ph - 120 - Math.round(ctx.rnd() * 40)
  const pillFill = "#ffffff"
  const pillInk = ensureContrast(ctx.p.deep, pillFill, AA_BODY)
  const pill = `<g filter="url(#drop)"><rect x="${r1(px)}" y="${r1(py)}" width="${r1(pw)}" height="${ph}" rx="${ph / 2}" fill="${pillFill}"/></g><text x="${W / 2}" y="${r1(py + ph / 2 + fs * 0.36)}" text-anchor="middle" font-family="${family(BOX_FONT)}" font-size="${fs}" font-weight="700" fill="${pillInk}">${esc(label)}</text>`
  // The script line above-left, its arrow curving down to the pill.
  const sy = clampY(py - 230 - Math.round(ctx.rnd() * 40))
  const sx = SIDE + 10 + Math.round(ctx.rnd() * 40)
  const script = scriptAt(ctx, s.script_line ?? "", sx, sy, 92)
  const startX = s.script_line ? sx + Math.min(script.width, 360) * 0.5 : sx + 120
  const startY = sy + 40
  const arrowInk = inkAt(ctx, startY, py + ph)
  const arrowSvg = arrow(startX, startY, px - 18, py + ph * 0.35, -70, s.script_line ? script.color : arrowInk.ink.color, arrowInk.ink.filter)
  return block.svg + script.svg + arrowSvg + pill + (s.tape ? tapeStrip(W - 200, H - SAFE - 20, 300, 86, 28, ctx.p.base, ctx.rnd) : "")
}

const DRAW: Record<StoryFrame, (ctx: Ctx, s: StoryFrameSlide) => string> = {
  hook: hookFrame,
  offer: offerFrame,
  product: productFrame,
  proof: proofFrame,
  cta: ctaFrame,
}

/** Renders one story frame to a 1080x1920 JPEG. Throws only if the canvas itself can't be drawn. */
export async function renderStoryFrame(slide: StoryFrameSlide): Promise<Buffer> {
  const p = slide.palette ?? NEUTRAL_PALETTE
  const rnd = prng(typeof slide.seed === "number" ? slide.seed : 1)
  const displayId: FontId = isFontId(slide.font_id) ? slide.font_id : DEFAULT_FONT_ID
  const { display, script, box, fontFiles } = await loadFonts(displayId)
  const { base, photo } = await background(slide, p, rnd)
  // Where text sits and how it's inked depends on the photo under it.
  const stats = photo
    ? {
        top: await regionLuminance(base, { x: 0.05, y: SAFE / H, w: 0.9, h: 0.36 }).catch(() => null),
        bottom: await regionLuminance(base, { x: 0.05, y: 0.5, w: 0.9, h: 0.36 }).catch(() => null),
      }
    : { top: null, bottom: null }
  const bands = photo ? await bandStats(base) : Array<RegionStats | null>(BANDS).fill(null)
  const ctx: Ctx = { f: { displayId, display, script, box }, p, rnd, stats, bands }
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${FILTERS}${(DRAW[slide.frame] ?? hookFrame)(ctx, slide)}</svg>`
  const overlay = Buffer.from(new Resvg(svg, { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: FONT_FAMILY_NAME[displayId] } }).render().asPng())
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
