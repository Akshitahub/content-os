import { createClient, createAdminClient } from "@/lib/supabase/server"
import { getISTDateString } from "@/lib/utils/ist"
import { checkAndIncrementUsage, refundGenerationUsage } from "@/lib/usage/check-and-increment-usage"
import { POST as POST_CREDIT_COST } from "@/lib/usage/credit-costs"
import { generateHooks } from "@/lib/ai/hooks-generator"
import { generateContent } from "@/lib/ai/content-generator"
import { generatePostImage } from "@/lib/ai/post-image-pipeline"
import { resolveColorThemes, findColorTheme } from "@/lib/design/color-themes"
import { DEFAULT_POST_TEMPLATE_ID, type PostTemplateId } from "@/lib/design/post-templates"
import { mergeCaptionWithHookAndCta } from "@/lib/utils/caption-merge"
import { isInternalUnlimited } from "@/lib/usage/is-internal-unlimited"
import type { BrandRow } from "@/types/database"
import type { GeneratedCaption, UserPlan } from "@/types/app"

const BUCKET = "brand-images"

// Distinct from "post_image"/"fullpost_social_post" (the real routes'
// feature strings) -- this is a genuinely different code path (an
// automatic background charge, not a user-initiated Create Post click),
// and this app's convention is a distinct feature string per distinct
// code path (see e.g. "carousel" vs "carousel_slide_bg_body"), not
// reusing one that would misattribute this in ai_generation_logs.
const FEATURE = "daily_draft"

export interface DailyDraft {
  hookText: string
  captionText: string
  hashtags: string[]
  imageUrl: string | null
  failed: boolean
}

