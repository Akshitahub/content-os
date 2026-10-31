import { NextResponse } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import type { BrandRow } from "@/types/database"
import { LOGO_MAX_BYTES, LOGO_TYPES, processLogo } from "@/lib/image/logo-upload"

// Brand settings -> "Brand logo": the uploaded file (PNG / JPG / SVG) is
// processed (lib/image/logo-upload.ts: background removed from a JPG,
// margins trimmed, SVG rasterised, a light / dark contrast variant made),
// stored in our storage, and replaces the brand's logo_url (the scraped
// one included). No credits -- it's the brand's own file.
export const maxDuration = 60

const BUCKET = "brand-images"

type RouteParams = { params: Promise<{ brandId: string }> }

const isMissingVariantColumn = (error: { message?: string } | null) => !!error?.message && /logo_variant_url/.test(error.message) && /column|schema cache/i.test(error.message)

export async function POST(request: Request, { params }: RouteParams) {
  const { brandId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  const { data: brand } = await supabase.from("brands").select("id").eq("id", brandId).eq("user_id", user.id).single<Pick<BrandRow, "id">>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  let file: FormDataEntryValue | null
  try {
    file = (await request.formData()).get("logo")
  } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Send the logo as form data."), { status: 400 })
  }
  if (!(file instanceof File)) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Choose a logo file."), { status: 400 })
  if (!LOGO_TYPES.has(file.type)) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Upload a PNG, JPG or SVG logo."), { status: 400 })
  if (file.size > LOGO_MAX_BYTES) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "That logo is over 5 MB."), { status: 400 })

  let logo: Awaited<ReturnType<typeof processLogo>>
  try {
    logo = await processLogo(Buffer.from(await file.arrayBuffer()), file.type)
  } catch (err) {
    console.error(`[brands/${brandId}/logo] couldn't read the logo:`, err instanceof Error ? err.message : err)
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Couldn't read that image -- try a PNG."), { status: 400 })
  }

  // Our storage (admin: the path starts with the user's id, ownership checked above).
  const admin = await createAdminClient()
  const stamp = Date.now()
  const upload = async (buf: Buffer, name: string): Promise<string | null> => {
    const path = `${user.id}/${brandId}/logo-${stamp}-${name}.png`
    const { error } = await admin.storage.from(BUCKET).upload(path, buf, { contentType: "image/png", upsert: true })
    if (error) {
      console.error(`[brands/${brandId}/logo] upload failed (${name}):`, error.message)
      return null
    }
    return admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  }
  const [mainUrl, variantUrl] = await Promise.all([upload(logo.main, "main"), upload(logo.variant, "variant")])
  if (!mainUrl) return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Couldn't save the logo. Please try again."), { status: 500 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const brands = () => admin.from("brands") as any
  let { error } = await brands().update({ logo_url: mainUrl, logo_variant_url: variantUrl }).eq("id", brandId) as { error: { message: string } | null }
  // Before migration 068: the logo itself still replaces the scraped one.
  if (isMissingVariantColumn(error)) ({ error } = await brands().update({ logo_url: mainUrl }).eq("id", brandId) as { error: { message: string } | null })
  if (error) {
    console.error(`[brands/${brandId}/logo] update failed:`, error.message)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Couldn't save the logo. Please try again."), { status: 500 })
  }
  return NextResponse.json({
    data: {
      logo_url: mainUrl,
      logo_variant_url: variantUrl,
      background_removed: logo.backgroundRemoved,
      reads_on_light: logo.readsOnLight,
      reads_on_dark: logo.readsOnDark,
    },
  })
}
