// Shared by components/generate/CarouselBuilder.tsx (live editing) and
// components/shared/ContentDetailPanel.tsx (viewing a saved carousel in
// the Library) -- previously only defined inside CarouselBuilder.tsx, so
// a body slide (which never gets a real AI-generated image_url — see
// lib/ai/carousel-slide-background.ts, only ever called for the hook/cta
// slides) rendered its flat color/gradient background live during editing
// but collapsed to bare unstyled text the moment it was viewed again in
// the Library, since nothing there knew how to reconstruct that same
// treatment. One shared mapping now, so both places can never drift apart.
export type CarouselBackgroundStyle = "gradient_dark" | "gradient_light" | "white_violet" | "dark_navy"

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
}

export function resolveCarouselBgStyle(style: string | null | undefined): CarouselBgStyleValue {
  if (style && style in CAROUSEL_BG_STYLES) return CAROUSEL_BG_STYLES[style as CarouselBackgroundStyle]
  return CAROUSEL_BG_STYLES.gradient_dark
}
