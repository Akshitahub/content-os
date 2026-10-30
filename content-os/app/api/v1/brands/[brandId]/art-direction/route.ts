import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import type { BrandRow } from "@/types/database"
import { z } from "zod"
import { artDirectionFrom, artDirectionSchema } from "@/lib/ai/brand-brain"
import { ensureArtDirection, persistArtDirection } from "@/lib/ai/art-direction"

type Params = { params: Promise<{ brandId: string }> }

// The brand's art direction (lib/ai/art-direction.ts): GET reads the cached
// one; POST re-derives it (an explicit refresh -- otherwise it's derived on
// first use and re-derived only when the brand's colours / description /
// logo / photos change); PUT saves the owner's edits ("Brand look" on the
// brand page), marked edited_by_user so they're never auto re-derived --
// only a POST refresh replaces them.

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
  const before = artDirectionFrom(loaded.brand)
  const artDirection = await ensureArtDirection(loaded.supabase, loaded.brand, { refresh: true })
  // ensureArtDirection falls back to the cached one when derivation fails --
  // that's not a refresh, so say so instead of returning the old one.
  if (!artDirection || (before && artDirection.derived_at === before.derived_at && artDirection.edited_by_user === before.edited_by_user)) {
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "Couldn't derive the brand's art direction. Please try again."), { status: 500 })
  }
  return NextResponse.json({ data: { art_direction: artDirection } })
}

const putSchema = z.object({ art_direction: artDirectionSchema })

export async function PUT(request: Request, { params }: Params) {
  const { brandId } = await params
  const loaded = await loadBrand(brandId)
  if ("error" in loaded) return loaded.error

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON body."), { status: 400 })
  }
  const parsed = putSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.issues[0]?.message), { status: 400 })
  }

  const artDirection = {
    ...parsed.data.art_direction,
    palette: Object.fromEntries(Object.entries(parsed.data.art_direction.palette).map(([k, v]) => [k, `#${v.replace(/^#/, "").toLowerCase()}`])) as typeof parsed.data.art_direction.palette,
    edited_by_user: true,
    edited_at: new Date().toISOString(),
  }
  // set_brand_art_direction (migration 063) merges just this key, so it can't clobber a Brand Brain edit.
  const saved = await persistArtDirection(loaded.supabase, brandId, artDirection)
  if (!saved) return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Couldn't save the brand look. Please try again."), { status: 500 })
  return NextResponse.json({ data: { art_direction: artDirection } })
}
