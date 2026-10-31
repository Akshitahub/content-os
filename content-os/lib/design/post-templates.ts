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

export type PostTemplateId = "bold_statement" | "product_focus" | "quote_card" | "minimal" | "blank" | "hard_truth_checklist" | "annotated_product" | "listicle_cover" | "festive_poster" | "review_card"

export interface PostTemplateMeta {
  id: PostTemplateId
  label: string
  description: string
  /** Only offered for a post with a product that has a photo. */
  requiresProductPhoto?: boolean
  /** Only offered when the topic names an occasion or the post's date is one. */
  requiresOccasion?: boolean
  /** Only offered when the user gave real review text. */
  requiresReview?: boolean
  /** Only offered to the Full Post caption call, which can list items (checked after: lib/ai/post-template-rules.ts). */
  requiresListCheck?: boolean
}

export const POST_TEMPLATES: PostTemplateMeta[] = [
  { id: "bold_statement", label: "Bold Statement", description: "Big bold headline over a dark gradient scrim" },
  { id: "product_focus", label: "Product Focus", description: "Clean photo with a solid brand-color CTA band" },
  { id: "quote_card", label: "Quote Card", description: "Moody vignette with a large quote-style headline" },
  { id: "minimal", label: "Minimal", description: "Restrained accent, lots of breathing room" },
  { id: "blank", label: "Blank / Custom", description: "No overlay, just the generated image" },
  // The first template that isn't a photo-background-plus-headline variant
  // -- a flat off-white checklist card (headline, wrong-way ✗ list,
  // right-way ✓ list, closing line), no AI-generated photo at all. See
  // lib/image/post-compositor.ts's buildHardTruthChecklist and
  // lib/ai/post-image-pipeline.ts's generatePostImage, which skips the
  // AI image call entirely for this one.
  { id: "hard_truth_checklist", label: "Hard Truth Checklist", description: "Flat card: contrarian headline, a wrong-way list, a right-way list — no photo" },
  // The brand's real product photo (background removed) on a base-coloured
  // card with handwritten callouts pointing at it -- no AI scene. See
  // lib/image/post-compositor.ts's compositeAnnotatedProduct.
  { id: "annotated_product", label: "Annotated Product", description: "Product with handwritten callouts", requiresProductPhoto: true },
  // Data-bound templates in the story frame language (lib/image/post-design.ts),
  // each checked server-side by lib/ai/post-template-rules.ts.
  { id: "listicle_cover", label: "Listicle Cover", description: "The number of tips on a big sticker -- always the real count", requiresListCheck: true },
  { id: "festive_poster", label: "Festive Poster", description: "A greeting poster for a real occasion", requiresOccasion: true },
  { id: "review_card", label: "Review Card", description: "A real customer review, word for word", requiresReview: true },
]

/** The templates a post can use: each data-bound one only when its data exists. */
export function availablePostTemplates(opts: { hasProductPhoto: boolean; hasOccasion?: boolean; hasReview?: boolean; canCheckList?: boolean }): PostTemplateMeta[] {
  return POST_TEMPLATES.filter((t) =>
    (!t.requiresProductPhoto || opts.hasProductPhoto)
    && (!t.requiresOccasion || !!opts.hasOccasion)
    && (!t.requiresReview || !!opts.hasReview)
    && (!t.requiresListCheck || !!opts.canCheckList))
}

export const POST_TEMPLATE_IDS = POST_TEMPLATES.map((t) => t.id) as [PostTemplateId, ...PostTemplateId[]]

export const DEFAULT_POST_TEMPLATE_ID: PostTemplateId = "bold_statement"
