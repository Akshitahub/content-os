// Dev-only sanity check for the OpenAI gpt-image-2 migration
// (lib/ai/image-provider.ts) -- generates one product image, one story
// background, and one text-heavy post image, and saves all three as local
// PNG files for a human to eyeball. Run manually: `npx tsx
// scripts/test-image-gen.ts`.
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
import { generateOpenAIImage, type ImageDimensions } from "@/lib/ai/image-provider"

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

async function main() {
  const outDir = join(process.cwd(), "scripts", "output")
  mkdirSync(outDir, { recursive: true })

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
