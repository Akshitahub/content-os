import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { MODELS, classifyOpenAIError } from "@/lib/ai/models"
import { generateRepurposedContent } from "@/lib/ai/repurpose-generator"
import { checkAndIncrementUsage, refundGenerationUsage, logGenerationOutcome } from "@/lib/usage/check-and-increment-usage"
import { REPURPOSE } from "@/lib/usage/credit-costs"
import { z } from "zod"
import type { BrandRow } from "@/types/database"

const repurposeSchema = z.object({
  brandId: z.string().uuid(),
  content: z.string().min(20, "Content must be at least 20 characters").max(5000),
})

export interface RepurposedContent {
  hooks: string[]
  carousel_ideas: { title: string; slides: string[] }[]
  reel_scripts: { hook: string; scenes: string[] }[]
  tweets: string[]
  linkedin: string
}

export async function POST(request: Request) {
  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[ai/repurpose] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  }

  const usageCheck = await checkAndIncrementUsage(user.id, REPURPOSE, "repurpose")
  if (!usageCheck.ok) {
    const code = usageCheck.status === 429 ? ErrorCodes.USAGE_LIMIT_EXCEEDED : ErrorCodes.INTERNAL_ERROR
    return NextResponse.json(buildError(code, usageCheck.message), { status: usageCheck.status })
  }
  const logId = usageCheck.logId

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = repurposeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, parsed.error.issues[0]?.message ?? "Validation failed."), { status: 400 })
  }

  const { brandId, content } = parsed.data

  const { data: brand } = await supabase
    .from("brands")
    .select("*")
    .eq("id", brandId)
    .eq("user_id", user.id)
    .single<BrandRow>()

  if (!brand) {
    return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })
  }

  // Finalizes this generation's ai_generation_logs row (created by
  // checkAndIncrementUsage above) with model, tokens, cost, latency and
  // outcome -- on every exit path below. Never logs the source content.
  const startTime = Date.now()
  let gen: Awaited<ReturnType<typeof generateRepurposedContent>> | null = null
  const recordOutcome = (success: boolean, errorMessage?: string) =>
    logGenerationOutcome(supabase, logId, {
      user_id: user.id, brand_id: brandId, feature: "repurpose", model: gen?.model ?? MODELS.creative,
      prompt_tokens: gen?.usage?.prompt_tokens ?? null,
      completion_tokens: gen?.usage?.completion_tokens ?? null,
      total_tokens: gen?.usage?.total_tokens ?? null,
      cost_usd: gen?.costUsd ?? null,
      latency_ms: Date.now() - startTime, success, error_message: errorMessage ?? null,
    })

  try {
    // Moved from Groq to OpenAI (MODELS.creative) in the Phase 1b
    // migration -- prompt + call + JSON retry now live in
    // lib/ai/repurpose-generator.ts. null = unparseable after the retry.
    gen = await generateRepurposedContent(content, brand)
    const result = gen.result
    if (!result) {
      await recordOutcome(false, "AI returned invalid JSON")
      await refundGenerationUsage(supabase, user.id, REPURPOSE, logId)
      return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "AI returned invalid JSON. Please try again."), { status: 500 })
    }

    if (!Array.isArray(result.hooks)) {
      await recordOutcome(false, "AI response malformed")
      await refundGenerationUsage(supabase, user.id, REPURPOSE, logId)
      return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "AI response malformed. Please try again."), { status: 500 })
    }

    await recordOutcome(true)
    return NextResponse.json({ data: result }, { status: 200 })
  } catch (err) {
    console.error("[ai/repurpose] error:", err)
    await recordOutcome(false, err instanceof Error ? err.message : "Unknown error")
    await refundGenerationUsage(supabase, user.id, REPURPOSE, logId)
    // A raw thrown error here can be the OpenAI SDK's own error object
    // (network/auth/rate-limit/timeout failures), which can surface the
    // provider in its message text -- classifyOpenAIError strips that
    // before this ever reaches the user.
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, classifyOpenAIError(err)), { status: 500 })
  }
}
