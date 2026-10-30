import type { BrandRow } from "@/types/database"
import {
  AA_BODY, AA_GRAPHIC, bestContrast, darkenTo, ensureContrast, hexContrast, hexLuminance, lightenTo, mixHex, parseHex, tintedScrimOpacity, toHex,
} from "@/lib/image/text-contrast"

// ─── The brand's 4-role palette ──────────────────────────────────────────────

/**
 * Every compositor's colours come from these four roles (resolveBrandPalette):
 * deep = ink, scrims and backing panels; base = solid backgrounds; accent =
 * bands / bars / strips; pop = highlights, quote marks, badges, dots.
 */
export interface BrandPalette {
  deep: string
  base: string
  accent: string
  pop: string
  /** Where it came from -- "neutral" means the brand has no colours of its own. */
  source: "art_direction" | "brand_colors" | "neutral"
}

/** A brand with no colours and no art direction: quiet, not a stock preset. */
export const NEUTRAL_PALETTE: BrandPalette = { deep: "#1f2328", base: "#f5f4f0", accent: "#3d4450", pop: "#c8963e", source: "neutral" }

type PaletteBrand = Pick<BrandRow, "primary_color" | "color_palette"> & { brand_brain?: unknown }

const HEX_RE = /^#?([a-f\d]{6}|[a-f\d]{3})$/i

function normHex(v: unknown): string | null {
  if (typeof v !== "string" || !HEX_RE.test(v.trim())) return null
  const rgb = parseHex(v)
  return rgb ? toHex(rgb) : null
}

/** The brand's saved colours as #rrggbb, primary first, deduped. */
export function savedBrandColors(brand: Pick<BrandRow, "primary_color" | "color_palette"> | null | undefined): string[] {
  const out: string[] = []
  const add = (v: unknown) => {
    const h = normHex(v)
    if (h && !out.includes(h)) out.push(h)
  }
  add(brand?.primary_color)
  const palette = brand?.color_palette
  if (palette && typeof palette === "object") Object.values(palette as Record<string, unknown>).forEach(add)
  return out
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255]
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4
  return [h * 60, s, l]
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360 / 360
  if (s === 0) return toHex([l * 255, l * 255, l * 255])
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t: number) => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return toHex([f(hue + 1 / 3) * 255, f(hue) * 255, f(hue - 1 / 3) * 255])
}

