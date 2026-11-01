import { NextResponse } from "next/server"
import { z } from "zod"
import { createAdminClient, createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"

type Params = { params: Promise<{ brandId: string; photoId: string }> }

// Where a customer photo's repost rights stand, set by the owner: 'requested'
// when they copy the DM, 'granted' on "They said yes", 'declined' on "They
// said no". Only 'granted' photos are ever used in generated content.

const Body = z.object({ rights_status: z.enum(["none", "requested", "granted", "declined"]) })

export async function PATCH(request: Request, { params }: Params) {
  const { brandId, photoId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  const { data: brand } = await supabase.from("brands").select("id").eq("id", brandId).eq("user_id", user.id).maybeSingle()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid status."), { status: 400 })

  const admin = await createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin.from("brand_images") as any)
    .update({ rights_status: parsed.data.rights_status, rights_updated_at: new Date().toISOString() })
    .eq("id", photoId).eq("brand_id", brandId).eq("source", "ugc")
    .select("id, rights_status").maybeSingle()
  if (error) return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Couldn't save that. Please try again."), { status: 500 })
  if (!data) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Photo not found."), { status: 404 })
  return NextResponse.json({ data })
}
