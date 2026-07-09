import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { suggestBlogPromptImprovements } from "@/lib/ai/blog-prompt-optimizer"
import { z } from "zod"
import type { BrandRow } from "@/types/database"

// Deliberately NOT gated by checkAndIncrementUsage — this is an optional,
// lightweight advisory step (one short Groq call), not blog generation
// itself. Charging a generation credit for suggestions the user might not
// even use would defeat the point, same reasoning as the reel prompt
// suggestions endpoint.
const schema = z.object({
  brandId: z.string().uuid(),
  prompt: z.string().min(1).max(1500),
})

export async function POST(request: Request) {
  console.log("[ai/blog/suggest-prompt] POST called")

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[ai/blog/suggest-prompt] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

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

  const { brandId, prompt } = parsed.data

  const { data: brand } = await supabase
    .from("brands")
    .select("niche, tone_of_voice")
    .eq("id", brandId)
    .eq("user_id", user.id)
    .single<Pick<BrandRow, "niche" | "tone_of_voice">>()

  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  const result = await suggestBlogPromptImprovements(prompt, {
    niche: brand.niche ?? "",
    tone_of_voice: brand.tone_of_voice ?? "",
  })

  return NextResponse.json({ data: result }, { status: 200 })
}
