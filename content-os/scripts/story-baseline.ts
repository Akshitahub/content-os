// Dev-only story quality baseline: runs ONE story sequence through the same
// code path the app uses (stories/generate route -> StorySequence's
// image-prompt write -> stories/slide-image route per frame) and saves every
// input, prompt, raw output, cost and background image, so a later
// prompt/pipeline change can be compared against this run side by side.
// Story counterpart of scripts/carousel-baseline.ts.
//
//   npx tsx scripts/story-baseline.ts --brand <brandId> --topic "<topic>" [--slides 4] [--vibe <vibe>] [--label baseline]
//
// Output: scripts/output/story-runs/<label>-<timestamp>/ (run.json,
// slide-NN.png, slides.md) -- scripts/output/ is gitignored.
//
// Mirrors, does not reimplement: the story prompt, image-prompt writer and
// story-background prompt all come from lib/ unchanged. Route-only
// post-processing (slide-count backstop, vibe background override, font
// stamp, text sanitize) is copied below with its source named. Differences
// from the real app, on purpose: no credits are charged and nothing is
// written to the DB or storage; every frame gets a background (the app only
// does hook/cta unless "AI background for every slide" is on); frames run
// one at a time (the app runs 3 concurrently) so each recorded request maps
// to one frame; no product is selected.
//
// The exact strings sent to the text/image models are captured by wrapping
// globalThis.fetch (OpenAI/Groq hosts only) before any lib/ module loads.
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
  console.error("[story-baseline] refusing to run with NODE_ENV=production -- this is a dev-only harness.")
  process.exit(1)
}

// ─── Args ───────────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 ? process.argv[i + 1] : undefined
}

// Same bounds as app/api/v1/ai/stories/generate/route.ts (storyCount 1-10)
// and the vibes stories/slide-image/generate/route.ts accepts. Custom color
// and Hard Truth Checklist are excluded: neither makes AI backgrounds.
const STORY_VIBES = ["fun_playful", "clean_minimal", "bold_dramatic", "warm_cozy", "professional", "trendy_genz"] as const
type StoryVibeArg = (typeof STORY_VIBES)[number]

const brandId = arg("brand")
const topic = arg("topic")?.trim()
const storyCount = Number(arg("slides") ?? 4)
const vibeArg = arg("vibe")
const label = (arg("label") ?? "baseline").replace(/[^\w.-]+/g, "_")

// --vision: score EVERY image against its brief (the app only samples).
const VISION = process.argv.includes("--vision")

if (!brandId || !topic) {
  console.error('Usage: npx tsx scripts/story-baseline.ts --brand <brandId> --topic "<topic>" [--slides 4] [--vibe <vibe>] [--label baseline]')
  process.exit(1)
}
if (!Number.isInteger(storyCount) || storyCount < 1 || storyCount > 10) {
  console.error("--slides must be an integer from 1 to 10 (same bounds as the stories route).")
  process.exit(1)
}
if (vibeArg && !(STORY_VIBES as readonly string[]).includes(vibeArg)) {
  console.error(`--vibe must be one of: ${STORY_VIBES.join(", ")}`)
  process.exit(1)
}
// StorySequence's vibe state starts undefined, so no --vibe = what a user who
// never touched the vibe picker sends.
const vibe = vibeArg as StoryVibeArg | undefined

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

// ─── Copied route / builder logic ───────────────────────────────────────────

// Copied from VIBE_TO_STORY_BACKGROUND (app/api/v1/ai/stories/generate/route.ts).
const VIBE_TO_STORY_BACKGROUND: Record<string, string> = {
  fun_playful: "vibe_fun_playful",
  clean_minimal: "white",
  bold_dramatic: "gradient_dark",
  warm_cozy: "gradient_warm",
  professional: "vibe_professional",
  trendy_genz: "vibe_trendy_genz",
  hard_truth_checklist: "checklist_cream",
}

// Copied from StorySequence.tsx's storyBgRole.
function storyBgRole(type: unknown): "hook" | "cta" | "body" {
  return type === "hook" || type === "cta" ? type : "body"
}

