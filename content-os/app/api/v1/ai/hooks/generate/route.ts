import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { generateHooksSchema } from "@/lib/validations/ai"
import { generateHooks } from "@/lib/ai/hooks-generator"
import { buildError, ErrorCodes } from "@/types/api"
import { checkAndIncrementUsage } from "@/lib/usage/check-and-increment-usage"
import type { BrandRow, ProductRow } from "@/types/database"

export async function POST(request: Request) {
  console.log("[ai/hooks/generate] POST called")

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[ai/hooks/generate] createClient failed:", err)
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

  const parsed = generateHooksSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })

  const { brandId, productId, hookTypes, count, platform, additionalContext } = parsed.data

  // Fetch brand (verify ownership)
  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  // Optionally fetch product
  let product: ProductRow | null = null
  if (productId) {
    const { data: prod } = await supabase.from("products").select("*").eq("id", productId).eq("brand_id", brandId).single<ProductRow>()
    product = prod
  }

  const startTime = Date.now()
  let result: Awaited<ReturnType<typeof generateHooks>>

  try {
    result = await generateHooks(brand, { hookTypes, count, platform, additionalContext, product })
  } catch (err) {
    console.error("HOOKS GEN ERROR:", err)
    // Log failure
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("ai_generation_logs") as any).insert({
      user_id: user.id, brand_id: brandId, feature: "hooks", model: "meta/llama-3.1-70b-instruct",
      latency_ms: Date.now() - startTime, success: false,
      error_message: err instanceof Error ? err.message : "Unknown error",
    })
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "AI generation failed. Please try again."), { status: 500 })
  }

  const latencyMs = Date.now() - startTime

  // Post-process: enforce 8-word max
  const validatedHooks = result.hooks.map((hook) => {
    const words = hook.hook_text.trim().split(/\s+/)
    if (words.length > 10) {
      const firstSentence = hook.hook_text.split(/[.!?]/)[0] ?? hook.hook_text
      const sentenceWords = firstSentence.trim().split(/\s+/)
      hook = { ...hook, hook_text: sentenceWords.slice(0, 8).join(" ") + "." }
    }
    return hook
  })

  // Save hooks to DB
  const hookInserts = validatedHooks.map((h) => ({
    brand_id: brandId,
    product_id: productId ?? null,
    hook_text: h.hook_text,
    hook_type: h.hook_type,
    platform: platform ?? null,
    generation_prompt: `platform:${platform ?? "any"} count:${count}`,
    model_used: result.model,
    is_saved: true,
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: savedHooks } = await (supabase.from("hooks") as any).insert(hookInserts).select()

  // Log success
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from("ai_generation_logs") as any).insert({
    user_id: user.id, brand_id: brandId, feature: "hooks", model: result.model,
    prompt_tokens: result.usage?.prompt_tokens ?? null,
    completion_tokens: result.usage?.completion_tokens ?? null,
    total_tokens: result.usage?.total_tokens ?? null,
    latency_ms: latencyMs, success: true,
  })

  // Merge DB IDs with validated hooks
  const hooksWithIds = validatedHooks.map((h, i) => ({
    ...h,
    id: savedHooks?.[i]?.id ?? null,
  }))

  return NextResponse.json({ data: hooksWithIds }, { status: 200 })
}
