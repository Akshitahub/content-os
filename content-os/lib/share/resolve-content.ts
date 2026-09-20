import { z } from "zod"
import type { createAdminClient } from "@/lib/supabase/server"
import type { Json } from "@/types/database"

// Typed from createAdminClient's own actual return type (SupabaseClient<Database>)
// rather than importing @supabase/supabase-js's SupabaseClient separately,
// so this can never drift from whatever that factory actually returns.
type AdminClient = Awaited<ReturnType<typeof createAdminClient>>

// The full set of content kinds a share link can point at -- every place
// "Share to WhatsApp" used to live (library card menus for
// caption/carousel/story/ad_copy, plus the dashboard's daily-draft card,
// which is its own daily_draft_cache row rather than a captions row). The
// zod schema and the TypeScript type are derived from the same literal
// list so app/api/v1/share/route.ts's validation can never drift from
// what this module actually knows how to resolve.
export const shareContentTypeSchema = z.enum(["caption", "carousel", "story", "ad_copy", "daily_draft"])
export type ShareContentType = z.infer<typeof shareContentTypeSchema>

// Deliberately NOT a real FK per content_type -- same polymorphic
// content_type + content_id shape supabase/migrations/053_content_feedback_notes.sql
// already established for the same reason: these tables have no shared
// parent to hang one real FK off of.
const TABLE_BY_CONTENT_TYPE: Record<ShareContentType, string> = {
  caption: "captions",
  carousel: "carousels",
  story: "stories",
  ad_copy: "ad_copies",
  daily_draft: "daily_draft_cache",
}

export function tableForContentType(contentType: ShareContentType): string {
  return TABLE_BY_CONTENT_TYPE[contentType]
}

/**
 * Confirms `contentId` is a real row in the right table AND actually
 * belongs to `brandId` -- called from POST /api/v1/share with the
 * caller's own authenticated (RLS-scoped) client, after that route has
 * already confirmed `brandId` itself belongs to the logged-in user. Without
 * this second check, a user could mint a share link for another brand's
 * (or another user's) content just by guessing/reusing a contentId under
 * their own legitimate brandId. `daily_draft_cache` isn't in the generated
 * Database type yet (same as lib/dashboard/get-or-create-daily-draft.ts's
 * own note), hence the `as any` -- every other content_type's table already
 * is, but this helper is shared across all of them so it casts uniformly
 * rather than special-casing one.
 */
export async function verifyContentBelongsToBrand(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  contentType: ShareContentType,
  contentId: string,
  brandId: string
): Promise<boolean> {
  const table = tableForContentType(contentType)
  const { data } = await supabase
    .from(table)
    .select("id")
    .eq("id", contentId)
    .eq("brand_id", brandId)
    .maybeSingle()
  return !!data
}

// One slide/block of visual content -- 1 entry for a caption or the daily
// draft, N for a carousel/story (in slide order), 0 for an ad copy (text
// only, no image field on that table at all).
export interface ResolvedShareSlide {
  imageUrl: string | null
  /** Carousel background_style / story background enum key -- resolved to
   * actual Tailwind classes by the page component (kept a rendering
   * concern, not a data-fetching one), same convention
   * lib/design/carousel-slide-styles.ts already follows. */
  backgroundStyle: string | null
  /** Same duplication precedent as CarouselFlatSlidePreview/PhoneStory --
   * an exact user-picked flat/gradient, takes priority over backgroundStyle. */
  customBackgroundColors: string[] | null
  headline: string | null
  subtext: string | null
  points: string[] | null
}

export interface ResolvedShareContent {
  contentType: ShareContentType
  brandId: string
  brandName: string
  brandLogoUrl: string | null
  /** First line of the caption/hook text -- used for the OG title and the
   * page's own heading, never a generic "Caption"/"Carousel" label. */
  hook: string
  /** Full text with line breaks preserved -- caption body, or slide text
   * joined for carousel/story, or the ad copy's own fields joined. */
  captionText: string
  hashtags: string[]
  platform: string | null
  /** Best-effort display hint only -- none of these tables persist the
   * exact aspect ratio a post was generated at. Stories are always 9:16
   * (lib/ai/story-slide-background.ts's STORY_DIMENSIONS); everything else
   * defaults to this app's universal 4:5 (post-image-pipeline.ts's
   * PORTRAIT_DIMENSIONS comment). */
  aspectRatio: "4:5" | "9:16"
  slides: ResolvedShareSlide[]
}

