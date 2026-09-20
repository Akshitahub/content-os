import { z } from "zod"

const platformEnum = z.enum([
  "instagram",
  "facebook",
  "tiktok",
  "youtube",
  "linkedin",
  "twitter",
])

const hookTypeEnum = z.enum([
  "question",
  "bold_statement",
  "story",
  "statistic",
  "controversial",
  "how_to",
])

const contentTypeEnum = z.enum([
  "reel",
  "post",
  "story",
  "carousel",
  "thread",
])

export const generateHooksSchema = z.object({
  brandId: z.string().uuid("Invalid brand ID"),
  productId: z.string().uuid("Invalid product ID").optional(),
  hookTypes: z.array(hookTypeEnum).max(6).optional(),
  count: z.number().int().min(1).max(10).default(5),
  platform: platformEnum.optional(),
  additionalContext: z
    .string()
    .max(500, "Additional context must be under 500 characters")
    .optional()
    .transform((val) => val?.replace(/<[^>]*>/g, "").trim()), // Strip HTML
})

export const generateCaptionsSchema = z.object({
  brandId: z.string().uuid("Invalid brand ID"),
  productId: z.string().uuid("Invalid product ID").optional(),
  hookId: z.string().uuid("Invalid hook ID").optional(),
  hookText: z
    .string()
    .max(500, "Hook text must be under 500 characters")
    .optional()
    .transform((val) => val?.replace(/<[^>]*>/g, "").trim()),
  platform: platformEnum,
  contentType: contentTypeEnum,
  additionalContext: z
    .string()
    .max(500, "Additional context must be under 500 characters")
    .optional()
    .transform((val) => val?.replace(/<[^>]*>/g, "").trim()),
})

export type GenerateHooksInput = z.infer<typeof generateHooksSchema>
export type GenerateCaptionsInput = z.infer<typeof generateCaptionsSchema>

const imageStyleEnum = z.enum([
  "product_photography",
  "lifestyle",
  "flat_lay",
  "minimal_studio",
  "festive",
  "ugc_style",
])

const aspectRatioEnum = z.enum(["1:1", "4:5", "9:16", "16:9"])

export const generateImageSchema = z.object({
  brandId: z.string().uuid("Invalid brand ID"),
  productId: z.string().uuid("Invalid product ID").optional(),
  prompt: z
    .string()
    .min(3, "Prompt is too short")
    .max(500, "Prompt must be under 500 characters")
    .transform((val) => val.replace(/<[^>]*>/g, "").trim()),
  style: imageStyleEnum.optional(),
  aspectRatio: aspectRatioEnum.default("1:1"),
  // Opt-in override for the "AI can't render legible text" warning --
  // false (the default) means the route short-circuits with a warning
  // when the prompt asks for rendered words/labels; true means the user
  // saw that warning and chose to proceed anyway.
  allowTextInImage: z.boolean().optional().default(false),
})

// z.input (pre-parse), not z.infer/z.output -- this is the shape the
// client sends in the request body, where aspectRatio's default and the
// new allowTextInImage override are both genuinely optional to supply.
export type GenerateImageInput = z.input<typeof generateImageSchema>

export const generateImageFromUploadSchema = z.object({
  brandId: z.string().uuid("Invalid brand ID"),
  sceneDescription: z
    .string()
    .min(3, "Scene description is too short")
    .max(300, "Scene description must be under 300 characters")
    .transform((val) => val.replace(/<[^>]*>/g, "").trim()),
  // 14MB base64 ceiling ≈ the remove-background route's existing 10MB
  // raw-file limit after base64 inflation -- same size policy as that
  // route (and generateAdMakerBackgroundSchema's productImageBase64), just
  // expressed in base64 chars.
  productImageBase64: z.string().max(14_000_000, "Product image is too large"),
})

export type GenerateImageFromUploadInput = z.infer<typeof generateImageFromUploadSchema>

const contentFormatEnum = z.enum([
  "social_post",
  "reel_script",
  "story",
  "carousel",
  "blog_post",
  "ad_copy",
])

export const generateContentSchema = z.object({
  brandId: z.string().uuid("Invalid brand ID"),
  productId: z.string().uuid("Invalid product ID").optional(),
  format: contentFormatEnum,
  platform: platformEnum.optional(),
  hookText: z
    .string()
    .max(500, "Hook text must be under 500 characters")
    .optional()
    .transform((val) => val?.replace(/<[^>]*>/g, "").trim()),
  additionalContext: z
    .string()
    .max(500, "Additional context must be under 500 characters")
    .optional()
    .transform((val) => val?.replace(/<[^>]*>/g, "").trim()),
})