function hslOf(hex: string): [number, number, number] {
  return rgbToHsl(parseHex(hex) ?? [0, 0, 0])
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/** deep / base / pop derived from the brand's own colours, keeping the accent's hue. */
export function derivePalette(colors: string[]): Omit<BrandPalette, "source"> {
  const accent = colors[0]!
  const [h, s] = hslOf(accent)
  const deep = darkenTo(hslToHex(h, Math.min(s, 0.55), 0.14), 0.03)
  const base = lightenTo(hslToHex(h, Math.min(s, 0.4), 0.95), 0.85)
  // A second brand colour that's visibly different becomes pop; otherwise the
  // accent's complement at a moderate saturation (a muted contrast, not
  // neon), or a warm gold for a near-grey accent.
  const second = colors.slice(1).find((c) => hueDistance(hslOf(c)[0], h) >= 40 || Math.abs(hexLuminance(c) - hexLuminance(accent)) >= 0.25)
  const popRaw = second ?? (s < 0.15 ? hslToHex(38, 0.55, 0.52) : hslToHex(h + 180, Math.min(0.6, Math.max(0.45, s * 0.7)), 0.45))
  return { deep, base, accent, pop: ensureContrast(popRaw, deep, AA_GRAPHIC) }
}

/** Art direction (or derived) roles, tidied so deep reads on base. */
function tidy(p: Omit<BrandPalette, "source">, source: BrandPalette["source"]): BrandPalette {
  const base = lightenTo(p.base, 0.7)
  const deep = ensureContrast(p.deep, base, AA_BODY)
  return { deep, base, accent: p.accent, pop: p.pop, source }
}

/**
 * The brand's 4-role palette. Source order: brand_brain.art_direction.palette,
 * then derived from primary_color / color_palette (hue kept), then neutral.
 * Pure -- safe on the client and the server.
 */
export function resolveBrandPalette(brand: PaletteBrand | null | undefined): BrandPalette {
  const brain = brand?.brand_brain && typeof brand.brand_brain === "object" ? (brand.brand_brain as { art_direction?: { palette?: Record<string, unknown> } }) : null
  const ad = brain?.art_direction?.palette
  if (ad) {
    const [deep, base, accent, pop] = [normHex(ad.deep), normHex(ad.base), normHex(ad.accent), normHex(ad.pop)]
    if (deep && base && accent && pop) return tidy({ deep, base, accent, pop }, "art_direction")
  }
  const colors = savedBrandColors(brand)
  if (colors.length) return tidy(derivePalette(colors), "brand_colors")
  return NEUTRAL_PALETTE
}

/** A palette from a plain primary/secondary pair (curated themes). */
export function paletteFromColors(primary: string, secondary?: string | null): BrandPalette {
  const colors = [normHex(primary), normHex(secondary)].filter((c): c is string => !!c)
  return colors.length ? tidy(derivePalette(colors), "brand_colors") : NEUTRAL_PALETTE
}

/** Accepts a palette from untrusted input (export routes); null if malformed. */
export function parsePalette(v: unknown): BrandPalette | null {
  if (!v || typeof v !== "object") return null
  const o = v as Record<string, unknown>
  const [deep, base, accent, pop] = [normHex(o.deep), normHex(o.base), normHex(o.accent), normHex(o.pop)]
  if (!deep || !base || !accent || !pop) return null
  const source = o.source === "art_direction" || o.source === "neutral" ? o.source : "brand_colors"
  return { deep, base, accent, pop, source }
}

// ─── Roles, contrast-checked ─────────────────────────────────────────────────

export interface PaletteRoles {
  /** Scrims and backing panels behind light text (deep, dark enough to act as black). */
  scrim: string
  /** Scrims behind dark text (base, light enough to act as white). */
  lightScrim: string
  /** Ink on base backgrounds and its muted variant -- both >= 4.5:1 on base. */
  ink: string
  inkMuted: string
  /** Text drawn straight on images: white or base, whichever reads better over the scrim. */
  onImage: string
  /** Stroke behind text on images. */
  stroke: string
  /** Bands / bars / strips: accent, or deep when accent can't carry its text. */
  band: string
  bandText: string
  /** Highlights, quote marks, badges, dots (pop). */
  pop: string
  /** The checklist's ✗ / ✓ marks: red / green tones that sit with the palette, >= 3:1 on base. */
  wrong: string
  right: string
  /** The translucent pop stripe behind ink, at an opacity that keeps the ink >= 4.5:1. */
  stripeOpacity: number
}

export function paletteRoles(p: BrandPalette): PaletteRoles {
  const scrim = darkenTo(p.deep, 0.02)
  const lightScrim = lightenTo(p.base, 0.88)
  const ink = ensureContrast(p.deep, p.base, AA_BODY)
  const inkMuted = ensureContrast(mixHex(ink, p.base, 0.3), p.base, AA_BODY)
  const onImage = bestContrast(scrim, ["#ffffff", p.base])
  const bandTextOnAccent = bestContrast(p.accent, ["#ffffff", p.base, ink])
  const accentCarries = hexContrast(bandTextOnAccent, p.accent) >= AA_BODY
  const band = accentCarries ? p.accent : ink
  const bandText = accentCarries ? bandTextOnAccent : bestContrast(ink, ["#ffffff", p.base])
  const stripeOpacity = [0.35, 0.3, 0.25, 0.2, 0.15, 0.1].find((o) => hexContrast(ink, mixHex(p.base, p.pop, o)) >= AA_BODY) ?? 0
  const { wrong, right } = markTones(p)
  return { scrim, lightScrim, ink, inkMuted, onImage, stroke: scrim, band, bandText, pop: p.pop, wrong, right, stripeOpacity }
}

/** pop on `bg` when it reads (>= 3:1 for a graphic), else pop pushed until it does. */
export function popOn(p: BrandPalette, bg: string): string {
  return ensureContrast(p.pop, bg, AA_GRAPHIC)
}

// Red / green keep their meaning; the tone follows the palette's temperature.
const MARK_TONES = {
  warm: { wrong: "#c2410c", right: "#4d7c0f" },
  cool: { wrong: "#be123c", right: "#0f766e" },
  neutral: { wrong: "#b91c1c", right: "#15803d" },
}

function markTones(p: BrandPalette): { wrong: string; right: string } {
  const [h, s] = hslOf(p.accent)
  const temp = s < 0.12 ? "neutral" : h < 75 || h >= 330 ? "warm" : h >= 150 && h < 300 ? "cool" : "neutral"
  const t = MARK_TONES[temp]
  return { wrong: ensureContrast(t.wrong, p.base, AA_GRAPHIC), right: ensureContrast(t.right, p.base, AA_GRAPHIC) }
}

// ─── Scrims as CSS (builder previews draw what the compositors draw) ─────────

function rgbaCss(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex) ?? [0, 0, 0]
  return `rgba(${r},${g},${b},${alpha})`
}

