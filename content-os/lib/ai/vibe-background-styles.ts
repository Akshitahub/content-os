// Shared by lib/ai/carousel-slide-background.ts and lib/ai/story-slide-background.ts
// — both build abstract/atmospheric AI backgrounds keyed off the same
// brand "vibe" concept (components/shared/VibePicker.tsx's Vibe id), just
// for different canvas shapes (carousel: square, stories: portrait).

export type Vibe =
  | "fun_playful"
  | "clean_minimal"
  | "bold_dramatic"
  | "warm_cozy"
  | "professional"
  | "trendy_genz"

export const DEFAULT_VIBE: Vibe = "clean_minimal"

// Abstract/atmospheric direction per vibe — deliberately NOT literal product
// or scene photography (unlike post-image-pipeline.ts's PHOTOGRAPHY_STYLE),
// since these sit directly behind live text and need to stay uncluttered.
export const VIBE_BACKGROUND_STYLES: Record<Vibe, string> = {
  fun_playful: "vibrant abstract gradient background with playful organic blob shapes, bright energetic color transitions, soft glowing light",
  clean_minimal: "minimalist abstract background, soft subtle gradient, generous negative space, gentle geometric shapes, understated texture",
  bold_dramatic: "high-contrast abstract gradient background, dramatic dark tones with a bold streak of accent color, moody atmospheric lighting, strong geometric shapes",
  warm_cozy: "warm abstract gradient background, soft glowing light, cozy amber and terracotta tones, gentle organic texture",
  professional: "sophisticated abstract gradient background, subtle geometric pattern, muted corporate-appropriate tones, clean structured composition",
  trendy_genz: "vibrant holographic abstract gradient background, iridescent color shift, bold abstract shapes, glossy Y2K-inspired texture",
}

// Same fallback swatches components/shared/VibePicker.tsx shows the user
// per vibe — duplicated here (rather than imported) since that component is
// a "use client" file and these run server-side. Only used when the brand
// has no colors of its own set yet.
export const VIBE_FALLBACK_COLORS: Record<Vibe, string[]> = {
  fun_playful: ["#FF6B6B", "#FFE66D", "#4ECDC4"],
  clean_minimal: ["#FFFFFF", "#F5F5F5", "#333333"],
  bold_dramatic: ["#000000", "#6366F1", "#EC4899"],
  warm_cozy: ["#F59E0B", "#EF4444", "#FEF3C7"],
  professional: ["#1E40AF", "#FFFFFF", "#1F2937"],
  trendy_genz: ["#7C3AED", "#EC4899", "#06B6D4"],
}

// Deliberately NOT lib/ai/prompts.ts's IMAGE_QUALITY_SAFETY_BOILERPLATE —
// that one opens with "professional photography" and includes an anatomy
// clause, both aimed at literal photographic content (post images,
// products, memes). Reusing it here would fight the abstract-only
// direction these prompts are built around.
export const ABSTRACT_SAFETY_BOILERPLATE = "no watermarks, no illegible text or symbols, clean high-resolution render, sharp focus"
