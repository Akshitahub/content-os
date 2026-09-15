import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import type { CalendarEntryRow, Json } from "@/types/database"
import { z } from "zod"

// lib/ai/fastlane.ts's own Autopilot insert stores a real generated Flux
// image directly on the entry it belongs to (platformData.image_url,
// around line 984) for hook/caption-format slots -- there's no
// content_project_id chain to walk for those at all, unlike the linked-
// images join below. platform_specific_data is JSONB (typed as Json), so
// this guards/casts safely rather than trusting the shape.
function extractPlatformImageUrl(platformSpecificData: Json | null): string | null {
  if (!platformSpecificData || typeof platformSpecificData !== "object" || Array.isArray(platformSpecificData)) return null
  const url = (platformSpecificData as Record<string, Json>).image_url
  return typeof url === "string" ? url : null
}

const createEntrySchema = z.object({
  brand_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scheduled_time: z.string().optional().nullable(),
  platform: z.enum(["instagram", "facebook", "tiktok", "youtube", "linkedin", "twitter"]).optional().nullable(),
  content_type: z.enum(["reel", "post", "story", "carousel", "thread"]).optional().nullable(),
  status: z.enum(["planned", "content_ready", "scheduled", "published", "missed"]).default("planned"),
  color: z.string().default("#6366f1"),
  notes: z.string().max(1000).optional().nullable(),
  content_project_id: z.string().uuid().optional().nullable(),
})

export async function GET(request: Request) {
  console.log("[calendar] GET called")
  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[calendar] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error initializing request."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  const { searchParams } = new URL(request.url)
  const brandId = searchParams.get("brandId")
  const month = searchParams.get("month")

  if (!brandId) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "brandId is required."), { status: 400 })

  try {
    const { data: brand } = await supabase.from("brands").select("user_id").eq("id", brandId).single<{ user_id: string }>()
    if (!brand || brand.user_id !== user.id) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

    let query = supabase.from("calendar_entries").select("*").eq("brand_id", brandId).order("scheduled_date", { ascending: true })

    if (month) {
      const [year, m] = month.split("-")
      const startDate = `${year}-${m}-01`
      const endDate = new Date(Number(year), Number(m), 0).toISOString().split("T")[0]
      query = query.gte("scheduled_date", startDate).lte("scheduled_date", endDate)
    }

    const { data: entries, error } = await query.returns<CalendarEntryRow[]>()
    if (error) {
      console.error("[calendar] GET query error:", error)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to fetch calendar.", error.message), { status: 500 })
    }

    // Attach each entry's real post-preview thumbnail, if any -- mirrors
    // app/api/v1/brands/[brandId]/captions/route.ts's own "linked-images"
    // join exactly, just with one extra hop: calendar_entries has no
    // content_project_id of its own populated by Autopilot/Fastlane's
    // insert (lib/ai/fastlane.ts only ever sets caption_id there), so this
    // goes calendar_entries.caption_id -> captions.content_project_id ->
    // generated_images.content_project_id. Manually-added entries (the
    // "+ Add entry" modal) have no caption_id at all and simply never
    // resolve a thumbnail here -- no placeholder, no special-casing needed.
    // Autopilot's own hook/caption slots don't resolve through this chain
    // either (their caption insert never sets content_project_id) even
    // though a real generated image exists -- see the
    // extractPlatformImageUrl fallback below this join, which fills that
    // specific gap directly from the entry's own platform_specific_data.
    // Response-shape addition only, not a schema change -- calendar_entries
    // itself is untouched.
    const imageUrlByEntryId = new Map<string, string>()
    try {
      const captionIds = Array.from(new Set((entries ?? []).map((e) => e.caption_id).filter((id): id is string => !!id)))
      if (captionIds.length > 0) {
        const { data: captions, error: captionsError } = await supabase
          .from("captions")
          .select("id, content_project_id")
          .in("id", captionIds)
          .returns<{ id: string; content_project_id: string | null }[]>()

        if (captionsError) {
          console.error("[calendar] GET linked-captions query error (non-fatal):", captionsError)
        } else {
          const projectIdByCaptionId = new Map<string, string>()
          const projectIds: string[] = []
          for (const c of captions ?? []) {
            if (!c.content_project_id) continue
            projectIdByCaptionId.set(c.id, c.content_project_id)
            projectIds.push(c.content_project_id)
          }
          const uniqueProjectIds = Array.from(new Set(projectIds))

          if (uniqueProjectIds.length > 0) {
            const { data: images, error: imagesError } = await supabase
              .from("generated_images")
              .select("content_project_id, public_url")
              .in("content_project_id", uniqueProjectIds)
              .order("created_at", { ascending: false })
              .returns<{ content_project_id: string | null; public_url: string }[]>()

            if (imagesError) {
              console.error("[calendar] GET linked-images query error (non-fatal):", imagesError)
            } else {
              // Most recent public_url per project_id -- images is already
              // ordered created_at descending, so the first match wins and
              // later ones for the same project are skipped.
              const urlByProjectId = new Map<string, string>()
              for (const img of images ?? []) {
                if (!img.content_project_id || urlByProjectId.has(img.content_project_id)) continue
                urlByProjectId.set(img.content_project_id, img.public_url)
              }
              for (const e of entries ?? []) {
                if (!e.caption_id) continue
                const projectId = projectIdByCaptionId.get(e.caption_id)
                const url = projectId ? urlByProjectId.get(projectId) : undefined
                if (url) imageUrlByEntryId.set(e.id, url)
              }
            }
          }
        }
      }
    } catch (err) {
      // Non-fatal -- the calendar still shows every entry, just without
      // thumbnails this one time, rather than failing the whole request.
      console.error("[calendar] GET linked-images join failed (non-fatal):", err)
    }

    // Fill the gap the chain above can't reach: Autopilot's hook/caption
    // slots never set caption_id -> captions.content_project_id at all, so
    // they can never resolve here, even though a real generated image is
    // sitting right on the entry's own platform_specific_data.image_url
    // (see extractPlatformImageUrl's own comment). Only fills entries the
    // chain above left unresolved -- when both exist, the linked-images
    // join's result wins, in case a future flow's generated_images link
    // ends up more authoritative/up to date than this one.
    for (const e of entries ?? []) {
      if (imageUrlByEntryId.has(e.id)) continue
      const platformImageUrl = extractPlatformImageUrl(e.platform_specific_data)
      if (platformImageUrl) imageUrlByEntryId.set(e.id, platformImageUrl)
    }

    const entriesWithImages = (entries ?? []).map((e) => ({
      ...e,
      image_url: imageUrlByEntryId.get(e.id) ?? null,
    }))

    return NextResponse.json({ data: entriesWithImages })
  } catch (err) {
    console.error("[calendar] GET unexpected error:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to fetch calendar."), { status: 500 })
  }
}

