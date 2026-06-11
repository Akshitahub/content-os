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
