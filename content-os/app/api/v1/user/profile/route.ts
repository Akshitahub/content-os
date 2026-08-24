import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import type { UserRow } from "@/types/database"
import { PLAN_LIMITS, type UserPlan } from "@/types/app"
import { z } from "zod"

export async function GET() {
  let supabase
  try {
    supabase = await createClient()
  } catch {
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "Not logged in."), { status: 401 })
  }

  const { data: userData } = await supabase
    .from("users")
    .select("plan, generation_count, generation_count_reset_at")
    .eq("id", user.id)
    .single<{ plan: string; generation_count: number; generation_count_reset_at: string | null }>()

  const rawPlan = userData?.plan
  const plan: UserPlan = rawPlan && rawPlan in PLAN_LIMITS ? (rawPlan as UserPlan) : "free"
  const limit = PLAN_LIMITS[plan].generations
  const resetAt = userData?.generation_count_reset_at ? new Date(userData.generation_count_reset_at) : null
  // Was a raw calendar-month-number comparison (now.getMonth() !==
  // resetAt.getMonth()), which is wrong: generation_count_reset_at is
  // always set to "now + 1 month" by charge_generation_usage (see
  // supabase/migrations/036_atomic_generation_usage.sql), so its month is
  // essentially always different from the current month regardless of
  // whether the reset has actually happened yet -- this made "used"
  // display as 0 immediately after almost every real charge, even though
  // the real generation_count value (confirmed live: 29 right after a
  // real Autopilot charge) was correct the whole time. The only correct
  // question is whether the stored timestamp has actually passed, same
  // check checkAndIncrementUsage/charge_generation_usage themselves use.
  const shouldReset = !resetAt || resetAt <= new Date()
  const currentCount = shouldReset ? 0 : (userData?.generation_count ?? 0)
  const remaining = Math.max(0, limit - currentCount)

  return NextResponse.json({ data: { plan, limit, used: currentCount, remaining } })
}

const updateProfileSchema = z.object({
  full_name: z.string().min(1, "Name is required").max(200),
})

export async function PUT(request: Request) {
  console.log("[user/profile] PUT called")
  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[user/profile] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error initializing request."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON body."), { status: 400 })
  }

  const parsed = updateProfileSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updatedUser, error } = await (supabase.from("users") as any)
      .update({ full_name: parsed.data.full_name, updated_at: new Date().toISOString() })
      .eq("id", user.id)
      .select()
      .single() as { data: UserRow | null; error: { message: string } | null }

    if (error) {
      console.error("[user/profile] PUT update error:", error)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to update profile.", error.message), { status: 500 })
    }

    return NextResponse.json({ data: updatedUser })
  } catch (err) {
    console.error("[user/profile] PUT unexpected error:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to update profile."), { status: 500 })
  }
}
