import type { TextRegion, TextStyle } from "@/lib/design/text-style"

// sharp is loaded only by the image functions below, so the colour helpers
// (hexContrast, readableInk, ...) are safe to import from client code too.
async function loadSharp() {
  return (await import("sharp")).default
}

// WCAG 2.x targets: headline (large text) 3:1, body 4.5:1.
const HEADLINE_CONTRAST = 3
const BODY_CONTRAST = 4.5
const MAX_SCRIM = 0.75
// Luminance standard deviation above which a region reads as busy (fine
// detail, hard edges) -- a uniform scrim alone leaves letters fighting it.
const BUSY_STD = 0.2
// Text colors' relative luminance: pure white, and TEXT_STYLE_PALETTE.dark (#111827).
const LIGHT_TEXT_L = 1
const DARK_TEXT_L = 0.0098

function channelToLinear(c: number): number {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** Black scrim alpha so light text over luminance L reaches `ratio`. */
function lightScrimFor(L: number, ratio: number): number {
  const maxBg = (LIGHT_TEXT_L + 0.05) / ratio - 0.05
  return L <= maxBg ? 0 : 1 - maxBg / L
}

/** White scrim alpha so dark text over luminance L reaches `ratio`. */
function darkScrimFor(L: number, ratio: number): number {
  const minBg = ratio * (DARK_TEXT_L + 0.05) - 0.05
  return L >= minBg ? 0 : (minBg - L) / (1 - L)
}

function percentile(sorted: Float64Array, p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))]!
}

export interface RegionStats {
  mean: number
  std: number
  /** 10th/90th-percentile luminance -- the darkest/brightest parts text will cross. */
  low: number
  high: number
}

