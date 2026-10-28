// Dev-only Full Post quality baseline: runs ONE single post through the same
// code path the app uses (fullpost/generate route's hook + caption calls ->
// FullPostGenerator's image-prompt write -> post-image/generate route) and
// saves every input, prompt, raw output, cost and the image, so a later
// prompt/pipeline change can be compared against this run side by side.
// Post counterpart of scripts/carousel-baseline.ts / story-baseline.ts.
//
//   npx tsx scripts/post-baseline.ts --brand <brandId> --topic "<topic>" [--label baseline]
//
// Output: scripts/output/post-runs/<label>-<timestamp>/ (run.json,
// image.png, post.md) -- scripts/output/ is gitignored.
//
// Mirrors FullPostGenerator's defaults: content angle "auto" (the topic is
// the whole additionalContext), no product, aspect ratio 4:5, visual style
// "editorial_graphic", no headline overlay typed (so the overlay is the
// caption's suggested_overlay_text), template/colour theme as the caption
// suggests. Differences from the real app, on purpose: no credits charged,
// no DB/storage writes (no content_projects/hooks/captions rows, no post
// image session). If the caption picks hard_truth_checklist the image step
// is skipped and recorded -- that template has no AI photo.
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
import type { GeneratedCaption, UserPlan } from "@/types/app"

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
  console.error("[post-baseline] refusing to run with NODE_ENV=production -- this is a dev-only harness.")
  process.exit(1)
}

// ─── Args ───────────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 ? process.argv[i + 1] : undefined
}

const brandId = arg("brand")
const topic = arg("topic")?.trim()
const label = (arg("label") ?? "baseline").replace(/[^\w.-]+/g, "_")

if (!brandId || !topic) {
  console.error('Usage: npx tsx scripts/post-baseline.ts --brand <brandId> --topic "<topic>" [--label baseline]')
  process.exit(1)
}

// FullPostGenerator's initial state.
const ASPECT_RATIO = "4:5" as const
const VISUAL_STYLE = "editorial_graphic" as const
const PLATFORM = "instagram" as const

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

