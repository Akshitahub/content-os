// Dev-only: does generated content stay on the user's topic? Runs 6 real
// topics (a sale, a launch, a festival, an educational tip, a founder story,
// a customer review) through the story generator exactly as the stories
// route does -- requestStorySequence with the quality gate's off_topic check,
// one regeneration if still off topic (onTopicOrRegenerate), one if short
// (regenerateIfShort) -- and prints every frame's kicker / headline / subtext
// plus the gate's verdict. Real model calls; nothing is written to the DB.
//
//   npx tsx scripts/test-topic-adherence.ts --brand <brandId> [--brand <brandId>] [--count 3]
import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
import type { BrandRow } from "@/types/database"

function loadEnvLocal(): void {
  const envPath = join(process.cwd(), ".env.local")
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
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
  console.error("[test-topic-adherence] refusing to run with NODE_ENV=production -- dev only.")
  process.exit(1)
}

const brandIds = process.argv.flatMap((a, i) => (a === "--brand" ? [process.argv[i + 1]!] : [])).filter(Boolean)
const countArg = process.argv.indexOf("--count")
const storyCount = countArg !== -1 ? Number(process.argv[countArg + 1]) : 3
if (!brandIds.length) {
  console.error("usage: npx tsx scripts/test-topic-adherence.ts --brand <brandId> [--brand <brandId>] [--count 3]")
  process.exit(1)
}

// One per category; the {brand} placeholder becomes the brand's name.
const TOPICS: { category: string; topic: string }[] = [
  { category: "sale", topic: "{brand} birthday sale: up to 50% off this weekend" },
  { category: "launch", topic: "Launching our new monsoon collection" },
  { category: "festival", topic: "Diwali gifting ideas from {brand}" },
  { category: "educational tip", topic: "How to care for your clothes so they last longer" },
  { category: "founder story", topic: "Why we started {brand}: the founder's story" },
  { category: "customer review", topic: "A customer review: what Priya loved about her order" },
]

async function main() {
  const { requestStorySequence } = await import("@/lib/ai/story-sequence-generator")
  const { onTopicOrRegenerate, OffTopicError } = await import("@/lib/ai/quality-gate")
  const { regenerateIfShort, ShortGenerationError } = await import("@/lib/ai/generation-retry")
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

  const summary: string[] = []
  for (const brandId of brandIds) {
    const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).single<BrandRow>()
    if (!brand) throw new Error(`brand ${brandId} not found`)
    console.log(`\n=== ${brand.name} (${brand.niche || "no niche"}) ===`)
    for (const { category, topic: template } of TOPICS) {
      const topic = template.replace(/\{brand\}/g, brand.name)
      const deadline = Date.now() + 120_000
      try {
        const gen = await regenerateIfShort(
          () => onTopicOrRegenerate(topic, () => requestStorySequence(brand, topic, storyCount, undefined, [], [], deadline)),
          (g) => {
            try { return (JSON.parse(g.raw) as { stories?: unknown[] }).stories?.length ?? 0 } catch { return 0 }
          },
          storyCount,
          "stories",
        )
        const stories = (JSON.parse(gen.raw) as { stories: { type?: string; kicker?: string; text?: string; subtext?: string }[] }).stories
        const gate = gen.gate
        console.log(`\n[${category}] "${topic}"  -- gate: ${gate ? (gate.skipped ? "skipped" : `${gate.issues.filter((i) => i.check === "off_topic").length} off_topic found, repaired: ${gate.repaired}, still off: ${gate.offTopic.length}`) : "n/a"}`)
        for (const s of stories) console.log(`  ${(s.type ?? "?").padEnd(7)} ${s.kicker ? `[${s.kicker}] ` : ""}${s.text ?? ""}${s.subtext ? `  /  ${s.subtext}` : ""}`)
        summary.push(`${brand.name} | ${category} | ${stories.length}/${storyCount} frames | ${stories[0]?.text ?? ""}`)
      } catch (err) {
        const label = err instanceof OffTopicError ? "OFF TOPIC (failed loudly)" : err instanceof ShortGenerationError ? "SHORT (failed loudly)" : `ERROR: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`
        console.log(`\n[${category}] "${topic}"  -- ${label}`)
        summary.push(`${brand.name} | ${category} | ${label}`)
      }
    }
  }
  console.log(`\n--- summary ---\n${summary.join("\n")}`)
}

main().catch((err) => {
  console.error("[test-topic-adherence] failed:", err)
  process.exit(1)
})
