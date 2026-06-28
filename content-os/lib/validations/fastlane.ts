import { z } from "zod"

export const fastlaneSchema = z.object({
  brandId: z.string().uuid("Invalid brand ID"),
  force: z.boolean().optional().default(false),
  clearAndRegenerate: z.boolean().optional().default(false),
  frequency: z.enum(["3x_week", "5x_week", "daily"]).optional().default("daily"),
  platforms: z.array(z.string()).optional().default([]),
  vibe: z.string().optional().default(""),
  focusAreas: z.array(z.string()).optional().default([]),
})

export type FastlaneInput = z.infer<typeof fastlaneSchema>
