import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { generateContentSchema } from "@/lib/validations/ai"
import { generateContent } from "@/lib/ai/content-generator"
import { buildError, ErrorCodes } from "@/types/api"
import { checkAndIncrementUsage } from "@/lib/usage/check-and-increment-usage"
import type { BrandRow, ProductRow } from "@/types/database"
import type { GeneratedCaption } from "@/types/app"

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("ai_generation_logs") as any).insert({
      user_id: user.id, brand_id: brandId, feature: `content_${format}`, model: "gemini-2.0-flash",
      latency_ms: Date.now() - startTime, success: false,
      error_message: err instanceof Error ? err.message : "Unknown error",
    })
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "AI generation failed. Please try again."), { status: 500 })
  }

  const latencyMs = Date.now() - startTime

  // Persist social_post results to the captions table to maintain history
  if (format === "social_post") {
    const caption = result.data as GeneratedCaption
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("captions") as any).insert({
      brand_id: brandId,
      product_id: productId ?? null,
      caption_text: caption.caption_text,
      hashtags: caption.hashtags,
      cta: caption.cta,
      character_count: caption.character_count,
      platform: platform ?? "instagram",
      model_used: result.model,
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from("ai_generation_logs") as any).insert({
    user_id: user.id, brand_id: brandId, feature: `content_${format}`, model: result.model,
    prompt_tokens: result.usage?.prompt_tokens ?? null,
    completion_tokens: result.usage?.completion_tokens ?? null,
    total_tokens: result.usage?.total_tokens ?? null,
    latency_ms: latencyMs, success: true,
  })

  return NextResponse.json({ data: { format, content: result.data } }, { status: 200 })
}
