import { NextResponse } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { generateImageSchema } from "@/lib/validations/ai"
import { generateImage } from "@/lib/ai/image-generator"
import { buildError, ErrorCodes } from "@/types/api"
import { checkAndIncrementUsage, refundGenerationUsage } from "@/lib/usage/check-and-increment-usage"
import { IMAGE } from "@/lib/usage/credit-costs"
import { isInternalUnlimited } from "@/lib/usage/is-internal-unlimited"
import type { BrandRow, ProductRow } from "@/types/database"
import type { UserPlan } from "@/types/app"

const BUCKET = "brand-images"

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  const usageCheck = await checkAndIncrementUsage(user.id, IMAGE)
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

  // Determines the image provider (Free -> Pollinations, paid -> Flux) —
  // same lookup app/api/v1/ai/post-image/generate/route.ts already does.
  const { data: userData } = await supabase.from("users").select("plan").eq("id", user.id).single<{ plan: UserPlan }>()
  const plan: UserPlan = userData?.plan ?? "free"

  const startTime = Date.now()
  // generateImage no longer throws (it now wraps fetchBackgroundImage,
  // which never throws) — check .success instead of try/catch, same
  // pattern as post-image/generate/route.ts.
  const result = await generateImage(brand, {
    prompt, style, aspectRatio, product, plan,
    isInternalUnlimitedUser: isInternalUnlimited(user.id),
  })

  if (!result.success) {
    // Full raw error (e.g. Pollinations API error text) stays server-side
    // only — never shown to the user.
    console.error("[ai/images/generate] generation failed:", result.error)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("ai_generation_logs") as any).insert({
      user_id: user.id, brand_id: brandId, feature: "images", model: "unknown",
      latency_ms: Date.now() - startTime, success: false,
      error_message: result.error,
    })
    await refundGenerationUsage(supabase, user.id, IMAGE)
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "Image generation failed. Please try again."), { status: 500 })
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
    // Image was generated but never actually delivered to the user — no
    // usable output, same as a generation failure.
    await refundGenerationUsage(supabase, user.id, IMAGE)
    return NextResponse.json(
      buildError(ErrorCodes.INTERNAL_ERROR, "Image generated but upload to storage failed.", uploadError.message),
      { status: 500 }
    )
  }

  const { data: publicUrlData } = admin.storage.from(BUCKET).getPublicUrl(storagePath)
  const latencyMs = Date.now() - startTime

  // model_used/provider now record the real provider that actually
  // produced the image — previously hardcoded to "imagen-4.0-generate-001"
  // regardless of the fact this route only ever called Pollinations, same
  // fix already applied to post-image/generate/route.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: savedImage } = await (supabase.from("generated_images") as any).insert({
    brand_id: brandId,
    product_id: productId ?? null,
    prompt: result.fullPrompt,
    style: style ?? null,
    aspect_ratio: aspectRatio,
    storage_path: storagePath,
    public_url: publicUrlData.publicUrl,
    model_used: result.provider,
    provider: result.provider,
    is_saved: true,
  }).select().single()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from("ai_generation_logs") as any).insert({
    user_id: user.id, brand_id: brandId, feature: "images", model: result.provider,
    latency_ms: latencyMs, success: true,
  })

  return NextResponse.json({
    data: {
      id: savedImage?.id ?? null,
      prompt,
      full_prompt: result.fullPrompt,
      style: style ?? null,
      aspect_ratio: aspectRatio,
      public_url: publicUrlData.publicUrl,
      storage_path: storagePath,
    },
  }, { status: 200 })
}
