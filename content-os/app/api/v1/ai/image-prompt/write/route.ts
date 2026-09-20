import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { classifyGroqError } from "@/lib/ai/models"
import { requestImagePromptStream, type ImagePromptFlow, type ImagePromptConstraints } from "@/lib/ai/image-prompt-writer"
import { z } from "zod"
import type { BrandRow, ProductRow } from "@/types/database"

const flowEnum = z.enum(["post", "story", "carousel", "ad_maker", "image_tool"])

const constraintsSchema = z.object({
  aspectRatioLabel: z.string().max(50).optional(),
  styleLabel: z.string().max(100).optional(),
  hasProductReference: z.boolean().optional(),
  role: z.enum(["hook", "cta", "body"]).optional(),
  allowTextInImage: z.boolean().optional(),
})

const schema = z.object({
  flow: flowEnum,
  brandId: z.string().uuid(),
  // Looked up server-side (authoritative) when the caller has a real saved
  // product id -- Full Post and the standalone Image Generator both do.
  productId: z.string().uuid().optional(),
  // Carousel and Story's product picker (components/shared/ProductPicker's
  // PickedProduct) only ever carries a name/description/imageUrl
  // client-side, never a database id, so there's nothing for those two
  // flows to look up server-side by id -- this lets them pass the same
  // name/description straight through instead. Ignored when productId is
  // also present (the authoritative DB lookup wins).
  product: z.object({
    name: z.string().max(200),
    description: z.string().max(1000).nullable().optional(),
  }).optional(),
  // The user's own typed brief, shared by every flow that reaches this
  // route (Post's "What do you want to post", Story/Carousel/Ad Maker's
  // "Visual scene") -- was capped at 500, matching (and inherited from) the
  // old UI cap on Post's own textarea. Raised to 5000 so a genuinely long
  // brief reaches Groq in full instead of being rejected outright; the
  // model itself (openai/gpt-oss-120b, ~131k token context) has more than
  // enough headroom for 5000 chars (~1250 tokens) of input alongside the
  // system prompt and this call's own max_tokens budget.
  rawInput: z.string().max(5000, "Your brief is too long -- please keep it under 5000 characters.").nullable().optional().transform((v) => v?.replace(/<[^>]*>/g, "").trim() || null),
  // True for an explicit "Rewrite"/"Regenerate" request -- see
  // lib/ai/image-prompt-writer.ts's WriteImagePromptInput.isRewrite for why
  // this exists (told to Groq explicitly, since it has no memory of a
  // previous attempt to differ from on its own).
  isRewrite: z.boolean().optional(),
  constraints: constraintsSchema.default({}),
})

// This route deliberately never calls checkAndIncrementUsage/charges a
// credit -- it's a soft creative-writing pass in front of the real,
// billed image-generation routes (post-image/generate, images/generate,
// carousel & stories slide-image/generate, ad-maker/generate), which are
// what actually call Replicate/Flux and are what already charge. Whatever
// this route produces is only ever a draft the user can still edit before
// they hit the real Generate action downstream.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return Response.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  let body: unknown
  try { body = await request.json() } catch {
    return Response.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = schema.safeParse(body)
  // issues[0]?.message (a specific, human-written string like the one on
  // rawInput's own .max() above), not parsed.error.message -- the latter is
  // a raw JSON dump of every issue, which would otherwise surface verbatim
  // in the UI's error banner instead of a clear, friendly message. Matches
  // the convention already used elsewhere (e.g. carousel/generate/route.ts).
  if (!parsed.success) return Response.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.issues[0]?.message), { status: 400 })

  const { flow, brandId, productId, product: inlineProduct, rawInput, isRewrite, constraints } = parsed.data

  const { data: brand } = await supabase
    .from("brands")
    .select("name, niche, target_audience, tone_of_voice, vibe")
    .eq("id", brandId)
    .eq("user_id", user.id)
    .single<Pick<BrandRow, "name" | "niche" | "target_audience" | "tone_of_voice" | "vibe">>()
  if (!brand) return Response.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  let product: Pick<ProductRow, "name" | "description" | "key_benefits"> | null = null
  if (productId) {
    const { data: prod } = await supabase
      .from("products")
      .select("name, description, key_benefits")
      .eq("id", productId)
      .eq("brand_id", brandId)
      .single<Pick<ProductRow, "name" | "description" | "key_benefits">>()
    product = prod
  } else if (inlineProduct) {
    product = { name: inlineProduct.name, description: inlineProduct.description ?? null, key_benefits: [] }
  }

  let groqStream: Awaited<ReturnType<typeof requestImagePromptStream>>
  try {
    groqStream = await requestImagePromptStream({
      flow: flow as ImagePromptFlow,
      rawInput,
      isRewrite,
      brand,
      product,
      constraints: constraints as ImagePromptConstraints,
    })
  } catch (err) {
    console.error("[ai/image-prompt/write] Groq stream failed to start:", err)
    return Response.json(buildError(ErrorCodes.AI_GENERATION_FAILED, classifyGroqError(err)), { status: 500 })
  }

  const encoder = new TextEncoder()
  const body_ = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of groqStream) {
          const delta = chunk.choices[0]?.delta?.content
          if (delta) controller.enqueue(encoder.encode(delta))
        }
      } catch (err) {
        // Mid-stream failure -- whatever text already reached the client
        // stays as a usable draft; nothing here was ever charged, so
        // there's nothing to refund. Just stop, don't error the response
        // (the client would otherwise see a broken read on an already-200
        // response either way).
        console.error("[ai/image-prompt/write] stream failed mid-generation:", err)
      } finally {
        controller.close()
      }
    },
  })

  return new Response(body_, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  })
}