async function main(): Promise<void> {
  const { generateHooks } = await import("@/lib/ai/hooks-generator")
  const { generateContent } = await import("@/lib/ai/content-generator")
  const { requestImagePromptStream } = await import("@/lib/ai/image-prompt-writer")
  const { generatePostImage, attemptsCostUsd } = await import("@/lib/ai/post-image-pipeline")
  const { IMAGE_PROVIDER_CONFIG } = await import("@/lib/ai/image-provider")
  const { MODELS } = await import("@/lib/ai/models")
  const { sumCostUsd } = await import("@/lib/ai/pricing")
  const { resolveSuggestedFont } = await import("@/lib/design/fonts")
  const { resolveColorThemes, findColorTheme } = await import("@/lib/design/color-themes")
  const { DEFAULT_POST_TEMPLATE_ID } = await import("@/lib/design/post-templates")
  const { mergeCaptionWithHookAndCta } = await import("@/lib/utils/caption-merge")
  const { fetchPastExamples } = await import("@/lib/ai/past-examples")
  const { isInternalUnlimited } = await import("@/lib/usage/is-internal-unlimited")
  const { sanitizeVisualBrief, briefUsesProductReference } = await import("@/lib/ai/visual-brief")

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.")
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

  const errors: string[] = []
  const runStartedAt = new Date()
  const outDir = join(process.cwd(), "scripts", "output", "post-runs", `${label}-${runStartedAt.toISOString().replace(/[:.]/g, "-")}`)
  mkdirSync(outDir, { recursive: true })

  const { data: brand, error: brandError } = await supabase.from("brands").select("*").eq("id", brandId!).single<BrandRow>()
  if (!brand) throw new Error(`Brand ${brandId} not found${brandError ? `: ${brandError.message}` : ""}`)
  const { data: owner } = await supabase.from("users").select("plan").eq("id", brand.user_id).single<{ plan: UserPlan }>()
  const plan: UserPlan = owner?.plan ?? "starter"
  const isUnlimited = isInternalUnlimited(brand.user_id)

  // Learned brand lessons, fetched the way the routes fetch them (fail-soft --
  // [] if brand_lessons isn't there yet). "image" lessons go to the prompt writer.
  const { getActiveLessons, imageLessonRules } = await import("@/lib/ai/brand-brain")
  const hookLessons = await getActiveLessons(supabase, brand.id, "hook")
  const captionLessons = await getActiveLessons(supabase, brand.id, "caption")
  const imageLessons = imageLessonRules(await getActiveLessons(supabase, brand.id, "image"))
  console.log(`Brand: ${brand.name} (${brand.niche ?? "no niche"}) · owner plan ${plan}${isUnlimited ? " (internal unlimited)" : ""}`)

  // fullpost/generate route: angle "auto" adds no hint, so the context is just the topic.
  const combinedContext = topic!
  const pastExamples = await fetchPastExamples(supabase, brand.id, "social_post")
  const colorThemes = resolveColorThemes(brand)

  // 1. Hook, then caption -- exactly the route's social_post calls.
  currentStage = "hook"
  console.log("Generating hook…")
  let started = Date.now()
  const hookResult = await generateHooks(brand, {
    hookTypes: ["bold_statement", "question", "story"],
    count: 1,
    platform: PLATFORM,
    additionalContext: combinedContext,
    product: null,
    lessons: hookLessons,
  })
  const hookLatencyMs = Date.now() - started
  const hook = hookResult.hooks[0]
  if (!hook) throw new Error("Hook generation returned no results")

  currentStage = "caption"
  console.log("Generating caption…")
  started = Date.now()
  const contentResult = await generateContent(brand, "social_post", {
    product: null,
    platform: PLATFORM,
    hookText: hook.hook_text,
    additionalContext: combinedContext,
    pastExamples,
    includeImagePrompt: true,
    availableColorThemes: colorThemes.map((t) => ({ id: t.id, label: t.label })),
    lessons: captionLessons,
  })
  const captionLatencyMs = Date.now() - started
  const caption = contentResult.data as GeneratedCaption
  const rawCaption = JSON.parse(JSON.stringify(caption)) as GeneratedCaption
  // Route post-processing.
  caption.caption_text = mergeCaptionWithHookAndCta(caption.caption_text, hook.hook_text, caption.cta)
  caption.character_count = caption.caption_text.length
  caption.suggested_font_id = resolveSuggestedFont(caption.suggested_font_id, brand.vibe)

  // FullPostGenerator's runImageGeneration choices.
  const template = caption.suggested_template || DEFAULT_POST_TEMPLATE_ID
  const colorThemeId = caption.suggested_color_theme_id || colorThemes[0]?.id || ""
  const overlayText = caption.suggested_overlay_text?.trim() || ""
  const isChecklist = template === "hard_truth_checklist"
  // As FullPostGenerator sends it (caption.visual) and the write / post-image
  // routes re-sanitize it.
  const visualBrief = sanitizeVisualBrief(caption.visual)

  // 2. Image prompt, as beginImagePromptWriting seeds it: the typed brief
  // (here: the topic) wins over caption.image_prompt.
  const seed = combinedContext.trim() || caption.image_prompt?.trim() || null
  let imagePrompt = ""
  let promptLatencyMs = 0
  let imageRecord: { file: string | null; latencyMs: number; costUsd: number | null; provider: string | null; attempts: unknown[]; finalImagePrompt: string | null; productReferenceUsed: boolean; skipped?: string; error?: string } = {
    file: null, latencyMs: 0, costUsd: null, provider: null, attempts: [], finalImagePrompt: null, productReferenceUsed: false,
  }

  if (isChecklist) {
    imageRecord.skipped = "hard_truth_checklist template -- no AI photo (generatePostImage composites a flat card)"
  } else {
    currentStage = "image_prompt_write"
    console.log("Writing the image prompt…")
    started = Date.now()
    try {
      const stream = await requestImagePromptStream({
        flow: "post",
        rawInput: seed,
        isRewrite: false,
        brand: { name: brand.name, niche: brand.niche, target_audience: brand.target_audience, tone_of_voice: brand.tone_of_voice, vibe: brand.vibe },
        product: null,
        constraints: { aspectRatioLabel: ASPECT_RATIO, styleLabel: VISUAL_STYLE, hasProductReference: false, visualBrief, lessons: imageLessons },
      })
      for await (const chunk of stream) imagePrompt += chunk.choices[0]?.delta?.content ?? ""
    } catch (err) {
      errors.push(`image_prompt_write: ${err instanceof Error ? err.message : String(err)}`)
    }
    promptLatencyMs = Date.now() - started
    // generatePostImageSchema's imagePrompt transform: strip tags, trim, 3-1500 chars.
    const sentPrompt = imagePrompt.replace(/<[^>]*>/g, "").trim()
    if (sentPrompt.length < 3 || sentPrompt.length > 1500) {
      errors.push(`image prompt is ${sentPrompt.length} chars -- the post-image route would reject it (3-1500) with a 400.`)
    } else {
      // 3. The image, with the options the post-image route passes.
      currentStage = "image"
      console.log("Generating the image…")
      const firstCall = captured.length
      started = Date.now()
      const result = await generatePostImage({
        imagePrompt: sentPrompt,
        brandNiche: brand.niche,
        targetAudience: brand.target_audience,
        template,
        colorTheme: findColorTheme(colorThemes, colorThemeId),
        captionText: undefined,
        logoUrl: brand.logo_url,
        plan,
        isInternalUnlimitedUser: isUnlimited,
        productImageUrl: null,
        aspectRatio: ASPECT_RATIO,
        visualStyle: VISUAL_STYLE,
        checklistHeadline: caption.checklist_headline ?? undefined,
        checklistHighlightedPhrase: caption.checklist_highlighted_phrase ?? undefined,
        checklistWrongItems: caption.checklist_wrong_items ?? undefined,
        checklistRightItems: caption.checklist_right_items ?? undefined,
        checklistClosingLine: caption.checklist_closing_line ?? undefined,
        visualBrief,
      })
      const imageRequests = captured.slice(firstCall)
      const first = imageRequests[0]?.request as { prompt?: unknown } | undefined
      imageRecord = {
        file: null,
        latencyMs: Date.now() - started,
        costUsd: attemptsCostUsd(result.attempts),
        provider: result.success ? result.provider : null,
        attempts: result.attempts,
        finalImagePrompt: typeof first?.prompt === "string" ? first.prompt : null,
        // No product is selected here, so never; with one it would follow briefUsesProductReference.
        productReferenceUsed: false && briefUsesProductReference(visualBrief),
      }
      if (result.success) {
        imageRecord.file = `image.${result.mimeType.includes("jpeg") ? "jpg" : "png"}`
        writeFileSync(join(outDir, imageRecord.file), result.buffer)
      } else {
        imageRecord.error = result.error
        errors.push(`image: ${result.error}`)
      }
    }
  }

  // 4. Outputs.
  const textCost = sumCostUsd(hookResult.costUsd, contentResult.costUsd)
  const totalLatencyMs = hookLatencyMs + captionLatencyMs + promptLatencyMs + imageRecord.latencyMs
  const run = {
    inputs: { brandId, brandName: brand.name, topic, label, platform: PLATFORM, aspectRatio: ASPECT_RATIO, visualStyle: VISUAL_STYLE, contentAngle: "auto", product: null },
    startedAt: runStartedAt.toISOString(),
    plan,
    isInternalUnlimitedUser: isUnlimited,
    models: { hook: hookResult.model, caption: contentResult.model, imagePromptWriter: MODELS.creative, image: IMAGE_PROVIDER_CONFIG.model },
    lessons: { hook: hookLessons, caption: captionLessons, image: imageLessons },
    pastExamples,
    hook,
    rawCaption,
    caption,
    postPlan: caption.post_plan ?? null,
    visual: caption.visual ?? null,
    overlayText,
    template,
    colorThemeId,
    fontId: caption.suggested_font_id,
    imagePromptSeed: seed,
    imagePrompt,
    image: imageRecord,
    calls: captured,
    cost: {
      hook: { usage: hookResult.usage ?? null, costUsd: hookResult.costUsd, latencyMs: hookLatencyMs },
      caption: { usage: contentResult.usage ?? null, costUsd: contentResult.costUsd, latencyMs: captionLatencyMs },
      imagePrompt: { usage: null, costUsd: null, latencyMs: promptLatencyMs, note: "streamed without usage reporting -- not priced" },
      image: { costUsd: imageRecord.costUsd, latencyMs: imageRecord.latencyMs },
      totalUsd: sumCostUsd(textCost, imageRecord.costUsd),
      totalLatencyMs,
    },
    errors,
  }
  writeFileSync(join(outDir, "run.json"), JSON.stringify(run, null, 2))

  const md = [
    `# ${label}: ${topic}`,
    "",
    `Brand **${brand.name}** · template ${template} · ${runStartedAt.toISOString()}`,
    `Total cost: $${run.cost.totalUsd ?? "unknown"} (hook $${hookResult.costUsd ?? "?"}, caption $${contentResult.costUsd ?? "?"}, image $${imageRecord.costUsd ?? "?"}; prompt writer not priced) · ${(totalLatencyMs / 1000).toFixed(1)} s`,
    "",
    `**Post plan:** ${caption.post_plan ? `${caption.post_plan.message ?? ""} — *why it matters:* ${caption.post_plan.audience_reason ?? ""}` : "(none returned)"}`,
    "",
    `**Visual brief:** ${caption.visual ? `${caption.visual.kind}: ${caption.visual.must_show}${caption.visual.composition ? ` (${caption.visual.composition})` : ""}` : "(none)"}`,
    "",
    `**Hook:** ${hook.hook_text}`,
    "",
    `**Overlay text:** ${overlayText || "(none)"}`,
    "",
    "**Caption:**",
    "",
    caption.caption_text,
    "",
    `**Image prompt seed:** ${seed ?? "(none)"}`,
    "",
    `**Image prompt (writer output):** ${imagePrompt || "(none)"}`,
    "",
    imageRecord.file ? `![](${imageRecord.file})` : `Image: ${imageRecord.skipped ?? `failed: ${imageRecord.error ?? ""}`}`,
    ...(errors.length ? ["", "## Errors", ...errors.map((e) => `- ${e}`)] : []),
    "",
  ].join("\n")
  writeFileSync(join(outDir, "post.md"), md)

  console.log(`\nDone. Total $${run.cost.totalUsd ?? "unknown"} · ${errors.length} error(s)\n${outDir}`)
}

main().catch((err) => {
  console.error("[post-baseline] failed:", err)
  process.exit(1)
})
