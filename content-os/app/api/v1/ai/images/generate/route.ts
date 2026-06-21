import { NextResponse } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { generateImageSchema } from "@/lib/validations/ai"
import { generateImage, ImageGenerationError } from "@/lib/ai/image-generator"
import { buildError, ErrorCodes } from "@/types/api"
import { checkAndIncrementUsage } from "@/lib/usage/check-and-increment-usage"
import type { BrandRow, ProductRow } from "@/types/database"

const BUCKET = "brand-images"

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  const usageCheck = await checkAndIncrementUsage(user.id)
  if (!usageCheck.ok) {
    const code = usageCheck.status === 429 ? ErrorCodes.USAGE_LIMIT_EXCEEDED : ErrorCodes.INTERNAL_ERROR
    return NextResponse.json(buildError(code, usageCheck.message), { status: usageCheck.status })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = generateImageSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })

  const { brandId, productId, prompt, style, aspectRatio } = parsed.data

  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  let product: ProductRow | null = null
  if (productId) {
    const { data: prod } = await supabase.from("products").select("*").eq("id", productId).eq("brand_id", brandId).single<ProductRow>()
    product = prod
  }

  const startTime = Date.now()
  let result: Awaited<ReturnType<typeof generateImage>>

  try {
    result = await generateImage(brand, { prompt, style, aspectRatio, product })
  } catch (err) {
    const message = err instanceof ImageGenerationError ? err.message : "Image generation failed. Please try again."
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("ai_generation_logs") as any).insert({
      user_id: user.id, brand_id: brandId, feature: "images", model: "imagen-4.0-generate-001",
      latency_ms: Date.now() - startTime, success: false,
      error_message: err instanceof Error ? err.message : "Unknown error",
    })
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, message), { status: 500 })
  }

  // Upload to Supabase Storage using the admin client (storage RLS expects the
  // path to start with the user's auth uid — admin client bypasses RLS safely
  // here because we've already verified brand ownership above).
  const admin = await createAdminClient()
  const ext = result.mimeType.includes("jpeg") ? "jpg" : "png"
  const storagePath = `${user.id}/${brandId}/${Date.now()}-${crypto.randomUUID()}.${ext}`

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, result.buffer, { contentType: result.mimeType, upsert: false })

  if (uploadError) {
    return NextResponse.json(
      buildError(ErrorCodes.INTERNAL_ERROR, "Image generated but upload to storage failed.", uploadError.message),
      { status: 500 }
    )
  }

  const { data: publicUrlData } = admin.storage.from(BUCKET).getPublicUrl(storagePath)
  const latencyMs = Date.now() - startTime

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: savedImage } = await (supabase.from("generated_images") as any).insert({
    brand_id: brandId,
    product_id: productId ?? null,
    prompt: result.fullPrompt,
    style: style ?? null,
    aspect_ratio: aspectRatio,
    storage_path: storagePath,
    public_url: publicUrlData.publicUrl,
    model_used: "imagen-4.0-generate-001",
  }).select().single()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from("ai_generation_logs") as any).insert({
    user_id: user.id, brand_id: brandId, feature: "images", model: "imagen-4.0-generate-001",
    latency_ms: latencyMs, success: true,
  })

  return NextResponse.json({
    data: {
      id: savedImage?.id ?? null,
      prompt,
      style: style ?? null,
      aspect_ratio: aspectRatio,
      public_url: publicUrlData.publicUrl,
      storage_path: storagePath,
    },
  }, { status: 200 })
}
