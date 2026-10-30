// Shared by components/generate/CarouselBuilder.tsx (live editing) and
// components/shared/ContentDetailPanel.tsx (viewing a saved carousel in
// the Library) -- previously only defined inside CarouselBuilder.tsx, so
// a body slide (which never gets a real AI-generated image_url — see
// lib/ai/carousel-slide-background.ts, only ever called for the hook/cta
// slides) rendered its flat color/gradient background live during editing
// but collapsed to bare unstyled text the moment it was viewed again in
// the Library, since nothing there knew how to reconstruct that same
// treatment. One shared mapping now, so both places can never drift apart.
import type { CSSProperties } from "react"
import { BRAND_PRESET_IDS, cssGradient, resolvePresetForPalette, type BrandPalette, type BrandPresetId } from "./color-themes"

/** Old generic presets -- still rendered for content saved before brand palettes. */
export type LegacyCarouselBackgroundStyle =
  | "gradient_dark" | "gradient_light" | "white_violet" | "dark_navy"
  // Vibe-specific flat backgrounds — see VIBE_TO_CAROUSEL_BACKGROUND in
  // app/api/v1/ai/carousel/generate/route.ts, which assigns these
  // deterministically from the selected vibe (bold_dramatic/clean_minimal
  // reuse gradient_dark/white_violet above; these three vibes had no
  // matching pre-existing style).
  | "vibe_fun_playful" | "vibe_warm_cozy" | "vibe_professional" | "vibe_trendy_genz"

/** New generations only use the brand presets (built from the palette, lib/design/color-themes.ts). */
export type CarouselBackgroundStyle = LegacyCarouselBackgroundStyle | BrandPresetId

export interface CarouselBgStyleValue {
  bg: string
  text: string
  subtext: string
  /** A brand preset: inline background plus the --slide-ink / --slide-sub
   * colours the text / subtext classes read. */
  style?: CSSProperties
}

export const CAROUSEL_BG_STYLES: Record<LegacyCarouselBackgroundStyle, CarouselBgStyleValue> = {
  gradient_dark: { bg: "bg-gradient-to-br from-violet-900 via-purple-900 to-indigo-950", text: "text-white", subtext: "text-white/70" },
  gradient_light: { bg: "bg-gradient-to-br from-violet-50 via-indigo-50 to-white", text: "text-gray-900", subtext: "text-gray-500" },
  white_violet: { bg: "bg-white border border-violet-100", text: "text-gray-900", subtext: "text-gray-500" },
  dark_navy: { bg: "bg-gradient-to-br from-gray-900 via-slate-900 to-black", text: "text-white", subtext: "text-white/60" },
  vibe_fun_playful: { bg: "bg-gradient-to-br from-orange-400 via-yellow-400 to-teal-400", text: "text-white", subtext: "text-white/70" },
  vibe_warm_cozy: { bg: "bg-gradient-to-br from-amber-400 via-orange-500 to-red-600", text: "text-white", subtext: "text-white/70" },
  vibe_professional: { bg: "bg-gradient-to-br from-blue-900 via-slate-800 to-gray-900", text: "text-white", subtext: "text-white/70" },
  vibe_trendy_genz: { bg: "bg-gradient-to-br from-violet-500 via-fuchsia-500 to-cyan-400", text: "text-white", subtext: "text-white/80" },
}

/**
 * A brand preset (or an old id mapped onto one when the brand has a
 * palette) as preview styles -- the same stops and contrast-checked text
 * colours the compositors draw. Null = render the old preset classes.
 */
export function brandPresetPreview(id: string | null | undefined, palette: BrandPalette | null | undefined, direction = "to bottom right"): CarouselBgStyleValue | null {
  const preset = resolvePresetForPalette(id, palette)
  if (!preset) return null
  return {
    bg: "",
    text: "text-[color:var(--slide-ink)]",
    subtext: "text-[color:var(--slide-sub)]",
    style: { background: cssGradient(preset.stops, direction), "--slide-ink": preset.text, "--slide-sub": preset.sub } as CSSProperties,
  }
}

export function resolveCarouselBgStyle(style: string | null | undefined, palette?: BrandPalette | null): CarouselBgStyleValue {
  const brand = brandPresetPreview(style, palette)
  if (brand) return brand
  if (style && style in CAROUSEL_BG_STYLES) return CAROUSEL_BG_STYLES[style as LegacyCarouselBackgroundStyle]
  return CAROUSEL_BG_STYLES.gradient_dark
}

/** The background options a builder offers: the brand presets. */
export const BRAND_PRESET_OPTIONS: { id: BrandPresetId; label: string }[] = BRAND_PRESET_IDS.map((id) => ({
  id,
  label: id === "brand_deep" ? "Brand deep" : id === "brand_warm" ? "Brand warm" : id === "brand_light" ? "Brand light" : "Brand bold",
}))
