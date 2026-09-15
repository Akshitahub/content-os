import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { syncEngagementForBrand } from "@/lib/social/engagement-sync"
import type { SocialConnectionRow } from "@/types/database"

type RouteParams = { params: Promise<{ brandId: string }> }

// Zernio's own analytics list + this route's caption/time-proximity match
// (see lib/social/engagement-sync.ts) can both take a moment for an
// account with a real posting history.
export const maxDuration = 30

/**
 * On-demand trigger for lib/social/engagement-sync.ts -- fetches this
 * brand's real Instagram post analytics and links whatever it can
 * confidently match back to the calendar_entries row that published it,
 * storing the result in content_engagement. Chosen over a new cron job for
 * this first pass: a periodic background sync would need its own Vercel
 * cron entry + CRON_SECRET auth (see app/api/v1/cron/publish-scheduled/
 * route.ts's pattern) -- a bigger infra decision than this pass called
 * for. The core function is already cron-ready (supabase client is
 * injected, not created inside it) if a scheduled version is wanted later;
 * this route is the same core function called on demand instead, e.g. from
 * a future "Sync engagement" action in the analytics or calendar UI (no
 * such button exists yet -- this route has no caller today beyond manual
 * testing).
 *
 * Never charges a credit -- this is account housekeeping, not a
 * generation.
 */
export async function POST(_request: Request, { params }: RouteParams) {
  const { brandId } = await params
  console.log(`[brands/${brandId}/engagement/sync] POST called`)

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[engagement/sync] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  const { data: brand } = await supabase.from("brands").select("id").eq("id", brandId).eq("user_id", user.id).single<{ id: string }>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  const { data: connection } = await supabase
    .from("social_connections")
    .select("*")
    .eq("brand_id", brandId)
    .eq("platform", "instagram")
    .eq("is_active", true)
    .maybeSingle<SocialConnectionRow>()

  if (!connection || !connection.zernio_account_id) {
    return NextResponse.json(
      buildError(ErrorCodes.VALIDATION_ERROR, "Connect Instagram first to sync engagement data."),
      { status: 400 }
    )
  }

  const result = await syncEngagementForBrand(supabase, brandId, connection.zernio_account_id)

  if (result.errors.length > 0) {
    console.error(`[engagement/sync] brand ${brandId} finished with errors:`, result.errors)
  }

  return NextResponse.json({ data: result }, { status: 200 })
}
