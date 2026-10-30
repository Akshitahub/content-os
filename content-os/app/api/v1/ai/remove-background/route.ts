import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { checkAndIncrementUsage, refundGenerationUsage } from "@/lib/usage/check-and-increment-usage"
import { REMOVE_BACKGROUND } from "@/lib/usage/credit-costs"
import { RemoveBackgroundError, isRemoveBackgroundConfigured, removeBackground } from "@/lib/image/remove-background"

export async function POST(request: Request) {
  let supabase
  try {
    supabase = await createClient()
  } catch {
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  }

  const usageCheck = await checkAndIncrementUsage(user.id, REMOVE_BACKGROUND, "remove_background")
  if (!usageCheck.ok) {
    const code = usageCheck.status === 429 ? ErrorCodes.USAGE_LIMIT_EXCEEDED : ErrorCodes.INTERNAL_ERROR
    return NextResponse.json(buildError(code, usageCheck.message), { status: usageCheck.status })
  }
  const logId = usageCheck.logId

  if (!isRemoveBackgroundConfigured()) {
    return NextResponse.json(
      buildError(ErrorCodes.INTERNAL_ERROR, "Background removal is not configured. Add REMOVE_BG_API_KEY to your environment."),
      { status: 500 }
    )
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid form data."), { status: 400 })
  }

  const imageFile = formData.get("image")
  if (!imageFile || !(imageFile instanceof Blob)) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "No image provided."), { status: 400 })
  }

  const ALLOWED_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"])
  const MAX_SIZE_BYTES = 10 * 1024 * 1024
  if (!ALLOWED_TYPES.has(imageFile.type)) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Please use a JPG, PNG, or WEBP image."), { status: 400 })
  }
  if (imageFile.size > MAX_SIZE_BYTES) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Image must be under 10MB."), { status: 400 })
  }

  try {
    // The remove.bg call itself lives in lib/image/remove-background.ts (shared with the annotated_product post template).
    const buffer = await removeBackground(imageFile)
    const base64 = buffer.toString("base64")

    return NextResponse.json({ data: { base64 } }, { status: 200 })
  } catch (err) {
    console.error("[remove-background] error:", err)
    await refundGenerationUsage(supabase, user.id, REMOVE_BACKGROUND, logId)
    if (err instanceof RemoveBackgroundError && err.status != null) {
      return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, err.message), { status: 500 })
    }
    return NextResponse.json(
      buildError(ErrorCodes.INTERNAL_ERROR, "Background removal failed. Please try again."),
      { status: 500 }
    )
  }
}