export async function POST(request: Request) {
  console.log("[calendar] POST called")
  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[calendar] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error initializing request."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = createEntrySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })

  const { brand_id } = parsed.data

  try {
    const { data: brand } = await supabase.from("brands").select("user_id").eq("id", brand_id).single<{ user_id: string }>()
    if (!brand || brand.user_id !== user.id) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: entry, error } = await (supabase.from("calendar_entries") as any)
      .insert(parsed.data)
      .select()
      .single() as { data: CalendarEntryRow | null; error: { message: string } | null }

    if (error) {
      console.error("[calendar] POST insert error:", error)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to create entry.", error.message), { status: 500 })
    }

    return NextResponse.json({ data: entry }, { status: 201 })
  } catch (err) {
    console.error("[calendar] POST unexpected error:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to create entry."), { status: 500 })
  }
}

export async function PATCH(request: Request) {
  console.log("[calendar] PATCH called")
  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[calendar] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error initializing request."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const patchSchema = z.object({
    id: z.string().uuid(),
    status: z.enum(["planned", "content_ready", "scheduled", "published", "missed"]).optional(),
    caption_text: z.string().max(5000).optional().nullable(),
    hashtags: z.array(z.string().max(200)).optional(),
    // Cancel-schedule sends this explicitly as null to clear the specific
    // time a "scheduled" entry had set — distinct from omitting the field
    // entirely (which leaves whatever's already there untouched, same as
    // every other optional field here).
    scheduled_time: z.string().nullable().optional(),
    // Drag-and-drop rescheduling in ContentCalendar.tsx's month view.
    scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })

  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })

  const { id, ...updates } = parsed.data

  try {
    const { data: entry } = await supabase
      .from("calendar_entries")
      .select("brand_id")
      .eq("id", id)
      .single<{ brand_id: string }>()
    if (!entry) return NextResponse.json(buildError(ErrorCodes.NOT_FOUND, "Entry not found."), { status: 404 })

    const { data: brand } = await supabase
      .from("brands")
      .select("user_id")
      .eq("id", entry.brand_id)
      .single<{ user_id: string }>()
    if (!brand || brand.user_id !== user.id) {
      return NextResponse.json(buildError(ErrorCodes.UNAUTHORIZED, "Access denied."), { status: 403 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updated, error: updateError } = await (supabase.from("calendar_entries") as any)
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single() as { data: CalendarEntryRow | null; error: { message: string } | null }

    if (updateError) {
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to update entry.", updateError.message), { status: 500 })
    }

    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error("[calendar] PATCH unexpected error:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to update entry."), { status: 500 })
  }
}

export async function DELETE(request: Request) {
  console.log("[calendar] DELETE called")
  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[calendar] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error initializing request."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  const { searchParams } = new URL(request.url)
  const entryId = searchParams.get("id")
  if (!entryId) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "id is required."), { status: 400 })

  try {
    const { data: entry } = await supabase.from("calendar_entries").select("brand_id").eq("id", entryId).single<{ brand_id: string }>()
    if (!entry) return NextResponse.json(buildError(ErrorCodes.NOT_FOUND, "Entry not found."), { status: 404 })

    const { data: brand } = await supabase.from("brands").select("user_id").eq("id", entry.brand_id).single<{ user_id: string }>()
    if (!brand || brand.user_id !== user.id) return NextResponse.json(buildError(ErrorCodes.UNAUTHORIZED, "Access denied."), { status: 403 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("calendar_entries") as any).delete().eq("id", entryId)

    return NextResponse.json({ data: { deleted: true } })
  } catch (err) {
    console.error("[calendar] DELETE unexpected error:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to delete entry."), { status: 500 })
  }
}
