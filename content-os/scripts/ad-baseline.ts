// Dev-only Ad Maker quality baseline: runs ONE Ad Maker generation through
// the same code path the app uses (AdMaker.tsx's scene prompt write ->
// brands/[brandId]/ai/ad-maker/generate route's 3 background variations)
// plus ONE ad_copy text generation (ai/content/generate's format), and saves
// every input, prompt, raw output, cost and image so a later change can be
// compared side by side. Ad counterpart of scripts/carousel-baseline.ts.
//
//   npx tsx scripts/ad-baseline.ts --brand <brandId> --product <productId> [--scene white_studio] [--format square] [--hook "<on-image text>"] [--label baseline]
//
// Output: scripts/output/ad-runs/<label>-<timestamp>/ (run.json,
// variation-N.png, ad.md) -- scripts/output/ is gitignored.
//
// Differences from the real app, on purpose: no credits charged, no
// DB/storage writes. The product reference is the product's own
// image_urls[0] passed straight to the image model -- the app first runs
// the photo through Remove Background (remove.bg, a paid external quota)
// and re-uploads the cutout to storage, neither of which this harness does.
// The 3 variations run one at a time (the app runs them concurrently, 400ms
// apart) so each recorded request maps to one variation. Images are the raw
// backgrounds; AdMaker.tsx's client-side canvas text overlay isn't drawn.
//
// The exact strings sent to the text/image models are captured by wrapping
// globalThis.fetch (OpenAI/Groq hosts only) before any lib/ module loads.
//
// NOT reachable in production -- standalone script; the NODE_ENV guard is
// defense-in-depth, same as scripts/test-creative-stages.ts.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
import type { BrandRow, ProductRow } from "@/types/database"
import type { UserPlan } from "@/types/app"

function loadEnvLocal(): void {
  const envPath = join(process.cwd(), ".env.local")
  if (!existsSync(envPath)) return
  const contents = readFileSync(envPath, "utf-8")
  for (const line of contents.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let value = trimmed.slice(eqIdx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (!(key in process.env)) process.env[key] = value
  }
}
loadEnvLocal()

if (process.env.NODE_ENV === "production") {
  console.error("[ad-baseline] refusing to run with NODE_ENV=production -- this is a dev-only harness.")
  process.exit(1)
}

// ─── Args ───────────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 ? process.argv[i + 1] : undefined
}

// Copied from AdMaker.tsx's SCENES (id -> display name; the name is what
// writeAdPrompt() sends as the prompt writer's styleLabel).
const SCENE_NAMES: Record<string, string> = {
  white_studio: "White Studio",
  dark_studio: "Dark Studio",
  marble_surface: "Marble Surface",
  wooden_table: "Wooden Table",
  nature_green: "Nature & Green",
  beach_summer: "Beach & Summer",
  cozy_cafe: "Cozy Cafe",
  diwali_glow: "Diwali Glow",
  christmas: "Christmas",
  party_fun: "Party & Fun",
}
const FORMATS = ["square", "portrait", "story"] as const
type AdFormat = (typeof FORMATS)[number]

const brandId = arg("brand")
const productId = arg("product")
const scene = arg("scene") ?? "white_studio"
const format = (arg("format") ?? "square") as AdFormat
const hookText = arg("hook")?.trim() ?? ""
const label = (arg("label") ?? "baseline").replace(/[^\w.-]+/g, "_")

if (!brandId || !productId) {
  console.error('Usage: npx tsx scripts/ad-baseline.ts --brand <brandId> --product <productId> [--scene white_studio] [--format square] [--hook "<text>"] [--label baseline]')
  process.exit(1)
}
if (!(scene in SCENE_NAMES)) {
  console.error(`--scene must be one of: ${Object.keys(SCENE_NAMES).join(", ")}`)
  process.exit(1)
}
if (!(FORMATS as readonly string[]).includes(format)) {
  console.error(`--format must be one of: ${FORMATS.join(", ")}`)
  process.exit(1)
}

// The ad-maker route's own constant.
const VARIATION_COUNT = 3

// ─── Model request capture ──────────────────────────────────────────────────

type CapturedCall = {
  stage: string
  url: string
  model: string | null
  status: number | null
  latencyMs: number
  /** Chat: the messages array. Image: { prompt, size, quality, n }. */
  request: unknown
  /** Non-streaming chat calls only: the model's raw message content. */
  responseContent?: string | null
  error?: string
}

const AI_HOSTS = ["api.openai.com", "api.groq.com"]
const captured: CapturedCall[] = []
let currentStage = "setup"

