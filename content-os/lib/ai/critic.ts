import { existsSync, readFileSync, readdirSync } from "fs"
import { join } from "path"
import { MODELS, getOpenAIClient } from "./models"
import { buildBrandContext } from "./prompts"
import { textCostUsd, toTextUsage } from "./pricing"
import type { BrandRow } from "@/types/database"
import { CRITIC_CRITERIA, CRITIC_PASS, criticOverall, type CriticCriterionId, type CriticScores } from "@/lib/design/critic-scores"

/**
 * The critic (one vision call): scores a finished post -- the rendered image
 * plus its caption and hook -- 1-10 on each of CRITIC_CRITERIA with a
 * one-line reason, and names the single fix that would lift it most. The
 * overall is the weighted average (lib/design/critic-scores.ts), capped at 6
 * when "image and copy agree" or "craft" fails. Autopilot keeps the best of
 * its candidates and flags a post below CRITIC_PASS for approval; the
 * manual tools show the score with a "Make it better" button.
 *
 * Calibration: up to 3 human-scored examples from scripts/reference-posts/
 * (see its README) go in with every call. Never throws -- null when the
 * call can't be made (no key, no credits, an error), and callers then
 * behave exactly as they did without a critic.
 */

export interface CriticResult {
  scores: CriticScores
  overall: number
  passed: boolean
  /** The one change that would lift the score most. */
  top_fix: string
  model: string
  costUsd: number | null
}

export interface CriticInput {
  /** The finished image as posted -- an https URL or a data: URL. */
  imageUrl: string
  caption: string
  hook: string
  format: "post" | "carousel" | "story"
}

interface ReferencePost { imageUrl: string; caption: string; hook: string; scores: Partial<Record<CriticCriterionId, number>>; note?: string }

const REFERENCE_DIR = join(process.cwd(), "scripts/reference-posts")
const MAX_REFERENCES = 3

/** Up to 3 calibration examples: <name>.json ({ image, caption, hook, scores, note }) next to its image. */
export function loadReferencePosts(dir = REFERENCE_DIR): ReferencePost[] {
  try {
    if (!existsSync(dir)) return []
    const refs: ReferencePost[] = []
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
      if (refs.length >= MAX_REFERENCES) break
      const raw = JSON.parse(readFileSync(join(dir, file), "utf-8")) as { image?: string; caption?: string; hook?: string; scores?: Record<string, number>; note?: string }
      if (!raw.image || !raw.scores) continue
      const imageUrl = /^https?:\/\//.test(raw.image)
        ? raw.image
        : `data:image/${raw.image.toLowerCase().endsWith(".png") ? "png" : "jpeg"};base64,${readFileSync(join(dir, raw.image)).toString("base64")}`
      refs.push({ imageUrl, caption: raw.caption ?? "", hook: raw.hook ?? "", scores: raw.scores as ReferencePost["scores"], note: raw.note })
    }
    return refs
  } catch (err) {
    console.error("[critic] couldn't read the reference posts (scoring without them):", err instanceof Error ? err.message : err)
    return []
  }
}

/** The system prompt -- exported for scripts/test-critic.ts. */
export function buildCriticPrompt(brand: BrandRow, format: CriticInput["format"]): string {
  const criteria = CRITIC_CRITERIA.map((c) => `- "${c.id}" (${c.label}): ${c.ask}`).join("\n")
  return `You are a demanding Instagram creative director for Indian D2C brands, scoring a finished ${format} before it goes out. Judge the IMAGE exactly as shown together with its hook and caption. Be honest and specific: an ordinary post is a 5 or 6, an 8 is genuinely good, a 10 is rare.

${buildBrandContext(brand)}

Score each criterion 1-10 with ONE short reason (max 15 words) about THIS post:
${criteria}

Then "top_fix": the single change that would raise the score most, as one plain instruction (max 20 words) -- e.g. "Use a photo of the chinos being worn; the flat studio shot doesn't match the street-style caption".

Respond with valid JSON only, no markdown:
{"scores": {${CRITIC_CRITERIA.map((c) => `"${c.id}": {"score": 1-10, "reason": "..."}`).join(", ")}}, "top_fix": "..."}`
}

const clampScore = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.max(1, Math.min(10, Math.round(n))) : null)

/** The model's JSON -> scores, or null if any criterion is missing. Exported for scripts/test-critic.ts. */
export function parseCriticResponse(raw: string): { scores: CriticScores; top_fix: string } | null {
  try {
    const data = JSON.parse(raw.replace(/```json\n?|```\n?/g, "").trim()) as { scores?: Record<string, { score?: unknown; reason?: unknown }>; top_fix?: unknown }
    const scores = {} as CriticScores
    for (const c of CRITIC_CRITERIA) {
      const entry = data.scores?.[c.id]
      const score = clampScore(entry?.score)
      if (score == null) return null
      scores[c.id] = { score, reason: typeof entry?.reason === "string" ? entry.reason.trim().slice(0, 160) : "" }
    }
    const topFix = typeof data.top_fix === "string" ? data.top_fix.trim().slice(0, 200) : ""
    return { scores, top_fix: topFix || lowestReason(scores) }
  } catch {
    return null
  }
}

/** With no top_fix, the weakest criterion's reason is the fix. */
function lowestReason(scores: CriticScores): string {
  const worst = CRITIC_CRITERIA.reduce((a, b) => (scores[b.id].score < scores[a.id].score ? b : a))
  return `${worst.label}: ${scores[worst.id].reason}`
}

export async function critiquePost(brand: BrandRow, input: CriticInput, label: string): Promise<CriticResult | null> {
  if (!process.env.OPENAI_API_KEY) return null
  const startedAt = Date.now()
  try {
    const refs = loadReferencePosts()
    const refContent = refs.flatMap((r, i) => [
      { type: "text" as const, text: `Calibration example ${i + 1} (scored by our team${r.note ? ` -- ${r.note}` : ""}): hook "${r.hook}", caption "${r.caption.slice(0, 300)}", scores ${JSON.stringify(r.scores)}` },
      { type: "image_url" as const, image_url: { url: r.imageUrl } },
    ])
    const res = await getOpenAIClient().chat.completions.create({
      model: MODELS.vision,
      max_completion_tokens: 900,
      reasoning_effort: "low",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildCriticPrompt(brand, input.format) },
        {
          role: "user",
          content: [
            ...refContent,
            { type: "text", text: `${refs.length ? "Now score THIS post.\n" : ""}Hook: ${input.hook}\nCaption: ${input.caption.slice(0, 1500)}` },
            { type: "image_url", image_url: { url: input.imageUrl } },
          ],
        },
      ],
    }, { timeout: 40_000, maxRetries: 1 })
    const parsed = parseCriticResponse(res.choices[0]?.message?.content ?? "")
    if (!parsed) {
      console.error(`[critic] ${label}: unreadable response (scoring skipped)`)
      return null
    }
    const overall = criticOverall(parsed.scores)
    const usage = toTextUsage(res.usage)
    console.log(`[critic] ${label}: overall=${overall} latencyMs=${Date.now() - startedAt}`)
    return { scores: parsed.scores, overall, passed: overall >= CRITIC_PASS, top_fix: parsed.top_fix, model: MODELS.vision, costUsd: textCostUsd(MODELS.vision, usage) }
  } catch (err) {
    console.error(`[critic] ${label}: couldn't score (behaving as before):`, err instanceof Error ? err.message : err)
    return null
  }
}
