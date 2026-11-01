import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"

type Params = { params: Promise<{ brandId: string }> }

// "What SocioPosts has learned" on the brand page: the brand's live lessons
// from its own results (source 'performance', lib/ai/performance-learning.ts)
// and from its owner's edits (source 'edits', lib/ai/edit-learning.ts).
// RLS (brand_lessons, migration 059) scopes rows to the owner.

export async function GET(_request: Request, { params }: Params) {
  const { brandId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  const { data: brand } = await supabase.from("brands").select("id").eq("id", brandId).eq("user_id", user.id).maybeSingle()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  const query = (cols: string) => supabase.from("brand_lessons" as never).select(cols)
    .eq("brand_id", brandId).eq("status", "active").in("source", ["performance", "edits"])
    .order("last_seen_at", { ascending: false }).limit(30)
  let { data, error } = await query("id, kind, rule, source, evidence_count, last_seen_at, expires_at")
  // Before migration 070: no expiry column (and nothing expires).
  if (error) ({ data, error } = await query("id, kind, rule, source, evidence_count, last_seen_at"))
  if (error) return NextResponse.json({ data: { lessons: [] } })
  const now = Date.now()
  const lessons = ((data ?? []) as unknown as { id: string; kind: string; rule: string; source: string; evidence_count: number; expires_at?: string | null }[])
    .filter((l) => !l.expires_at || Date.parse(l.expires_at) > now)
    .map(({ id, kind, rule, source, evidence_count }) => ({ id, kind, rule, source, evidence_count }))
  return NextResponse.json({ data: { lessons } })
}
