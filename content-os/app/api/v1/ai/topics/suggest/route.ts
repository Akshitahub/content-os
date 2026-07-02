import { NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { getGroqClient, MODELS, classifyGroqError } from "@/lib/ai/models"
import { buildTopicSuggestionSystemPrompt, buildTopicSuggestionUserPrompt } from "@/lib/ai/prompts"
import type { BrandRow, ProductRow } from "@/types/database"

const suggestTopicsSchema = z.object({
  brandId: z.string().uuid(),
  productId: z.string().uuid().optional().nullable(),
  contentType: z.enum(["hook", "carousel", "story", "meme"]),
})

export async function POST(request: Request) {
  console.log("[ai/topics/suggest] POST called")

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[ai/topics/suggest] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  }

  // Topic suggestions are intentionally free/unmetered — no checkAndIncrementUsage.
  // These exist to reduce friction before a metered generation.
  // ai_generation_logs is still inserted below for cost tracking visibility.

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = suggestTopicsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })
  }

  const { brandId, productId, contentType } = parsed.data

  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) {
    return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })
  }

  let product: ProductRow | null = null
  if (productId) {
    const { data: prod } = await supabase.from("products").select("*").eq("id", productId).eq("brand_id", brandId).single<ProductRow>()
    product = prod
  }

  const groq = getGroqClient()
  const startTime = Date.now()

  try {
    const completion = await groq.chat.completions.create({
      model: MODELS.extraction,
      messages: [
        { role: "system", content: buildTopicSuggestionSystemPrompt() },
        { role: "user", content: buildTopicSuggestionUserPrompt(brand, { contentType, product }) },
      ],
      temperature: 0.9,
      max_tokens: 512,
    })

    const raw = completion.choices[0]?.message?.content ?? ""
    let topics: string[] = []
    try {
      const result = JSON.parse(raw) as { topics?: unknown }
      if (Array.isArray(result.topics)) {
        topics = (result.topics as unknown[])
          .filter((t): t is string => typeof t === "string")
          .slice(0, 5)
      }
    } catch {
      // If JSON parse fails, return empty topics rather than error
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("ai_generation_logs") as any).insert({
      user_id: user.id, brand_id: brandId, feature: "topic_suggest", model: MODELS.extraction,
      prompt_tokens: completion.usage?.prompt_tokens ?? null,
      completion_tokens: completion.usage?.completion_tokens ?? null,
      total_tokens: completion.usage?.total_tokens ?? null,
      latency_ms: Date.now() - startTime, success: true,
    })

    return NextResponse.json({ data: { topics } })
  } catch (err) {
    console.error("[ai/topics/suggest] error:", err)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("ai_generation_logs") as any).insert({
      user_id: user.id, brand_id: brandId, feature: "topic_suggest", model: MODELS.extraction,
      latency_ms: Date.now() - startTime, success: false,
      error_message: err instanceof Error ? err.message : "Unknown error",
    })
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, classifyGroqError(err)), { status: 500 })
  }
}
