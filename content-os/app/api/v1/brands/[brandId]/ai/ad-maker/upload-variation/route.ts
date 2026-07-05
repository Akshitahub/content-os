import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { uploadMediaToStorage } from "@/lib/storage/upload-media"
import { z } from "zod"

type RouteParams = { params: Promise<{ brandId: string }> }

const schema = z.object({
  dataUrl: z.string().min(1),
})

/**
 * Ad Maker's variations only exist as client-side canvas.toDataURL() base64
 * strings — Instagram/Facebook's publish API needs a real publicly-hosted
 * URL, not a data URI. This uploads one specific variation on demand, right
 * before the user schedules it.
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { brandId } = await params
  console.log(`[ai/ad-maker/upload-variation] POST called for brand ${brandId}`)

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[ai/ad-maker/upload-variation] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  const { data: brand } = await supabase.from("brands").select("id").eq("id", brandId).eq("user_id", user.id).single()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.issues[0]?.message), { status: 400 })
  }

  const match = parsed.data.dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid data URL."), { status: 400 })
  }
  const buffer = Buffer.from(match[2], "base64")

  const uploadResult = await uploadMediaToStorage(
    { kind: "buffer", buffer, mimeType: "image/png" },
    `${brandId}/ads`
  )

  if ("error" in uploadResult) {
    console.error("[ai/ad-maker/upload-variation] upload failed:", uploadResult.error)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Couldn't prepare the image for scheduling. Please try again."), { status: 500 })
  }

  return NextResponse.json({ data: { publicUrl: uploadResult.publicUrl } }, { status: 200 })
}
