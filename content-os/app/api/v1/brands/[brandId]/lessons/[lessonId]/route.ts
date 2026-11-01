import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"

type Params = { params: Promise<{ brandId: string; lessonId: string }> }

// The owner removes a lesson: retired (kept for the record, never read by
// generation again). A performance lesson that is still true is not
// re-created by the weekly run -- its key stays taken by the retired row.

export async function DELETE(_request: Request, { params }: Params) {
  const { brandId, lessonId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  const { data: brand } = await supabase.from("brands").select("id").eq("id", brandId).eq("user_id", user.id).maybeSingle()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from("brand_lessons") as any)
    .update({ status: "retired" }).eq("id", lessonId).eq("brand_id", brandId).select("id").maybeSingle()
  if (error) return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Couldn't remove that. Please try again."), { status: 500 })
  if (!data) return NextResponse.json(buildError(ErrorCodes.NOT_FOUND, "Lesson not found."), { status: 404 })
  return NextResponse.json({ data: { id: lessonId } })
}
