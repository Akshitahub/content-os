import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"

export async function DELETE() {
  console.log("[user/account] DELETE called")
  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[user/account] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error initializing request."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  }

  try {
    // TODO: Add deleted_at column to users table for hard deletion
    const { error: signOutError } = await supabase.auth.signOut()

    if (signOutError) {
      console.error("[user/account] DELETE sign out error:", signOutError)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to delete account.", signOutError.message), { status: 500 })
    }

    return NextResponse.json({ data: { deleted: true } })
  } catch (err) {
    console.error("[user/account] DELETE unexpected error:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to delete account."), { status: 500 })
  }
}