/** Relative luminance (WCAG) statistics of one region of an image. */
export async function regionLuminance(image: Buffer, region: TextRegion): Promise<RegionStats> {
  const sharp = await loadSharp()
  const meta = await sharp(image).metadata()
  const W = meta.width ?? 0
  const H = meta.height ?? 0
  if (!W || !H) throw new Error("text-contrast: image has no dimensions")
  const left = Math.min(W - 1, Math.max(0, Math.round(region.x * W)))
  const top = Math.min(H - 1, Math.max(0, Math.round(region.y * H)))
  const width = Math.max(1, Math.min(W - left, Math.round(region.w * W)))
  const height = Math.max(1, Math.min(H - top, Math.round(region.h * H)))

  // Downsampled to a fixed grid: deterministic, and the statistics don't
  // need every pixel. Nearest-neighbour keeps real pixel values, so a busy
  // region isn't averaged into a flat grey.
  const { data, info } = await sharp(image)
    .extract({ left, top, width, height })
    .resize(64, 64, { fit: "fill", kernel: "nearest" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const n = info.width * info.height
  const lum = new Float64Array(n)
  let sum = 0
  for (let i = 0; i < n; i++) {
    const o = i * info.channels
    const L = 0.2126 * channelToLinear(data[o]!) + 0.7152 * channelToLinear(data[o + 1]!) + 0.0722 * channelToLinear(data[o + 2]!)
    lum[i] = L
    sum += L
  }
  const mean = sum / n
  let sq = 0
  for (let i = 0; i < n; i++) sq += (lum[i]! - mean) ** 2
  lum.sort()
  return { mean, std: Math.sqrt(sq / n), low: percentile(lum, 0.1), high: percentile(lum, 0.9) }
}

/**
 * The text treatment for one region, pure in its statistics: light or dark
 * text, whichever needs the lighter scrim (light when `preferLight`, e.g. a
 * template whose text is always white), with the scrim strong enough that
 * the headline clears 3:1 and body text 4.5:1 against the region's
 * brightest (for light text) or darkest (for dark text) 10% -- body copy
 * crosses those parts too, not just the average. A busy region, or one
 * that would need more than MAX_SCRIM, also gets a backing panel.
 */
export function textStyleFromStats(stats: RegionStats, options: { preferLight?: boolean } = {}): TextStyle {
  const light = Math.max(lightScrimFor(stats.high, HEADLINE_CONTRAST), lightScrimFor(stats.high, BODY_CONTRAST))
  const dark = Math.max(darkScrimFor(stats.low, HEADLINE_CONTRAST), darkScrimFor(stats.low, BODY_CONTRAST))
  const useLight = options.preferLight || light <= dark
  const needed = useLight ? light : dark
  const busy = stats.std > BUSY_STD
  return {
    text_color: useLight ? "light" : "dark",
    scrim_opacity: Math.round(Math.min(MAX_SCRIM, needed + (busy ? 0.1 : 0)) * 100) / 100,
    needs_backing: busy || needed > MAX_SCRIM,
  }
}

export async function computeTextStyle(image: Buffer, region: TextRegion, options: { preferLight?: boolean } = {}): Promise<TextStyle> {
  return textStyleFromStats(await regionLuminance(image, region), options)
}

/** Fail-soft wrapper for generation routes: a broken image never fails the
 * generation over this -- null just means renderers keep their old scrim. */
export async function computeTextStyleSafe(image: Buffer, region: TextRegion, options: { preferLight?: boolean } = {}): Promise<TextStyle | null> {
  try {
    return await computeTextStyle(image, region, options)
  } catch (err) {
    console.error("[text-contrast] couldn't compute text_style (non-fatal):", err instanceof Error ? err.message : err)
    return null
  }
}

/** Contrast the chosen style actually achieves over a region of luminance L (for checks). */
export function achievedContrast(style: TextStyle, L: number): number {
  if (style.text_color === "light") return contrast(LIGHT_TEXT_L, L * (1 - style.scrim_opacity))
  return contrast(DARK_TEXT_L, L + style.scrim_opacity * (1 - L))
}

// ─── Colour pairs (brand palette roles) ──────────────────────────────────────

/** Required contrast for text: 3:1 for large text (headlines), 4.5:1 for body (WCAG AA). */
export const AA_LARGE = HEADLINE_CONTRAST
export const AA_BODY = BODY_CONTRAST
/** Non-text graphics (marks, bars, dots) against their background: 3:1. */
export const AA_GRAPHIC = 3

export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim())
  if (!m) return null
  const h = m[1]!.length === 3 ? m[1]!.split("").map((c) => c + c).join("") : m[1]!
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

export function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`
}

/** WCAG relative luminance of a hex colour (0 for unparseable). */
export function hexLuminance(hex: string): number {
  const rgb = parseHex(hex)
  if (!rgb) return 0
  return 0.2126 * channelToLinear(rgb[0]) + 0.7152 * channelToLinear(rgb[1]) + 0.0722 * channelToLinear(rgb[2])
}

/** WCAG contrast ratio between two hex colours. */
export function hexContrast(a: string, b: string): number {
  return contrast(hexLuminance(a), hexLuminance(b))
}

/** `a` mixed toward `b` by t (0 = a, 1 = b), in sRGB. */
export function mixHex(a: string, b: string, t: number): string {
  const x = parseHex(a) ?? [0, 0, 0]
  const y = parseHex(b) ?? [0, 0, 0]
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t])
}

/** The candidate with the best contrast against `bg`. */
export function bestContrast(bg: string, candidates: string[]): string {
  return candidates.reduce((best, c) => (hexContrast(c, bg) > hexContrast(best, bg) ? c : best), candidates[0]!)
}

/**
 * `fg`, nudged toward black or white (whichever direction gains contrast)
 * just far enough to reach `ratio` against `bg` -- keeps the hue while it can.
 */
export function ensureContrast(fg: string, bg: string, ratio: number): string {
  if (hexContrast(fg, bg) >= ratio) return fg
  const toward = hexLuminance(bg) > 0.18 ? "#000000" : "#ffffff"
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const c = mixHex(fg, toward, t)
    if (hexContrast(c, bg) >= ratio) return c
  }
  return toward
}

/** `color` darkened (same hue) until its luminance is at most `maxL`. */
export function darkenTo(color: string, maxL: number): string {
  if (hexLuminance(color) <= maxL) return color
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const c = mixHex(color, "#000000", t)
    if (hexLuminance(c) <= maxL) return c
  }
  return "#000000"
}

/** `color` lightened (same hue) until its luminance is at least `minL`. */
export function lightenTo(color: string, minL: number): string {
  if (hexLuminance(color) >= minL) return color
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const c = mixHex(color, "#ffffff", t)
    if (hexLuminance(c) >= minL) return c
  }
  return "#ffffff"
}

// Brightest background body text (white) still clears 4.5:1 on; the dark-text
// counterpart is the dimmest. text_style scrims were computed for pure black /
// white at these limits.
const LIGHT_TEXT_MAX_BG = (LIGHT_TEXT_L + 0.05) / BODY_CONTRAST - 0.05
const DARK_TEXT_MIN_BG = BODY_CONTRAST * (DARK_TEXT_L + 0.05) - 0.05

/**
 * A text_style scrim tinted with a brand colour instead of pure black
 * (light text) or white (dark text), with its opacity raised so the
 * result is never lighter (darker) than the black (white) scrim it
 * replaces -- the text keeps the contrast textStyleFromStats computed.
 */
export function tintedScrimOpacity(opacity: number, tint: string, textColor: "light" | "dark"): number {
  if (opacity <= 0) return 0
  const L = hexLuminance(tint)
  const factor = textColor === "light"
    ? LIGHT_TEXT_MAX_BG / Math.max(0.01, LIGHT_TEXT_MAX_BG - L)
    : (1 - DARK_TEXT_MIN_BG) / Math.max(0.01, L - DARK_TEXT_MIN_BG)
  return Math.round(Math.min(1, opacity * factor) * 100) / 100
}
