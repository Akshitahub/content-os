import { NextResponse } from "next/server"
import { createAdminClient, createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"

type Params = { params: Promise<{ brandId: string; photoId: string }> }

// Removes one collected photo: the row is deactivated (so a later sync never
// re-adds it -- its external_id stays known) and our storage copy deleted.

export async function DELETE(_request: Request, { params }: Params) {
  const { brandId, photoId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  const { data: brand } = await supabase.from("brands").select("id").eq("id", brandId).eq("user_id", user.id).maybeSingle()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  const admin = await createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const images = admin.from("brand_images") as any
  const { data: row } = await images.select("id, storage_path").eq("id", photoId).eq("brand_id", brandId).maybeSingle() as { data: { id: string; storage_path: string | null } | null }
  if (!row) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Photo not found."), { status: 404 })

  const { error } = await images.update({ is_active: false, quality_ok: false }).eq("id", photoId).eq("brand_id", brandId)
  if (error) return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Couldn't remove the photo. Please try again."), { status: 500 })
  if (row.storage_path) {
    const { error: storageError } = await admin.storage.from("brand-images").remove([row.storage_path])
    if (storageError) console.error("[brands/photos] storage delete failed (non-fatal):", storageError.message)
  }
  return NextResponse.json({ data: { id: photoId } })
}
