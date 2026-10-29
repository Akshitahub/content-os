import { NextResponse, after } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { generateFullPostSchema } from "@/lib/validations/ai"
import { generateHooks } from "@/lib/ai/hooks-generator"
import { generateContent } from "@/lib/ai/content-generator"
import { generatePostCardHtml } from "@/lib/design/post-card-generator"
import { resolveColorThemes } from "@/lib/design/color-themes"
import { resolveTypography } from "@/lib/design/fonts"
import { rememberBrandTypography } from "@/lib/design/brand-typography"
import { mergeCaptionWithHookAndCta } from "@/lib/utils/caption-merge"
import { buildError, ErrorCodes } from "@/types/api"
import { checkAndIncrementUsage, refundGenerationUsage, logGenerationOutcome } from "@/lib/usage/check-and-increment-usage"
import { CONTENT_FORMAT_CREDIT_COSTS } from "@/lib/usage/credit-costs"
import { createPostImageSession } from "@/lib/usage/post-image-regenerate-session"
import { fetchPastExamples } from "@/lib/ai/past-examples"
import { withDeadline, DeadlineExceededError, GENERATION_TIMED_OUT_MESSAGE } from "@/lib/utils/with-deadline"
import { addTextUsage, sumCostUsd } from "@/lib/ai/pricing"
import type { BrandRow, ProductRow } from "@/types/database"
import type { GeneratedCaption, ReelScript, CarouselContent, AdCopy } from "@/types/app"
import { timedGenerationRoute, type GenerationTimer } from "@/lib/utils/generation-timing"
import { getActiveLessons, LESSON_SCOPE_FOR_FORMAT } from "@/lib/ai/brand-brain"
import { recordContentEvent, type ContentEventType } from "@/lib/usage/content-events"
import { gateEventMeta } from "@/lib/ai/quality-gate"
import { stampPostLayout } from "@/lib/design/text-layouts"
import { getPrimaryColor } from "@/lib/design/post-card-generator"
import { generatePostCopy } from "@/lib/ai/post-copy"

// Mirrors components/generate/FullPostGenerator.tsx's former client-side
// ANGLE_HINT map verbatim -- moved server-side so the angle is a real,
// validated parameter (generateFullPostSchema.contentAngle) rather than a
// soft hint the client folded into additionalContext prose.
// Hook + caption are several sequential model calls (each with its own
// retry/fact-guard step). 300s is the maximum Vercel allows on the Hobby
// plan with fluid compute (and the default on every plan) -- see
// vercel.com/docs/functions/configuring-functions/duration, checked
// 2026-10-26. TEXT_DEADLINE_MS keeps the route's own hard stop 30s below
// it, so on a slow run the catch block below still runs (refund + a real
// JSON error) instead of Vercel killing the function mid-flight.
export const maxDuration = 300
const TEXT_DEADLINE_MS = 270_000

const ANGLE_HINT: Record<"problem_solution" | "quick_tip" | "myth_contrarian" | "launch_offer", string> = {
  problem_solution: "Write this as a problem-and-solution post: name a real customer pain point, then the fix.",
  quick_tip: "Write this as a quick tip / how-to post: concise, actionable steps worth saving.",
  myth_contrarian: "Write this as a myth-busting / contrarian post: challenge a common misconception in this space.",
  launch_offer: "Write this as a launch/offer post: promotional, direct, built around a specific offer or drop.",
}

export async function POST(request: Request) {
  return timedGenerationRoute("fullpost", (timer) => handlePost(request, timer))
}

