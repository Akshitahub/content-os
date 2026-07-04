import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { z } from "zod"
import type { StoryRow } from "@/types/database"

type Params = { params: Promise<{ brandId: string; storyId: string }> }

const updateSchema = z.object({
  user_rating: z.number().int().min(1).max(5).optional(),
  is_saved: z.boolean().optional(),
})

export async function PUT(request: Request, { params }: Params) {
  console.log("[brands/stories/:id] PUT called")

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[brands/stories/:id] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed."), { status: 400 })

  const { brandId, storyId } = await params

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from("stories") as any)
      .update(parsed.data)
      .eq("id", storyId)
      .eq("brand_id", brandId)
      .select()
      .single() as { data: StoryRow | null; error: { message: string } | null }
    if (error) {
      console.error("[brands/stories/:id] update error:", error)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Update failed."), { status: 500 })
    }
    return NextResponse.json({ data })
  } catch (err) {
    console.error("[brands/stories/:id] error:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Update failed."), { status: 500 })
  }
}
