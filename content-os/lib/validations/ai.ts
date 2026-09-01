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
})

export type GenerateImageInput = z.infer<typeof generateImageSchema>

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

const postTemplateEnum = z.enum(["bold_statement", "product_focus", "quote_card", "minimal", "blank"])
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
    .max(500, "Image prompt must be under 500 characters")
    .transform((val) => val.replace(/<[^>]*>/g, "").trim()),
  template: postTemplateEnum,
  colorThemeId: z.string().min(1, "Color theme is required"),
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
})

export type GenerateAdMakerBackgroundInput = z.infer<typeof generateAdMakerBackgroundSchema>

export const generateFullPostSchema = z.object({
  brandId: z.string().uuid("Invalid brand ID"),
  productId: z.string().uuid("Invalid product ID").optional(),
  format: contentFormatEnum,
  platform: platformEnum,
  occasionId: z.string().optional(),
  additionalContext: z
    .string()
    .max(500, "Additional context must be under 500 characters")
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
  additionalContext: z
    .string()
    .max(500, "Additional context must be under 500 characters")
    .optional()
    .transform((val) => val?.replace(/<[^>]*>/g, "").trim()),
})

export type GenerateFullPostFromPhotoInput = z.infer<typeof generateFullPostFromPhotoSchema>
