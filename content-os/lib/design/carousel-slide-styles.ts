// Shared by components/generate/CarouselBuilder.tsx (live editing) and
// components/shared/ContentDetailPanel.tsx (viewing a saved carousel in
// the Library) -- previously only defined inside CarouselBuilder.tsx, so
// a body slide (which never gets a real AI-generated image_url — see
// lib/ai/carousel-slide-background.ts, only ever called for the hook/cta
// slides) rendered its flat color/gradient background live during editing
// but collapsed to bare unstyled text the moment it was viewed again in
// the Library, since nothing there knew how to reconstruct that same
// treatment. One shared mapping now, so both places can never drift apart.
export type CarouselBackgroundStyle =
  | "gradient_dark" | "gradient_light" | "white_violet" | "dark_navy"
  // Vibe-specific flat backgrounds — see VIBE_TO_CAROUSEL_BACKGROUND in
  // app/api/v1/ai/carousel/generate/route.ts, which assigns these
  // deterministically from the selected vibe (bold_dramatic/clean_minimal
  // reuse gradient_dark/white_violet above; these three vibes had no
  // matching pre-existing style).
  | "vibe_fun_playful" | "vibe_warm_cozy" | "vibe_professional" | "vibe_trendy_genz"

export interface CarouselBgStyleValue {
  bg: string
  text: string
  subtext: string
}

export const CAROUSEL_BG_STYLES: Record<CarouselBackgroundStyle, CarouselBgStyleValue> = {
  gradient_dark: { bg: "bg-gradient-to-br from-violet-900 via-purple-900 to-indigo-950", text: "text-white", subtext: "text-white/70" },
  gradient_light: { bg: "bg-gradient-to-br from-violet-50 via-indigo-50 to-white", text: "text-gray-900", subtext: "text-gray-500" },
  white_violet: { bg: "bg-white border border-violet-100", text: "text-gray-900", subtext: "text-gray-500" },
  dark_navy: { bg: "bg-gradient-to-br from-gray-900 via-slate-900 to-black", text: "text-white", subtext: "text-white/60" },
  vibe_fun_playful: { bg: "bg-gradient-to-br from-orange-400 via-yellow-400 to-teal-400", text: "text-white", subtext: "text-white/70" },
  vibe_warm_cozy: { bg: "bg-gradient-to-br from-amber-400 via-orange-500 to-red-600", text: "text-white", subtext: "text-white/70" },
  vibe_professional: { bg: "bg-gradient-to-br from-blue-900 via-slate-800 to-gray-900", text: "text-white", subtext: "text-white/70" },
  vibe_trendy_genz: { bg: "bg-gradient-to-br from-violet-500 via-fuchsia-500 to-cyan-400", text: "text-white", subtext: "text-white/80" },
}

export function resolveCarouselBgStyle(style: string | null | undefined): CarouselBgStyleValue {
  if (style && style in CAROUSEL_BG_STYLES) return CAROUSEL_BG_STYLES[style as CarouselBackgroundStyle]
  return CAROUSEL_BG_STYLES.gradient_dark
}