function summarizeRequest(body: unknown): { model: string | null; request: unknown; stream: boolean } {
  if (typeof body === "string") {
    try {
      const json = JSON.parse(body) as Record<string, unknown>
      const request = json.messages ?? { prompt: json.prompt, size: json.size, quality: json.quality, n: json.n }
      return { model: (json.model as string) ?? null, request, stream: json.stream === true }
    } catch {
      return { model: null, request: body.slice(0, 2000), stream: false }
    }
  }
  if (body instanceof FormData) {
    // images.edit (product reference photo) -- multipart, file parts omitted.
    const fields: Record<string, unknown> = {}
    for (const [k, v] of body.entries()) if (typeof v === "string") fields[k] = v
    return { model: (fields.model as string) ?? null, request: fields, stream: false }
  }
  return { model: null, request: null, stream: false }
}

const realFetch = globalThis.fetch
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  if (!AI_HOSTS.some((h) => url.includes(h))) return realFetch(input, init)
  const { model, request, stream } = summarizeRequest(init?.body)
  const entry: CapturedCall = { stage: currentStage, url: url.replace(/\?.*$/, ""), model, status: null, latencyMs: 0, request }
  captured.push(entry)
  const started = Date.now()
  try {
    const res = await realFetch(input, init)
    entry.status = res.status
    entry.latencyMs = Date.now() - started
    if (!stream && url.includes("/chat/completions")) {
      res.clone().text().then((text) => {
        try {
          entry.responseContent = (JSON.parse(text) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? null
        } catch {
          entry.responseContent = text.slice(0, 4000)
        }
      }).catch(() => {})
    }
    return res
  } catch (err) {
    entry.latencyMs = Date.now() - started
    entry.error = err instanceof Error ? err.message : String(err)
    throw err
  }
}

// ─── Run ────────────────────────────────────────────────────────────────────

type VariationRecord = {
  index: number
  /** This variation's strategy variant (angle/hypothesis/copy/visual), null without a strategy. */
  variant: unknown
  imageFile: string | null
  latencyMs: number
  costUsd: number | null
  provider: string | null
  productReferenceUsed: boolean
  /** The prompt string actually sent to the image provider on the first attempt. */
  finalImagePrompt: string | null
  attempts: unknown[]
  imageRequests: CapturedCall[]
  error?: string
}

