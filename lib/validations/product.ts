import { z } from "zod"

export const createProductSchema = z.object({
  name: z.string().min(1, "Product name is required").max(200).trim(),
  description: z.string().max(2000).nullish(),
  price: z.number().positive().nullish(),
  currency: z.string().max(10).default("INR"),
  category: z.string().max(100).nullish(),
  key_benefits: z.array(z.string().max(200)).max(20).optional().transform((v) => v ?? []),
  ingredients: z.string().max(2000).nullish(),
  target_customer: z.string().max(500).nullish(),
  image_urls: z.array(z.string().url()).max(10).optional().transform((v) => v ?? []),
})

export const updateProductSchema = createProductSchema.partial()

export type CreateProductInput = z.infer<typeof createProductSchema>
export type UpdateProductInput = z.infer<typeof updateProductSchema>
