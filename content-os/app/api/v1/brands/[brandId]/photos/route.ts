import { NextResponse } from "next/server"
import { createAdminClient, createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"

type Params = { params: Promise<{ brandId: string }> }

// The brand's collected photos (lib/brand-photos.ts) -- the "Your photos"
// strip on the brand page. Only the usable ones (quality_ok), newest first.
// Ownership is checked with the user's client; the rows are read with the
// admin client (brand_images predates this app's RLS policies).

export async function GET(_request: Request, { params }: Params) {
  const { brandId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  const { data: brand } = await supabase.from("brands").select("id").eq("id", brandId).eq("user_id", user.id).maybeSingle()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  const admin = await createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin.from("brand_images") as any)
    .select("id, url, kind, source, product_id, created_at")
    .eq("brand_id", brandId)
    .eq("is_active", true)
    .eq("quality_ok", true)
    .order("created_at", { ascending: false })
    .limit(60)
  // Before migration 064 the columns don't exist yet -- no photos, not an error.
  if (error) return NextResponse.json({ data: { photos: [] } })
  return NextResponse.json({ data: { photos: data ?? [] } })
}
