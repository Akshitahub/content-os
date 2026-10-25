import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { MODELS } from "@/lib/ai/models"
import { UsageCarryingError } from "@/lib/ai/pricing"
import { logGenerationOutcome } from "@/lib/usage/check-and-increment-usage"
import { buildError, ErrorCodes } from "@/types/api"
import { generateOccasionContent, type OccasionContent } from "@/lib/ai/occasion-content-generator"
import { z } from "zod"
import type { BrandRow } from "@/types/database"

type RouteParams = { params: Promise<{ brandId: string }> }

const occasionContentSchema = z.object({
  occasionName: z.string().min(1).max(200),
  occasionAngle: z.string().min(1).max(600),
})

export async function POST(request: Request, { params }: RouteParams) {
  const { brandId } = await params
  console.log("[generate-occasion-content] POST called")

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[generate-occasion-content] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  }

  const { data: brand } = await supabase
    .from("brands")
    .select("*")
    .eq("id", brandId)
    .eq("user_id", user.id)
    .single<BrandRow>()

  if (!brand) {
    return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = occasionContentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message),
      { status: 400 },
    )
  }

  const { occasionName, occasionAngle } = parsed.data

  let generated: OccasionContent

  // This route never charges credits, so there's no charge row to
  // finalize -- logGenerationOutcome inserts one (credits_charged left
  // null, so user/credits-breakdown ignores it). Records model, tokens,
  // cost, latency and outcome; never the occasion angle or generated copy.
  const startTime = Date.now()
  let gen: Awaited<ReturnType<typeof generateOccasionContent>> | null = null
  const recordOutcome = (success: boolean, errorMessage?: string, failedUsage?: UsageCarryingError) =>
    logGenerationOutcome(supabase, null, {
      user_id: user.id, brand_id: brandId, feature: "occasion_content", model: gen?.model ?? MODELS.creative,
      prompt_tokens: (gen?.usage ?? failedUsage?.usage)?.prompt_tokens ?? null,
      completion_tokens: (gen?.usage ?? failedUsage?.usage)?.completion_tokens ?? null,
      total_tokens: (gen?.usage ?? failedUsage?.usage)?.total_tokens ?? null,
      cost_usd: gen?.costUsd ?? failedUsage?.costUsd ?? null,
      latency_ms: Date.now() - startTime, success, error_message: errorMessage ?? null,
    })

  try {
    // Moved from Groq to OpenAI (MODELS.creative) in the Phase 1b
    // migration -- prompt + call + parse now live in
    // lib/ai/occasion-content-generator.ts.
    gen = await generateOccasionContent(brand, occasionName, occasionAngle)
    generated = gen.content

    if (!generated.hook && !generated.caption) {
      await recordOutcome(false, "AI returned empty content")
      return NextResponse.json(
        buildError(ErrorCodes.AI_GENERATION_FAILED, "AI returned empty content."),
        { status: 500 },
      )
    }
  } catch (err) {
    console.error("[generate-occasion-content] AI failed:", err)
    await recordOutcome(false, err instanceof Error ? err.message : "Unknown error", err instanceof UsageCarryingError ? err : undefined)
    return NextResponse.json(
      buildError(ErrorCodes.AI_GENERATION_FAILED, "Failed to generate content. Please try again."),
      { status: 500 },
    )
  }

  // Save hook + caption to DB (non-fatal)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: hookData } = await (supabase.from("hooks") as any)
      .insert({
        brand_id: brandId,
        hook_text: generated.hook,
        hook_type: "bold_statement",
        generation_prompt: `occasion:${occasionName}`,
        model_used: MODELS.creative,
        is_saved: true,
      })
      .select("id")
      .single() as { data: { id: string } | null }

    if (hookData?.id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from("captions") as any).insert({
        brand_id: brandId,
        hook_id: hookData.id,
        caption_text: generated.caption,
        hashtags: generated.hashtags,
        model_used: MODELS.creative,
        is_saved: true,
      })
    }
  } catch (persistErr) {
    console.error("[generate-occasion-content] persist failed (non-fatal):", persistErr)
  }

  await recordOutcome(true)
  return NextResponse.json({ data: generated }, { status: 200 })
}
