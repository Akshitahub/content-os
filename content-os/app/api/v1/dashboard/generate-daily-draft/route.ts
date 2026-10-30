import { NextResponse } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { getISTDateString } from "@/lib/utils/ist"
import { checkAndIncrementUsage, refundGenerationUsage, logGenerationOutcome } from "@/lib/usage/check-and-increment-usage"
import { POST as POST_CREDIT_COST } from "@/lib/usage/credit-costs"
import { generatePostImage, attemptsCostUsd } from "@/lib/ai/post-image-pipeline"
import { UsageCarryingError, addTextUsage, sumCostUsd, type TextUsage } from "@/lib/ai/pricing"
import { resolveColorThemes, findColorTheme } from "@/lib/design/color-themes"
import { DEFAULT_POST_TEMPLATE_ID, type PostTemplateId } from "@/lib/design/post-templates"
import { mergeCaptionWithHookAndCta } from "@/lib/utils/caption-merge"
import { isInternalUnlimited } from "@/lib/usage/is-internal-unlimited"
import { buildError, ErrorCodes } from "@/types/api"
import type { BrandRow } from "@/types/database"
import type { GeneratedCaption, UserPlan } from "@/types/app"
import type { DailyDraft, DailyDraftCacheRow } from "@/lib/dashboard/get-or-create-daily-draft"
import { timedGenerationRoute, type GenerationTimer } from "@/lib/utils/generation-timing"
import { withDeadline, DeadlineExceededError, GENERATION_TIMED_OUT_MESSAGE } from "@/lib/utils/with-deadline"
import { prepareGeneratedImage } from "@/lib/storage/generated-image"
import { getActiveLessons } from "@/lib/ai/brand-brain"
import { stampPostLayout } from "@/lib/design/text-layouts"
import { getPrimaryColor } from "@/lib/design/post-card-generator"
import { resolveTypography } from "@/lib/design/fonts"
import { generatePostCopy } from "@/lib/ai/post-copy"
import { ensureArtDirection } from "@/lib/ai/art-direction"

const BUCKET = "brand-images"

// Distinct from "post_image"/"fullpost_social_post" (the real routes'
// feature strings) -- this is a genuinely different code path (an
// automatic background charge, not a user-initiated Create Post click).
const FEATURE = "daily_draft"

// Chains up to three sequential external calls (hook, caption, image
// generation) before the storage upload -- same reasoning/pattern as
// app/api/v1/ai/post-image/generate/route.ts's own maxDuration. Fired by
// components/dashboard/DailyDraftTrigger.tsx AFTER the dashboard page has
// already rendered and been sent to the browser, so this is never on the
// critical path of any page render -- see get-or-create-daily-draft.ts's
// own doc comment for the incident this fixes (the whole Home page used
// to hang behind this exact chain running inside the server render).
// 300s = Hobby maximum with fluid compute (vercel.com/docs/functions/
// configuring-functions/duration, checked 2026-10-26). Was 60, below the
// image step's own ~100s worst case: Vercel killed the function after the
// credit charge and the catch block's refund never ran. ROUTE_DEADLINE_MS
// stops this route's model work 30s earlier so the refund always runs.
export const maxDuration = 300
const ROUTE_DEADLINE_MS = 270_000

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
    console.error("[dashboard/generate-daily-draft] failed to insert failure marker (non-fatal):", err)
  }
}

// Fact-guard time budget (lib/ai/fact-guard.ts): hooks + caption must
// leave room inside maxDuration for the (up to two-attempt) image
// generation after them -- past this a fact-guard retry is skipped and the
// unsupported claim stripped instead.
const TEXT_DEADLINE_MS = 150_000

export async function POST(request: Request) {
  return timedGenerationRoute("daily-draft", (timer) => handlePost(request, timer))
}

