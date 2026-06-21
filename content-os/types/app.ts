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

export type AspectRatio = "1:1" | "4:5" | "9:16" | "16:9"

export type ImageStyle =
  | "product_photography"
  | "lifestyle"
  | "flat_lay"
  | "minimal_studio"
  | "festive"
  | "ugc_style"

// Generation types (for UI state, not DB)
export type GeneratedImage = {
  prompt: string
  style: ImageStyle | null
  aspect_ratio: AspectRatio
  public_url: string
  storage_path: string
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

export type ImageGenerationOptions = {
  brandId: string
  productId?: string
  prompt: string
  style?: ImageStyle
  aspectRatio?: AspectRatio
}

// ─── Content format types ──────────────────────────────────────────────────

export type ContentFormat =
  | "social_post"
  | "reel_script"
  | "story"
  | "carousel"
  | "blog_post"
  | "ad_copy"

export type ReelScene = {
  visual_direction: string
  voiceover_or_text_overlay: string
  duration_seconds: number
}

export type ReelScript = {
  hook: string
  scenes: ReelScene[]
  caption: string
  hashtags: string[]
}

export type StoryContent = {
  text: string
  sticker_suggestion: string
}

export type CarouselSlide = {
  slide_number: number
  headline: string
  body: string
}

export type CarouselContent = {
  slides: CarouselSlide[]
  caption: string
  hashtags: string[]
}

export type BlogPost = {
  title: string
  body: string
  meta_description: string
}

export type AdCopy = {
  headline: string
  primary_text: string
  description: string
  cta_button: string
}

// Maps each ContentFormat to its output type.
// social_post reuses the existing GeneratedCaption shape.
export type ContentFormatOutputMap = {
  social_post: GeneratedCaption
  reel_script: ReelScript
  story: StoryContent
  carousel: CarouselContent
  blog_post: BlogPost
  ad_copy: AdCopy
}

// ─── Plan limits ────────────────────────────────────────────────────────────

export const PLAN_LIMITS: Record<UserPlan, { generations: number; brands: number; products: number }> = {
  free:    { generations: 15,   brands: 1,  products: 5 },
  starter: { generations: 500,  brands: 3,  products: 30 },
  pro:     { generations: 500,  brands: 10, products: 200 },
  agency:  { generations: 2000, brands: 50, products: 1000 },
}
