import { NextResponse, after } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { generateFullPostSchema } from "@/lib/validations/ai"
import { generateHooks } from "@/lib/ai/hooks-generator"
import { generateContent } from "@/lib/ai/content-generator"
import { generatePostCardHtml } from "@/lib/design/post-card-generator"
import { mergeCaptionWithHookAndCta } from "@/lib/utils/caption-merge"
import { buildError, ErrorCodes } from "@/types/api"
import { checkAndIncrementUsage, refundGenerationUsage, logGenerationOutcome } from "@/lib/usage/check-and-increment-usage"
import { CONTENT_FORMAT_CREDIT_COSTS } from "@/lib/usage/credit-costs"
import { createPostImageSession } from "@/lib/usage/post-image-regenerate-session"
import { fetchPastExamples } from "@/lib/ai/past-examples"
import type { BrandRow, ProductRow } from "@/types/database"
import type { GeneratedCaption, ReelScript, CarouselContent, AdCopy } from "@/types/app"

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = generateFullPostSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })

  const { brandId, productId, format, platform, additionalContext } = parsed.data

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

  try {
    let hookResult: Awaited<ReturnType<typeof generateHooks>>
    let contentResult: Awaited<ReturnType<typeof generateContent>>
    let sessionResult: { sessionId: string } | { error: string } | null = null

    if (format === "social_post") {
      // social_post's caption prompt is built from the hook's own text, so
      // content generation genuinely can't start until the hook exists —
      // this stays sequential.
      hookResult = await generateHooks(brand, {
        hookTypes: ["bold_statement", "question", "story"],
        count: 1,
        platform,
        additionalContext,
        product,
      })
      const firstHook = hookResult.hooks[0]
      if (!firstHook) throw new Error("Hook generation returned no results")

      // createPostImageSession only depends on user.id, not on
      // contentResult — run it alongside content generation instead of
      // after it.
      const [contentRes, sessRes] = await Promise.all([
        generateContent(brand, format, {
          product,
          platform,
          hookText: firstHook.hook_text,
          additionalContext,
          pastExamples,
          includeImagePrompt: true,
        }),
        createPostImageSession(user.id),
      ])
      contentResult = contentRes
      sessionResult = sessRes
    } else {
      // Every other format ignores hookText entirely, so hook generation
      // and content generation have no real dependency on each other — run
      // them concurrently instead of paying for both latencies back to back.
      ;[hookResult, contentResult] = await Promise.all([
        generateHooks(brand, {
          hookTypes: ["bold_statement", "question", "story"],
          count: 1,
          platform,
          additionalContext,
          product,
        }),
        generateContent(brand, format, {
          product,
          platform,
          hookText: undefined,
          additionalContext,
          pastExamples,
          includeImagePrompt: false,
        }),
      ])
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
    const { error: hookInsertError } = await (supabase.from("hooks") as any).insert({
      brand_id: brandId,
      product_id: productId ?? null,
      hook_text: hook.hook_text,
      hook_type: hook.hook_type,
      generation_prompt: `fullpost platform:${platform ?? "any"}`,
      model_used: hookResult.model,
      is_saved: true,
    })
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
    if (format === "social_post") {
      const caption = contentResult.data as GeneratedCaption
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from("captions") as any).insert({
        brand_id: brandId,
        content_project_id: contentProjectId,
        caption_text: caption.caption_text, hashtags: caption.hashtags,
        cta: caption.cta, character_count: caption.character_count,
        platform: platform ?? "instagram", model_used: contentResult.model,
        is_saved: true,
      })
      contentInsertError = error
    } else if (format === "reel_script") {
      const script = contentResult.data as ReelScript
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from("reel_scripts") as any).insert({
        brand_id: brandId, product_id: productId ?? null,
        platform: platform ?? null, hook: script.hook,
        scenes: script.scenes, caption: script.caption ?? null,
        hashtags: script.hashtags ?? [], is_saved: true,
      })
      contentInsertError = error
    } else if (format === "carousel") {
      const carousel = contentResult.data as CarouselContent
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from("carousels") as any).insert({
        brand_id: brandId, product_id: productId ?? null,
        platform: platform ?? null, slides: carousel.slides,
        hashtags: carousel.hashtags ?? [], is_saved: true,
      })
      contentInsertError = error
    } else if (format === "ad_copy") {
      const ad = contentResult.data as AdCopy
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from("ad_copies") as any).insert({
        brand_id: brandId, product_id: productId ?? null,
        platform: platform ?? null, headline: ad.headline,
        primary_text: ad.primary_text, description: ad.description ?? null,
        cta_button: ad.cta_button ?? null, is_saved: true,
      })
      contentInsertError = error
    }
    if (contentInsertError) throw new Error(`Failed to save ${format} content: ${contentInsertError.message}`)

    // Pure logging — deferred via after() so it runs once the response has
    // been sent instead of adding its own latency to it. Plain
    // fire-and-forget isn't safe here (Vercel can freeze/kill the function
    // right after the response is written), so this still needs after()
    // rather than just dropping the await.
    after(async () => {
      await logGenerationOutcome(supabase, logId, {
        user_id: user.id,
        brand_id: brandId,
        feature,
        model: hookResult.model,
        latency_ms: Date.now() - startTime,
        success: true,
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
    return NextResponse.json(
      buildError(ErrorCodes.AI_GENERATION_FAILED, "Full post generation failed. Please try again."),
      { status: 500 }
    )
  }
}
