import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { checkAndIncrementUsage } from "@/lib/usage/check-and-increment-usage"
import { generateBlogPost } from "@/lib/ai/blog-generator"
import { z } from "zod"
import type { BrandRow, ProductRow } from "@/types/database"

const schema = z.object({
  brandId: z.string().uuid(),
  productId: z.string().uuid().optional(),
  // The user's own topic/prompt — required. This feature never auto-generates
  // a blog post from nothing.
  prompt: z.string().min(3).max(1500),
})

export async function POST(request: Request) {
  console.log("[ai/blog/generate] POST called")

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[ai/blog/generate] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

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

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.issues[0]?.message), { status: 400 })
  }

  const { brandId, productId, prompt } = parsed.data

  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  let product: ProductRow | null = null
  if (productId) {
    const { data: prod } = await supabase.from("products").select("*").eq("id", productId).eq("brand_id", brandId).single<ProductRow>()
    product = prod
  }

  // Feed the brand's own past highly-rated blog posts back into the prompt
  // as few-shot examples — same pattern already used for captions,
  // carousels, stories, ad copy, and reel scripts. Skip entirely if none
  // exist yet rather than fabricating a style pattern for a new brand.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pastRatedPosts } = await (supabase.from("blog_posts") as any)
    .select("title, body")
    .eq("brand_id", brandId)
    .gte("user_rating", 4)
    .order("user_rating", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(3) as { data: { title: string; body: string }[] | null }

  const pastExamples = (pastRatedPosts ?? []).map((p) => `${p.title}\n${p.body}`)

  const startTime = Date.now()
  let result: Awaited<ReturnType<typeof generateBlogPost>>

  try {
    result = await generateBlogPost(brand, { userPrompt: prompt, product, pastExamples })
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("ai_generation_logs") as any).insert({
      user_id: user.id, brand_id: brandId, feature: "blog_post", model: "meta/llama-3.1-70b-instruct",
      latency_ms: Date.now() - startTime, success: false,
      error_message: err instanceof Error ? err.message : "Unknown error",
    })
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "AI generation failed. Please try again."), { status: 500 })
  }

  const latencyMs = Date.now() - startTime

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: savedPost } = await (supabase.from("blog_posts") as any).insert({
    brand_id: brandId,
    user_prompt: prompt,
    title: result.post.title,
    body: result.post.body,
    meta_description: result.post.meta_description ?? null,
    suggested_tags: result.post.suggested_tags ?? [],
    is_saved: true,
  }).select().single()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from("ai_generation_logs") as any).insert({
    user_id: user.id, brand_id: brandId, feature: "blog_post", model: result.model,
    prompt_tokens: result.usage?.prompt_tokens ?? null,
    completion_tokens: result.usage?.completion_tokens ?? null,
    total_tokens: result.usage?.total_tokens ?? null,
    latency_ms: latencyMs, success: true,
  })

  return NextResponse.json({ data: { ...result.post, id: savedPost?.id ?? null } }, { status: 200 })
}
