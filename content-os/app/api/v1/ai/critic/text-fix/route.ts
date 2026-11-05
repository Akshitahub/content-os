import { NextResponse } from "next/server"
import { z } from "zod"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import type { BrandRow } from "@/types/database"
import { applyFixToOverlayText } from "@/lib/ai/overlay-text-fix"
import { noteGenerationBrand } from "@/lib/ai/provider-fallback"
import { criticLimitReached } from "@/lib/usage/critic-daily-limit"

// Full Post's "Make it better" for a layout / text fix (fix_target
// "layout_text"): the critic's fix applied to the overlay words only, so
// the client can re-composite the same photo. One short text call, no
// image call; no credit charged, bounded by the critic's daily limit.
export const maxDuration = 30

const schema = z.object({
  brandId: z.string().uuid(),
  fix: z.string().min(1).max(300),
  headline: z.string().min(1).max(300),
  kicker: z.string().max(60).nullish(),
  highlight: z.string().max(120).nullish(),
  hook: z.string().max(500).default(""),
  caption: z.string().max(5000).default(""),
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
  const { brandId, fix, headline, kicker, highlight, hook, caption } = parsed.data

  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })
  noteGenerationBrand(brand.id, user.id)

  if (await criticLimitReached(await createAdminClient(), user.id)) {
    return NextResponse.json(buildError(ErrorCodes.USAGE_LIMIT_EXCEEDED, "That's a lot of scoring for one day -- try again tomorrow."), { status: 429 })
  }

  const result = await applyFixToOverlayText(brand, { fix, headline, kicker: kicker ?? null, highlight: highlight ?? null, hook, caption })
  if (!result) return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "Couldn't rewrite the words right now."), { status: 503 })
  console.log(`[critic/text-fix] cost_usd=${result.costUsd ?? "unknown"}`)
  return NextResponse.json({ data: { headline: result.headline, kicker: result.kicker, highlight: result.highlight } })
}