async function handlePost(request: Request, timer: GenerationTimer) {
  const deadlineAt = Date.now() + TEXT_DEADLINE_MS
  const remainingMs = () => deadlineAt - Date.now()
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = generateFullPostSchema.safeParse(body)
  // issues[0]?.message surfaces the specific, human-written message (e.g.
  // additionalContext's own .max() text) instead of parsed.error.message's
  // raw JSON dump of every issue -- matches the convention already used
  // elsewhere (e.g. carousel/generate/route.ts).
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.issues[0]?.message), { status: 400 })

  const { brandId, productId, format, platform, contentAngle, additionalContext } = parsed.data

  const angleHint = contentAngle && contentAngle !== "auto" ? ANGLE_HINT[contentAngle] : null
  const combinedContext = [angleHint, additionalContext].filter(Boolean).join(" ") || undefined

  // social_post is the "Create → Full Post" flow — this text-generation
  // step charges 0 here because the whole Post (hook + caption + AI image)
  // is billed as ONE bundled charge at the image step
  // (app/api/v1/ai/post-image/generate/route.ts, cost = POST). Every other
  // format has no follow-up image charge, so it pays its real weighted
  // cost right here. Moved after body parsing (was previously checked
  // before the request body was even read) so `format` is known before
  // charging for it.
  const cost = format === "social_post" ? 0 : CONTENT_FORMAT_CREDIT_COSTS[format]
  const feature = `fullpost_${format}`
  const usageCheck = await checkAndIncrementUsage(user.id, cost, feature)
  if (!usageCheck.ok) {
    const code = usageCheck.status === 429 ? ErrorCodes.USAGE_LIMIT_EXCEEDED : ErrorCodes.INTERNAL_ERROR
    return NextResponse.json(buildError(code, usageCheck.message), { status: usageCheck.status })
  }
  const logId = usageCheck.logId

  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  let product: ProductRow | null = null
  if (productId) {
    const { data: prod } = await supabase.from("products").select("*").eq("id", productId).eq("brand_id", brandId).single<ProductRow>()
    product = prod
  }

  const startTime = Date.now()

  // Feed the brand's own past highly-rated content of this same format back
  // into the prompt as few-shot examples — app/api/v1/ai/content/generate
  // already did this (fetchPastExamples, shared from lib/ai/past-examples
  // so the two routes can't drift apart), but this flow never did, leaving
  // its caption/copy generation with no brand-voice grounding from past
  // examples at all despite the prompt already supporting it.
  const pastExamples = await fetchPastExamples(supabase, brandId, format)
  // Learned brand lessons (lib/ai/brand-brain.ts): hooks read "hook", the
  // content reads its format's scope. Fail-soft -- [] on any error.
  const contentLessonScope = LESSON_SCOPE_FOR_FORMAT[format]
  const [hookLessons, contentLessons] = await Promise.all([
    getActiveLessons(supabase, brandId, "hook"),
    contentLessonScope ? getActiveLessons(supabase, brandId, contentLessonScope) : Promise.resolve([]),
  ])

  try {
    let hookResult: Awaited<ReturnType<typeof generateHooks>>
    let contentResult: Awaited<ReturnType<typeof generateContent>>
    let sessionResult: { sessionId: string } | { error: string } | null = null

    if (format === "social_post") {
      // The caption (and its post_plan) first, then the hook written from
      // that plan, so the two say the same thing (lib/ai/post-copy.ts).
      // createPostImageSession only depends on user.id -- run it alongside.
      const [copy, sessRes] = await timer.step("caption", withDeadline(Promise.all([
        generatePostCopy(brand, {
          product,
          platform,
          additionalContext: combinedContext,
          pastExamples,
          availableColorThemes: resolveColorThemes(brand).map(t => ({ id: t.id, label: t.label })),
          factGuardDeadline: deadlineAt - 30_000,
          captionLessons: contentLessons,
          hookLessons,
        }),
        createPostImageSession(user.id),
      ]), remainingMs(), "fullpost caption"))
      hookResult = copy.hook
      contentResult = copy.caption
      sessionResult = sessRes
    } else {
      // Every other format ignores hookText entirely, so hook generation
      // and content generation have no real dependency on each other — run
      // them concurrently instead of paying for both latencies back to back.
      ;[hookResult, contentResult] = await timer.step("caption", withDeadline(Promise.all([
        generateHooks(brand, {
          hookTypes: ["bold_statement", "question", "story"],
          count: 1,
          platform,
          additionalContext: combinedContext,
          product,
          factGuardDeadline: deadlineAt - 30_000,
          lessons: hookLessons,
        }),
        generateContent(brand, format, {
          product,
          platform,
          hookText: undefined,
          additionalContext: combinedContext,
          pastExamples,
          includeImagePrompt: false,
          factGuardDeadline: deadlineAt - 30_000,
          lessons: contentLessons,
        }),
      ]), remainingMs(), "fullpost content"))
    }

    const hook = hookResult.hooks[0]
    if (!hook) throw new Error("Hook generation returned no results")

    // buildCaptionSystemPrompt (lib/ai/prompts.ts) already instructs the
    // model to restate the hook and close with the CTA inside caption_text
    // — but that's a prompt-level convention the model can still miss, and
    // the reel-script prompt has no such mandate for its caption at all.
    // Merge here too (redundancy-checked, so a compliant caption is a
    // no-op) so caption_text/caption — the field publish-scheduled/route.ts
    // and schedule-post/route.ts actually persist and send — is guaranteed
    // to carry the hook and CTA, not just usually.
    if (format === "social_post") {
      const caption = contentResult.data as GeneratedCaption
      caption.caption_text = mergeCaptionWithHookAndCta(caption.caption_text, hook.hook_text, caption.cta)
      caption.character_count = caption.caption_text.length
      // Overlay typeface: the model's pick if valid, else the brand-vibe
      // fallback -- so the client never has to guess.
      // Brand-level typography (lib/design/fonts.ts resolveTypography).
      const typography = resolveTypography(brand, { suggested: caption.suggested_font_id })
      caption.suggested_font_id = typography.heading
      await rememberBrandTypography(supabase, brand, typography)
      // Content-matched layout for the overlay text (lib/design/text-layouts.ts).
      Object.assign(caption, stampPostLayout(caption, caption.suggested_overlay_text, { brand, headingFont: typography.heading, visualKind: caption.visual?.kind, accentColor: getPrimaryColor(brand) }))
    } else if (format === "reel_script") {
      const script = contentResult.data as ReelScript
      if (script.caption) {
        script.caption = mergeCaptionWithHookAndCta(script.caption, script.hook, null)
      }
    }

    // Only social_post has an AI-generated post image to regenerate — the
    // session lets /api/v1/ai/post-image/generate know whether a given
    // call is the chargeable initial generation, the free first
    // regenerate, or a chargeable later one, without trusting the client.
    let postSessionId: string | null = null
    if (format === "social_post" && sessionResult) {
      if ("sessionId" in sessionResult) {
        postSessionId = sessionResult.sessionId
      } else {
        // This is swallowed on purpose today (the caption/hook response
        // still returns 200) — but it means postSessionId comes back null,
        // which the client reads as "couldn't start image generation" and
        // never even calls POST /api/v1/ai/post-image/generate. If you're
        // seeing that generic client-side error, this is almost certainly
        // where it actually originates — check createPostImageSession's own
        // log line just above for the underlying Postgres/PostgREST error.
        console.error(`[ai/fullpost/generate] ROOT CAUSE of client "couldn't start image generation": session creation failed for user ${user.id}:`, sessionResult.error)
      }
    }

    const postCardHtml = generatePostCardHtml(brand, hook, format, platform, contentResult.data)

    // Links this caption to the AI post image generated alongside it
    // (app/api/v1/ai/post-image/generate/route.ts sets the same id on its
    // generated_images insert once the client threads it through) — until
    // now neither insert ever populated content_project_id, so a caption
    // and its image were two fully disconnected rows with no way for the
    // Library to find one from the other. content_projects.content_project_id
    // is a real FK (ON DELETE SET NULL), not a bare uuid column, so this
    // creates an actual minimal row rather than just generating an id.
    // Only social_post has a linked AI image at all — every other format
    // skips this.
    let contentProjectId: string | null = null
    if (format === "social_post") {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: project, error: projectError } = await (supabase.from("content_projects") as any)
          .insert({
            brand_id: brandId,
            product_id: productId ?? null,
            title: hook.hook_text,
            platform: platform ?? null,
            content_type: "post",
          })
          .select("id")
          .single() as { data: { id: string } | null; error: { message: string } | null }
        if (projectError) throw new Error(projectError.message)
        contentProjectId = project?.id ?? null
      } catch (err) {
        // Non-fatal — the caption/image still generate fine without the
        // link, they just won't show each other in the Library.
        console.error("[ai/fullpost/generate] failed to create content_projects row (non-fatal):", err instanceof Error ? err.message : err)
      }
    }

    // Persist hook. Explicitly checked -- confirmed live against the real
    // database (not assumed) that Supabase's client does NOT throw for a
    // genuine Postgres/PostgREST rejection (RLS denial, missing column,
    // constraint violation, etc.) on a normal .insert(); it resolves with
    // {data:null, error:{...}}. This used to be a bare, unchecked insert,
    // so a rejection here was completely invisible while the response
    // still claimed success. A failure here throws (caught below), which
    // is deliberately NOT retried -- see the captions note just below for
    // why: the confirmed failure mode is structural, and retrying a
    // structurally-doomed insert would just fail identically again.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: hookRow, error: hookInsertError } = await (supabase.from("hooks") as any).insert({
      brand_id: brandId,
      product_id: productId ?? null,
      hook_text: hook.hook_text,
      hook_type: hook.hook_type,
      generation_prompt: `fullpost platform:${platform ?? "any"}`,
      model_used: hookResult.model,
      is_saved: true,
    }).select("id").single()
    if (hookInsertError) throw new Error(`Failed to save hook: ${hookInsertError.message}`)

    // Persist content to its table. Same explicit-error-check reasoning as
    // the hook insert above -- confirmed live (2026-08-24) that this was
    // silently failing 100% of the time for social_post specifically: the
    // captions insert included `product_id`, a column that has never
    // existed on public.captions (migrations/001_initial_schema.sql never
    // added it -- only hooks/reel_scripts/carousels/ad_copies have a real
    // product_id column, all separately confirmed live to insert fine).
    // PostgREST rejected every attempt with PGRST204 "Could not find the
    // 'product_id' column of 'captions' in the schema cache", and since
    // nothing here ever checked .error, that rejection was invisible: no
    // log, no thrown exception, and the route still returned 200 with a
    // complete-looking hook/caption/image response. Removed the erroneous
    // field (captions' product association already exists via hook_id ->
    // hooks.product_id and content_project_id -> content_projects.product_id,
    // so nothing is lost) and made every insert below throw a real error
    // instead of silently swallowing one -- caught by this function's
    // existing outer catch, which already refunds usage and returns a
    // real error response, so the client is never told a post succeeded
    // when its core content record didn't save.
    let contentInsertError: { message: string } | null = null
    let contentRowId: string | null = null
    if (format === "social_post") {
      const caption = contentResult.data as GeneratedCaption
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: row, error } = await (supabase.from("captions") as any).insert({
        brand_id: brandId,
        content_project_id: contentProjectId,
        caption_text: caption.caption_text, hashtags: caption.hashtags,
        cta: caption.cta, character_count: caption.character_count,
        platform: platform ?? "instagram", model_used: contentResult.model,
        is_saved: true,
      }).select("id").single()
      contentInsertError = error
      contentRowId = row?.id ?? null
    } else if (format === "reel_script") {
      const script = contentResult.data as ReelScript
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: row, error } = await (supabase.from("reel_scripts") as any).insert({
        brand_id: brandId, product_id: productId ?? null,
        platform: platform ?? null, hook: script.hook,
        scenes: script.scenes, caption: script.caption ?? null,
        hashtags: script.hashtags ?? [], is_saved: true,
      }).select("id").single()
      contentInsertError = error
      contentRowId = row?.id ?? null
    } else if (format === "carousel") {
      const carousel = contentResult.data as CarouselContent
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: row, error } = await (supabase.from("carousels") as any).insert({
        brand_id: brandId, product_id: productId ?? null,
        platform: platform ?? null, slides: carousel.slides,
        hashtags: carousel.hashtags ?? [], is_saved: true,
      }).select("id").single()
      contentInsertError = error
      contentRowId = row?.id ?? null
    } else if (format === "ad_copy") {
      const ad = contentResult.data as AdCopy
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: row, error } = await (supabase.from("ad_copies") as any).insert({
        brand_id: brandId, product_id: productId ?? null,
        platform: platform ?? null, headline: ad.headline,
        primary_text: ad.primary_text, description: ad.description ?? null,
        cta_button: ad.cta_button ?? null, is_saved: true,
      }).select("id").single()
      contentInsertError = error
      contentRowId = row?.id ?? null
    }
    if (contentInsertError) throw new Error(`Failed to save ${format} content: ${contentInsertError.message}`)

    // "generated" content events for the hook and the format's own row.
    const contentEventType = ({ social_post: "caption", carousel: "carousel", ad_copy: "ad_copy" } as Record<string, ContentEventType | undefined>)[format]
    recordContentEvent(supabase, [
      { userId: user.id, brandId, contentType: "hook", contentId: hookRow?.id ?? null, event: "generated", meta: { model: hookResult.model, cost_usd: hookResult.costUsd } },
      ...(contentEventType ? [{ userId: user.id, brandId, contentType: contentEventType, contentId: contentRowId, event: "generated" as const, meta: { model: contentResult.model, cost_usd: contentResult.costUsd, ...gateEventMeta(contentResult.gate) } }] : []),
    ])

    // Pure logging — deferred via after() so it runs once the response has
    // been sent instead of adding its own latency to it. Plain
    // fire-and-forget isn't safe here (Vercel can freeze/kill the function
    // right after the response is written), so this still needs after()
    // rather than just dropping the await.
    // Tokens and cost cover BOTH text calls (hooks + content) -- the
    // image is billed and logged separately by post-image/generate.
    const textUsage = addTextUsage(hookResult.usage, contentResult.usage)
    after(async () => {
      await logGenerationOutcome(supabase, logId, {
        user_id: user.id,
        brand_id: brandId,
        feature,
        model: hookResult.model,
        prompt_tokens: textUsage?.prompt_tokens ?? null,
        completion_tokens: textUsage?.completion_tokens ?? null,
        total_tokens: textUsage?.total_tokens ?? null,
        cost_usd: sumCostUsd(hookResult.costUsd, contentResult.costUsd),
        latency_ms: Date.now() - startTime,
        success: true,
        ...(contentProjectId ? { content_project_id: contentProjectId } : {}),
      })
    })

    return NextResponse.json({
      data: {
        hook,
        content: { format, content: contentResult.data },
        postCardHtml,
        platform,
        format,
        postSessionId,
        contentProjectId,
      },
    }, { status: 200 })
  } catch (err) {
    after(async () => {
      await logGenerationOutcome(supabase, logId, {
        user_id: user.id,
        brand_id: brandId,
        feature,
        model: "meta/llama-3.1-70b-instruct",
        latency_ms: Date.now() - startTime,
        success: false,
        error_message: err instanceof Error ? err.message : "Unknown error",
      })
    })
    await refundGenerationUsage(supabase, user.id, cost, logId)
    const timedOut = err instanceof DeadlineExceededError
    return NextResponse.json(
      buildError(ErrorCodes.AI_GENERATION_FAILED, timedOut ? GENERATION_TIMED_OUT_MESSAGE : "Full post generation failed. Please try again."),
      { status: timedOut ? 504 : 500 }
    )
  }
}