/** The photo / custom-colour scrim (dark at the bottom), deep-tinted. */
export function scrimGradientCss(p: BrandPalette): string {
  const c = paletteRoles(p).scrim
  const o = (a: number) => tintedScrimOpacity(a, c, "light")
  return `linear-gradient(to top, ${rgbaCss(c, o(0.75))}, ${rgbaCss(c, o(0.25))}, ${rgbaCss(c, o(0.45))})`
}

/** text_style's uniform scrim (or backing panel at `opacity`): deep-tinted under light text, base-tinted under dark. */
export function styleTintCss(p: BrandPalette, textColor: "light" | "dark", opacity: number): string {
  const r = paletteRoles(p)
  const tint = textColor === "light" ? r.scrim : r.lightScrim
  return rgbaCss(tint, tintedScrimOpacity(opacity, tint, textColor))
}

// ─── Background presets built from the palette (stories + carousels) ────────

export interface PalettePreset {
  stops: [string, string, string]
  text: string
  sub: string
}

export const BRAND_PRESET_IDS = ["brand_deep", "brand_warm", "brand_light", "brand_bold"] as const
export type BrandPresetId = (typeof BRAND_PRESET_IDS)[number]

export function isBrandPresetId(id: string | null | undefined): id is BrandPresetId {
  return !!id && (BRAND_PRESET_IDS as readonly string[]).includes(id)
}

/** Old generic preset ids -> the nearest brand preset (stories and carousels share the names). */
export const LEGACY_PRESET_TO_BRAND: Record<string, BrandPresetId> = {
  gradient_violet: "brand_deep",
  gradient_pink: "brand_warm",
  gradient_dark: "brand_deep",
  gradient_warm: "brand_warm",
  gradient_light: "brand_light",
  white: "brand_light",
  white_violet: "brand_light",
  dark_navy: "brand_deep",
  checklist_cream: "brand_light",
  vibe_fun_playful: "brand_warm",
  vibe_warm_cozy: "brand_warm",
  vibe_professional: "brand_deep",
  vibe_trendy_genz: "brand_bold",
}

/** Any preset id (brand or legacy) -> its brand preset; unknown ids -> brand_deep. */
export function toBrandPreset(id: string | null | undefined): BrandPresetId {
  if (isBrandPresetId(id)) return id
  return LEGACY_PRESET_TO_BRAND[id ?? ""] ?? "brand_deep"
}

/**
 * Text over a gradient: the candidate whose worst stop still reads best; the
 * stops are pulled toward the opposite end until that text clears 4.5:1 on
 * every stop, and the sub colour is a solid tint that clears it too.
 */
function presetFrom(stops: [string, string, string], candidates: string[]): PalettePreset {
  const worst = (c: string, s: string[]) => Math.min(...s.map((x) => hexContrast(c, x)))
  const text = candidates.reduce((best, c) => (worst(c, stops) > worst(best, stops) ? c : best), candidates[0]!)
  const lightText = hexLuminance(text) > 0.5
  const fixed = stops.map((s) => {
    if (hexContrast(text, s) >= AA_BODY) return s
    for (let t = 0.1; t <= 1.0001; t += 0.1) {
      const c = mixHex(s, lightText ? "#000000" : "#ffffff", t)
      if (hexContrast(text, c) >= AA_BODY) return c
    }
    return lightText ? "#000000" : "#ffffff"
  }) as [string, string, string]
  const subRaw = mixHex(text, fixed[1], 0.22)
  const sub = fixed.reduce((c, s) => ensureContrast(c, s, AA_BODY), subRaw)
  return { stops: fixed, text, sub }
}

/** Halfway between two neighbouring colours along the hue arc (sRGB for near-greys). */
function hueMidpoint(a: string, b: string): string {
  const [ha, sa, la] = hslOf(a)
  const [hb, sb, lb] = hslOf(b)
  if (sa < 0.12 || sb < 0.12) return mixHex(a, b, 0.5)
  const d = ((hb - ha + 540) % 360) - 180
  return hslToHex(ha + d / 2, (sa + sb) / 2, (la + lb) / 2)
}

/** brand_warm's far end: pop when it neighbours the accent, else the accent turned 35deg toward orange. */
function warmEnd(p: BrandPalette): string {
  const [ha, sa, la] = hslOf(p.accent)
  if (sa < 0.12) return mixHex(p.accent, p.pop, 0.6)
  if (hueDistance(ha, hslOf(p.pop)[0]) <= 90) return p.pop
  const toward = ((30 - ha + 540) % 360) - 180
  return hslToHex(ha + Math.sign(toward || 1) * Math.min(35, Math.abs(toward) || 35), sa, Math.min(0.62, la + 0.06))
}

