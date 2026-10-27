// Dev-only carousel quality baseline: runs ONE carousel through the same
// code path the app uses (carousel/generate route -> CarouselBuilder's
// image-prompt write -> slide-image route per slide) and saves every input,
// prompt, raw output, cost and background image, so a later prompt/model
// change can be compared against this run side by side.
//
//   npx tsx scripts/carousel-baseline.ts --brand <brandId> --topic "<topic>" [--slides 7] [--vibe <vibe>] [--label baseline]
//
// Output: scripts/output/carousel-runs/<label>-<timestamp>/ (run.json,
// slide-NN.png, slides.md) -- scripts/output/ is gitignored.
//
// Mirrors, does not reimplement: the carousel prompt, image-prompt writer
// and slide-background prompt all come from lib/ unchanged. Route-only
// post-processing (CTA merge, vibe background override, font stamp, text
// sanitize) is copied below with its source named. Differences from the
// real app, on purpose: no credits are charged and nothing is written to
// the DB or storage; every slide gets a background (the app only does
// hook/cta unless "AI background for every slide" is on); slides run one
// at a time (the app runs 3 concurrently) so each recorded request maps to
// one slide.
//
// The exact strings sent to the text/image models are captured by wrapping
// globalThis.fetch (OpenAI/Groq hosts only) before any lib/ module loads --
// the prompt builders themselves are private to lib/.
//
// NOT reachable in production -- standalone script; the NODE_ENV guard is
// defense-in-depth, same as scripts/test-creative-stages.ts.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
import type { BrandRow } from "@/types/database"
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
  console.error("[carousel-baseline] refusing to run with NODE_ENV=production -- this is a dev-only harness.")
  process.exit(1)
}

// ─── Args ───────────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 ? process.argv[i + 1] : undefined
}

// Same enums/bounds as app/api/v1/ai/carousel/generate/route.ts's schema
// (slideCount 5-10, default 7) and slide-image/generate/route.ts's
// CAROUSEL_VIBES. "custom_color" is excluded: the builder skips AI images
// entirely in that mode.
const CAROUSEL_VIBES = ["fun_playful", "clean_minimal", "bold_dramatic", "warm_cozy", "professional", "trendy_genz"] as const
type CarouselVibeArg = (typeof CAROUSEL_VIBES)[number]

const brandId = arg("brand")
const topic = arg("topic")?.trim()
const slideCount = Number(arg("slides") ?? 7)
const vibeArg = arg("vibe")
const label = (arg("label") ?? "baseline").replace(/[^\w.-]+/g, "_")

if (!brandId || !topic) {
  console.error('Usage: npx tsx scripts/carousel-baseline.ts --brand <brandId> --topic "<topic>" [--slides 7] [--vibe <vibe>] [--label baseline]')
  process.exit(1)
}
if (!Number.isInteger(slideCount) || slideCount < 5 || slideCount > 10) {
  console.error("--slides must be an integer from 5 to 10 (same bounds as the carousel route).")
  process.exit(1)
}
if (vibeArg && !(CAROUSEL_VIBES as readonly string[]).includes(vibeArg)) {
  console.error(`--vibe must be one of: ${CAROUSEL_VIBES.join(", ")}`)
  process.exit(1)
}
// CarouselBuilder's vibe state starts undefined (useState<Vibe | undefined>()),
// so no --vibe = what a user who never touched the vibe picker sends.
const vibe = vibeArg as CarouselVibeArg | undefined

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

// ─── Copied route logic (app/api/v1/ai/carousel/generate/route.ts) ─────────

// Copied from VIBE_TO_CAROUSEL_BACKGROUND (carousel/generate/route.ts ~line 37).
const VIBE_TO_CAROUSEL_BACKGROUND: Record<string, string> = {
  fun_playful: "vibe_fun_playful",
  clean_minimal: "white_violet",
  bold_dramatic: "gradient_dark",
  warm_cozy: "vibe_warm_cozy",
  professional: "vibe_professional",
  trendy_genz: "vibe_trendy_genz",
}

