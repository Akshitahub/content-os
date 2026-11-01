import { NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { recordContentEdits } from "@/lib/ai/edit-learning"
import { buildError, ErrorCodes } from "@/types/api"

type Params = { params: Promise<{ brandId: string }> }

// An edit made in a generator before scheduling (Full Post's caption), where
// no server row is updated: the before / after pair, learned from
// (lib/ai/edit-learning.ts -- small touch-ups are dropped there).

const Body = z.object({
  surface: z.enum(["full_post"]),
  field: z.enum(["caption", "hook", "headline"]),
  before: z.string().max(5000),
  after: z.string().max(5000),
})

export async function POST(request: Request, { params }: Params) {
  const { brandId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  const { data: brand } = await supabase.from("brands").select("id").eq("id", brandId).eq("user_id", user.id).maybeSingle()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid edit."), { status: 400 })
  const recorded = await recordContentEdits(supabase, [{ brandId, userId: user.id, ...parsed.data }])
  return NextResponse.json({ data: { recorded } })
}