// story_plan as markdown for slides.md.
function storyPlanLines(plan: unknown): string[] {
  if (!plan || typeof plan !== "object") return ["**Story plan:** (none returned)", ""]
  const p = plan as { goal?: unknown; next_action?: unknown; arc?: unknown }
  const arc = Array.isArray(p.arc) ? (p.arc as { story_number?: unknown; type?: unknown; message?: unknown }[]) : []
  return [
    "## Story plan",
    `- **Goal:** ${String(p.goal ?? "")}`,
    `- **Next action:** ${String(p.next_action ?? "")}`,
    ...arc.map((a) => `  ${String(a.story_number ?? "?")}. *${String(a.type ?? "")}* — ${String(a.message ?? "")}`),
    "",
  ]
}

// A frame's visual brief as one table cell: "kind: must_show (composition)".
function visualCell(visual: unknown): string {
  if (!visual || typeof visual !== "object") return "—"
  const v = visual as { kind?: unknown; must_show?: unknown; composition?: unknown }
  return `${String(v.kind ?? "?")}: ${String(v.must_show ?? "")}${v.composition ? ` (${String(v.composition)})` : ""}`
}


// A file this run wrote, as the data: URL the server compositors accept.
function fileAsDataUrl(dir: string, file: string): string {
  const mime = file.endsWith(".jpg") ? "image/jpeg" : "image/png"
  return `data:${mime};base64,${readFileSync(join(dir, file)).toString("base64")}`
}

// ─── Run ────────────────────────────────────────────────────────────────────

type SlideRecord = {
  index: number
  type: string
  /** Background role (storyBgRole) -- what the image prompt was told. */
  role: "hook" | "cta" | "body"
  text: string
  subtext: string
  textPosition: string | null
  /** The text_position actually sent with the image request (StorySequence sends it only for some frames). */
  textPositionSent: string | null
  imageFile: string | null
  /** The final frame with its real text overlay (see finalOutput in run.json). */
  finalImageFile?: string | null
  /** --vision only: 1-5 score of the background against its brief, with the reason. */
  alignment?: { score: number; reason: string; costUsd: number | null } | null
  /** How text is drawn over this background (lib/image/text-contrast.ts), as the slide-image route computes it. */
  textStyle?: unknown
  /** Final render warnings for this slide ("text_overflow"). */
  warnings?: string[]
  /** Split layer (lib/ai/split-layer.ts): whether the two-half composite ran, and both half prompts. */
  split?: { used: boolean; halfPrompts: { left: string; right: string }; fallbackReason?: string } | null
  latencyMs: number
  costUsd: number | null
  provider: string | null
  /** The frame's visual brief (kind/must_show/composition), if the model gave one. */
  visual: unknown
  /** The brief actually sent (re-sanitized, as the slide-image route does) -- null on the hook, which keeps the shared scene. */
  briefUsed: unknown
  /** Whether a product reference photo went with this frame (always false here -- no product is selected). */
  productReferenceUsed: boolean
  /** The prompt string actually sent to the image provider on the first attempt. */
  finalImagePrompt: string | null
  attempts: unknown[]
  imageRequests: CapturedCall[]
  error?: string
}