// Copied from mergeCtaSlideIntoSlides (carousel/generate/route.ts ~line 70).
function mergeCtaSlideIntoSlides(slides: unknown[], ctaSlide: unknown, realHandle?: string): unknown[] {
  if (!ctaSlide || typeof ctaSlide !== "object") return slides
  const cta = ctaSlide as { headline?: unknown; cta?: unknown; handle?: unknown; role?: unknown }
  const handle = realHandle ?? (typeof cta.handle === "string" ? cta.handle : undefined)
  const existingIndex = slides.findIndex((s) => s && typeof s === "object" && (s as { type?: unknown }).type === "cta")
  if (existingIndex !== -1) {
    const existing = slides[existingIndex] as Record<string, unknown>
    if (typeof existing.cta === "string" && typeof existing.handle === "string" && realHandle === undefined) return slides
    const merged = [...slides]
    merged[existingIndex] = {
      ...existing,
      cta: typeof existing.cta === "string" ? existing.cta : (typeof cta.cta === "string" ? cta.cta : undefined),
      handle: handle ?? (typeof existing.handle === "string" ? existing.handle : undefined),
      role: typeof existing.role === "string" ? existing.role : (typeof cta.role === "string" ? cta.role : "cta"),
    }
    return merged
  }
  return [
    ...slides,
    {
      slide_number: slides.length + 1,
      type: "cta",
      role: typeof cta.role === "string" ? cta.role : "cta",
      background_style: "gradient_dark",
      headline: typeof cta.headline === "string" ? cta.headline : "",
      cta: typeof cta.cta === "string" ? cta.cta : undefined,
      handle,
    },
  ]
}

// Copied from CarouselBuilder.tsx's carouselBgRole (~line 232).
function carouselBgRole(index: number, count: number): "hook" | "cta" | "body" {
  if (index === 0) return "hook"
  if (count > 1 && index === count - 1) return "cta"
  return "body"
}

// narrative_plan as markdown for slides.md -- [] when the model didn't return one.
function narrativePlanLines(plan: unknown): string[] {
  if (!plan || typeof plan !== "object") return ["**Narrative plan:** (none returned)", ""]
  const p = plan as { audience_question?: unknown; takeaway?: unknown; arc?: unknown }
  const arc = Array.isArray(p.arc) ? (p.arc as { slide_number?: unknown; role?: unknown; new_information?: unknown }[]) : []
  return [
    "## Narrative plan",
    `- **Audience question:** ${String(p.audience_question ?? "")}`,
    `- **Takeaway:** ${String(p.takeaway ?? "")}`,
    ...arc.map((a) => `  ${String(a.slide_number ?? "?")}. *${String(a.role ?? "")}* — ${String(a.new_information ?? "")}`),
    "",
  ]
}

// ─── Run ────────────────────────────────────────────────────────────────────

type SlideRecord = {
  index: number
  /** Background role (carouselBgRole) -- what the image prompt was told. */
  role: "hook" | "cta" | "body"
  /** The slide's narrative role from the model's narrative_plan arc. */
  narrativeRole: string | null
  headline: string
  points: string[]
  imageFile: string | null
  latencyMs: number
  costUsd: number | null
  provider: string | null
  attempts: unknown[]
  imageRequests: CapturedCall[]
  note?: string
  error?: string
}