export function brandPreset(id: BrandPresetId, p: BrandPalette): PalettePreset {
  const r = paletteRoles(p)
  const lightCandidates = ["#ffffff", p.base, r.ink]
  switch (id) {
    case "brand_warm":
      // accent -> pop when they're neighbours on the wheel. A complementary
      // pop goes grey (sRGB) or garish (round the wheel) halfway, so then
      // it's accent -> a warmer neighbour of the accent instead.
      return presetFrom([p.accent, hueMidpoint(p.accent, warmEnd(p)), warmEnd(p)], lightCandidates)
    case "brand_light":
      return { stops: [p.base, p.base, p.base], text: r.ink, sub: r.inkMuted }
    case "brand_bold":
      return presetFrom([p.accent, p.accent, p.accent], lightCandidates)
    case "brand_deep":
    default:
      return presetFrom([p.deep, mixHex(p.deep, p.accent, 0.5), p.accent], lightCandidates)
  }
}

/**
 * The background a saved / generated slide renders with: brand presets
 * always use the palette (neutral when the brand has none); old preset ids
 * map to the nearest brand preset only for a brand with a palette of its
 * own, and otherwise keep their old look (null = use the legacy preset).
 */
export function resolvePresetForPalette(id: string | null | undefined, palette: BrandPalette | null | undefined): PalettePreset | null {
  if (isBrandPresetId(id)) return brandPreset(id, palette ?? NEUTRAL_PALETTE)
  if (palette && palette.source !== "neutral") return brandPreset(toBrandPreset(id), palette)
  return null
}

export function cssGradient(stops: [string, string, string], direction = "to bottom"): string {
  return stops[0] === stops[1] && stops[1] === stops[2] ? stops[0] : `linear-gradient(${direction}, ${stops[0]}, ${stops[1]}, ${stops[2]})`
}

// ─── Post colour themes ──────────────────────────────────────────────────────

export interface ColorTheme {
  id: string
  label: string
  primary: string
  secondary: string
  /** The 4 roles every post template draws from. */
  palette: BrandPalette
  /** "brand" first and pre-selected; "other" = the curated options. */
  group: "brand" | "other"
}

function curated(id: string, label: string, primary: string, secondary: string): ColorTheme {
  return { id, label, primary, secondary, palette: paletteFromColors(primary, secondary), group: "other" }
}

// Offered under "Other options" -- never auto-picked when the brand has a palette.
export const CURATED_PALETTES: ColorTheme[] = [
  curated("curated_violet", "Violet", "#6366f1", "#818cf8"),
  curated("curated_sunset", "Sunset", "#f97316", "#fb923c"),
  curated("curated_forest", "Forest", "#16a34a", "#4ade80"),
  curated("curated_midnight", "Midnight", "#1e293b", "#475569"),
]

/**
 * The colour-theme choices for a brand: "Brand colours" (its 4-role palette)
 * first and pre-selected, then the curated options. A brand with no colours
 * gets a neutral palette first instead -- never a curated one by default.
 * Used identically on the client and the server (the server re-derives the
 * theme for a submitted id from the brand row, never trusting client colours).
 */
export function resolveColorThemes(brand: PaletteBrand | null | undefined): ColorTheme[] {
  const palette = resolveBrandPalette(brand)
  const label = palette.source === "neutral" ? "Neutral" : "Brand colours"
  return [{ id: "brand", label, primary: palette.accent, secondary: palette.pop, palette, group: "brand" }, ...CURATED_PALETTES]
}

/** Whether the brand has a palette of its own (colours or art direction). */
export function hasBrandPalette(themes: ColorTheme[]): boolean {
  return themes[0]?.group === "brand" && themes[0].palette.source !== "neutral"
}

/** The themes a model may pick from automatically: only the brand's own when it has a palette. */
export function autoPickableThemes(themes: ColorTheme[]): ColorTheme[] {
  return hasBrandPalette(themes) ? themes.slice(0, 1) : themes
}

/** An automatic (model-suggested) pick: ignored in favour of the brand palette when there is one. */
export function autoPickColorTheme(themes: ColorTheme[], suggestedId: string | null | undefined): ColorTheme {
  return findColorTheme(autoPickableThemes(themes), suggestedId ?? undefined)
}

export function findColorTheme(themes: ColorTheme[], id: string | undefined): ColorTheme {
  return themes.find((t) => t.id === id) ?? themes[0]!
}
