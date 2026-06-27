import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { fastlaneSchema } from "@/lib/validations/fastlane"
import { executeFastlane } from "@/lib/ai/fastlane"

const FASTLANE_GENERATION_COST = 30

export async function POST(request: Request) {
  console.log("[fastlane] POST called")

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[fastlane] createClient failed:", err)
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

  const parsed = fastlaneSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })
  }

  const { brandId } = parsed.data

  try {
    // Verify brand ownership
    const { data: brand } = await supabase
      .from("brands")
      .select("id, user_id")
      .eq("id", brandId)
      .eq("user_id", user.id)
      .single<{ id: string; user_id: string }>()

    if (!brand) {
      return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })
    }

    // Check usage limits
    const { data: userData } = await supabase
      .from("users")
      .select("plan, generation_count, generation_count_reset_at")
      .eq("id", user.id)
      .single<{ plan: string; generation_count: number; generation_count_reset_at: string | null }>()

    if (userData) {
      const planLimits: Record<string, number> = { free: 15, starter: 500, pro: 500, agency: 2000 }
      const limit = planLimits[userData.plan] ?? 15

      // Reset monthly if needed
      const now = new Date()
      const resetAt = userData.generation_count_reset_at ? new Date(userData.generation_count_reset_at) : null
      const shouldReset = !resetAt || (now.getMonth() !== resetAt.getMonth() || now.getFullYear() !== resetAt.getFullYear())

      const currentCount = shouldReset ? 0 : userData.generation_count

      if (currentCount + FASTLANE_GENERATION_COST > limit) {
        return NextResponse.json(
          buildError(ErrorCodes.INTERNAL_ERROR, `Fastlane requires ${FASTLANE_GENERATION_COST} generations. You have ${limit - currentCount} remaining on your ${userData.plan} plan.`),
          { status: 429 }
        )
      }
    }

    // Execute fastlane
    const result = await executeFastlane(supabase, user.id, brandId)

    // Increment generation count
    const { data: currentUser } = await supabase
      .from("users")
      .select("generation_count, generation_count_reset_at")
      .eq("id", user.id)
      .single<{ generation_count: number; generation_count_reset_at: string | null }>()

    if (currentUser) {
      const now = new Date()
      const resetAt = currentUser.generation_count_reset_at ? new Date(currentUser.generation_count_reset_at) : null
      const shouldReset = !resetAt || (now.getMonth() !== resetAt.getMonth() || now.getFullYear() !== resetAt.getFullYear())

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from("users") as any).update({
        generation_count: shouldReset
          ? FASTLANE_GENERATION_COST
          : currentUser.generation_count + FASTLANE_GENERATION_COST,
        generation_count_reset_at: shouldReset ? now.toISOString() : currentUser.generation_count_reset_at,
      }).eq("id", user.id)
    }

    return NextResponse.json({ data: result }, { status: 201 })
  } catch (err) {
    console.error("[fastlane] POST unexpected error:", err)
    const message = err instanceof Error ? err.message : "Failed to execute Fastlane."
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, message), { status: 500 })
  }
}
