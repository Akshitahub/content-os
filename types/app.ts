import type { BrandRow, ProductRow } from "./database"

/**
 * App-level types — these are what components and hooks work with.
 * They may extend or combine database row types.
 */

export type Platform =
  | "instagram"
  | "facebook"
  | "tiktok"
  | "youtube"
  | "linkedin"
  | "twitter"

export type ContentType = "reel" | "post" | "story" | "carousel" | "thread"

export type HookType =
  | "question"
  | "bold_statement"
  | "story"
  | "statistic"
  | "controversial"
  | "how_to"

export type ContentStatus =
  | "draft"
  | "review"
  | "approved"
  | "scheduled"
  | "published"

export type CalendarStatus =
  | "planned"
  | "content_ready"
  | "scheduled"
  | "published"
  | "missed"

export type UserPlan = "free" | "starter" | "pro" | "agency"

// Extended types with relations
export type BrandWithProducts = BrandRow & {
  products: ProductRow[]
}

// Generation types (for UI state, not DB)
export type GeneratedHook = {
  hook_text: string
  hook_type: HookType
  reasoning: string
}

export type GeneratedCaption = {
  caption_text: string
  hashtags: string[]
  cta: string
  character_count: number
}

// Generation request options
export type HookGenerationOptions = {
  brandId: string
  productId?: string
  hookTypes?: HookType[]
  count?: number
  platform?: Platform
  additionalContext?: string
}

export type CaptionGenerationOptions = {
  brandId: string
  productId?: string
  hookId?: string
  hookText?: string
  platform: Platform
  contentType: ContentType
  additionalContext?: string
}

// Plan limits
export const PLAN_LIMITS: Record<UserPlan, { generations: number; brands: number; products: number }> = {
  free: { generations: 10, brands: 1, products: 5 },
  starter: { generations: 100, brands: 3, products: 30 },
  pro: { generations: 500, brands: 10, products: 200 },
  agency: { generations: 2000, brands: 50, products: 1000 },
}
