import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"

export async function POST() {
  let supabase
  try {
    supabase = await createClient()
  } catch {
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from("users") as any)
    .update({ onboarding_completed: true })
    .eq("id", user.id)

  if (error) {
    console.error("[onboarding/complete] update error:", error)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to update onboarding status."), { status: 500 })
  }

  return NextResponse.json({ success: true })
}
