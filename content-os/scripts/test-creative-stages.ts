// Dev-only sanity check for the Phase 1 Groq -> OpenAI creative-stages
// migration (hooks, blog, reel_script, ad_copy, prompt-authoring, vision).
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
