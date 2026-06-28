import { z } from "zod"

const brandBaseSchema = z.object({
  name: z.string().min(1, "Brand name is required").max(100).trim(),
  description: z.string().max(500).nullish(),
  niche: z.string().max(100).nullish(),
  target_audience: z.string().max(300).nullish(),
  tone_of_voice: z.string().max(200).nullish(),
  brand_values: z.array(z.string().max(50)).max(10).optional().transform((v) => v ?? []),
  competitors: z.array(z.string().max(100)).max(10).optional().transform((v) => v ?? []),
  website_url: z.union([z.string().url("Please enter a valid URL"), z.literal(""), z.null()]).optional(),
  instagram_handle: z.string().max(50).nullish(),
  ai_persona: z.string().max(1000).nullish(),
  vibe: z.string().max(50).nullish(),
  posting_frequency: z.string().max(20).nullish(),
  target_platforms: z.array(z.string().max(30)).optional(),
  onboarding_type: z.string().max(50).nullish(),
})

export const createBrandSchema = brandBaseSchema
export const updateBrandSchema = brandBaseSchema.partial()

export type CreateBrandInput = {
  name: string
  description?: string | null
  niche?: string | null
  target_audience?: string | null
  tone_of_voice?: string | null
  brand_values: string[]
  competitors: string[]
  website_url?: string | null
  instagram_handle?: string | null
  ai_persona?: string | null
}

export type UpdateBrandInput = Partial<CreateBrandInput>