export type GenerateContentInput = z.infer<typeof generateContentSchema>

export const extractFromUrlSchema = z.object({
  url: z.string().url("Enter a valid URL, including https://"),
  brandId: z.string().uuid().optional(),
})

export type ExtractFromUrlInput = z.infer<typeof extractFromUrlSchema>

const postTemplateEnum = z.enum(["bold_statement", "product_focus", "quote_card", "minimal", "blank", "hard_truth_checklist"])
// Matches lib/design/fonts.ts's CURATED_FONTS ids exactly -- kept as a
// static literal here rather than importing from lib/design, same
// convention postTemplateEnum above already follows for lib/design/post-templates.ts.
const postFontEnum = z.enum(["anton", "inter", "playfair", "quicksand", "caveat"])

export const generatePostImageSchema = z.object({
  brandId: z.string().uuid("Invalid brand ID"),
  productId: z.string().uuid("Invalid product ID").optional(),
  // Required — this route always renders a specific message-grounded scene,
  // never falls back to a generic prompt (see lib/ai/post-image-pipeline.ts).
  imagePrompt: z
    .string()
    .min(3, "Image prompt is too short")
    // Was 500 -- shorter than the 80-150 word (~500-1000+ char) prompts the
    // prompt-authoring stage (lib/ai/image-prompt-writer.ts) now writes, so
    // a real AI-authored prompt could fail this check outright. 1500
    // matches post-image-pipeline.ts's own MAX_IMAGE_PROMPT_CHARS safety
    // cap, which sentence-boundary-trims anything beyond it regardless.
    .max(1500, "Image prompt must be under 1500 characters")
    .transform((val) => val.replace(/<[^>]*>/g, "").trim()),
  template: postTemplateEnum,
  colorThemeId: z.string().min(1, "Color theme is required"),
  // Optional — defaults to the pre-existing 4:5 portrait server-side (see
  // lib/ai/post-image-pipeline.ts's PORTRAIT_DIMENSIONS) so omitting this
  // doesn't change behavior for any existing caller. Only actually affects
  // output when there's no text overlay (captionText empty/omitted) —
  // compositePostImage's SVG templates use fixed pixel anchors tuned for
  // the 1080x1350 canvas, so a composited (captioned) image still renders
  // at 4:5 regardless of this value until the templates themselves become
  // dimension-aware. See generatePostImage in post-image-pipeline.ts.
  aspectRatio: z.enum(["4:5", "1:1", "9:16"]).optional(),
  // Which visual direction the background image itself follows -- see
  // lib/ai/post-image-pipeline.ts's PHOTOGRAPHY_STYLE/EDITORIAL_GRAPHIC_STYLE.
  // Omitted defaults to PHOTOGRAPHY_STYLE (today's existing behavior), so
  // this stays behavior-preserving for every caller that doesn't pass it.
  visualStyle: z.enum(["studio_scene", "editorial_graphic"]).optional(),
  // Fully optional -- replaces the old separate headline/ctaText fields.
  // Omitted or empty means no text overlay at all: no auto-filled headline
  // from a picked hook, no auto-filled CTA from brand.cta_phrase. Only
  // what the user explicitly typed here ever gets composited.
  captionText: z
    .string()
    .max(150, "Image text must be under 150 characters")
    .optional()
    .transform((val) => val?.replace(/<[^>]*>/g, "").trim()),
  // Which curated font renders captionText, if any is provided -- optional,
  // defaults to the pre-existing Anton font server-side (see
  // lib/design/fonts.ts's DEFAULT_FONT_ID) so omitting this doesn't
  // silently change behavior for anyone not using the picker yet.
  fontId: postFontEnum.optional(),
  // Uniform multiplier applied to the template's headline font size before
  // compositePostImage's own fitText auto-shrink loop runs -- optional,
  // defaults to 1.0 (the pre-existing fixed sizes) server-side. Same
  // 0.7-1.5 range as the Story/Carousel text_size_scale fields.
  textSizeScale: z.number().min(0.7, "Text size is out of range").max(1.5, "Text size is out of range").nullish(),
  // Ties this call to the session created by /api/v1/ai/fullpost/generate,
  // so the server (not any client-supplied flag) can determine whether this
  // is the chargeable initial generation, the free first regenerate, or a
  // chargeable later regenerate — see lib/usage/post-image-regenerate-session.ts.
  postSessionId: z.string().uuid("Invalid session ID"),
  // Links the resulting generated_images row back to the same
  // content_projects row its caption was inserted under (fullpost/generate
  // creates it and returns this id) — optional since not every caller of
  // this route originates from a fullpost/generate session with a project
  // to link to.
  contentProjectId: z.string().uuid("Invalid content project ID").optional(),
  // Only meaningful when template is "hard_truth_checklist" -- see
  // lib/ai/post-image-pipeline.ts's generatePostImage. Every other
  // template ignores these entirely.
  checklistHeadline: z.string().max(200, "Checklist headline is too long").optional(),
  checklistHighlightedPhrase: z.string().max(100, "Highlighted phrase is too long").optional().nullable(),
  checklistWrongItems: z.array(z.string().max(200)).max(5, "Too many wrong-way items").optional(),
  checklistRightItems: z.array(z.string().max(200)).max(5, "Too many right-way items").optional(),
  checklistClosingLine: z.string().max(300, "Closing line is too long").optional().nullable(),
})

