import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { addUploadedPhoto } from "@/lib/brand-photos"
import { PHOTO_LINK_MAX, verifyPhotoLinkToken } from "@/lib/photo-link-token"
import { buildError, ErrorCodes } from "@/types/api"

type Params = { params: Promise<{ token: string }> }

// One photo from the phone page (app/send-photos/[token]). No login: the
// signed, 7-day token is the auth and only lets photos be ADDED to its one
// brand. The page shrinks each photo before sending (longest side 2048), so
// a request stays well under the platform's body limit.

const MAX_BYTES = 8 * 1024 * 1024

export async function POST(request: Request, { params }: Params) {
  const { token } = await params
  const link = verifyPhotoLinkToken(token)
  if (!link) return NextResponse.json(buildError(ErrorCodes.UNAUTHORIZED, "This link has expired. Ask for a new one from your brand page."), { status: 401 })

  const form = await request.formData().catch(() => null)
  const file = form?.get("photo")
  if (!(file instanceof Blob) || !file.type.startsWith("image/")) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "That isn't a photo."), { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "That photo is too large."), { status: 413 })

  const admin = await createAdminClient()
  const result = await addUploadedPhoto(admin, link.brandId, link.linkId, Buffer.from(await file.arrayBuffer()), PHOTO_LINK_MAX)
  if (result.ok) return NextResponse.json({ data: { id: result.id } })
  if (result.reason === "limit") return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, `This link has taken its ${PHOTO_LINK_MAX} photos.`), { status: 409 })
  if (result.reason === "not_image") return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "That isn't a photo we can read."), { status: 400 })
  return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Couldn't save that photo. Try again."), { status: 500 })
}