async function handlePost(request: Request, timer: GenerationTimer) {
  const requestStartedAt = Date.now()
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }
  const brandId = (body as { brandId?: unknown })?.brandId
  if (typeof brandId !== "string" || !brandId) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "brandId is required."), { status: 400 })
  }

  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  const today = getISTDateString()

  // Re-check the cache here too, not just on the page -- guards against a
  // second DailyDraftTrigger firing (e.g. two open tabs) from charging and
  // generating twice for the same brand/day.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (supabase.from("daily_draft_cache") as any)
    .select("*")
    .eq("brand_id", brand.id)
    .eq("draft_date", today)
    .maybeSingle() as { data: DailyDraftCacheRow | null }

  if (existing) {
    if (existing.generation_failed) {
      return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "Already attempted today."), { status: 409 })
    }
    const draft: DailyDraft = {
      id: existing.id,
      hookText: existing.hook_text,
      captionText: existing.caption_text,
      hashtags: existing.hashtags ?? [],
      imageUrl: existing.image_url,
      failed: false,
    }
    return NextResponse.json({ data: draft })
  }

  const usageCheck = await checkAndIncrementUsage(user.id, POST_CREDIT_COST, FEATURE)
  if (!usageCheck.ok) {
    await insertFailedRow(supabase, brand.id, today)
    const code = usageCheck.status === 429 ? ErrorCodes.USAGE_LIMIT_EXCEEDED : ErrorCodes.INTERNAL_ERROR
    return NextResponse.json(buildError(code, usageCheck.message), { status: usageCheck.status })
  }

  // Spend so far, written onto the charge's ai_generation_logs row on both
  // success and failure (failed attempts are still billed) -- same as
  // app/api/v1/ai/post-image/generate/route.ts.
  const startTime = Date.now()
  let textUsage: TextUsage | undefined
  let textModel: string | null = null
  let imageProvider: string | null = null
  let costUsd: number | null = null
  let contentProjectId: string | null = null
  const recordOutcome = (success: boolean, errorMessage?: string) =>
    logGenerationOutcome(supabase, usageCheck.logId, {
      user_id: user.id, brand_id: brand.id, feature: FEATURE,
      model: [textModel, imageProvider].filter(Boolean).join("+") || "unknown",
      prompt_tokens: textUsage?.prompt_tokens ?? null,
      completion_tokens: textUsage?.completion_tokens ?? null,
      total_tokens: textUsage?.total_tokens ?? null,
      cost_usd: costUsd,
      latency_ms: Date.now() - startTime, success,
      ...(errorMessage ? { error_message: errorMessage } : {}),
      ...(contentProjectId ? { content_project_id: contentProjectId } : {}),
    })

  // Learned brand lessons (lib/ai/brand-brain.ts) -- fail-soft, [] on error.
  const [hookLessons, captionLessons] = await Promise.all([
    getActiveLessons(supabase, brand.id, "hook"),
    getActiveLessons(supabase, brand.id, "caption"),
  ])

  try {
    // Same functions the real fullpost/generate route uses -- no
    // productId, no additionalContext (a generic on-brand post, not tied
    // to anything the user typed), and no contentAngle (omitted entirely
    // so it stays equivalent to that route's own "auto" default).
    // Caption first, then the hook from its plan (lib/ai/post-copy.ts); each
    // call's usage is added as it completes, so neither is lost to the other.
    // Brand art direction (lib/ai/art-direction.ts): derived once, cached in
    // brand_brain; every brief and image prompt below reads it. Fail-soft.
    const artDirection = await ensureArtDirection(supabase, brand)
    const colorThemes = resolveColorThemes(brand)
    const { hook: hookResult, caption: contentResult } = await timer.step("caption", withDeadline(generatePostCopy(brand, {
      product: null,
      platform: "instagram",
      availableColorThemes: colorThemes.map((t) => ({ id: t.id, label: t.label })),
      factGuardDeadline: requestStartedAt + TEXT_DEADLINE_MS,
      captionLessons,
      hookLessons,
      onUsage: (_step, usage, cost) => {
        textUsage = addTextUsage(textUsage, usage)
        costUsd = sumCostUsd(costUsd, cost)
      },
    }), requestStartedAt + ROUTE_DEADLINE_MS - Date.now(), "daily draft copy"))
    textModel = contentResult.model
    const hook = hookResult.hooks[0]
    if (!hook) throw new Error("Hook generation returned no results")
    const caption = contentResult.data as GeneratedCaption
    // Same post-generation merge fullpost/generate/route.ts applies, so
    // this cached draft's caption carries the hook and CTA the same way
    // a real Create Post caption does.
    caption.caption_text = mergeCaptionWithHookAndCta(caption.caption_text, hook.hook_text, caption.cta)
    caption.character_count = caption.caption_text.length
    // Content-matched layout + extras for the overlay text, same as Full Post (lib/design/text-layouts.ts).
    Object.assign(caption, stampPostLayout(caption, caption.suggested_overlay_text, { brand, headingFont: resolveTypography(brand).heading, visualKind: caption.visual?.kind, accentColor: getPrimaryColor(brand) }))

    // Best-effort content_projects row, mirroring fullpost/generate/route.ts --
    // non-fatal if it fails, the draft still generates fine without it.
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
      console.error("[dashboard/generate-daily-draft] failed to create content_projects row (non-fatal):", err instanceof Error ? err.message : err)
    }

    const { data: userData } = await supabase.from("users").select("plan").eq("id", user.id).single<{ plan: UserPlan }>()
    const plan: UserPlan = userData?.plan ?? "starter"
    const colorTheme = findColorTheme(colorThemes, caption.suggested_color_theme_id ?? undefined)
    const imagePrompt = (caption.image_prompt?.trim() || `${hook.hook_text}, ${brand.niche ?? "brand"} product`).slice(0, 500)

    // No captionText -- matches Create Post's current decoupled-overlay
    // architecture, a clean text-free background rather than a
    // server-composited one.
    const imageResult = await timer.step("image", withDeadline(generatePostImage({
      artDirection,
      imagePrompt,
      brandNiche: brand.niche,
      targetAudience: brand.target_audience,
      template: (caption.suggested_template as PostTemplateId) || DEFAULT_POST_TEMPLATE_ID,
      colorTheme,
      captionText: undefined,
      logoUrl: brand.logo_url,
      plan,
      isInternalUnlimitedUser: isInternalUnlimited(user.id),
      productImageUrl: null,
      aspectRatio: "4:5",
    }), requestStartedAt + ROUTE_DEADLINE_MS - Date.now(), "daily draft image"))
    imageProvider = imageResult.attempts[imageResult.attempts.length - 1]?.provider ?? null
    costUsd = sumCostUsd(costUsd, attemptsCostUsd(imageResult.attempts))
    if (!imageResult.success) throw new Error(imageResult.error)

    // Same storage upload as app/api/v1/ai/post-image/generate/route.ts --
    // admin client since storage RLS expects the path to start with the
    // user's own auth uid, which brand ownership is already verified
    // above.
    const admin = await createAdminClient()
    const image = await prepareGeneratedImage(imageResult.buffer, imageResult.mimeType, "dashboard/generate-daily-draft")
    const storagePath = `${user.id}/${brand.id}/${Date.now()}-${crypto.randomUUID()}.${image.ext}`
    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(storagePath, image.buffer, { contentType: image.mimeType, upsert: false })
    if (uploadError) throw new Error(uploadError.message)
    const { data: publicUrlData } = admin.storage.from(BUCKET).getPublicUrl(storagePath)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: insertedRow, error: insertError } = await (supabase.from("daily_draft_cache") as any).insert({
      brand_id: brand.id,
      draft_date: today,
      hook_text: hook.hook_text,
      caption_text: caption.caption_text,
      hashtags: caption.hashtags,
      image_url: publicUrlData.publicUrl,
      content_project_id: contentProjectId,
      generation_failed: false,
    }).select("id").single() as { data: { id: string } | null; error: { message: string } | null }
    if (insertError || !insertedRow) throw new Error(insertError?.message ?? "Failed to save the daily draft.")

    await recordOutcome(true)

    const draft: DailyDraft = {
      id: insertedRow.id,
      hookText: hook.hook_text,
      captionText: caption.caption_text,
      hashtags: caption.hashtags,
      imageUrl: publicUrlData.publicUrl,
      failed: false,
    }
    return NextResponse.json({ data: draft }, { status: 200 })
  } catch (err) {
    console.error("[dashboard/generate-daily-draft] generation failed, refunding charge:", err instanceof Error ? err.message : err)
    if (err instanceof UsageCarryingError) {
      textUsage = addTextUsage(textUsage, err.usage)
      costUsd = sumCostUsd(costUsd, err.costUsd)
    }
    await recordOutcome(false, err instanceof Error ? err.message : "Unknown error")
    await refundGenerationUsage(supabase, user.id, POST_CREDIT_COST, usageCheck.logId)
    await insertFailedRow(supabase, brand.id, today)
    const timedOut = err instanceof DeadlineExceededError
    return NextResponse.json(
      buildError(ErrorCodes.AI_GENERATION_FAILED, timedOut ? GENERATION_TIMED_OUT_MESSAGE : "Daily draft generation failed."),
      { status: timedOut ? 504 : 500 }
    )
  }
}
