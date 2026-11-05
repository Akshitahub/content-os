import { existsSync, readFileSync, readdirSync } from "fs"
import { join } from "path"
import { MODELS, getTextClientFor, visionReasoning } from "./models"
import { VISION_MAX_IMAGES, visionImageUrl } from "./vision-image"
import { buildBrandContext } from "./prompts"
import { textCostUsd, toTextUsage } from "./pricing"
import type { BrandRow } from "@/types/database"
import { CRITIC_CRITERIA, CRITIC_HARD_FAIL, CRITIC_PASS, criticOverall, withCurrentCriterionIds, type CriticCriterionId, type CriticFixTarget, type CriticScores } from "@/lib/design/critic-scores"
import type { TextLayoutId } from "@/lib/design/text-layouts"
import { inSceneTextMatches } from "./in-scene-text"

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
  /** What top_fix changes: the photograph, or only the words on it and their layout. */
  fix_target: CriticFixTarget
  /** With intendedText: the text the critic can read in the image ("" = none). */
  image_text: string | null
  model: string
  costUsd: number | null
}

export interface CriticInput {
  /** The finished image as posted -- an https URL or a data: URL. */
  imageUrl: string
  caption: string
  hook: string
  format: "post" | "carousel" | "story"
  /** What the brand's own results say works (top performance lessons) -- context, never a score of its own. */
  resultsLessons?: string[]
  /** The text layout drawn on the image, when known (split_panel / bottom_card add a solid text panel). */
  textLayout?: TextLayoutId | null
  /** Words the concept deliberately put in the scene (lib/ai/in-scene-text.ts). */
  intendedText?: string | null
}

/** Layouts that put a solid text panel beside / below the one photo -- by design, not a collage. */
const PANEL_LAYOUTS = new Set<TextLayoutId>(["split_panel", "bottom_card"])

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
      // Older calibration files may still score a retired criterion (real_indian).
      refs.push({ imageUrl, caption: raw.caption ?? "", hook: raw.hook ?? "", scores: withCurrentCriterionIds(raw.scores), note: raw.note })
    }
    return refs
  } catch (err) {
    console.error("[critic] couldn't read the reference posts (scoring without them):", err instanceof Error ? err.message : err)
    return []
  }
}

/** The system prompt -- exported for scripts/test-critic.ts. */
export function buildCriticPrompt(brand: BrandRow, format: CriticInput["format"], textLayout?: TextLayoutId | null, intendedText?: string | null): string {
  const criteria = CRITIC_CRITERIA.map((c) => `- "${c.id}" (${c.label}): ${c.ask}`).join("\n")
  return `You are a demanding Instagram creative director for Indian D2C brands, scoring a finished ${format} before it goes out. Judge the IMAGE exactly as shown together with its hook and caption. Be honest and specific: an ordinary post is a 5 or 6, an 8 is genuinely good, a 10 is rare.

${buildBrandContext(brand)}

Score each criterion 1-10 with ONE short reason (max 15 words) about THIS post:
${criteria}

Also "single_photo": judge the PHOTOGRAPH only -- the post's own design (its type, a solid brand-colour panel or band beside or above the photo, the logo) is not a panel. false if the photograph itself is a collage, a grid, several photos side by side, or shows the same person more than once (a deliberate two-half comparison with different subjects is fine) -- otherwise true.${textLayout && PANEL_LAYOUTS.has(textLayout) ? "\nThis post's design deliberately places a solid text panel beside/below ONE photograph. Judge single_photo on the photograph area only. The text panel is our deliberate design: don't count it against craft or single_photo." : ""}

${intendedText ? `This post's photograph deliberately carries the words "${intendedText}" on a real object in the scene: judge them as part of the design, not as unwanted text on the image. Also "image_text": exactly the words you can read in the image, as written ("" if none).

` : ""}Then "top_fix": the single change that would raise the score most, as one plain instruction (max 20 words) -- e.g. "Use a photo of the chinos being worn; the flat studio shot doesn't match the street-style caption".

And "fix_target": "layout_text" when top_fix only changes the words printed on the image or how they sit (wording, length, size, position, the text panel, contrast of the type) and the photograph can stay; "image" when the photograph itself must change.

Respond with valid JSON only, no markdown:
{"scores": {${CRITIC_CRITERIA.map((c) => `"${c.id}": {"score": 1-10, "reason": "..."}`).join(", ")}}, "single_photo": true, ${intendedText ? `"image_text": "...", ` : ""}"top_fix": "...", "fix_target": "image"}`
}

const clampScore = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.max(1, Math.min(10, Math.round(n))) : null)

/**
 * The model's JSON -> scores, or null if any criterion is missing. Exported
 * for scripts/test-critic.ts. model_top_fix / model_fix_target are the
 * model's own, kept for when critiquePost ignores a single_photo=false.
 */
