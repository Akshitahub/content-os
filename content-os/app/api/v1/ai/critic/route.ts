import { NextResponse } from "next/server"
import { z } from "zod"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import type { BrandRow } from "@/types/database"
import { critiquePost } from "@/lib/ai/critic"
import { noteGenerationBrand } from "@/lib/ai/provider-fallback"
import { recordContentEvent } from "@/lib/usage/content-events"
import { toSavedCritic } from "@/lib/design/critic-scores"

// The critic on a finished manual post / carousel cover / story frame
// (lib/ai/critic.ts): the score, its reasons and the one fix to make. No
// credit is charged -- it judges, it doesn't generate -- but calls are
// bounded per user per day (counted from the content events it records).
export const maxDuration = 60

const DAILY_LIMIT = 60

const schema = z.object({
  brandId: z.string().uuid(),
  // The image as it will be posted: hosted, or the editor's own render.
  imageUrl: z.string().max(8_000_000).regex(/^(https?:\/\/|data:image\/(png|jpeg|webp);base64,)/),
  caption: z.string().max(5000).default(""),
  hook: z.string().max(500).default(""),
  format: z.enum(["post", "carousel", "story"]),
  contentType: z.enum(["caption", "carousel", "story"]).optional(),
  contentId: z.string().uuid().nullish(),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.issues[0]?.message), { status: 400 })
  const { brandId, imageUrl, caption, hook, format, contentType, contentId } = parsed.data

  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })
  noteGenerationBrand(brand.id, user.id)

  const admin = await createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count } = await (admin.from("content_events" as any) as any)
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id).eq("event", "critic_scored")
    .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) as { count: number | null }
  if ((count ?? 0) >= DAILY_LIMIT) {
    return NextResponse.json(buildError(ErrorCodes.USAGE_LIMIT_EXCEEDED, "That's a lot of scoring for one day -- try again tomorrow."), { status: 429 })
  }

  const result = await critiquePost(brand, { imageUrl, caption, hook, format }, `manual ${format}`)
  if (!result) {
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "Couldn't score this right now."), { status: 503 })
  }
  const saved = toSavedCritic(result)
  recordContentEvent(admin, {
    userId: user.id, brandId, contentType: contentType ?? (format === "post" ? "caption" : format), contentId: contentId ?? null,
    event: "critic_scored", meta: { source: "manual", score: result.overall, needs_approval: saved.needs_approval, cost_usd: result.costUsd },
  })
  return NextResponse.json({ data: { overall: result.overall, passed: result.passed, top_fix: result.top_fix, reasons: saved.reasons, scores: result.scores } })
}
