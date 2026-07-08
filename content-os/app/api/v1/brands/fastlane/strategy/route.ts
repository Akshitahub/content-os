import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { generateStrategyOverview } from "@/lib/ai/fastlane"
import { z } from "zod"
import type { BrandRow } from "@/types/database"

// Deliberately NOT gated by checkAndIncrementUsage — this is one lightweight
// Groq call meant to be regenerated freely before committing to the real
// 30-slot generation (which does consume generation credits). Charging the
// same budget here would defeat the point of a cheap preview step.
const strategyPreviewSchema = z.object({
  brandId: z.string().uuid(),
  frequency: z.enum(["3x_week", "5x_week", "daily"]).optional(),
  platforms: z.array(z.string()).optional(),
  vibe: z.string().optional(),
  focusAreas: z.array(z.string()).optional(),
})

export async function POST(request: Request) {
  console.log("[fastlane/strategy] POST called")

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[fastlane/strategy] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error initializing request."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = strategyPreviewSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })
  }

  const { brandId, frequency, platforms, vibe, focusAreas } = parsed.data

  const { data: brand } = await supabase
    .from("brands")
    .select("*")
    .eq("id", brandId)
    .eq("user_id", user.id)
    .single<BrandRow>()

  if (!brand) {
    return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })
  }

  try {
    const strategy = await generateStrategyOverview(brand, { frequency, platforms, vibe, focusAreas })
    return NextResponse.json({ data: strategy }, { status: 200 })
  } catch (err) {
    console.error("[fastlane/strategy] generation failed:", err)
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "Couldn't generate a strategy preview. Please try again."), { status: 500 })
  }
}
