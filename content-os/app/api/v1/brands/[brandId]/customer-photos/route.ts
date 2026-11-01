import { NextResponse } from "next/server"
import { createAdminClient, createClient } from "@/lib/supabase/server"
import { parseBrandBrain } from "@/lib/brand-brain-profile"
import { repostRequestDm } from "@/lib/ugc-dm"
import { buildError, ErrorCodes } from "@/types/api"
import type { BrandRow } from "@/types/database"

type Params = { params: Promise<{ brandId: string }> }

// "Customer photos" on the brand page: photos customers tagged the brand in
// (brand_images source 'ugc', migration 069), each with where its repost
// rights stand and the DM the owner can copy to ask. Before 069: none.

export async function GET(_request: Request, { params }: Params) {
  const { brandId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).maybeSingle<BrandRow>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  const admin = await createAdminClient()
  const { data: conn } = await admin.from("social_connections").select("id").eq("brand_id", brandId).eq("platform", "instagram").eq("is_active", true).maybeSingle()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin.from("brand_images") as any)
    .select("id, url, creator_handle, permalink, rights_status, created_at")
    .eq("brand_id", brandId)
    .eq("source", "ugc")
    .eq("is_active", true)
    .eq("quality_ok", true)
    .order("created_at", { ascending: false })
    .limit(40)
  const rows = error ? [] : (data ?? []) as { id: string; url: string; creator_handle: string; permalink: string | null; rights_status: string }[]
  const voice = { name: brand.name, tone_of_voice: brand.tone_of_voice, ai_persona: brand.ai_persona, brand_personality: brand.brand_personality, phrases: parseBrandBrain(brand.brand_brain).voice?.phrases_to_use ?? [] }
  return NextResponse.json({
    data: {
      instagramConnected: !!conn,
      photos: rows.map((r) => ({ ...r, dm: repostRequestDm(voice, r.creator_handle) })),
    },
  })
}