interface BrandInfo {
  name: string
  logo_url: string | null
}

async function fetchBrandInfo(admin: AdminClient, brandId: string): Promise<BrandInfo | null> {
  const { data } = await admin
    .from("brands")
    .select("name, logo_url")
    .eq("id", brandId)
    .maybeSingle<BrandInfo>()
  return data
}

function firstLine(text: string): string {
  return text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? text.trim()
}

interface CaptionShareRow {
  brand_id: string
  caption_text: string
  hashtags: string[] | null
  platform: string | null
  content_project_id: string | null
}

async function resolveCaption(admin: AdminClient, contentId: string): Promise<ResolvedShareContent | null> {
  const { data: caption } = await admin
    .from("captions")
    .select("brand_id, caption_text, hashtags, platform, content_project_id")
    .eq("id", contentId)
    .maybeSingle<CaptionShareRow>()
  if (!caption) return null
  const brand = await fetchBrandInfo(admin, caption.brand_id)
  if (!brand) return null

  // Same content_project_id join captions/route.ts's GET already does --
  // captions and generated_images have no direct relationship, only a
  // shared content_project_id, and a project can have more than one image
  // (each "Regenerate image" inserts a new row); most recent wins.
  let imageUrl: string | null = null
  if (caption.content_project_id) {
    const { data: image } = await admin
      .from("generated_images")
      .select("public_url")
      .eq("content_project_id", caption.content_project_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ public_url: string }>()
    imageUrl = image?.public_url ?? null
  }

  return {
    contentType: "caption",
    brandId: caption.brand_id,
    brandName: brand.name,
    brandLogoUrl: brand.logo_url,
    hook: firstLine(caption.caption_text),
    captionText: caption.caption_text,
    hashtags: caption.hashtags ?? [],
    platform: caption.platform,
    aspectRatio: "4:5",
    slides: [{ imageUrl, backgroundStyle: null, customBackgroundColors: null, headline: null, subtext: null, points: null }],
  }
}

interface CarouselSlideShape {
  headline?: string
  subtext?: string
  points?: string[]
  image_url?: string | null
  background_style?: string | null
  custom_background_colors?: string[] | null
}

interface CarouselShareRow {
  brand_id: string
  title: string | null
  slides: Json
  hashtags: string[] | null
  platform: string | null
}

async function resolveCarousel(admin: AdminClient, contentId: string): Promise<ResolvedShareContent | null> {
  const { data: carousel } = await admin
    .from("carousels")
    .select("brand_id, title, slides, hashtags, platform")
    .eq("id", contentId)
    .maybeSingle<CarouselShareRow>()
  if (!carousel) return null
  const brand = await fetchBrandInfo(admin, carousel.brand_id)
  if (!brand) return null

  const slides = ((carousel.slides as unknown as CarouselSlideShape[]) ?? [])
  const captionText = [
    carousel.title,
    ...slides.map((s) => [s.headline, s.subtext, ...(s.points ?? [])].filter(Boolean).join("\n")),
  ].filter(Boolean).join("\n\n")

  return {
    contentType: "carousel",
    brandId: carousel.brand_id,
    brandName: brand.name,
    brandLogoUrl: brand.logo_url,
    hook: carousel.title || slides[0]?.headline || "Carousel",
    captionText,
    hashtags: carousel.hashtags ?? [],
    platform: carousel.platform,
    aspectRatio: "4:5",
    slides: slides.map((s) => ({
      imageUrl: s.image_url ?? null,
      backgroundStyle: s.background_style ?? null,
      customBackgroundColors: s.custom_background_colors ?? null,
      headline: s.headline ?? null,
      subtext: s.subtext ?? null,
      points: s.points ?? null,
    })),
  }
}

interface StorySlideShape {
  text?: string
  subtext?: string
  background?: string | null
  background_image_url?: string | null
  custom_background_colors?: string[] | null
}

interface StoryShareRow {
  brand_id: string
  topic: string | null
  stories: Json
}

