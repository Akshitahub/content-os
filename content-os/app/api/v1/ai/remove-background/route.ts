import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { checkAndIncrementUsage } from "@/lib/usage/check-and-increment-usage"

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

  const usageCheck = await checkAndIncrementUsage(user.id)
  if (!usageCheck.ok) {
    const code = usageCheck.status === 429 ? ErrorCodes.USAGE_LIMIT_EXCEEDED : ErrorCodes.INTERNAL_ERROR
    return NextResponse.json(buildError(code, usageCheck.message), { status: usageCheck.status })
  }

  const apiKey = process.env.REMOVE_BG_API_KEY
  if (!apiKey) {
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

  try {
    const removeBgForm = new FormData()
    removeBgForm.append("image_file", imageFile)
    removeBgForm.append("size", "auto")

    const response = await fetch("https://api.remove.bg/v1.0/removebg", {
      method: "POST",
      headers: { "X-Api-Key": apiKey },
      body: removeBgForm,
    })

    if (!response.ok) {
      const text = await response.text()
      console.error("[remove-background] remove.bg error:", response.status, text)
      const errorMsg = response.status === 402
        ? "Remove.bg free tier limit reached. Get a free API key at remove.bg"
        : `Background removal failed (${response.status})`
      return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, errorMsg), { status: 500 })
    }

    const buffer = await response.arrayBuffer()
    const base64 = Buffer.from(buffer).toString("base64")

    return NextResponse.json({ data: { base64 } }, { status: 200 })
  } catch (err) {
    console.error("[remove-background] error:", err)
    return NextResponse.json(
      buildError(ErrorCodes.INTERNAL_ERROR, "Background removal failed. Please try again."),
      { status: 500 }
    )
  }
}
