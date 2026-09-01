import { NextResponse } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { generateImageFromUploadSchema } from "@/lib/validations/ai"
import { generateImage } from "@/lib/ai/image-generator"
import { buildError, ErrorCodes } from "@/types/api"
import { checkAndIncrementUsage, refundGenerationUsage, logGenerationOutcome } from "@/lib/usage/check-and-increment-usage"
import { IMAGE } from "@/lib/usage/credit-costs"
import { isInternalUnlimited } from "@/lib/usage/is-internal-unlimited"
import type { BrandRow } from "@/types/database"
import type { UserPlan } from "@/types/app"

const BUCKET = "brand-images"
const FEATURE = "images"

/**
 * Same Images-tab pipeline as app/api/v1/ai/images/generate/route.ts, but
 * for a freshly-uploaded reference photo rather than a saved Product row
 * (see lib/ai/image-generator.ts's productImageUrl option) -- e.g. "place
 * this exact photo into a new scene" without first saving it as a Product.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  const usageCheck = await checkAndIncrementUsage(user.id, IMAGE, FEATURE)
  if (!usageCheck.ok) {
    const code = usageCheck.status === 429 ? ErrorCodes.USAGE_LIMIT_EXCEEDED : ErrorCodes.INTERNAL_ERROR
    return NextResponse.json(buildError(code, usageCheck.message), { status: usageCheck.status })
  }
  const logId = usageCheck.logId

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = generateImageFromUploadSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })

  const { brandId, sceneDescription, productImageBase64 } = parsed.data

  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  // Determines the image provider (Free -> Pollinations, paid -> Flux) —
  // same lookup images/generate/route.ts already does.
  const { data: userData } = await supabase.from("users").select("plan").eq("id", user.id).single<{ plan: UserPlan }>()
  const plan: UserPlan = userData?.plan ?? "starter"

  // Upload via the admin client — storage RLS expects the path to start
  // with the user's auth uid, admin bypasses RLS safely here since brand
  // ownership is already verified above (same pattern as images/generate
  // and ad-maker/generate).
  const admin = await createAdminClient()

  // The client sends whichever form its data URL is already holding (e.g.
  // a data: URL from FileReader/remove-background, same as
  // ad-maker/generate/route.ts's productImageBase64) -- strip that prefix
  // when present so this doesn't try to decode "data:image/png;base64,"
  // itself as image bytes; falls back to treating the whole string as raw
  // base64 if there's no data: prefix to strip.
  const base64Payload = productImageBase64.match(/^data:[^;]+;base64,(.+)$/)?.[1] ?? productImageBase64

  let productImageBuffer: Buffer
  try {
    productImageBuffer = Buffer.from(base64Payload, "base64")
  } catch (err) {
    console.error("[ai/images/generate-from-upload] product image decode threw:", err)
    await refundGenerationUsage(supabase, user.id, IMAGE, logId)
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Couldn't read the uploaded image."), { status: 400 })
  }

  const productImagePath = `${user.id}/${brandId}/upload-reference-${Date.now()}-${crypto.randomUUID()}.png`
  const { error: productUploadError } = await admin.storage
    .from(BUCKET)
    .upload(productImagePath, productImageBuffer, { contentType: "image/png", upsert: false })

  if (productUploadError) {
    console.error("[ai/images/generate-from-upload] product image upload failed:", productUploadError)
    await refundGenerationUsage(supabase, user.id, IMAGE, logId)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Couldn't upload the reference photo. Please try again."), { status: 500 })
  }

  const productImageUrl = admin.storage.from(BUCKET).getPublicUrl(productImagePath).data.publicUrl

  const startTime = Date.now()
  // generateImage never throws (it wraps fetchBackgroundImage, which never
  // throws) — check .success instead of try/catch, same pattern as
  // images/generate/route.ts.
  const result = await generateImage(brand, {
    prompt: sceneDescription,
    aspectRatio: "1:1",
    productImageUrl,
    plan,
    isInternalUnlimitedUser: isInternalUnlimited(user.id),
  })

  if (!result.success) {
    // Full raw error (e.g. Pollinations API error text) stays server-side
    // only — never shown to the user.
    console.error("[ai/images/generate-from-upload] generation failed:", result.error)
    await logGenerationOutcome(supabase, logId, {
      user_id: user.id, brand_id: brandId, feature: FEATURE, model: "unknown",
      latency_ms: Date.now() - startTime, success: false,
      error_message: result.error,
    })
    await refundGenerationUsage(supabase, user.id, IMAGE, logId)
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "Image generation failed. Please try again."), { status: 500 })
  }

  // Upload to Supabase Storage using the admin client (storage RLS expects the
  // path to start with the user's auth uid — admin client bypasses RLS safely
  // here because we've already verified brand ownership above).
  const ext = result.mimeType.includes("jpeg") ? "jpg" : "png"
  const storagePath = `${user.id}/${brandId}/${Date.now()}-${crypto.randomUUID()}.${ext}`

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, result.buffer, { contentType: result.mimeType, upsert: false })

  if (uploadError) {
    // Image was generated but never actually delivered to the user — no
    // usable output, same as a generation failure.
    await refundGenerationUsage(supabase, user.id, IMAGE, logId)
    return NextResponse.json(
      buildError(ErrorCodes.INTERNAL_ERROR, "Image generated but upload to storage failed.", uploadError.message),
      { status: 500 }
    )
  }

  const { data: publicUrlData } = admin.storage.from(BUCKET).getPublicUrl(storagePath)
  const latencyMs = Date.now() - startTime

  // model_used/provider record the real provider that actually produced
  // the image, same fix already applied to images/generate/route.ts and
  // post-image/generate/route.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from("generated_images") as any).insert({
    brand_id: brandId,
    product_id: null,
    prompt: result.fullPrompt,
    style: null,
    aspect_ratio: "1:1",
    storage_path: storagePath,
    public_url: publicUrlData.publicUrl,
    model_used: result.provider,
    provider: result.provider,
    is_saved: true,
  }).select().single()

  await logGenerationOutcome(supabase, logId, {
    user_id: user.id, brand_id: brandId, feature: FEATURE, model: result.provider,
    latency_ms: latencyMs, success: true,
  })

  return NextResponse.json({
    data: {
      public_url: publicUrlData.publicUrl,
      provider: result.provider,
    },
  }, { status: 200 })
}
