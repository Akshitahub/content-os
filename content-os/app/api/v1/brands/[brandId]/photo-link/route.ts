import { NextResponse } from "next/server"
import QRCode from "qrcode"
import { createClient } from "@/lib/supabase/server"
import { createPhotoLinkToken } from "@/lib/photo-link-token"
import { buildError, ErrorCodes } from "@/types/api"

type Params = { params: Promise<{ brandId: string }> }

// "Send photos from your phone": a fresh 7-day link to app/send-photos/[token]
// for this brand, its QR code (SVG) and a WhatsApp share URL. Nothing is
// stored -- the signed token is the link.

export async function POST(request: Request, { params }: Params) {
  const { brandId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  const { data: brand } = await supabase.from("brands").select("id, name").eq("id", brandId).eq("user_id", user.id).maybeSingle<{ id: string; name: string }>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  const { token, expiresAt } = createPhotoLinkToken(brandId)
  const url = `${new URL(request.url).origin}/send-photos/${token}`
  const qrSvg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" })
  const message = `Send ${brand.name}'s photos to SocioPosts from this phone (link works for 7 days): ${url}`
  return NextResponse.json({ data: { url, expiresAt, qrSvg, whatsappUrl: `https://wa.me/?text=${encodeURIComponent(message)}` } })
}
