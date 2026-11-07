import { NextResponse } from "next/server"
import { z } from "zod"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import type { BrandRow } from "@/types/database"
import { critiquePost } from "@/lib/ai/critic"
import { getPerformanceLessons } from "@/lib/ai/performance-learning"
import { noteGenerationBrand } from "@/lib/ai/provider-fallback"
import { recordContentEvent } from "@/lib/usage/content-events"
import { toSavedCritic } from "@/lib/design/critic-scores"
import { criticLimitReached } from "@/lib/usage/critic-daily-limit"
import { textLayoutIdSchema } from "@/lib/design/text-layouts"
import { enforceRateLimits } from "@/lib/security/rate-limit"

// The critic on a finished manual post / carousel cover / story frame
// (lib/ai/critic.ts): the score, its reasons and the one fix to make. No
// credit is charged -- it judges, it doesn't generate -- but calls are
// bounded per user per day (lib/usage/critic-daily-limit.ts).
export const maxDuration = 60

const schema = z.object({
  brandId: z.string().uuid(),
  // The image as it will be posted: hosted, or the editor's own render.
  imageUrl: z.string().max(8_000_000).regex(/^(https?:\/\/|data:image\/(png|jpeg|webp);base64,)/),
  caption: z.string().max(5000).default(""),
  hook: z.string().max(500).default(""),
  format: z.enum(["post", "carousel", "story"]),
  contentType: z.enum(["caption", "carousel", "story"]).optional(),
  contentId: z.string().uuid().nullish(),
  // The text layout drawn on the image (split_panel / bottom_card aren't collages).
  textLayout: textLayoutIdSchema.optional(),
  // Words the creative concept deliberately put in the picture -- judged as design.
  intendedText: z.string().max(80).optional(),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  const rateLimited = await enforceRateLimits(user.id, "generate")
  if (rateLimited) return rateLimited

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.issues[0]?.message), { status: 400 })
  const { brandId, imageUrl, caption, hook, format, contentType, contentId, textLayout, intendedText } = parsed.data

  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })
  noteGenerationBrand(brand.id, user.id)

  const admin = await createAdminClient()
  if (await criticLimitReached(admin, user.id)) {
    return NextResponse.json(buildError(ErrorCodes.USAGE_LIMIT_EXCEEDED, "That's a lot of scoring for one day -- try again tomorrow."), { status: 429 })
  }

  // What the brand's own results say works, as context (lib/ai/performance-learning.ts).
  const resultsLessons = (await getPerformanceLessons(admin, brand.id)).slice(0, 3).map((l) => l.rule)
  const result = await critiquePost(brand, { imageUrl, caption, hook, format, resultsLessons, textLayout, intendedText }, `manual ${format}`)
  if (!result) {
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "Couldn't score this right now."), { status: 503 })
  }
  const saved = toSavedCritic(result)
  recordContentEvent(admin, {
    userId: user.id, brandId, contentType: contentType ?? (format === "post" ? "caption" : format), contentId: contentId ?? null,
    event: "critic_scored", meta: { source: "manual", score: result.overall, needs_approval: saved.needs_approval, cost_usd: result.costUsd },
  })
  return NextResponse.json({ data: { overall: result.overall, passed: result.passed, top_fix: result.top_fix, fix_target: result.fix_target, reasons: saved.reasons, scores: result.scores } })
}
