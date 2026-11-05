import { MODELS } from "./models"
import { createTextCompletion } from "./provider-fallback"
import { buildBrandContext } from "./prompts"
import { textCostUsd, toTextUsage } from "./pricing"
import type { BrandRow } from "@/types/database"
import { sanitizeHighlight, sanitizeKicker } from "@/lib/design/text-layouts"
import { sanitizeTextForCompositing } from "@/lib/image/sanitize-text-for-compositing"

/**
 * "Make it better" when the critic's fix is about the words on the image or
 * their layout (fix_target "layout_text", lib/ai/critic.ts): one short text
 * call that applies the fix to the overlay headline / kicker / highlight
 * only. The photo is kept and re-composited on the client -- no image call.
 * Never throws: null when the call fails, and the caller keeps its text.
 */

export interface OverlayText {
  headline: string
  kicker: string | null
  highlight: string | null
}

const MAX_HEADLINE_WORDS = 12

export async function applyFixToOverlayText(brand: BrandRow, input: OverlayText & { fix: string; hook: string; caption: string }): Promise<(OverlayText & { costUsd: number | null }) | null> {
  try {
    const { response: res, model } = await createTextCompletion(
      {
        model: MODELS.creative,
        // A few words, judged against one instruction -- short thinking.
        reasoning_effort: "low",
        max_completion_tokens: 800,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You edit the words printed ON an Instagram post image for an Indian D2C brand. Apply the art director's fix to these words only -- the photo stays as it is. Keep the same message, use only facts already in the headline, hook or caption, and never invent a claim, number or offer.

${buildBrandContext(brand)}

Respond with valid JSON only, no markdown:
{"headline": "max ${MAX_HEADLINE_WORDS} words", "kicker": "max 4 words above the headline, or null", "highlight": "1-4 words copied exactly from the headline, or null"}`,
          },
          {
            role: "user",
            content: `Fix: ${input.fix}\nHeadline: ${input.headline}\nKicker: ${input.kicker ?? "(none)"}\nHighlight: ${input.highlight ?? "(none)"}\nHook: ${input.hook}\nCaption: ${input.caption.slice(0, 1200)}`,
          },
        ],
      },
      { stage: "overlay_text_fix", timeout: 20_000 },
    )
    const data = JSON.parse(res.choices[0]?.message?.content ?? "{}") as { headline?: unknown; kicker?: unknown; highlight?: unknown }
    const headline = typeof data.headline === "string"
      ? sanitizeTextForCompositing(data.headline.replace(/["“”]/g, "").replace(/\s+/g, " ").trim()).split(" ").slice(0, MAX_HEADLINE_WORDS).join(" ")
      : ""
    if (!headline) return null
    return {
      headline,
      kicker: sanitizeKicker(data.kicker),
      highlight: sanitizeHighlight(data.highlight, headline),
      costUsd: textCostUsd(model, toTextUsage(res.usage)),
    }
  } catch (err) {
    console.error("[overlay-text-fix] couldn't apply the fix (keeping the words):", err instanceof Error ? err.message : err)
    return null
  }
}
