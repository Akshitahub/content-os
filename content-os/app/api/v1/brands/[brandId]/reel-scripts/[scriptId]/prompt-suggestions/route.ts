import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { suggestPromptImprovements } from "@/lib/ai/reel-prompt-optimizer"
import { z } from "zod"
import type { BrandRow } from "@/types/database"

type RouteParams = { params: Promise<{ brandId: string; scriptId: string }> }

// Deliberately NOT gated by checkAndIncrementReelUsage/checkAndIncrementUsage
// — this is an optional, lightweight advisory step (one short Groq call),
// not video generation itself. Charging a reel or generation credit for
// prompt suggestions the user might not even use would defeat the point.
const schema = z.object({
  prompt: z.string().min(1).max(2500),
})

export async function POST(request: Request, { params }: RouteParams) {
  const { brandId } = await params
  console.log("[reel-scripts/prompt-suggestions] POST called")

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[reel-scripts/prompt-suggestions] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  const { data: brand } = await supabase
    .from("brands")
    .select("niche, tone_of_voice")
    .eq("id", brandId)
    .eq("user_id", user.id)
    .single<Pick<BrandRow, "niche" | "tone_of_voice">>()

  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.issues[0]?.message), { status: 400 })
  }

  const result = await suggestPromptImprovements(parsed.data.prompt, {
    niche: brand.niche ?? "",
    tone_of_voice: brand.tone_of_voice ?? "",
  })

  return NextResponse.json({ data: result }, { status: 200 })
}
