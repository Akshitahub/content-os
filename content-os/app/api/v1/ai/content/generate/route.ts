import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { generateContentSchema } from "@/lib/validations/ai"
import { generateContent } from "@/lib/ai/content-generator"
import { buildError, ErrorCodes } from "@/types/api"
import { checkAndIncrementUsage } from "@/lib/usage/check-and-increment-usage"
import { captureServerEvent } from "@/lib/analytics/posthog"
import type { BrandRow, ProductRow } from "@/types/database"
import type { GeneratedCaption, ReelScript, CarouselContent, AdCopy } from "@/types/app"

export async function POST(request: Request) {
  console.log("[ai/content/generate] POST called")

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[ai/content/generate] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

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

  const parsed = generateContentSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })

  const { brandId, productId, format, platform, hookText, additionalContext } = parsed.data

  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  let product: ProductRow | null = null
  if (productId) {
    const { data: prod } = await supabase.from("products").select("*").eq("id", productId).eq("brand_id", brandId).single<ProductRow>()
    product = prod
  }

  const startTime = Date.now()
  let result: Awaited<ReturnType<typeof generateContent>>

  try {
    result = await generateContent(brand, format, { product, platform, hookText, additionalContext })
  } catch (err) {
    console.error("[ai/content/generate] generation failed:", err)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("ai_generation_logs") as any).insert({
      user_id: user.id, brand_id: brandId, feature: `content_${format}`, model: "meta/llama-3.1-70b-instruct",
      latency_ms: Date.now() - startTime, success: false,
      error_message: err instanceof Error ? err.message : "Unknown error",
    })
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "AI generation failed. Please try again."), { status: 500 })
  }

  const latencyMs = Date.now() - startTime

  // Persist each format to its own table
  let reelScriptId: string | null = null
  try {
    if (format === "social_post") {
      const caption = result.data as GeneratedCaption
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from("captions") as any).insert({
        brand_id: brandId, product_id: productId ?? null,
        caption_text: caption.caption_text, hashtags: caption.hashtags,
        cta: caption.cta, character_count: caption.character_count,
        platform: platform ?? "instagram", model_used: result.model,
        is_saved: true,
      })
    } else if (format === "reel_script") {
      const script = result.data as ReelScript
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: savedScript } = await (supabase.from("reel_scripts") as any).insert({
        brand_id: brandId, product_id: productId ?? null,
        platform: platform ?? null, hook: script.hook,
        scenes: script.scenes, caption: script.caption ?? null,
        hashtags: script.hashtags ?? [], is_saved: true,
      }).select("id").single()
      reelScriptId = savedScript?.id ?? null
    } else if (format === "carousel") {
      const carousel = result.data as CarouselContent
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from("carousels") as any).insert({
        brand_id: brandId, product_id: productId ?? null,
        platform: platform ?? null,
        slides: carousel.slides, hashtags: carousel.hashtags ?? [],
        is_saved: true,
      })
    } else if (format === "ad_copy") {
      const ad = result.data as AdCopy
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from("ad_copies") as any).insert({
        brand_id: brandId, product_id: productId ?? null,
        platform: platform ?? null, headline: ad.headline,
        primary_text: ad.primary_text, description: ad.description ?? null,
        cta_button: ad.cta_button ?? null, is_saved: true,
      })
    }
  } catch (persistErr) {
    console.error("[ai/content/generate] persist failed (non-fatal):", persistErr)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from("ai_generation_logs") as any).insert({
    user_id: user.id, brand_id: brandId, feature: `content_${format}`, model: result.model,
    prompt_tokens: result.usage?.prompt_tokens ?? null,
    completion_tokens: result.usage?.completion_tokens ?? null,
    total_tokens: result.usage?.total_tokens ?? null,
    latency_ms: latencyMs, success: true,
  })

  await captureServerEvent(user.id, "content_generated", { content_type: format, brand_id: brandId, platform: platform ?? null })

  return NextResponse.json(
    { data: { format, content: result.data, ...(format === "reel_script" ? { id: reelScriptId } : {}) } },
    { status: 200 }
  )
}
