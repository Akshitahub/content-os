import { z } from "zod"

export const fastlaneSchema = z.object({
  brandId: z.string().uuid("Invalid brand ID"),
})

export type FastlaneInput = z.infer<typeof fastlaneSchema>
