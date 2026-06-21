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
