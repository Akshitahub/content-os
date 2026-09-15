import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import type { HookRow } from "@/types/database"
import { z } from "zod"

type RouteParams = { params: Promise<{ brandId: string; hookId: string }> }

const updateHookSchema = z.object({
  user_rating: z.number().int().min(1).max(5).optional().nullable(),
  is_saved: z.boolean().optional(),
  // Only meaningful alongside a 1-2 star user_rating -- see the
  // content_feedback_notes insert below. Not a hooks column, so it's
  // split out of parsed.data before the update() call rather than passed
  // straight through.
  note: z.string().max(1000).optional().nullable(),
})

export async function PUT(request: Request, { params }: RouteParams) {
  const { brandId, hookId } = await params
  console.log(`[hooks/${brandId}/${hookId}] PUT called`)

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error(`[hooks/${brandId}/${hookId}] createClient failed:`, err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = updateHookSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })

  try {
    // Verify brand ownership and hook belongs to brand
    const { data: hook } = await supabase
      .from("hooks")
      .select("id, brand_id")
      .eq("id", hookId)
      .single<Pick<HookRow, "id" | "brand_id">>()

    if (!hook || hook.brand_id !== brandId) {
      return NextResponse.json(buildError(ErrorCodes.NOT_FOUND, "Hook not found."), { status: 404 })
    }

    const { data: brand } = await supabase
      .from("brands")
      .select("user_id")
      .eq("id", brandId)
      .single<{ user_id: string }>()

    if (!brand || brand.user_id !== user.id) {
      return NextResponse.json(buildError(ErrorCodes.UNAUTHORIZED, "Access denied."), { status: 403 })
    }

    const { note, ...hookUpdate } = parsed.data

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updated, error } = await (supabase.from("hooks") as any)
      .update(hookUpdate)
      .eq("id", hookId)
      .select()
      .single() as { data: HookRow | null; error: { message: string } | null }

    if (error) {
      console.error(`[hooks/${brandId}/${hookId}] PUT update error:`, error)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to update hook.", error.message), { status: 500 })
    }

    // Capture the "why" behind a low rating, if the user gave one -- see
    // supabase/migrations/053_content_feedback_notes.sql for the reasoning
    // on this table's shape. Non-fatal: a failed insert here should never
    // fail the rating update itself, which already succeeded above.
    if (note?.trim() && hookUpdate.user_rating != null && hookUpdate.user_rating <= 2) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: noteError } = await (supabase.from("content_feedback_notes") as any).insert({
        brand_id: brandId,
        content_type: "hook",
        content_id: hookId,
        rating: hookUpdate.user_rating,
        note: note.trim(),
      })
      if (noteError) {
        console.error(`[hooks/${brandId}/${hookId}] content_feedback_notes insert failed (non-fatal):`, noteError.message)
      }
    }

    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error(`[hooks/${brandId}/${hookId}] PUT unexpected error:`, err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to update hook."), { status: 500 })
  }
}