async function resolveStory(admin: AdminClient, contentId: string): Promise<ResolvedShareContent | null> {
  const { data: story } = await admin
    .from("stories")
    .select("brand_id, topic, stories")
    .eq("id", contentId)
    .maybeSingle<StoryShareRow>()
  if (!story) return null
  const brand = await fetchBrandInfo(admin, story.brand_id)
  if (!brand) return null

  const slides = ((story.stories as unknown as StorySlideShape[]) ?? [])
  const captionText = [story.topic, ...slides.map((s) => [s.text, s.subtext].filter(Boolean).join("\n"))]
    .filter(Boolean).join("\n\n")

  return {
    contentType: "story",
    brandId: story.brand_id,
    brandName: brand.name,
    brandLogoUrl: brand.logo_url,
    // Stories table has no platform column of its own -- Instagram-only
    // feature today, same default toExportSlide/ContentDetailPanel callers
    // already pass.
    hook: story.topic || slides[0]?.text || "Story",
    captionText,
    hashtags: [],
    platform: "instagram",
    aspectRatio: "9:16",
    slides: slides.map((s) => ({
      imageUrl: s.background_image_url ?? null,
      backgroundStyle: s.background ?? null,
      customBackgroundColors: s.custom_background_colors ?? null,
      headline: s.text ?? null,
      subtext: s.subtext ?? null,
      points: null,
    })),
  }
}

interface AdCopyShareRow {
  brand_id: string
  headline: string
  primary_text: string
  description: string | null
  cta_button: string | null
  platform: string | null
}

async function resolveAdCopy(admin: AdminClient, contentId: string): Promise<ResolvedShareContent | null> {
  const { data: ad } = await admin
    .from("ad_copies")
    .select("brand_id, headline, primary_text, description, cta_button, platform")
    .eq("id", contentId)
    .maybeSingle<AdCopyShareRow>()
  if (!ad) return null
  const brand = await fetchBrandInfo(admin, ad.brand_id)
  if (!brand) return null

  const captionText = [ad.primary_text, ad.description, ad.cta_button].filter(Boolean).join("\n\n")

  return {
    contentType: "ad_copy",
    brandId: ad.brand_id,
    brandName: brand.name,
    brandLogoUrl: brand.logo_url,
    hook: ad.headline,
    captionText,
    hashtags: [],
    platform: ad.platform,
    aspectRatio: "4:5",
    // ad_copies has no image column at all -- text-only preview.
    slides: [],
  }
}

interface DailyDraftShareRow {
  brand_id: string
  hook_text: string
  caption_text: string
  hashtags: string[] | null
  image_url: string | null
}

async function resolveDailyDraft(admin: AdminClient, contentId: string): Promise<ResolvedShareContent | null> {
  // daily_draft_cache isn't in the generated Database type yet -- same `as
  // any` convention lib/dashboard/get-or-create-daily-draft.ts already uses
  // for this exact table.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: draft } = await (admin.from("daily_draft_cache") as any)
    .select("brand_id, hook_text, caption_text, hashtags, image_url")
    .eq("id", contentId)
    .maybeSingle() as { data: DailyDraftShareRow | null }
  if (!draft) return null
  const brand = await fetchBrandInfo(admin, draft.brand_id)
  if (!brand) return null

  return {
    contentType: "daily_draft",
    brandId: draft.brand_id,
    brandName: brand.name,
    brandLogoUrl: brand.logo_url,
    hook: draft.hook_text,
    captionText: draft.caption_text,
    hashtags: draft.hashtags ?? [],
    platform: "instagram",
    aspectRatio: "4:5",
    slides: [{ imageUrl: draft.image_url, backgroundStyle: null, customBackgroundColors: null, headline: null, subtext: null, points: null }],
  }
}

/**
 * The one entry point both app/p/[token]/page.tsx (rendering) and its
 * generateMetadata (Open Graph tags) call, always with the service-role
 * client (lib/supabase/server.ts's createAdminClient) -- there is no
 * logged-in user on the public preview page. Returns null for a genuinely
 * missing row (deleted content, not just an invalid token) so the caller
 * can show the same "no longer available" page as an expired/revoked link,
 * never a different message that would leak which case it was.
 */
export async function resolveShareContent(
  admin: AdminClient,
  contentType: ShareContentType,
  contentId: string
): Promise<ResolvedShareContent | null> {
  switch (contentType) {
    case "caption": return resolveCaption(admin, contentId)
    case "carousel": return resolveCarousel(admin, contentId)
    case "story": return resolveStory(admin, contentId)
    case "ad_copy": return resolveAdCopy(admin, contentId)
    case "daily_draft": return resolveDailyDraft(admin, contentId)
  }
}