export type GeneratePostImageInput = z.infer<typeof generatePostImageSchema>

const adMakerFormatEnum = z.enum(["square", "portrait", "story"])

export const generateAdMakerBackgroundSchema = z.object({
  scene: z.string().min(1, "Scene is required").max(50, "Scene is too long"),
  customScene: z
    .string()
    .max(300, "Custom scene description must be under 300 characters")
    .optional()
    .transform((val) => val?.replace(/<[^>]*>/g, "").trim()),
  format: adMakerFormatEnum.default("square"),
  // 14MB base64 ceiling ≈ the remove-background route's existing 10MB raw-file
  // limit after base64 inflation -- same size policy as that route, just
  // expressed in base64 chars.
  productImageBase64: z.string().max(14_000_000, "Product image is too large").optional(),
  // The SocioPosts-authored (and possibly user-edited) scene prompt from
  // the new prompt-writing stage (see lib/ai/image-prompt-writer.ts) --
  // replaces the scene preset's own hardcoded description as the creative
  // core when present. Optional so an older, not-yet-updated client still
  // works exactly as before with just scene/customScene.
  customPrompt: z
    .string()
    // Was 600 -- see generatePostImageSchema.imagePrompt's identical fix
    // above for why: too short for the prompt-authoring stage's real
    // 80-150 word output.
    .max(1500, "Scene prompt must be under 1500 characters")
    .optional()
    .transform((val) => val?.replace(/<[^>]*>/g, "").trim()),
})

export type GenerateAdMakerBackgroundInput = z.infer<typeof generateAdMakerBackgroundSchema>

export const generateFullPostSchema = z.object({
  brandId: z.string().uuid("Invalid brand ID"),
  productId: z.string().uuid("Invalid product ID").optional(),
  format: contentFormatEnum,
  platform: platformEnum,
  occasionId: z.string().optional(),
  contentAngle: z.enum(["auto", "problem_solution", "quick_tip", "myth_contrarian", "launch_offer"]).optional(),
  // The user's own "What do you want to post" brief -- was 500, matching
  // (and the origin of) the old UI textarea cap. Raised to 5000 alongside
  // that UI cap's removal and image-prompt/write's identical rawInput fix,
  // so a genuinely long brief is never silently rejected or truncated.
  additionalContext: z
    .string()
    .max(5000, "Your brief is too long -- please keep it under 5000 characters.")
    .optional()
    .transform((val) => val?.replace(/<[^>]*>/g, "").trim()),
})

export type GenerateFullPostInput = z.infer<typeof generateFullPostSchema>

// "Upload your own photo" path — a genuinely different capability from
// generateFullPostSchema above: no productId (this isn't tied to a saved
// Product), no AI-generated image at all (the uploaded photo itself is
// what gets published, see app/api/v1/ai/fullpost/generate-from-photo/route.ts).
// imageDataUrl's real content-type/size are validated where the bytes are
// actually decoded (lib/storage/upload-media.ts's ALLOWED_MIME_TYPES/
// MAX_UPLOAD_BYTES) — this only checks it's shaped like a data: URL so a
// garbage string fails fast with a clear error instead of reaching that
// far first.
export const generateFullPostFromPhotoSchema = z.object({
  brandId: z.string().uuid("Invalid brand ID"),
  imageDataUrl: z.string().regex(/^data:image\/[a-zA-Z+.-]+;base64,/, "Invalid image data URL"),
  // Same field/fix as generateFullPostSchema.additionalContext above.
  additionalContext: z
    .string()
    .max(5000, "Your brief is too long -- please keep it under 5000 characters.")
    .optional()
    .transform((val) => val?.replace(/<[^>]*>/g, "").trim()),
})

export type GenerateFullPostFromPhotoInput = z.infer<typeof generateFullPostFromPhotoSchema>
