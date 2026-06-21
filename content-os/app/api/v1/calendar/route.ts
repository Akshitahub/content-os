import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import type { CalendarEntryRow } from "@/types/database"
import { z } from "zod"

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
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  const { searchParams } = new URL(request.url)
  const brandId = searchParams.get("brandId")
  const month = searchParams.get("month") // YYYY-MM

  if (!brandId) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "brandId is required."), { status: 400 })

  // Verify brand ownership
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
  if (error) return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to fetch calendar.", error.message), { status: 500 })

  return NextResponse.json({ data: entries })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = createEntrySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })

  const { brand_id } = parsed.data
  const { data: brand } = await supabase.from("brands").select("user_id").eq("id", brand_id).single<{ user_id: string }>()
  if (!brand || brand.user_id !== user.id) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: entry, error } = await (supabase.from("calendar_entries") as any)
    .insert(parsed.data)
    .select()
    .single() as { data: CalendarEntryRow | null; error: { message: string } | null }

  if (error) return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to create entry.", error.message), { status: 500 })

  return NextResponse.json({ data: entry }, { status: 201 })
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  const { searchParams } = new URL(request.url)
  const entryId = searchParams.get("id")
  if (!entryId) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "id is required."), { status: 400 })

  const { data: entry } = await supabase.from("calendar_entries").select("brand_id").eq("id", entryId).single<{ brand_id: string }>()
  if (!entry) return NextResponse.json(buildError(ErrorCodes.NOT_FOUND, "Entry not found."), { status: 404 })

  const { data: brand } = await supabase.from("brands").select("user_id").eq("id", entry.brand_id).single<{ user_id: string }>()
  if (!brand || brand.user_id !== user.id) return NextResponse.json(buildError(ErrorCodes.UNAUTHORIZED, "Access denied."), { status: 403 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from("calendar_entries") as any).delete().eq("id", entryId)

  return NextResponse.json({ data: { deleted: true } })
}
