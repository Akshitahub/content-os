import { z } from "zod"

export const discoverInfluencerSchema = z.object({
  handle: z.string().min(1).max(100).transform((h) => h.replace(/^@/, "")),
  platform: z.enum(["instagram", "tiktok", "youtube", "linkedin"]),
})

export const createInfluencerSchema = z.object({
  handle: z.string().min(1).max(100),
  platform: z.enum(["instagram", "tiktok", "youtube", "linkedin"]),
  full_name: z.string().max(200).optional().nullable(),
  bio: z.string().max(2000).optional().nullable(),
  follower_count: z.number().int().min(0).optional().nullable(),
  niche: z.string().max(100).optional().nullable(),
  location: z.string().max(100).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
})

export const updateInfluencerSchema = z.object({
  status: z
    .enum(["discovered", "contacted", "replied", "negotiating", "partnered", "rejected", "completed"])
    .optional(),
  notes: z.string().max(2000).optional().nullable(),
  niche: z.string().max(100).optional().nullable(),
  fit_score: z.number().int().min(0).max(100).optional().nullable(),
  fit_reasoning: z.string().max(2000).optional().nullable(),
})

export const generateOutreachSchema = z.object({
  channel: z.enum(["dm", "email", "whatsapp"]),
  campaignGoal: z.string().max(500).optional(),
})

export const generateBriefSchema = z.object({
  campaignName: z.string().min(1).max(200),
  productId: z.string().uuid().optional(),
})

export const updatePartnershipSchema = z.object({
  partnershipId: z.string().uuid(),
  actual_reach: z.number().int().min(0).optional().nullable(),
  actual_engagement: z.number().int().min(0).optional().nullable(),
  conversions: z.number().int().min(0).optional().nullable(),
  roi_notes: z.string().max(2000).optional().nullable(),
  status: z.enum(["draft", "sent", "active", "completed", "cancelled"]).optional(),
})

// Cap matches the outreach-generation prompt's own limit — email is the
// longest channel at "under 300 words" (buildOutreachUserPrompt's
// channelRules), so 3000 chars gives generous headroom for a hand-edit
// without allowing an unbounded paste.
export const updateOutreachMessageSchema = z.object({
  messageId: z.string().uuid(),
  message_text: z.string().min(1).max(3000),
  subject: z.string().max(200).optional().nullable(),
})

export const sendOutreachEmailSchema = z.object({
  messageId: z.string().uuid(),
  email: z.string().email().max(320).optional(),
})

export type DiscoverInfluencerInput = z.infer<typeof discoverInfluencerSchema>
export type CreateInfluencerInput = z.infer<typeof createInfluencerSchema>
export type UpdateInfluencerInput = z.infer<typeof updateInfluencerSchema>
export type GenerateOutreachInput = z.infer<typeof generateOutreachSchema>
export type GenerateBriefInput = z.infer<typeof generateBriefSchema>
export type UpdatePartnershipInput = z.infer<typeof updatePartnershipSchema>
export type UpdateOutreachMessageInput = z.infer<typeof updateOutreachMessageSchema>
export type SendOutreachEmailInput = z.infer<typeof sendOutreachEmailSchema>
