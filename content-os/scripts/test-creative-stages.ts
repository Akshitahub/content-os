// Dev-only sanity check for the Groq -> OpenAI creative-stages migration
// -- Phase 1 (hooks, blog, reel_script, ad_copy, prompt-authoring, vision)
// and Phase 1b (story, carousel, repurpose, occasion content, Autopilot).
// Runs one real call per moved stage and prints latency + output. Run
// manually: `npx tsx scripts/test-creative-stages.ts`.
//
// NOT reachable in production: this is a standalone script, not an API
// route or page -- Next.js never serves anything under scripts/ to a
// browser. The NODE_ENV guard below is defense-in-depth only, in case
// this is ever accidentally invoked from a production process (e.g. a
// misconfigured build/start script) rather than a developer's own
// terminal.
import { readFileSync, existsSync } from "fs"
import { join } from "path"
import sharp from "sharp"
import type { BrandRow } from "@/types/database"

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
  console.error("[test-creative-stages] refusing to run with NODE_ENV=production -- this is a dev-only sanity check.")
  process.exit(1)
}

// A complete, structurally-valid brands row fixture -- no real database
// connection needed for this script, every moved stage only ever reads
// plain fields off this object.
const TEST_BRAND: BrandRow = {
  id: "00000000-0000-0000-0000-000000000000",
  user_id: "00000000-0000-0000-0000-000000000000",
  name: "Sunlit Skincare",
  description: "A clean-beauty skincare brand for Indian skin",
  niche: "skincare",
  target_audience: "Urban Indian women aged 22-35 who want a simple, effective routine",
  tone_of_voice: "warm, confident, a little playful",
  brand_values: ["clean ingredients", "cruelty-free", "affordable"],
  color_palette: { primary: "#E8A87C", secondary: "#F7F3E9" },
  logo_url: null,
  website_url: null,
  instagram_handle: "sunlitskincare",
  ai_persona: null,
  primary_color: "#E8A87C",
  cta_phrase: "Shop now",
  brand_personality: null,
  content_pillars: ["product", "educational", "behind_scenes"],
  target_emotion: null,
  positioning: "The affordable clean-beauty brand that actually works for Indian skin and climate",
  vibe: "warm_cozy",
  onboarding_type: null,
  posting_frequency: null,
  target_platforms: ["instagram"],
  is_active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

type StageResult = { stage: string; ok: boolean; ms: number; detail: string }
const results: StageResult[] = []

async function runStage(stage: string, fn: () => Promise<string>): Promise<void> {
  const startedAt = Date.now()
  console.log(`[test-creative-stages] -> ${stage}`)
  try {
    const detail = await fn()
    const ms = Date.now() - startedAt
    console.log(`[test-creative-stages]    OK (${ms}ms): ${detail.slice(0, 200)}${detail.length > 200 ? "..." : ""}`)
    results.push({ stage, ok: true, ms, detail })
  } catch (err) {
    const ms = Date.now() - startedAt
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[test-creative-stages]    FAILED (${ms}ms): ${message}`)
    results.push({ stage, ok: false, ms, detail: message })
  }
}

async function main() {
  const { generateHooks } = await import("@/lib/ai/hooks-generator")
  await runStage("hooks (lib/ai/hooks-generator.ts)", async () => {
    const result = await generateHooks(TEST_BRAND, { count: 2 })
    return `model=${result.model} hooks=${JSON.stringify(result.hooks.map((h) => h.hook_text))}`
  })

  const { generateBlogPost } = await import("@/lib/ai/blog-generator")
  await runStage("blog (lib/ai/blog-generator.ts)", async () => {
    const result = await generateBlogPost(TEST_BRAND, {
      userPrompt: "5 reasons a simple skincare routine beats a 10-step one",
      wordLimit: 300,
    })
    return `model=${result.model} title=${JSON.stringify(result.post.title)}`
  })

  const { generateContent } = await import("@/lib/ai/content-generator")
  await runStage("reel_script (lib/ai/content-generator.ts)", async () => {
    const result = await generateContent(TEST_BRAND, "reel_script", {
      additionalContext: "A quick morning skincare routine reel",
    })
    const data = result.data as { hook: string }
    return `model=${result.model} hook=${JSON.stringify(data.hook)}`
  })

  await runStage("ad_copy (lib/ai/content-generator.ts)", async () => {
    const result = await generateContent(TEST_BRAND, "ad_copy", {
      additionalContext: "Promote our bestselling vitamin C serum",
    })
    const data = result.data as { headline: string }
    return `model=${result.model} headline=${JSON.stringify(data.headline)}`
  })

  const { requestImagePromptStream } = await import("@/lib/ai/image-prompt-writer")
  await runStage("prompt-authoring (lib/ai/image-prompt-writer.ts)", async () => {
    const stream = await requestImagePromptStream({
      flow: "post",
      rawInput: "A bottle of our vitamin C serum on a marble bathroom counter",
      brand: TEST_BRAND,
      constraints: { aspectRatioLabel: "4:5 portrait" },
    })
    let text = ""
    for await (const chunk of stream) {
      text += chunk.choices[0]?.delta?.content ?? ""
    }
    return `promptLen=${text.length} preview=${JSON.stringify(text.slice(0, 120))}`
  })

  const { analyzePhotoForPost } = await import("@/lib/ai/vision")
  await runStage("vision (lib/ai/vision.ts)", async () => {
    // A small solid-color PNG generated locally, base64-encoded as a data:
    // URL -- avoids depending on any external image host for this test.
    // OpenAI's vision input accepts a data: URL directly in image_url.url.
    const testImageBuffer = await sharp({
      create: { width: 512, height: 512, channels: 3, background: { r: 232, g: 168, b: 124 } },
    }).png().toBuffer()
    const dataUrl = `data:image/png;base64,${testImageBuffer.toString("base64")}`
    const result = await analyzePhotoForPost(TEST_BRAND, dataUrl, "A warm beige/orange product shot background")
    return `model=${result.model} hook=${JSON.stringify(result.hook.hook_text)}`
  })

  // ─── Phase 1b stages ──────────────────────────────────────────────────
  // Each lib function below logs its own provider/model/stage/latency/
  // success line (lib/ai/creative-completion.ts) in addition to this
  // script's per-stage timing.
  const { requestStorySequence } = await import("@/lib/ai/story-sequence-generator")
  await runStage("story (lib/ai/story-sequence-generator.ts)", async () => {
    const { raw, costUsd } = await requestStorySequence(TEST_BRAND, "Why a 3-step routine beats a 10-step one", 5, undefined, [])
    const data = JSON.parse(raw) as { stories?: { text?: string }[] }
    console.log(`[test-creative-stages]    story costUsd=${costUsd}`)
    if (!Array.isArray(data.stories) || data.stories.length === 0) throw new Error(`no stories in response: ${raw.slice(0, 200)}`)
    return `slides=${data.stories.length} texts=${JSON.stringify(data.stories.map((s) => s.text))}`
  })

  const { generateCarouselWithRetry } = await import("@/lib/ai/carousel-generator")
  await runStage("carousel (lib/ai/carousel-generator.ts)", async () => {
    const result = await generateCarouselWithRetry(TEST_BRAND, "Sunscreen myths Indian skin still believes", 7, "instagram", undefined, [])
    const data = result.data as { slides?: { headline?: string }[]; cover_hook?: string }
    console.log(`[test-creative-stages]    carousel costUsd=${result.costUsd}`)
    if (!Array.isArray(data.slides) || data.slides.length === 0) throw new Error("no slides in response")
    return `slides=${data.slides.length} cover_hook=${JSON.stringify(data.cover_hook)} headlines=${JSON.stringify(data.slides.map((s) => s.headline))}`
  })

  const { generateRepurposedContent } = await import("@/lib/ai/repurpose-generator")
  await runStage("repurpose (lib/ai/repurpose-generator.ts)", async () => {
    const { result: data, costUsd } = await generateRepurposedContent(
      "Most people over-exfoliate. Your skin barrier needs a few days to recover between acid treatments, and stacking actives every night is the fastest way to end up red, tight and breaking out. Two nights a week is plenty for most skin types.",
      TEST_BRAND
    )
    if (!data || !Array.isArray(data.hooks)) throw new Error("unparseable or malformed response")
    return `costUsd=${costUsd} hooks=${JSON.stringify(data.hooks)} tweets=${data.tweets?.length ?? 0} linkedinChars=${data.linkedin?.length ?? 0}`
  })

  const { generateOccasionContent } = await import("@/lib/ai/occasion-content-generator")
  await runStage("occasion-content (lib/ai/occasion-content-generator.ts)", async () => {
    const { content: data, costUsd } = await generateOccasionContent(TEST_BRAND, "Diwali", "Festive glow without harsh products")
    if (!data.hook && !data.caption) throw new Error("empty content")
    return `costUsd=${costUsd} hook=${JSON.stringify(data.hook)} caption=${JSON.stringify(data.caption)}`
  })

  // story/carousel through the shared content-generator path (Full Post,
  // Content tab, calendar regenerate) -- a different, shorter prompt than
  // the dedicated routes above.
  await runStage("story format (lib/ai/content-generator.ts)", async () => {
    const result = await generateContent(TEST_BRAND, "story", { additionalContext: "Launch of our new vitamin C serum" })
    return `model=${result.model} text=${JSON.stringify((result.data as { text: string }).text)}`
  })

  await runStage("carousel format (lib/ai/content-generator.ts)", async () => {
    const result = await generateContent(TEST_BRAND, "carousel", { additionalContext: "3 signs your moisturizer isn't working" })
    return `model=${result.model} slides=${(result.data as { slides: unknown[] }).slides.length}`
  })

  // Autopilot's strategy preview -- the one fastlane.ts text call that's
  // exported and has no database dependency. (generateContentStrategy
  // reads occasions from the database and generateSlotContent is private;
  // both go through the same createCreativeCompletion helper.)
  const { generateStrategyOverview } = await import("@/lib/ai/fastlane")
  await runStage("autopilot strategy overview (lib/ai/fastlane.ts)", async () => {
    const result = await generateStrategyOverview(TEST_BRAND)
    return `goal=${JSON.stringify(result.goal)} weeks=${JSON.stringify(result.week_themes)}`
  })

  console.log("\n[test-creative-stages] summary:")
  for (const r of results) {
    console.log(`  ${r.ok ? "OK  " : "FAIL"}  (${r.ms}ms)  ${r.stage}`)
  }

  const failures = results.filter((r) => !r.ok).length
  if (failures > 0) {
    console.error(`\n[test-creative-stages] ${failures}/${results.length} stage(s) failed -- see errors above.`)
    process.exit(1)
  }
  console.log(`\n[test-creative-stages] all ${results.length} stages succeeded. Latencies above are the real measurement this migration's timeouts were estimated without -- revisit each stage's timeout/reasoning_effort against these numbers.`)
}

main().catch((err) => {
  console.error("[test-creative-stages] unexpected error:", err)
  process.exit(1)
})
