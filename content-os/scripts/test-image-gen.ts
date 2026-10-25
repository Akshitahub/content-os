// Dev-only sanity check for the OpenAI gpt-image-2 migration
// (lib/ai/image-provider.ts) -- generates one product image, one story
// background, and one text-heavy post image, and saves all three as local
// PNG files for a human to eyeball. Run manually: `npx tsx
// scripts/test-image-gen.ts`.
//
// No-crop portrait check: also generates one 4:5 post and one 9:16 story at
// the exact-ratio native sizes in IMAGE_PROVIDER_CONFIG.sizes, and saves
// each twice -- the raw native image, and the final canvas exactly as the
// app produces it (the post composited with on-image text by
// compositePostImage; the story scaled to 1080x1920 the way
// story-compositor.ts does) -- so cropping and text placement can be
// eyeballed side by side. `--sizes-only` runs just these two generations.
// Every configured size is also checked offline against gpt-image-2's size
// rules (isValidImageSize) before anything is generated.
//
// NOT reachable in production: this is a standalone script, not an API
// route or page -- Next.js never serves anything under scripts/ to a
// browser. The NODE_ENV guard below is defense-in-depth only, in case
// this is ever accidentally invoked from a production process (e.g. a
// misconfigured build/start script) rather than a developer's own
// terminal.
import { writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { readFileSync, existsSync } from "fs"
import sharp from "sharp"
import { generateOpenAIImage, isValidImageSize, resolveImageSize, IMAGE_PROVIDER_CONFIG, type ImageDimensions } from "@/lib/ai/image-provider"
import { compositePostImage } from "@/lib/image/post-compositor"
import { resolveColorThemes } from "@/lib/design/color-themes"
import { DEFAULT_POST_TEMPLATE_ID } from "@/lib/design/post-templates"

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
  console.error("[test-image-gen] refusing to run with NODE_ENV=production -- this is a dev-only sanity check.")
  process.exit(1)
}

// Offline: every configured native size must pass gpt-image-2's size rules.
function checkConfiguredSizes(): boolean {
  let ok = true
  for (const [name, size] of Object.entries(IMAGE_PROVIDER_CONFIG.sizes)) {
    const valid = isValidImageSize(size)
    if (!valid) ok = false
    console.log(`[test-image-gen] size ${name.padEnd(9)} ${size.padEnd(10)} ${valid ? "valid" : "INVALID for gpt-image-2"}`)
  }
  return ok
}

// One 4:5 post and one 9:16 story at the new exact-ratio sizes: saves the
// raw native image and the final canvas the app would produce from it.
async function runNoCropCases(outDir: string): Promise<{ label: string; ok: boolean; detail: string; ms: number }[]> {
  const results: { label: string; ok: boolean; detail: string; ms: number }[] = []
  const cases = [
    {
      label: "4:5 post, no crop (composited with on-image text)",
      prompt: "a single amber glass serum bottle with a brass dropper on a sunlit bathroom shelf, soft morning light, fresh green plant leaves at the top and bottom edges of the frame, no people, no text, no logos",
      canvas: { width: 1080, height: 1350, aspectRatio: "4:5" } satisfies ImageDimensions,
      prefix: "nocrop-post-4x5",
    },
    {
      label: "9:16 story, no crop",
      prompt: "a tall vertical shot of a sunlit bathroom shelf with an amber serum bottle in the middle, a green plant at the very top of the frame and a woven basket at the very bottom, soft morning light, no people, no text, no logos",
      canvas: { width: 1080, height: 1920, aspectRatio: "9:16" } satisfies ImageDimensions,
      prefix: "nocrop-story-9x16",
    },
  ]
  for (const c of cases) {
    const startedAt = Date.now()
    console.log(`[test-image-gen] -> ${c.label} (requesting ${resolveImageSize(c.canvas)})`)
    const result = await generateOpenAIImage(c.prompt, c.canvas)
    const ms = Date.now() - startedAt
    if ("error" in result) {
      console.error(`[test-image-gen]    FAILED (${result.reason}): ${result.error}`)
      results.push({ label: c.label, ok: false, detail: `${result.reason}: ${result.error}`, ms })
      continue
    }
    const meta = await sharp(result.buffer).metadata()
    const nativePath = join(outDir, `${c.prefix}-native.png`)
    writeFileSync(nativePath, result.buffer)

    const finalBuffer = c.canvas.height === 1350
      ? await compositePostImage(result.buffer, {
          template: DEFAULT_POST_TEMPLATE_ID,
          colorTheme: resolveColorThemes({ primary_color: "#E8A87C", color_palette: {} })[0]!,
          captionText: "Your skin, but brighter",
          logoUrl: null,
        })
      : await sharp(result.buffer).resize(c.canvas.width, c.canvas.height, { fit: "cover" }).png().toBuffer()
    const finalMeta = await sharp(finalBuffer).metadata()
    const finalPath = join(outDir, `${c.prefix}-final.png`)
    writeFileSync(finalPath, finalBuffer)

    const nativeRatio = (meta.width ?? 0) / (meta.height ?? 1)
    const canvasRatio = c.canvas.width / c.canvas.height
    const cropPct = Math.max(0, (1 - Math.min(nativeRatio, canvasRatio) / Math.max(nativeRatio, canvasRatio)) * 100)
    console.log(`[test-image-gen]    OK -- native ${meta.width}x${meta.height}, final ${finalMeta.width}x${finalMeta.height}, cropped ${cropPct.toFixed(1)}%, costUsd=${result.costUsd ?? "unknown"}`)
    console.log(`[test-image-gen]       ${nativePath}\n[test-image-gen]       ${finalPath}`)
    results.push({ label: c.label, ok: true, detail: `${meta.width}x${meta.height} -> ${finalPath}`, ms })
  }
  return results
}

