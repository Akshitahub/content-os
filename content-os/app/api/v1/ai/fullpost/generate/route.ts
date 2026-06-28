import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { generateFullPostSchema } from "@/lib/validations/ai"
import { generateHooks } from "@/lib/ai/hooks-generator"
import { generateContent } from "@/lib/ai/content-generator"
import { generatePostCardHtml } from "@/lib/design/post-card-generator"
import { buildError, ErrorCodes } from "@/types/api"
import { checkAndIncrementUsage } from "@/lib/usage/check-and-increment-usage"
import type { BrandRow, ProductRow } from "@/types/database"
import type { GeneratedCaption, ReelScript, CarouselContent, AdCopy } from "@/types/app"

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  const usageCheck = await checkAndIncrementUsage(user.id)
  if (!usageCheck.ok) {
    const code = usageCheck.status === 429 ? ErrorCodes.USAGE_LIMIT_EXCEEDED : ErrorCodes.INTERNAL_ERROR
    return NextResponse.json(buildError(code, usageCheck.message), { status: usageCheck.status })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = generateFullPostSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })

  const { brandId, productId, format, platform, additionalContext } = parsed.data

  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  let product: ProductRow | null = null
  if (productId) {
    const { data: prod } = await supabase.from("products").select("*").eq("id", productId).eq("brand_id", brandId).single<ProductRow>()
    product = prod
  }

  const startTime = Date.now()

  try {
    // Generate hook first (count=1), then use it to anchor the content
    const hookResult = await generateHooks(brand, {
      hookTypes: ["bold_statement", "question", "story"],
      count: 1,
      platform,
      additionalContext,
      product,
    })

    const hook = hookResult.hooks[0]
    if (!hook) throw new Error("Hook generation returned no results")

    const contentResult = await generateContent(brand, format, {
      product,
      platform,
      hookText: format === "social_post" ? hook.hook_text : undefined,
      additionalContext,
    })

    const postCardHtml = generatePostCardHtml(brand, hook, format, platform, contentResult.data)

    // Persist hook
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("hooks") as any).insert({
      brand_id: brandId,
      product_id: productId ?? null,
      hook_text: hook.hook_text,
      hook_type: hook.hook_type,
      generation_prompt: `fullpost platform:${platform ?? "any"}`,
      model_used: hookResult.model,
      is_saved: true,
    })

    // Persist content to its table
    try {
      if (format === "social_post") {
        const caption = contentResult.data as GeneratedCaption
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from("captions") as any).insert({
          brand_id: brandId, product_id: productId ?? null,
          caption_text: caption.caption_text, hashtags: caption.hashtags,
          cta: caption.cta, character_count: caption.character_count,
          platform: platform ?? "instagram", model_used: contentResult.model,
          is_saved: true,
        })
      } else if (format === "reel_script") {
        const script = contentResult.data as ReelScript
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from("reel_scripts") as any).insert({
          brand_id: brandId, product_id: productId ?? null,
          platform: platform ?? null, hook: script.hook,
          scenes: script.scenes, caption: script.caption ?? null,
          hashtags: script.hashtags ?? [], is_saved: true,
        })
      } else if (format === "carousel") {
        const carousel = contentResult.data as CarouselContent
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from("carousels") as any).insert({
          brand_id: brandId, product_id: productId ?? null,
          platform: platform ?? null, slides: carousel.slides,
          hashtags: carousel.hashtags ?? [], is_saved: true,
        })
      } else if (format === "ad_copy") {
        const ad = contentResult.data as AdCopy
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from("ad_copies") as any).insert({
          brand_id: brandId, product_id: productId ?? null,
          platform: platform ?? null, headline: ad.headline,
          primary_text: ad.primary_text, description: ad.description ?? null,
          cta_button: ad.cta_button ?? null, is_saved: true,
        })
      }
    } catch (persistErr) {
      console.error("[ai/fullpost/generate] persist failed (non-fatal):", persistErr)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("ai_generation_logs") as any).insert({
      user_id: user.id,
      brand_id: brandId,
      feature: `fullpost_${format}`,
      model: hookResult.model,
      latency_ms: Date.now() - startTime,
      success: true,
    })

    return NextResponse.json({
      data: {
        hook,
        content: { format, content: contentResult.data },
        postCardHtml,
        platform,
        format,
      },
    }, { status: 200 })
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("ai_generation_logs") as any).insert({
      user_id: user.id,
      brand_id: brandId,
      feature: `fullpost_${format}`,
      model: "meta/llama-3.1-70b-instruct",
      latency_ms: Date.now() - startTime,
      success: false,
      error_message: err instanceof Error ? err.message : "Unknown error",
    })
    return NextResponse.json(
      buildError(ErrorCodes.AI_GENERATION_FAILED, "Full post generation failed. Please try again."),
      { status: 500 }
    )
  }
}
