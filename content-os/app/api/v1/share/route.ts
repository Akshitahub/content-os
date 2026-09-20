import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { checkAndIncrementShareLinkUsage } from "@/lib/usage/check-and-increment-abuse-limits"
import { generateShareToken } from "@/lib/share/tokens"
import { shareContentTypeSchema, verifyContentBelongsToBrand } from "@/lib/share/resolve-content"
import { z } from "zod"

// Real production domain, not process.env.NEXT_PUBLIC_APP_URL -- unlike an
// OAuth callback (which must match whatever origin is actually serving the
// request, preview deploys included), a link a user pastes into WhatsApp/
// Instagram/Slack must always resolve to the one real public site
// regardless of which environment happened to mint it.
const PUBLIC_SHARE_BASE_URL = "https://www.socioposts.com"

const SHARE_LINK_TTL_DAYS = 30

const schema = z.object({
  brandId: z.string().uuid(),
  contentType: shareContentTypeSchema,
  contentId: z.string().uuid(),
})

interface ShareLinkRow {
  token: string
  expires_at: string | null
}

// This route deliberately never calls checkAndIncrementUsage/charges a
// generation credit -- minting a link for already-generated content isn't
// a generation. checkAndIncrementShareLinkUsage below is a separate,
// generous abuse-rate limit (same family as schedule-post's own), not a
// billing gate.
export async function POST(request: Request) {
  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[share] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error initializing request."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.issues[0]?.message), { status: 400 })

  const { brandId, contentType, contentId } = parsed.data

  const { data: brand } = await supabase.from("brands").select("user_id").eq("id", brandId).single<{ user_id: string }>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })
  if (brand.user_id !== user.id) return NextResponse.json(buildError(ErrorCodes.UNAUTHORIZED, "Access denied."), { status: 403 })

  // Confirms contentId is a real row that actually belongs to brandId --
  // without this, a user could mint a link for another brand/user's
  // content just by guessing a contentId under their own legitimate brand.
  const belongsToBrand = await verifyContentBelongsToBrand(supabase, contentType, contentId, brandId)
  if (!belongsToBrand) return NextResponse.json(buildError(ErrorCodes.NOT_FOUND, "Content not found."), { status: 404 })

  const now = Date.now()

  // Reuse an existing, still-valid (non-expired, non-revoked) link for this
  // exact content instead of minting a new one every time -- repeated
  // clicks on "Copy preview link" for the same post keep returning the
  // same URL, same reasoning content_feedback_notes-style polymorphic
  // lookups already use content_type + content_id as the key.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (supabase.from("share_links") as any)
    .select("token, expires_at")
    .eq("content_type", contentType)
    .eq("content_id", contentId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle() as { data: ShareLinkRow | null }

  if (existing && (!existing.expires_at || new Date(existing.expires_at).getTime() > now)) {
    return NextResponse.json({ data: { url: `${PUBLIC_SHARE_BASE_URL}/p/${existing.token}`, expiresAt: existing.expires_at } })
  }

  // Every call to this route re-hosts nothing and costs no generation
  // credit, but is otherwise uncapped -- bound call frequency the same way
  // schedule-post/url-extraction already are.
  const usageCheck = await checkAndIncrementShareLinkUsage(user.id)
  if (!usageCheck.ok) {
    return NextResponse.json(buildError(ErrorCodes.USAGE_LIMIT_EXCEEDED, usageCheck.message), { status: usageCheck.status })
  }

  const token = generateShareToken()
  const expiresAt = new Date(now + SHARE_LINK_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: insertError } = await (supabase.from("share_links") as any).insert({
    token,
    content_type: contentType,
    content_id: contentId,
    brand_id: brandId,
    created_by: user.id,
    expires_at: expiresAt,
  })
  if (insertError) {
    console.error("[share] insert failed:", insertError)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Couldn't create the preview link. Please try again."), { status: 500 })
  }

  return NextResponse.json({ data: { url: `${PUBLIC_SHARE_BASE_URL}/p/${token}`, expiresAt } })
}

async function resolveOwnedContent(request: Request) {
  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[share] createClient failed:", err)
    return { error: NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error initializing request."), { status: 500 }) }
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return { error: NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 }) }
  }

  const { searchParams } = new URL(request.url)
  const parsed = schema.safeParse({
    brandId: searchParams.get("brandId"),
    contentType: searchParams.get("contentType"),
    contentId: searchParams.get("contentId"),
  })
  if (!parsed.success) {
    return { error: NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.issues[0]?.message), { status: 400 }) }
  }
  const { brandId, contentType, contentId } = parsed.data

  const { data: brand } = await supabase.from("brands").select("user_id").eq("id", brandId).single<{ user_id: string }>()
  if (!brand) return { error: NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 }) }
  if (brand.user_id !== user.id) return { error: NextResponse.json(buildError(ErrorCodes.UNAUTHORIZED, "Access denied."), { status: 403 }) }

  return { supabase, contentType, contentId }
}

/** Looks up an existing, still-active link for a piece of content WITHOUT
 * creating one -- backs the Library "View" panel's optional "Link active
 * until <date>" status (ContentDetailPanel.tsx), which shouldn't mint a
 * fresh link just by opening the panel. */
export async function GET(request: Request) {
  const resolved = await resolveOwnedContent(request)
  if ("error" in resolved) return resolved.error
  const { supabase, contentType, contentId } = resolved

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (supabase.from("share_links") as any)
    .select("token, expires_at")
    .eq("content_type", contentType)
    .eq("content_id", contentId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle() as { data: ShareLinkRow | null }

  if (!existing || (existing.expires_at && new Date(existing.expires_at).getTime() <= Date.now())) {
    return NextResponse.json({ data: null })
  }
  return NextResponse.json({ data: { url: `${PUBLIC_SHARE_BASE_URL}/p/${existing.token}`, expiresAt: existing.expires_at } })
}

/** Sets revoked_at on the active link for a piece of content -- backs the
 * Library "View" panel's "Disable link" button. Idempotent: revoking with
 * no active link is a no-op success, not an error. */
export async function DELETE(request: Request) {
  const resolved = await resolveOwnedContent(request)
  if ("error" in resolved) return resolved.error
  const { supabase, contentType, contentId } = resolved

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateError } = await (supabase.from("share_links") as any)
    .update({ revoked_at: new Date().toISOString() })
    .eq("content_type", contentType)
    .eq("content_id", contentId)
    .is("revoked_at", null)
  if (updateError) {
    console.error("[share] revoke failed:", updateError)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Couldn't disable the preview link. Please try again."), { status: 500 })
  }

  return NextResponse.json({ data: { revoked: true } })
}
