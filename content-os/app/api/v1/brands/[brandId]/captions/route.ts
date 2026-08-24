import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import type { CaptionRow } from "@/types/database"

type RouteParams = { params: Promise<{ brandId: string }> }

async function getAuthorizedBrand(brandId: string) {
  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[captions] createClient failed:", err)
    return { error: "server_error" as const, supabase: null, user: null }
  }
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: "unauthenticated" as const, supabase, user: null }
  const { data: brand } = await supabase
    .from("brands")
    .select("id, user_id")
    .eq("id", brandId)
    .single<{ id: string; user_id: string }>()
  if (!brand) return { error: "not_found" as const, supabase, user }
  if (brand.user_id !== user.id) return { error: "unauthorized" as const, supabase, user }
  return { error: null, supabase, user }
}

export async function GET(request: Request, { params }: RouteParams) {
  const { brandId } = await params
  console.log(`[captions/${brandId}] GET called`)
  const result = await getAuthorizedBrand(brandId)

  if (result.error === "server_error") return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  if (result.error === "unauthenticated") return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  if (result.error === "not_found") return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })
  if (result.error === "unauthorized") return NextResponse.json(buildError(ErrorCodes.UNAUTHORIZED, "Access denied."), { status: 403 })

  const { searchParams } = new URL(request.url)
  const savedParam = searchParams.get("saved")
  const limitParam = searchParams.get("limit")
  const platform = searchParams.get("platform")

  try {
    let query = result.supabase!
      .from("captions")
      .select("*")
      .eq("brand_id", brandId)
      .order("created_at", { ascending: false })

    // Default to saved=true; pass saved=false to get all
    if (savedParam !== "false") {
      query = query.eq("is_saved", true)
    }

    if (platform && platform !== "all") {
      query = query.eq("platform", platform)
    }

    if (limitParam) {
      const limit = parseInt(limitParam, 10)
      if (!isNaN(limit) && limit > 0) query = query.limit(limit)
    }

    const { data: captions, error } = await query.returns<CaptionRow[]>()

    if (error) {
      console.error(`[captions/${brandId}] GET query error:`, error)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to fetch captions.", error.message), { status: 500 })
    }

    // Attach each caption's linked AI post image(s), if any -- captions and
    // generated_images have zero direct relationship of their own, only a
    // shared content_project_id (see app/api/v1/ai/fullpost/generate/route.ts
    // and .../post-image/generate/route.ts, which now both set it). A
    // project can have more than one image (each "Regenerate image" call
    // inserts a new row rather than updating in place), so this is an array
    // per caption, not a single image. One batched query, not one per
    // caption.
    const projectIds = Array.from(new Set(captions.map((c) => c.content_project_id).filter((id): id is string => !!id)))
    const imagesByProject = new Map<string, { public_url: string }[]>()
    if (projectIds.length > 0) {
      const { data: images, error: imagesError } = await result.supabase!
        .from("generated_images")
        .select("content_project_id, public_url")
        .in("content_project_id", projectIds)
        .order("created_at", { ascending: false })
        .returns<{ content_project_id: string | null; public_url: string }[]>()

      if (imagesError) {
        // Non-fatal — the Library still shows the caption text, just
        // without its image this one time, rather than failing the whole list.
        console.error(`[captions/${brandId}] GET linked-images query error (non-fatal):`, imagesError)
      } else {
        for (const img of images ?? []) {
          if (!img.content_project_id) continue
          const list = imagesByProject.get(img.content_project_id) ?? []
          list.push({ public_url: img.public_url })
          imagesByProject.set(img.content_project_id, list)
        }
      }
    }

    const captionsWithImages = captions.map((c) => ({
      ...c,
      images: c.content_project_id ? (imagesByProject.get(c.content_project_id) ?? []) : [],
    }))

    return NextResponse.json({ data: captionsWithImages })
  } catch (err) {
    console.error(`[captions/${brandId}] GET unexpected error:`, err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to fetch captions."), { status: 500 })
  }
}
