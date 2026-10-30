import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import type { BrandRow } from "@/types/database"
import { artDirectionFrom } from "@/lib/ai/brand-brain"
import { ensureArtDirection } from "@/lib/ai/art-direction"

type Params = { params: Promise<{ brandId: string }> }

// The brand's art direction (lib/ai/art-direction.ts): GET reads the cached
// one; POST re-derives it (an explicit refresh -- otherwise it's derived on
// first use and re-derived only when the brand's colours / description change).

// One derivation call (vision when there are product photos).
export const maxDuration = 60

async function loadBrand(brandId: string) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 }) }
  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).maybeSingle<BrandRow>()
  if (!brand) return { error: NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 }) }
  return { supabase, brand }
}

export async function GET(_request: Request, { params }: Params) {
  const { brandId } = await params
  const loaded = await loadBrand(brandId)
  if ("error" in loaded) return loaded.error
  return NextResponse.json({ data: { art_direction: artDirectionFrom(loaded.brand) } })
}

export async function POST(_request: Request, { params }: Params) {
  const { brandId } = await params
  const loaded = await loadBrand(brandId)
  if ("error" in loaded) return loaded.error
  const artDirection = await ensureArtDirection(loaded.supabase, loaded.brand, { refresh: true })
  if (!artDirection) return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "Couldn't derive the brand's art direction. Please try again."), { status: 500 })
  return NextResponse.json({ data: { art_direction: artDirection } })
}
