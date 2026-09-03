import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import type { UserRow } from "@/types/database"
import { getUserCreditSummary } from "@/lib/usage/get-user-credit-summary"
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

  // Single source of truth for this computation -- also used by
  // app/api/admin/users/[id]/route.ts (via createAdminClient()) so the
  // admin panel shows an arbitrary user's credit standing without
  // duplicating this logic. Every existing consumer of `remaining`
  // (e.g. Header's low-credit nudge threshold) should read the real total
  // a user can still spend, not just the monthly-pool slice of it.
  const summary = await getUserCreditSummary(supabase, user.id)

  return NextResponse.json({ data: summary })
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