async function main(): Promise<void> {
  const { generateCarouselWithRetry } = await import("@/lib/ai/carousel-generator")
  const { requestImagePromptStream } = await import("@/lib/ai/image-prompt-writer")
  const { generateCarouselSlideBackground } = await import("@/lib/ai/carousel-slide-background")
  const { attemptsCostUsd } = await import("@/lib/ai/post-image-pipeline")
  const { IMAGE_PROVIDER_CONFIG } = await import("@/lib/ai/image-provider")
  const { MODELS } = await import("@/lib/ai/models")
  const { sumCostUsd } = await import("@/lib/ai/pricing")
  const { resolveSuggestedFont } = await import("@/lib/design/fonts")
  const { findContentQualityIssues, sanitizeLeakedArtifacts } = await import("@/lib/ai/content-quality-check")
  const { isInternalUnlimited } = await import("@/lib/usage/is-internal-unlimited")
  const { PLAN_LIMITS } = await import("@/types/app")

  // Copied from sanitizeCarouselText/sanitizeCarouselSlides (carousel/generate/route.ts ~line 125).
  const sanitizeText = (value: string | undefined): string | undefined => {
    if (typeof value !== "string" || !value) return value
    return findContentQualityIssues(value).length === 0 ? value : sanitizeLeakedArtifacts(value)
  }
  const sanitizeSlides = (slides: unknown[]): unknown[] => slides.map((slide) => {
    if (!slide || typeof slide !== "object") return slide
    const s = slide as Record<string, unknown>
    return {
      ...s,
      headline: typeof s.headline === "string" ? sanitizeText(s.headline) : s.headline,
      subtext: typeof s.subtext === "string" ? sanitizeText(s.subtext) : s.subtext,
      points: Array.isArray(s.points) ? s.points.map((p) => (typeof p === "string" ? sanitizeText(p) : p)) : s.points,
      cta: typeof s.cta === "string" ? sanitizeText(s.cta) : s.cta,
    }
  })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.")
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

  const errors: string[] = []
  const runStartedAt = new Date()
  const outDir = join(process.cwd(), "scripts", "output", "carousel-runs", `${label}-${runStartedAt.toISOString().replace(/[:.]/g, "-")}`)
  mkdirSync(outDir, { recursive: true })

  const { data: brand, error: brandError } = await supabase.from("brands").select("*").eq("id", brandId!).single<BrandRow>()
  if (!brand) throw new Error(`Brand ${brandId} not found${brandError ? `: ${brandError.message}` : ""}`)
  const { data: owner } = await supabase.from("users").select("plan").eq("id", brand.user_id).single<{ plan: UserPlan }>()
  const plan: UserPlan = owner?.plan ?? "starter"
  const isUnlimited = isInternalUnlimited(brand.user_id)
  console.log(`Brand: ${brand.name} (${brand.niche ?? "no niche"}) · owner plan ${plan}${isUnlimited ? " (internal unlimited)" : ""}`)

  // Copied from the pastExamples block in carousel/generate/route.ts (~line 190).
  const pastExamples: string[] = []
  {
    const { data: pastCarousels, error } = await supabase
      .from("carousels")
      .select("slides")
      .eq("brand_id", brand.id)
      .gte("user_rating", 4)
      .order("user_rating", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(5) as { data: { slides: unknown }[] | null; error: { message: string } | null }
    if (error) errors.push(`pastExamples: ${error.message}`)
    for (const c of pastCarousels ?? []) {
      if (!Array.isArray(c.slides)) continue
      const headlines = c.slides
        .map((s) => (s && typeof s === "object" && "headline" in s ? String((s as { headline: unknown }).headline) : null))
        .filter((h): h is string => !!h)
      if (headlines.length > 0) pastExamples.push(headlines.join(" / "))
    }
  }

  // 1. Carousel copy -- exactly the route's call.
  currentStage = "carousel_copy"
  console.log(`Generating ${slideCount}-slide carousel copy…`)
  const copyStarted = Date.now()
  const gen = await generateCarouselWithRetry(brand, topic!, slideCount, "instagram", vibe, pastExamples)
  const copyLatencyMs = Date.now() - copyStarted
  const d = gen.data as Record<string, unknown>
  if (!Array.isArray(d.slides) || d.slides.length === 0) throw new Error("AI returned no carousel slides")

  // 2. Route post-processing, in the route's order.
  const realHandle = brand.instagram_handle ? `@${brand.instagram_handle}` : undefined
  let slides = mergeCtaSlideIntoSlides(d.slides, d.cta_slide, realHandle)
  const effectiveVibe = vibe || (d.suggested_vibe as string | undefined)
  const vibeBackground = effectiveVibe ? VIBE_TO_CAROUSEL_BACKGROUND[effectiveVibe] : undefined
  if (vibeBackground) slides = slides.map((s) => (s && typeof s === "object" ? { ...s, background_style: vibeBackground } : s))
  const fontId = resolveSuggestedFont(d.suggested_font_id, brand.vibe, effectiveVibe)
  slides = slides.map((s) => (s && typeof s === "object" ? { ...s, font_id: fontId } : s))
  slides = sanitizeSlides(slides)

  // 3. One visual prompt for the whole carousel, as CarouselBuilder's
  // writeVisualPrompt() sends it to /api/v1/ai/image-prompt/write on a first
  // write with an empty field: rawInput null, no product, and constraints
  // { styleLabel: vibe, hasProductReference: false }. The route loads these
  // five brand fields and streams the text back; usePromptWriter keeps it
  // as-is.
  currentStage = "image_prompt_write"
  console.log("Writing the visual prompt…")
  const promptStarted = Date.now()
  let visualPrompt = ""
  try {
    const stream = await requestImagePromptStream({
      flow: "carousel",
      rawInput: null,
      isRewrite: false,
      brand: { name: brand.name, niche: brand.niche, target_audience: brand.target_audience, tone_of_voice: brand.tone_of_voice, vibe: brand.vibe },
      product: null,
      constraints: { styleLabel: vibe, hasProductReference: false },
    })
    for await (const chunk of stream) visualPrompt += chunk.choices[0]?.delta?.content ?? ""
  } catch (err) {
    errors.push(`image_prompt_write: ${err instanceof Error ? err.message : String(err)}`)
  }
  const promptLatencyMs = Date.now() - promptStarted
  // slide-image/generate/route.ts's customPrompt transform: strip tags, trim, max 1500.
  let customPrompt: string | undefined = visualPrompt.replace(/<[^>]*>/g, "").trim() || undefined
  if (customPrompt && customPrompt.length > 1500) {
    errors.push(`visualPrompt is ${customPrompt.length} chars -- the slide-image route would reject it (max 1500) with a 400.`)
    customPrompt = undefined
  }

  // 4. A background for every slide (see header), as the slide-image route calls it.
  const slideRecords: SlideRecord[] = []
  for (let i = 0; i < slides.length; i++) {
    const s = (slides[i] ?? {}) as Record<string, unknown>
    const role = carouselBgRole(i, slides.length)
    currentStage = `slide_${i + 1}`
    const firstCall = captured.length
    console.log(`Slide ${i + 1}/${slides.length} (${role})…`)
    const started = Date.now()
    const result = await generateCarouselSlideBackground({
      vibe,
      brand,
      plan,
      isInternalUnlimitedUser: isUnlimited,
      role,
      productImageUrl: undefined,
      slideType: undefined,
      customPrompt,
      quality: "low",
    })
    const record: SlideRecord = {
      index: i + 1,
      role,
      narrativeRole: typeof s.role === "string" ? s.role : null,
      headline: typeof s.headline === "string" ? s.headline : "",
      points: Array.isArray(s.points) ? s.points.filter((p): p is string => typeof p === "string") : [],
      imageFile: null,
      latencyMs: Date.now() - started,
      costUsd: attemptsCostUsd(result.attempts),
      provider: result.success ? result.provider : null,
      attempts: result.attempts,
      imageRequests: captured.slice(firstCall),
    }
    if (role === "cta" && !PLAN_LIMITS[plan].carouselCtaAiBackground && !isUnlimited) {
      record.note = `The real app would refuse this slide (plan "${plan}" has no carouselCtaAiBackground).`
    }
    if (result.success) {
      const ext = result.mimeType.includes("jpeg") ? "jpg" : "png"
      record.imageFile = `slide-${String(i + 1).padStart(2, "0")}.${ext}`
      writeFileSync(join(outDir, record.imageFile), result.buffer)
    } else {
      record.error = result.error
      errors.push(`slide ${i + 1}: ${result.error}`)
    }
    slideRecords.push(record)
  }

  // 5. Outputs.
  const copyCalls = captured.filter((c) => c.stage === "carousel_copy")
  const imageCost = sumCostUsd(...slideRecords.map((r) => r.costUsd))
  const run = {
    inputs: { brandId, brandName: brand.name, topic, slides: slideCount, vibe: vibe ?? null, platform: "instagram", label },
    startedAt: runStartedAt.toISOString(),
    plan,
    isInternalUnlimitedUser: isUnlimited,
    models: { carouselCopy: gen.model, imagePromptWriter: MODELS.creative, image: IMAGE_PROVIDER_CONFIG.model, imageQuality: "low" },
    pastExamples,
    carouselPrompt: copyCalls[0]?.request ?? null,
    carouselCalls: copyCalls,
    rawCarouselOutputs: copyCalls.map((c) => c.responseContent ?? null),
    narrativePlan: d.narrative_plan ?? null,
    carouselData: gen.data,
    finalSlides: slides,
    effectiveVibe: effectiveVibe ?? null,
    fontId,
    visualPrompt,
    imagePromptCall: captured.filter((c) => c.stage === "image_prompt_write"),
    slides: slideRecords,
    cost: {
      carouselCopy: { usage: gen.usage ?? null, costUsd: gen.costUsd, latencyMs: copyLatencyMs },
      imagePrompt: { usage: null, costUsd: null, latencyMs: promptLatencyMs, note: "streamed without usage reporting -- not priced" },
      images: { costUsd: imageCost },
      totalUsd: sumCostUsd(gen.costUsd, imageCost),
    },
    errors,
  }
  writeFileSync(join(outDir, "run.json"), JSON.stringify(run, null, 2))

  const cell = (t: string) => t.replace(/\|/g, "\\|").replace(/\n/g, " ")
  const md = [
    `# ${label}: ${topic}`,
    "",
    `Brand **${brand.name}** · ${slideCount} slides requested · vibe ${vibe ?? "(none -- model suggested " + (effectiveVibe ?? "none") + ")"} · ${runStartedAt.toISOString()}`,
    `Total cost: $${run.cost.totalUsd ?? "unknown"} (copy $${gen.costUsd ?? "?"}, images $${imageCost ?? "?"}; prompt writer not priced)`,
    "",
    `**Visual prompt:** ${cell(visualPrompt || "(none)")}`,
    "",
    ...narrativePlanLines(d.narrative_plan),
    "| # | Narrative role | Bg role | Headline | Points | Image |",
    "|---|----------------|---------|----------|--------|-------|",
    ...slideRecords.map((r) => `| ${r.index} | ${r.narrativeRole ?? "—"} | ${r.role} | ${cell(r.headline)} | ${cell(r.points.join(" · "))} | ${r.imageFile ? `![](${r.imageFile})` : `failed: ${cell(r.error ?? "")}`} |`),
    ...(errors.length ? ["", "## Errors", ...errors.map((e) => `- ${e}`)] : []),
    "",
  ].join("\n")
  writeFileSync(join(outDir, "slides.md"), md)

  console.log(`\nDone. Total $${run.cost.totalUsd ?? "unknown"} · ${errors.length} error(s)\n${outDir}`)
}

main().catch((err) => {
  console.error("[carousel-baseline] failed:", err)
  process.exit(1)
})
