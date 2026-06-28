import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { generateCaptionsSchema } from "@/lib/validations/ai"
import { generateCaption } from "@/lib/ai/captions-generator"
import { buildError, ErrorCodes } from "@/types/api"
import { checkAndIncrementUsage } from "@/lib/usage/check-and-increment-usage"
import type { BrandRow, ProductRow } from "@/types/database"

export async function POST(request: Request) {
  console.log("[ai/captions/generate] POST called")

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[ai/captions/generate] createClient failed:", err)
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

  const parsed = generateCaptionsSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })

  const { brandId, productId, hookId, hookText, platform, contentType, additionalContext } = parsed.data

  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  let product: ProductRow | null = null
  if (productId) {
    const { data: prod } = await supabase.from("products").select("*").eq("id", productId).eq("brand_id", brandId).single<ProductRow>()
    product = prod
  }

  // Resolve hook text from DB if hookId provided but no hookText
  let resolvedHookText = hookText
  if (!resolvedHookText && hookId) {
    const { data: hook } = await supabase.from("hooks").select("hook_text").eq("id", hookId).single() as { data: { hook_text: string } | null; error: unknown }
    resolvedHookText = hook?.hook_text
  }

  const startTime = Date.now()
  let result: Awaited<ReturnType<typeof generateCaption>>

  try {
    result = await generateCaption(brand, { hookText: resolvedHookText, platform, contentType, additionalContext, product })
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("ai_generation_logs") as any).insert({
      user_id: user.id, brand_id: brandId, feature: "captions", model: "meta/llama-3.1-70b-instruct",
      latency_ms: Date.now() - startTime, success: false,
      error_message: err instanceof Error ? err.message : "Unknown error",
    })
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "AI generation failed. Please try again."), { status: 500 })
  }

  const latencyMs = Date.now() - startTime

  // Save to DB
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: savedCaption } = await (supabase.from("captions") as any).insert({
    brand_id: brandId,
    product_id: productId ?? null,
    hook_id: hookId ?? null,
    caption_text: result.caption.caption_text,
    hashtags: result.caption.hashtags,
    cta: result.caption.cta,
    character_count: result.caption.character_count,
    platform,
    model_used: result.model,
    is_saved: true,
  }).select().single()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from("ai_generation_logs") as any).insert({
    user_id: user.id, brand_id: brandId, feature: "captions", model: result.model,
    prompt_tokens: result.usage?.prompt_tokens ?? null,
    completion_tokens: result.usage?.completion_tokens ?? null,
    total_tokens: result.usage?.total_tokens ?? null,
    latency_ms: latencyMs, success: true,
  })

  return NextResponse.json({ data: { ...result.caption, id: savedCaption?.id ?? null } }, { status: 200 })
}
