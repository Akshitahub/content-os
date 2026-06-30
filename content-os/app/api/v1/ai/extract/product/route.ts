import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { extractFromUrlSchema } from "@/lib/validations/ai"
import { fetchPage, PageFetchError } from "@/lib/web/fetch-page"
import { extractProductFromPage, ExtractionError } from "@/lib/ai/url-extractor"
import { buildError, ErrorCodes } from "@/types/api"

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = extractFromUrlSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Enter a valid URL.", parsed.error.message), { status: 400 })
  }

  // brandId is optional context for this route — not required to extract,
  // ownership is verified by the caller when the product is actually saved.

  try {
    const page = await fetchPage(parsed.data.url)
    const extracted = await extractProductFromPage(page)
    return NextResponse.json({ data: extracted }, { status: 200 })
  } catch (err) {
    if (err instanceof PageFetchError || err instanceof ExtractionError) {
      return NextResponse.json({
        data: null,
        scrape_failed: true,
        message: "We couldn't access that product page automatically. Please fill in the details manually below.",
      }, { status: 200 })
    }
    return NextResponse.json({
      data: null,
      scrape_failed: true,
      message: "We couldn't access that product page automatically. Please fill in the details manually below.",
    }, { status: 200 })
  }
}
