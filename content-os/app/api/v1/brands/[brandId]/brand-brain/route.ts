import { NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import type { BrandRow } from "@/types/database"
import { parseBrandBrain } from "@/lib/brand-brain-profile"
import { derivationStatusOf, scheduleBrandBrainDerivation, writeBrainFields } from "@/lib/ai/brand-brain-derive"

type Params = { params: Promise<{ brandId: string }> }

// The brand's Brand Brain, filled automatically (lib/ai/brand-brain-derive.ts).
// GET: the profile, which fields are auto / edited, and the derivation status
// -- a brand never derived (or whose derivation failed over an hour ago)
// gets one started in the background. PUT: the user's edits, saved field by
// field (set_brand_brain_fields, migration 065) and marked auto: false so
// re-derivation never touches them.

const RETRY_FAILED_AFTER_MS = 60 * 60_000

async function loadBrand(brandId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 }) }
  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).maybeSingle<BrandRow>()
  if (!brand) return { error: NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 }) }
  return { supabase, brand }
}

export async function GET(_request: Request, { params }: Params) {
  const { brandId } = await params
  const loaded = await loadBrand(brandId)
  if ("error" in loaded) return loaded.error
  const raw = loaded.brand.brand_brain
  let status = derivationStatusOf(raw)
  const retryFailed = status?.status === "failed" && Date.now() - Date.parse(status.finished_at ?? status.started_at) > RETRY_FAILED_AFTER_MS
  if (!status || retryFailed) {
    scheduleBrandBrainDerivation(brandId)
    status = { status: "running", started_at: new Date().toISOString() }
  }
  const fieldMeta = raw && typeof raw === "object" ? ((raw as { field_meta?: Record<string, { auto?: boolean }> }).field_meta ?? {}) : {}
  return NextResponse.json({ data: { brain: parseBrandBrain(raw), field_meta: fieldMeta, status } })
}

const list = z.array(z.string().max(160)).max(8)
const putSchema = z.object({
  fields: z.object({
    facts: z.object({ differentiators: list }).partial().optional(),
    voice: z.object({ phrases_to_avoid: list, claims_never_to_make: list }).partial().optional(),
    strategy: z.object({ objections: list }).partial().optional(),
    visual: z.object({ avoid_visuals: list, photography_style: z.string().max(300), heading_font: z.string().max(20), body_font: z.string().max(20) }).partial().optional(),
  }),
})

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
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.issues[0]?.message), { status: 400 })

  // Normalized the same way the profile is everywhere (trimmed, capped, valid fonts only);
  // a field the user cleared is saved as [] / "" so it stays theirs, empty.
  const clean = parseBrandBrain(parsed.data.fields)
  const fields: Record<string, Record<string, unknown>> = {}
  for (const [sec, section] of Object.entries(parsed.data.fields)) {
    for (const f of Object.keys(section ?? {})) {
      const value = (clean as Record<string, Record<string, unknown> | undefined>)[sec]?.[f]
      const empty = typeof (section as Record<string, unknown>)[f] === "string" ? "" : []
      fields[sec] = { ...(fields[sec] ?? {}), [f]: value ?? empty }
    }
  }
  const saved = await writeBrainFields(loaded.supabase, brandId, fields, false)
  if (!saved) return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Couldn't save. Please try again."), { status: 500 })
  return NextResponse.json({ data: { saved: true } })
}
