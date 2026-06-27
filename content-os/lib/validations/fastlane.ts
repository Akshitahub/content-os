import { z } from "zod"

export const fastlaneSchema = z.object({
  brandId: z.string().uuid("Invalid brand ID"),
  force: z.boolean().optional().default(false),
  clearAndRegenerate: z.boolean().optional().default(false),
})

export type FastlaneInput = z.infer<typeof fastlaneSchema>