export function parseCriticResponse(raw: string): { scores: CriticScores; top_fix: string; fix_target: CriticFixTarget; single_photo: boolean; model_top_fix: string; model_fix_target: CriticFixTarget; image_text: string | null } | null {
  try {
    const data = JSON.parse(raw.replace(/```json\n?|```\n?/g, "").trim()) as { scores?: Record<string, { score?: unknown; reason?: unknown }>; top_fix?: unknown; fix_target?: unknown; single_photo?: unknown; image_text?: unknown }
    const scores = {} as CriticScores
    for (const c of CRITIC_CRITERIA) {
      const entry = data.scores?.[c.id]
      const score = clampScore(entry?.score)
      if (score == null) return null
      scores[c.id] = { score, reason: typeof entry?.reason === "string" ? entry.reason.trim().slice(0, 160) : "" }
    }
    const topFix = typeof data.top_fix === "string" ? data.top_fix.trim().slice(0, 200) : ""
    // Anything but an explicit "layout_text" is an image fix (today's path).
    const fixTarget: CriticFixTarget = data.fix_target === "layout_text" ? "layout_text" : "image"
    const imageText = typeof data.image_text === "string" ? data.image_text.trim().slice(0, 200) : null
    // Only an explicit false fails -- a missing field doesn't.
    const singlePhoto = data.single_photo !== false
    if (!singlePhoto) {
      return { scores, single_photo: false, top_fix: "Use one single photograph of one moment -- this image repeats the same person or is split into panels.", fix_target: "image", model_top_fix: topFix, model_fix_target: fixTarget, image_text: imageText }
    }
    return { scores, single_photo: true, top_fix: topFix || lowestReason(scores), fix_target: fixTarget, model_top_fix: topFix, model_fix_target: fixTarget, image_text: imageText }
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
  if (!process.env.GROQ_API_KEY) return null
  const startedAt = Date.now()
  try {
    // Groq vision takes at most 3 images: up to 2 calibration posts + this one.
    const refs = loadReferencePosts().slice(0, VISION_MAX_IMAGES - 1)
    const refImages = await Promise.all(refs.map((r) => visionImageUrl(r.imageUrl)))
    const postImage = await visionImageUrl(input.imageUrl)
    const refContent = refs.flatMap((r, i) => [
      { type: "text" as const, text: `Calibration example ${i + 1} (scored by our team${r.note ? ` -- ${r.note}` : ""}): hook "${r.hook}", caption "${r.caption.slice(0, 300)}", scores ${JSON.stringify(r.scores)}` },
      { type: "image_url" as const, image_url: { url: refImages[i]! } },
    ])
    const res = await getTextClientFor(MODELS.vision).chat.completions.create({
      model: MODELS.vision,
      // Short hidden thinking for the judgement; the cap leaves room for it.
      max_completion_tokens: 2000,
      ...visionReasoning("low"),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildCriticPrompt(brand, input.format, input.textLayout, input.intendedText) },
        {
          role: "user",
          content: [
            ...refContent,
            { type: "text", text: `${refs.length ? "Now score THIS post.\n" : ""}${input.resultsLessons?.length ? `What this brand's own past results say (context for your top_fix, not a score):\n${input.resultsLessons.map((l) => `- ${l}`).join("\n")}\n` : ""}Hook: ${input.hook}\nCaption: ${input.caption.slice(0, 1500)}` },
            { type: "image_url", image_url: { url: postImage } },
          ],
        },
      ],
    }, { timeout: 40_000, maxRetries: 1 })
    const parsed = parseCriticResponse(res.choices[0]?.message?.content ?? "")
    if (!parsed) {
      console.error(`[critic] ${label}: unreadable response (scoring skipped)`)
      return null
    }
    // A collage / repeated subject is a hard fail, whatever else scored well
    // -- except on our own split_panel / bottom_card, where single_photo is
    // ignored entirely (the model reads our text panel as a second panel)
    // and the model's own fix is used.
    const ownPanel = !!input.textLayout && PANEL_LAYOUTS.has(input.textLayout)
    const hardFail = !parsed.single_photo && !ownPanel
    if (!parsed.single_photo && ownPanel) console.log(`[critic] ${label}: single_photo ignored on ${input.textLayout}`)
    const overall = hardFail ? Math.min(criticOverall(parsed.scores), CRITIC_HARD_FAIL) : criticOverall(parsed.scores)
    let topFix = parsed.single_photo || hardFail ? parsed.top_fix : parsed.model_top_fix || lowestReason(parsed.scores)
    let fixTarget = parsed.single_photo || hardFail ? parsed.fix_target : parsed.model_fix_target
    // The concept's words came out wrong: never regenerated automatically
    // (one image per item) -- it's the fix the user can choose to make.
    if (input.intendedText && parsed.image_text !== null && !inSceneTextMatches(input.intendedText, parsed.image_text)) {
      console.log(`[creative-concept] in-scene text mismatch (${label})`)
      topFix = `Text in the image reads '${parsed.image_text || "nothing legible"}'`
      fixTarget = "image"
    }
    const usage = toTextUsage(res.usage)
    console.log(`[critic] ${label}: overall=${overall} latencyMs=${Date.now() - startedAt}`)
    return { scores: parsed.scores, overall, passed: overall >= CRITIC_PASS, top_fix: topFix, fix_target: fixTarget, image_text: parsed.image_text, model: MODELS.vision, costUsd: textCostUsd(MODELS.vision, usage) }
  } catch (err) {
    console.error(`[critic] ${label}: couldn't score (behaving as before):`, err instanceof Error ? err.message : err)
    return null
  }
}