async function main(): Promise<void> {
  const { requestStorySequence } = await import("@/lib/ai/story-sequence-generator")
  const { requestImagePromptStream } = await import("@/lib/ai/image-prompt-writer")
  const { generateStorySlideBackground } = await import("@/lib/ai/story-slide-background")
  const { sanitizeVisualBrief, briefUsesProductReference } = await import("@/lib/ai/visual-brief")
  const { computeTextStyleSafe } = await import("@/lib/image/text-contrast")
  const { storyTextRegion } = await import("@/lib/design/text-style")
  const { attemptsCostUsd } = await import("@/lib/ai/post-image-pipeline")
  const { IMAGE_PROVIDER_CONFIG } = await import("@/lib/ai/image-provider")
  const { MODELS } = await import("@/lib/ai/models")
  const { sumCostUsd } = await import("@/lib/ai/pricing")
  const { resolveSuggestedFont } = await import("@/lib/design/fonts")
  const { findContentQualityIssues, sanitizeLeakedArtifacts } = await import("@/lib/ai/content-quality-check")
  const { isInternalUnlimited } = await import("@/lib/usage/is-internal-unlimited")

  // Copied from sanitizeStoryText/sanitizeStorySlides (stories/generate/route.ts).
  const sanitizeText = (value: string | undefined): string | undefined => {
    if (typeof value !== "string" || !value) return value
    return findContentQualityIssues(value).length === 0 ? value : sanitizeLeakedArtifacts(value)
  }
  const sanitizeSlides = (stories: Record<string, unknown>[]): Record<string, unknown>[] => stories.map((s) => ({
    ...s,
    text: typeof s.text === "string" ? sanitizeText(s.text) : s.text,
    subtext: typeof s.subtext === "string" ? sanitizeText(s.subtext) : s.subtext,
    checklist_highlighted_phrase: typeof s.checklist_highlighted_phrase === "string" ? sanitizeText(s.checklist_highlighted_phrase) : s.checklist_highlighted_phrase,
    checklist_wrong_item: typeof s.checklist_wrong_item === "string" ? sanitizeText(s.checklist_wrong_item) : s.checklist_wrong_item,
    checklist_right_item: typeof s.checklist_right_item === "string" ? sanitizeText(s.checklist_right_item) : s.checklist_right_item,
  }))

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.")
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

  const errors: string[] = []
  const runStartedAt = new Date()
  const outDir = join(process.cwd(), "scripts", "output", "story-runs", `${label}-${runStartedAt.toISOString().replace(/[:.]/g, "-")}`)
  mkdirSync(outDir, { recursive: true })

  const { data: brand, error: brandError } = await supabase.from("brands").select("*").eq("id", brandId!).single<BrandRow>()
  if (!brand) throw new Error(`Brand ${brandId} not found${brandError ? `: ${brandError.message}` : ""}`)
  const { data: owner } = await supabase.from("users").select("plan").eq("id", brand.user_id).single<{ plan: UserPlan }>()
  const plan: UserPlan = owner?.plan ?? "starter"
  const isUnlimited = isInternalUnlimited(brand.user_id)

  // Learned brand lessons, fetched the way the routes fetch them (fail-soft --
  // [] if brand_lessons isn't there yet). "image" lessons go to the prompt writer.
  const { getActiveLessons, imageLessonRules } = await import("@/lib/ai/brand-brain")
  const { brandBrainImageConstraints, parseBrandBrain } = await import("@/lib/brand-brain-profile")
  const storyLessons = await getActiveLessons(supabase, brand.id, "story")
  const imageLessons = imageLessonRules(await getActiveLessons(supabase, brand.id, "image"))
  console.log(`Brand: ${brand.name} (${brand.niche ?? "no niche"}) · owner plan ${plan}${isUnlimited ? " (internal unlimited)" : ""}`)

  // Copied from the pastExamples block in stories/generate/route.ts.
  const pastExamples: string[] = []
  {
    const { data: pastStories, error } = await supabase
      .from("stories")
      .select("stories")
      .eq("brand_id", brand.id)
      .gte("user_rating", 4)
      .order("user_rating", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(5) as { data: { stories: unknown }[] | null; error: { message: string } | null }
    if (error) errors.push(`pastExamples: ${error.message}`)
    for (const s of pastStories ?? []) {
      if (!Array.isArray(s.stories)) continue
      const texts = s.stories
        .map((slide) => (slide && typeof slide === "object" && "text" in slide ? String((slide as { text: unknown }).text) : null))
        .filter((t): t is string => !!t)
      if (texts.length > 0) pastExamples.push(texts.join(" / "))
    }
  }

  // 1. Story copy -- exactly the route's call.
  currentStage = "story_copy"
  console.log(`Generating ${storyCount}-frame story copy…`)
  const copyStarted = Date.now()
  const gen = await requestStorySequence(brand, topic!, storyCount, vibe, pastExamples, storyLessons)
  const copyLatencyMs = Date.now() - copyStarted
  const d = JSON.parse(gen.raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()) as Record<string, unknown>
  if (!Array.isArray(d.stories) || d.stories.length < storyCount) throw new Error(`AI returned ${Array.isArray(d.stories) ? d.stories.length : 0} story frames, expected ${storyCount}`)

  // 2. Route post-processing, in the route's order.
  let stories: Record<string, unknown>[] = (d.stories as Record<string, unknown>[]).slice(0, storyCount).map((s, i) => ({ ...s, story_number: i + 1 }))
  const effectiveVibe = vibe || (d.suggested_vibe as string | undefined)
  const vibeBackground = effectiveVibe ? VIBE_TO_STORY_BACKGROUND[effectiveVibe] : undefined
  if (vibeBackground) stories = stories.map((s) => ({ ...s, background: vibeBackground }))
  const fontId = resolveSuggestedFont(d.suggested_font_id, brand.vibe, effectiveVibe)
  stories = stories.map((s) => ({ ...s, font_id: fontId }))
  stories = sanitizeSlides(stories)

  // 3. One visual prompt for the whole sequence, as StorySequence's
  // writeVisualPrompt() sends it on a first write with an empty field:
  // flow "story", rawInput null, no product, { styleLabel: vibe,
  // hasProductReference: false }.
  currentStage = "image_prompt_write"
  console.log("Writing the visual prompt…")
  const promptStarted = Date.now()
  let visualPrompt = ""
  try {
    const stream = await requestImagePromptStream({
      flow: "story",
      rawInput: null,
      isRewrite: false,
      brand: { name: brand.name, niche: brand.niche, target_audience: brand.target_audience, tone_of_voice: brand.tone_of_voice, vibe: brand.vibe },
      product: null,
      constraints: { styleLabel: vibe, hasProductReference: false, lessons: imageLessons, ...brandBrainImageConstraints(parseBrandBrain(brand.brand_brain)) },
    })
    for await (const chunk of stream) visualPrompt += chunk.choices[0]?.delta?.content ?? ""
  } catch (err) {
    errors.push(`image_prompt_write: ${err instanceof Error ? err.message : String(err)}`)
  }
  const promptLatencyMs = Date.now() - promptStarted
  // stories/slide-image/generate/route.ts's customPrompt transform: strip tags, trim, max 1500.
  let customPrompt: string | undefined = visualPrompt.replace(/<[^>]*>/g, "").trim() || undefined
  if (customPrompt && customPrompt.length > 1500) {
    errors.push(`visualPrompt is ${customPrompt.length} chars -- the slide-image route would reject it (max 1500) with a 400.`)
    customPrompt = undefined
  }

  // 4. A background for every frame, as StorySequence's runStoryBackgrounds
  // calls the slide-image route with no product selected: hook/cta (and any
  // frame with its own brief) send their text_position, plus the frame's
  // visual as visualBrief, re-sanitized like the route does.
  const slideRecords: SlideRecord[] = []
  for (let i = 0; i < stories.length; i++) {
    const s = stories[i]!
    const role = storyBgRole(s.type)
    const textPosition = s.text_position as "top" | "center" | "bottom" | undefined
    const textPositionSent = role !== "body" || s.visual ? textPosition : undefined
    const visualBrief = sanitizeVisualBrief(s.visual)
    const productImageUrl: string | undefined = undefined
    currentStage = `slide_${i + 1}`
    const firstCall = captured.length
    console.log(`Frame ${i + 1}/${stories.length} (${String(s.type)} -> ${role})…`)
    const started = Date.now()
    const result = await generateStorySlideBackground({
      vibe,
      brand,
      plan,
      isInternalUnlimitedUser: isUnlimited,
      role,
      productImageUrl,
      textPosition: textPositionSent,
      customPrompt,
      visualBrief,
      // StorySequence sends the user's own typed scene text; this harness
      // types none (rawInput null), so there's no direction.
      userDirection: null,
      quality: "low",
    })
    const imageRequests = captured.slice(firstCall)
    const firstImageRequest = imageRequests[0]?.request as { prompt?: unknown } | undefined
    const record: SlideRecord = {
      index: i + 1,
      type: String(s.type ?? ""),
      role,
      text: typeof s.text === "string" ? s.text : "",
      subtext: typeof s.subtext === "string" ? s.subtext : "",
      textPosition: textPosition ?? null,
      textPositionSent: textPositionSent ?? null,
      imageFile: null,
      latencyMs: Date.now() - started,
      costUsd: attemptsCostUsd(result.attempts),
      provider: result.success ? result.provider : null,
      visual: s.visual ?? null,
      briefUsed: visualBrief ?? null,
      productReferenceUsed: !!productImageUrl && briefUsesProductReference(visualBrief),
      finalImagePrompt: typeof firstImageRequest?.prompt === "string" ? firstImageRequest.prompt : null,
      attempts: result.attempts,
      imageRequests,
      split: result.split ?? null,
    }
    if (result.success) {
      const ext = result.mimeType.includes("jpeg") ? "jpg" : "png"
      record.imageFile = `slide-${String(i + 1).padStart(2, "0")}.${ext}`
      writeFileSync(join(outDir, record.imageFile), result.buffer)
      // As the slide-image route computes it (region from the text_position it was sent).
      record.textStyle = await computeTextStyleSafe(result.buffer, storyTextRegion(textPositionSent))
    } else {
      record.error = result.error
      errors.push(`frame ${i + 1}: ${result.error}`)
    }
    slideRecords.push(record)
  }

  // 5. Final frames with the real text overlay, via the same server
  // renderer the app's story export uses (stories/render route ->
  // renderStorySlidesToPng).
  if (VISION) {
    const { checkImageAlignment } = await import("@/lib/ai/image-alignment")
    for (const rec of slideRecords) {
      const brief = rec.briefUsed as import("@/lib/ai/visual-brief").VisualBrief | null
      if (!rec.imageFile || !brief) continue
      const res = await checkImageAlignment({ imageUrl: fileAsDataUrl(outDir, rec.imageFile), brief })
      rec.alignment = res ? { score: res.score, reason: res.reason, costUsd: res.costUsd } : null
    }
  }

  let finalOutput: { rendered: boolean; renderer?: string; reason?: string } = { rendered: false }
  try {
    const { renderStorySlides } = await import("@/lib/image/story-compositor")
    // Copied from StorySequence.tsx's toExportSlide (~line 75); the
    // background provider is "openai", so the product overlay defaults off.
    const exportSlides = stories.map((raw, i) => {
      const s = raw as Record<string, never>
      const file = slideRecords[i]?.imageFile
      return {
        type: s.type,
        text: s.text,
        subtext: s.subtext,
        background: s.background,
        text_position: s.text_position,
        has_poll: s.has_poll,
        poll_options: s.poll_options,
        background_image_url: file ? fileAsDataUrl(outDir, file) : null,
        custom_background_colors: s.custom_background_colors,
        productImageSource: null,
        text_position_x: s.text_position_x,
        text_position_y: s.text_position_y,
        show_product_overlay: false,
        product_position_x: s.product_position_x,
        product_position_y: s.product_position_y,
        custom_text_color: s.custom_text_color,
        font_id: s.font_id,
        body_font_id: s.body_font_id,
        text_size_scale: s.text_size_scale,
        checklist_highlighted_phrase: s.checklist_highlighted_phrase,
        checklist_wrong_item: s.checklist_wrong_item,
        checklist_right_item: s.checklist_right_item,
        text_style: file ? (slideRecords[i]?.textStyle as import("@/lib/design/text-style").TextStyle | null | undefined) ?? null : null,
      }
    })
    const finals = await renderStorySlides(exportSlides)
    finals.forEach(({ png, warnings }, i) => {
      const file = `final-${String(i + 1).padStart(2, "0")}.png`
      writeFileSync(join(outDir, file), png)
      if (slideRecords[i]) {
        slideRecords[i]!.finalImageFile = file
        slideRecords[i]!.warnings = warnings
      }
    })
    finalOutput = { rendered: true, renderer: "renderStorySlides (lib/image/story-compositor.ts, the stories/render export route)" }
  } catch (err) {
    errors.push(`final render: ${err instanceof Error ? err.message : String(err)}`)
    finalOutput = { rendered: false, reason: "renderer threw -- see errors" }
  }

  // 6. Outputs.
  const copyCalls = captured.filter((c) => c.stage === "story_copy")
  const imageCost = sumCostUsd(...slideRecords.map((r) => r.costUsd))
  const totalLatencyMs = copyLatencyMs + promptLatencyMs + slideRecords.reduce((a, r) => a + r.latencyMs, 0)
  const run = {
    inputs: { brandId, brandName: brand.name, topic, slides: storyCount, vibe: vibe ?? null, label },
    startedAt: runStartedAt.toISOString(),
    plan,
    isInternalUnlimitedUser: isUnlimited,
    models: { storyCopy: gen.model, imagePromptWriter: MODELS.creative, image: IMAGE_PROVIDER_CONFIG.model, imageQuality: "low" },
    lessons: { story: storyLessons, image: imageLessons },
    pastExamples,
    storyPrompt: copyCalls[0]?.request ?? null,
    storyCalls: copyCalls,
    rawStoryOutputs: copyCalls.map((c) => c.responseContent ?? null),
    storyPlan: d.story_plan ?? null,
    storyData: d,
    finalStories: stories,
    effectiveVibe: effectiveVibe ?? null,
    fontId,
    visualPrompt,
    imagePromptCall: captured.filter((c) => c.stage === "image_prompt_write"),
    slides: slideRecords,
    finalOutput,
    // Quality gate (lib/ai/quality-gate.ts): its input is in the copy-stage
    // calls above (the MODELS.scoring request); issues are pre-repair.
    gate: gen.gate ?? null,
    cost: {
      storyCopy: { usage: gen.usage ?? null, costUsd: gen.costUsd, latencyMs: copyLatencyMs },
      imagePrompt: { usage: null, costUsd: null, latencyMs: promptLatencyMs, note: "streamed without usage reporting -- not priced" },
      images: { costUsd: imageCost },
      totalUsd: sumCostUsd(gen.costUsd, imageCost),
      totalLatencyMs,
    },
    errors,
  }
  writeFileSync(join(outDir, "run.json"), JSON.stringify(run, null, 2))

  const cell = (t: string) => t.replace(/\|/g, "\\|").replace(/\n/g, " ")
  const md = [
    `# ${label}: ${topic}`,
    "",
    `Brand **${brand.name}** · ${storyCount} frames requested · vibe ${vibe ?? "(none -- model suggested " + (effectiveVibe ?? "none") + ")"} · ${runStartedAt.toISOString()}`,
    `Total cost: $${run.cost.totalUsd ?? "unknown"} (copy $${gen.costUsd ?? "?"}, images $${imageCost ?? "?"}; prompt writer not priced) · ${(totalLatencyMs / 1000).toFixed(1)} s`,
    "",
    `**Visual prompt:** ${cell(visualPrompt || "(none)")}`,
    "",
    ...storyPlanLines(d.story_plan),
    "| # | Type | Bg role | Text position | Text | Subtext | Visual brief | Image |",
    "|---|------|---------|---------------|------|---------|--------------|-------|",
    ...slideRecords.map((r) => `| ${r.index} | ${r.type} | ${r.role} | ${r.textPosition ?? "—"} | ${cell(r.text)} | ${cell(r.subtext)} | ${cell(visualCell(r.visual))} | ${r.imageFile ? `![](${r.imageFile})` : `failed: ${cell(r.error ?? "")}`} |`),
    ...(errors.length ? ["", "## Errors", ...errors.map((e) => `- ${e}`)] : []),
    "",
  ].join("\n")
  writeFileSync(join(outDir, "slides.md"), md)

  console.log(`\nDone. Total $${run.cost.totalUsd ?? "unknown"} · ${errors.length} error(s)\n${outDir}`)
}

main().catch((err) => {
  console.error("[story-baseline] failed:", err)
  process.exit(1)
})
