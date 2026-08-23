// Layout registry for the "Create → Full Post" AI-generated post image.
// Deliberately just metadata (id/label/description) for the picker UI and
// the validated enum list — the actual per-template geometry (scrim
// position, font sizes, logo box, accent shape) lives directly in
// lib/image/post-compositor.ts, the only place that needs it, the same way
// components/shared/PostPreviewCard.tsx keeps its per-template layout
// inline rather than in a separate data file.
//
// Independent of color — see lib/design/color-themes.ts for the separate
// color-theme selector. Layout x color are two independent choices, not
// preset combos.

export type PostTemplateId = "bold_statement" | "product_focus" | "quote_card" | "minimal" | "blank"

export interface PostTemplateMeta {
  id: PostTemplateId
  label: string
  description: string
}

export const POST_TEMPLATES: PostTemplateMeta[] = [
  { id: "bold_statement", label: "Bold Statement", description: "Big bold headline over a dark gradient scrim" },
  { id: "product_focus", label: "Product Focus", description: "Clean photo with a solid brand-color CTA band" },
  { id: "quote_card", label: "Quote Card", description: "Moody vignette with a large quote-style headline" },
  { id: "minimal", label: "Minimal", description: "Restrained accent, lots of breathing room" },
  { id: "blank", label: "Blank / Custom", description: "No overlay, just the generated image" },
]

export const POST_TEMPLATE_IDS = POST_TEMPLATES.map((t) => t.id) as [PostTemplateId, ...PostTemplateId[]]

export const DEFAULT_POST_TEMPLATE_ID: PostTemplateId = "bold_statement"