async function main(): Promise<void> {
  const { requestImagePromptStream } = await import("@/lib/ai/image-prompt-writer")
  const { generateAdMakerBackground } = await import("@/lib/ai/ad-maker-background")
  const { generateAdStrategy } = await import("@/lib/ai/ad-strategy")
  const { generateContent } = await import("@/lib/ai/content-generator")
  const { attemptsCostUsd } = await import("@/lib/ai/post-image-pipeline")
  const { IMAGE_PROVIDER_CONFIG } = await import("@/lib/ai/image-provider")
  const { MODELS } = await import("@/lib/ai/models")
  const { sumCostUsd } = await import("@/lib/ai/pricing")
  const { fetchPastExamples } = await import("@/lib/ai/past-examples")
  const { isInternalUnlimited } = await import("@/lib/usage/is-internal-unlimited")

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.")
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

  const errors: string[] = []
  const runStartedAt = new Date()
  const outDir = join(process.cwd(), "scripts", "output", "ad-runs", `${label}-${runStartedAt.toISOString().replace(/[:.]/g, "-")}`)
  mkdirSync(outDir, { recursive: true })

  const { data: brand, error: brandError } = await supabase.from("brands").select("*").eq("id", brandId!).single<BrandRow>()
  if (!brand) throw new Error(`Brand ${brandId} not found${brandError ? `: ${brandError.message}` : ""}`)
  const { data: product } = await supabase.from("products").select("*").eq("id", productId!).eq("brand_id", brand.id).single<ProductRow>()
  if (!product) throw new Error(`Product ${productId} not found for brand ${brand.id}`)
  const productImageUrl = product.image_urls?.[0]
  if (!productImageUrl) throw new Error(`Product ${product.name} has no photo (image_urls is empty) -- Ad Maker needs one.`)
  const { data: owner } = await supabase.from("users").select("plan").eq("id", brand.user_id).single<{ plan: UserPlan }>()
  const plan: UserPlan = owner?.plan ?? "starter"
  const isUnlimited = isInternalUnlimited(brand.user_id)
  console.log(`Brand: ${brand.name} · product ${product.name} · owner plan ${plan}${isUnlimited ? " (internal unlimited)" : ""}`)

  // 1. Scene prompt, as AdMaker.tsx's writeAdPrompt() sends it for a preset
  // scene: rawInput null, no product, styleLabel = scene name.
  currentStage = "image_prompt_write"
  console.log("Writing the scene prompt…")
  let started = Date.now()
  let adPrompt = ""
  try {
    const stream = await requestImagePromptStream({
      flow: "ad_maker",
      rawInput: null,
      isRewrite: false,
      brand: { name: brand.name, niche: brand.niche, target_audience: brand.target_audience, tone_of_voice: brand.tone_of_voice, vibe: brand.vibe },
      product: null,
      constraints: { styleLabel: SCENE_NAMES[scene], aspectRatioLabel: format, hasProductReference: true },
    })
    for await (const chunk of stream) adPrompt += chunk.choices[0]?.delta?.content ?? ""
  } catch (err) {
    errors.push(`image_prompt_write: ${err instanceof Error ? err.message : String(err)}`)
  }
  const promptLatencyMs = Date.now() - started
  // generateAdMakerBackgroundSchema's customPrompt transform: strip tags, trim, max 1500.
  let customPrompt: string | undefined = adPrompt.replace(/<[^>]*>/g, "").trim() || undefined
  if (customPrompt && customPrompt.length > 1500) {
    errors.push(`scene prompt is ${customPrompt.length} chars -- the ad-maker route would reject it (max 1500) with a 400.`)
    customPrompt = undefined
  }

  // 2. Strategy step, as the ad-maker route runs it (user direction = the
  // typed headline; no custom scene here). Fails soft like the route.
  currentStage = "ad_strategy"
  console.log("Deciding the ad strategy…")
  started = Date.now()
  let strategy: Awaited<ReturnType<typeof generateAdStrategy>> | null = null
  try {
    strategy = await generateAdStrategy({ brand, product, userDirection: hookText || undefined, format, timeoutMs: 45_000 })
  } catch (err) {
    errors.push(`ad_strategy (fell back to brief-less variations): ${err instanceof Error ? err.message : String(err)}`)
  }
  const strategyLatencyMs = Date.now() - started

  // 3. The 3 background variations, built exactly as the route builds them.
  const backgroundOptions = {
    scene,
    customScene: undefined,
    brandNiche: brand.niche,
    format,
    plan,
    isInternalUnlimitedUser: isUnlimited,
    productImageUrl,
    customPrompt,
  }
  const variations: VariationRecord[] = []
  for (let i = 0; i < VARIATION_COUNT; i++) {
    currentStage = `variation_${i + 1}`
    console.log(`Variation ${i + 1}/${VARIATION_COUNT}…`)
    const firstCall = captured.length
    started = Date.now()
    const result = await generateAdMakerBackground({ ...backgroundOptions, visualBrief: strategy?.variants[i]?.visual })
    const imageRequests = captured.slice(firstCall)
    const first = imageRequests[0]?.request as { prompt?: unknown } | undefined
    const record: VariationRecord = {
      index: i + 1,
      variant: strategy?.variants[i] ?? null,
      imageFile: null,
      latencyMs: Date.now() - started,
      costUsd: attemptsCostUsd(result.attempts),
      provider: result.success ? result.provider : null,
      productReferenceUsed: true,
      finalImagePrompt: typeof first?.prompt === "string" ? first.prompt : null,
      attempts: result.attempts,
      imageRequests,
    }
    if (result.success) {
      record.imageFile = `variation-${i + 1}.${result.mimeType.includes("jpeg") ? "jpg" : "png"}`
      writeFileSync(join(outDir, record.imageFile), result.buffer)
    } else {
      record.error = result.error
      errors.push(`variation ${i + 1}: ${result.error}`)
    }
    variations.push(record)
  }

  // 3. ad_copy text format, as ai/content/generate calls it (no hook, no
  // extra context typed).
  currentStage = "ad_copy"
  console.log("Generating ad copy…")
  started = Date.now()
  let adCopy: unknown = null
  let adCopyCost: number | null = null
  let adCopyUsage: unknown = null
  try {
    const pastExamples = await fetchPastExamples(supabase, brand.id, "ad_copy")
    const res = await generateContent(brand, "ad_copy", { product, platform: undefined, hookText: undefined, additionalContext: undefined, pastExamples })
    adCopy = res.data
    adCopyCost = res.costUsd
    adCopyUsage = res.usage ?? null
  } catch (err) {
    errors.push(`ad_copy: ${err instanceof Error ? err.message : String(err)}`)
  }
  const adCopyLatencyMs = Date.now() - started

  // 4. Outputs.
  const imageCost = sumCostUsd(...variations.map((v) => v.costUsd))
  const totalLatencyMs = promptLatencyMs + strategyLatencyMs + variations.reduce((a, v) => a + v.latencyMs, 0) + adCopyLatencyMs
  const run = {
    inputs: { brandId, brandName: brand.name, productId, productName: product.name, productImageUrl, scene, format, hookText: hookText || null, label },
    startedAt: runStartedAt.toISOString(),
    plan,
    isInternalUnlimitedUser: isUnlimited,
    models: { scenePromptWriter: MODELS.creative, image: IMAGE_PROVIDER_CONFIG.model, adCopy: MODELS.creative },
    scenePrompt: adPrompt,
    adBrief: strategy?.brief ?? null,
    variants: strategy?.variants ?? null,
    variations,
    adCopy,
    calls: captured,
    cost: {
      scenePrompt: { costUsd: null, latencyMs: promptLatencyMs, note: "streamed without usage reporting -- not priced" },
      strategy: { model: strategy?.model ?? null, usage: strategy?.usage ?? null, costUsd: strategy?.costUsd ?? null, latencyMs: strategyLatencyMs },
      images: { costUsd: imageCost },
      adCopy: { usage: adCopyUsage, costUsd: adCopyCost, latencyMs: adCopyLatencyMs },
      totalUsd: sumCostUsd(strategy?.costUsd, imageCost, adCopyCost),
      totalLatencyMs,
    },
    errors,
  }
  writeFileSync(join(outDir, "run.json"), JSON.stringify(run, null, 2))

  const cell = (t: string) => t.replace(/\|/g, "\\|").replace(/\n/g, " ")
  const copy = adCopy as { headline?: string; primary_text?: string; description?: string; cta_button?: string } | null
  const md = [
    `# ${label}: ${product.name}`,
    "",
    `Brand **${brand.name}** · scene ${scene} · format ${format} · ${runStartedAt.toISOString()}`,
    `Total cost: $${run.cost.totalUsd ?? "unknown"} (images $${imageCost ?? "?"}, ad copy $${adCopyCost ?? "?"}; scene prompt not priced) · ${(totalLatencyMs / 1000).toFixed(1)} s`,
    "",
    `**Scene prompt (shared by all ${VARIATION_COUNT} variations):** ${cell(adPrompt || "(none)")}`,
    "",
    `**On-image text:** ${hookText || "(none typed)"}`,
    "",
    ...(strategy ? [
      "## Ad brief",
      `- **Audience:** ${strategy.brief.audience}`,
      `- **Desired action:** ${strategy.brief.desired_action} (${strategy.brief.funnel_stage})`,
      `- **Value proposition:** ${strategy.brief.value_proposition}`,
      `- **Offer:** ${strategy.brief.offer ?? "none"} · **Proof:** ${strategy.brief.proof ?? "none"}`,
      "",
    ] : []),
    "| # | Angle | Hypothesis | Headline | Primary text | CTA | Visual brief | Image |",
    "|---|-------|------------|----------|--------------|-----|--------------|-------|",
    ...variations.map((v) => {
      const vv = v.variant as { angle?: string; hypothesis?: string; headline?: string; primary_text?: string; cta_button?: string; visual?: { kind?: string; must_show?: string } } | null
      return `| ${v.index} | ${vv?.angle ?? "—"} | ${cell(vv?.hypothesis ?? "—")} | ${cell(vv?.headline ?? "—")} | ${cell(vv?.primary_text ?? "—")} | ${vv?.cta_button ?? "—"} | ${vv?.visual ? cell(`${vv.visual.kind}: ${vv.visual.must_show}`) : "—"} | ${v.imageFile ? `![](${v.imageFile})` : `failed: ${cell(v.error ?? "")}`} |`
    }),
    "",
    "## Ad copy (ad_copy format)",
    `- **Headline:** ${copy?.headline ?? "—"}`,
    `- **Primary text:** ${copy?.primary_text ?? "—"}`,
    `- **Description:** ${copy?.description ?? "—"}`,
    `- **CTA:** ${copy?.cta_button ?? "—"}`,
    `- **Angle:** ${(copy as { angle?: string } | null)?.angle ?? "—"}`,
    `- **Ad brief:** ${JSON.stringify((copy as { ad_brief?: unknown } | null)?.ad_brief ?? null)}`,
    ...(errors.length ? ["", "## Errors", ...errors.map((e) => `- ${e}`)] : []),
    "",
  ].join("\n")
  writeFileSync(join(outDir, "ad.md"), md)

  console.log(`\nDone. Total $${run.cost.totalUsd ?? "unknown"} · ${errors.length} error(s)\n${outDir}`)
}

main().catch((err) => {
  console.error("[ad-baseline] failed:", err)
  process.exit(1)
})