async function main() {
  const outDir = join(process.cwd(), "scripts", "output")
  mkdirSync(outDir, { recursive: true })

  if (!checkConfiguredSizes()) {
    console.error("[test-image-gen] a configured size breaks gpt-image-2's size rules -- fix IMAGE_PROVIDER_CONFIG.sizes before generating.")
    process.exit(1)
  }

  if (process.argv.includes("--sizes-only")) {
    const results = await runNoCropCases(outDir)
    const failed = results.filter((r) => !r.ok).length
    if (failed > 0) process.exit(1)
    console.log(`\n[test-image-gen] no-crop check done -- open the *-native.png / *-final.png pairs in ${outDir}.`)
    return
  }

  const cases: { label: string; prompt: string; dimensions: ImageDimensions; filename: string }[] = [
    {
      label: "product image (1:1 square)",
      prompt:
        "three amber glass skincare serum bottles with brass pump lids, arranged on a white marble surface, soft diffused studio lighting, minimal clean beauty-brand aesthetic, shallow depth of field, no people, no text, no logos",
      dimensions: { width: 1024, height: 1024, aspectRatio: "1:1" },
      filename: "product-image.png",
    },
    {
      label: "story background (9:16 portrait)",
      prompt:
        "abstract atmospheric vertical gradient background, warm golden-hour amber and coral tones blending softly, calm uncluttered composition with the vertical center kept simple for a text overlay, no people, no text, no words, no letters",
      dimensions: { width: 1080, height: 1920, aspectRatio: "9:16" },
      filename: "story-background.png",
    },
    {
      label: "text-heavy post image (4:5 portrait) -- tests gpt-image-2's text rendering",
      prompt:
        "a clean minimalist motivational quote card on a soft cream paper background, bold modern sans-serif typography in dark charcoal ink reading exactly the words \"START TODAY\" centered in the frame, a thin accent line beneath the text, no photographic elements, no people, no logos, no watermarks",
      dimensions: { width: 1080, height: 1350, aspectRatio: "4:5" },
      filename: "text-heavy-post.png",
    },
  ]

  console.log(`[test-image-gen] running ${cases.length} test generations, saving to ${outDir}\n`)

  const results: { label: string; ok: boolean; detail: string; ms: number }[] = []

  results.push(...(await runNoCropCases(outDir)))

  for (const testCase of cases) {
    const startedAt = Date.now()
    console.log(`[test-image-gen] -> ${testCase.label}`)
    const result = await generateOpenAIImage(testCase.prompt, testCase.dimensions)
    const ms = Date.now() - startedAt

    if ("error" in result) {
      console.error(`[test-image-gen]    FAILED (${result.reason}): ${result.error}`)
      results.push({ label: testCase.label, ok: false, detail: `${result.reason}: ${result.error}`, ms })
      continue
    }

    const outPath = join(outDir, testCase.filename)
    writeFileSync(outPath, result.buffer)
    console.log(`[test-image-gen]    OK -- ${result.buffer.length} bytes -> ${outPath}`)
    results.push({ label: testCase.label, ok: true, detail: outPath, ms })
  }

  console.log("\n[test-image-gen] summary:")
  for (const r of results) {
    console.log(`  ${r.ok ? "OK  " : "FAIL"}  (${r.ms}ms)  ${r.label} -- ${r.detail}`)
  }

  const failures = results.filter((r) => !r.ok).length
  if (failures > 0) {
    console.error(`\n[test-image-gen] ${failures}/${results.length} generation(s) failed -- see errors above.`)
    process.exit(1)
  }
  console.log(`\n[test-image-gen] all ${results.length} generations succeeded -- open the files in ${outDir} to eyeball them.`)
}

main().catch((err) => {
  console.error("[test-image-gen] unexpected error:", err)
  process.exit(1)
})
