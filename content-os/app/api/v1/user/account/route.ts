import { NextResponse } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
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
    // Deleting the auth.users row cascades through public.users -> brands
    // -> every content table (captions, reel_scripts, carousels, ad_copies,
    // stories, blog_posts, etc.) via the ON DELETE CASCADE foreign keys
    // already defined across supabase/migrations/*.sql. This is real,
    // irreversible deletion — not a soft-delete flag — so there is no
    // recovery path once admin.deleteUser succeeds.
    //
    // Not covered: Supabase Storage objects (generated images, memes, reel
    // scene assets/videos) aren't tied to content rows via a DB foreign
    // key, so a cascade delete here doesn't remove them from the bucket —
    // they're orphaned rather than deleted. Sweeping those would mean
    // walking every storage-backed table across every one of the user's
    // brands before this call, mirroring the per-table storage-path
    // extraction already in app/api/v1/cron/cleanup-abandoned-drafts —
    // a larger, separate task.
    const admin = await createAdminClient()
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)

    if (deleteError) {
      console.error("[user/account] DELETE admin.deleteUser error:", deleteError)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to delete account."), { status: 500 })
    }

    // Best-effort cookie cleanup — the account is already gone server-side
    // at this point regardless of whether this succeeds.
    await supabase.auth.signOut().catch(() => {})

    return NextResponse.json({ data: { deleted: true } })
  } catch (err) {
    console.error("[user/account] DELETE unexpected error:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to delete account."), { status: 500 })
  }
}