// Shape of a daily_draft_cache row -- not in types/database.ts yet (that's
// generated from a live Supabase schema; supabase/migrations/050_daily_draft_cache.sql
// hasn't been run there yet), so every query/insert against this table
// below is cast through `as any`, same convention already used for other
// not-yet-typed tables elsewhere in this codebase.
interface DailyDraftCacheRow {
  id: string
  brand_id: string
  draft_date: string
  hook_text: string
  caption_text: string
  hashtags: string[] | null
  image_url: string | null
  content_project_id: string | null
  generation_failed: boolean
  created_at: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function insertFailedRow(supabase: any, brandId: string, draftDate: string): Promise<void> {
  try {
    await supabase.from("daily_draft_cache").insert({
      brand_id: brandId,
      draft_date: draftDate,
      // NOT NULL columns -- no real hook/caption exists on a failed
      // attempt, so these stay empty rather than nullable.
      hook_text: "",
      caption_text: "",
      generation_failed: true,
    })
  } catch (err) {
    console.error("[get-or-create-daily-draft] failed to insert failure marker (non-fatal):", err)
  }
}

/**
 * Returns today's (IST) cached daily draft for this brand, generating and
 * charging for one if none exists yet -- at most once per brand per day,
 * regardless of how many times the dashboard is loaded. Never throws: this
 * runs inside a Server Component render, where an uncaught throw would
 * break the whole page load, so every failure path below returns null
 * instead and lets the dashboard fall back to its plain "Generate a post"
 * CTA.
 */
export async function getOrCreateDailyDraft(brand: BrandRow, userId: string): Promise<DailyDraft | null> {
  try {
    const supabase = await createClient()
    const today = getISTDateString()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (supabase.from("daily_draft_cache") as any)
      .select("*")
      .eq("brand_id", brand.id)
      .eq("draft_date", today)
      .maybeSingle() as { data: DailyDraftCacheRow | null }

    if (existing) {
      // Already tried and failed today -- don't retry on every page load
      // (that would silently retry-charge-and-fail repeatedly). Once per
      // day is enough; tomorrow gets a fresh attempt.
      if (existing.generation_failed) return null
      return {
        hookText: existing.hook_text,
        captionText: existing.caption_text,
        hashtags: existing.hashtags ?? [],
        imageUrl: existing.image_url,
        failed: false,
      }
    }

    const usageCheck = await checkAndIncrementUsage(userId, POST_CREDIT_COST, FEATURE)
    if (!usageCheck.ok) {
      await insertFailedRow(supabase, brand.id, today)
      return null
    }

    try {
      // Same functions the real fullpost/generate route uses -- no
      // productId, no additionalContext (a generic on-brand post, not tied
      // to anything the user typed), and no contentAngle (omitted entirely
      // so it stays equivalent to that route's own "auto" default).
      const hookResult = await generateHooks(brand, {
        hookTypes: ["bold_statement", "question", "story"],
        count: 1,
        platform: "instagram",
        product: null,
      })
      const hook = hookResult.hooks[0]
      if (!hook) throw new Error("Hook generation returned no results")

      const colorThemes = resolveColorThemes(brand)
      const contentResult = await generateContent(brand, "social_post", {
        product: null,
        platform: "instagram",
        hookText: hook.hook_text,
        includeImagePrompt: true,
        availableColorThemes: colorThemes.map((t) => ({ id: t.id, label: t.label })),
      })
      const caption = contentResult.data as GeneratedCaption
      // Same post-generation merge fullpost/generate/route.ts applies, so
      // this cached draft's caption carries the hook and CTA the same way
      // a real Create Post caption does.
      caption.caption_text = mergeCaptionWithHookAndCta(caption.caption_text, hook.hook_text, caption.cta)
      caption.character_count = caption.caption_text.length

      // Best-effort content_projects row, mirroring fullpost/generate/route.ts --
      // non-fatal if it fails, the draft still generates fine without it.
      let contentProjectId: string | null = null
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: project } = await (supabase.from("content_projects") as any)
          .insert({
            brand_id: brand.id,
            product_id: null,
            title: hook.hook_text,
            platform: "instagram",
            content_type: "post",
          })
          .select("id")
          .single() as { data: { id: string } | null }
        contentProjectId = project?.id ?? null
      } catch (err) {
        console.error("[get-or-create-daily-draft] failed to create content_projects row (non-fatal):", err instanceof Error ? err.message : err)
      }

      const { data: userData } = await supabase.from("users").select("plan").eq("id", userId).single<{ plan: UserPlan }>()
      const plan: UserPlan = userData?.plan ?? "starter"
      const colorTheme = findColorTheme(colorThemes, caption.suggested_color_theme_id ?? undefined)
      const imagePrompt = (caption.image_prompt?.trim() || `${hook.hook_text}, ${brand.niche ?? "brand"} product`).slice(0, 500)

      // No captionText -- matches Create Post's current decoupled-overlay
      // architecture, a clean text-free background rather than a
      // server-composited one.
      const imageResult = await generatePostImage({
        imagePrompt,
        brandNiche: brand.niche,
        targetAudience: brand.target_audience,
        template: (caption.suggested_template as PostTemplateId) || DEFAULT_POST_TEMPLATE_ID,
        colorTheme,
        captionText: undefined,
        logoUrl: brand.logo_url,
        plan,
        isInternalUnlimitedUser: isInternalUnlimited(userId),
        productImageUrl: null,
        aspectRatio: "4:5",
      })
      if (!imageResult.success) throw new Error(imageResult.error)

      // Same storage upload as app/api/v1/ai/post-image/generate/route.ts --
      // admin client since storage RLS expects the path to start with the
      // user's own auth uid, which brand ownership is already verified
      // above (the caller resolved `brand` for this same userId).
      const admin = await createAdminClient()
      const storagePath = `${userId}/${brand.id}/${Date.now()}-${crypto.randomUUID()}.png`
      const { error: uploadError } = await admin.storage
        .from(BUCKET)
        .upload(storagePath, imageResult.buffer, { contentType: imageResult.mimeType, upsert: false })
      if (uploadError) throw new Error(uploadError.message)
      const { data: publicUrlData } = admin.storage.from(BUCKET).getPublicUrl(storagePath)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: insertError } = await (supabase.from("daily_draft_cache") as any).insert({
        brand_id: brand.id,
        draft_date: today,
        hook_text: hook.hook_text,
        caption_text: caption.caption_text,
        hashtags: caption.hashtags,
        image_url: publicUrlData.publicUrl,
        content_project_id: contentProjectId,
        generation_failed: false,
      })
      if (insertError) throw new Error(insertError.message)

      return {
        hookText: hook.hook_text,
        captionText: caption.caption_text,
        hashtags: caption.hashtags,
        imageUrl: publicUrlData.publicUrl,
        failed: false,
      }
    } catch (err) {
      console.error("[get-or-create-daily-draft] generation failed, refunding charge:", err instanceof Error ? err.message : err)
      await refundGenerationUsage(supabase, userId, POST_CREDIT_COST, usageCheck.logId)
      await insertFailedRow(supabase, brand.id, today)
      return null
    }
  } catch (err) {
    console.error("[get-or-create-daily-draft] unexpected error:", err instanceof Error ? err.message : err)
    return null
  }
}
