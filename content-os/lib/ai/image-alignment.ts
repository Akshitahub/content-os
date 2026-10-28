import { after } from "next/server"
import { MODELS, getOpenAIClient } from "./models"
import { textCostUsd, toTextUsage, type TextUsage } from "./pricing"
import { briefScene, type VisualBrief } from "./visual-brief"
import { insertContentEvents, type ContentEventType } from "@/lib/usage/content-events"

// Image alignment, measured not enforced (spec §8): does a generated image
// show what its visual brief asked for? One MODELS.vision call, scored 1-5.
// In the app this runs on a sample (QUALITY_VISION_SAMPLE_RATE, default
// 0.25) after the response is sent and only records a "quality_checked"
// content event -- it never blocks, retries or alters an image.

export type AlignmentResult = { score: number; reason: string; usage: TextUsage | undefined; costUsd: number | null }

/** One vision call: "does this image show <framing + must_show>?" -- null on any error. */
export async function checkImageAlignment(params: { imageUrl: string; brief: VisualBrief }): Promise<AlignmentResult | null> {
  const question = `Does this image show: ${briefScene(params.brief, "an abstract atmospheric background")}? Score 1-5 (5 = clearly shows exactly that, 1 = shows something else), and give one short reason. Respond with JSON only: {"score": 1-5, "reason": "..."}`
  try {
    const res = await getOpenAIClient().chat.completions.create(
      {
        model: MODELS.vision,
        // Same conventions as lib/ai/vision.ts: max_completion_tokens, no temperature.
        max_completion_tokens: 200,
        reasoning_effort: "none",
        response_format: { type: "json_object" },
        messages: [{
          role: "user",
          content: [
            { type: "text", text: question },
            { type: "image_url", image_url: { url: params.imageUrl } },
          ],
        }],
      },
      { timeout: 20_000, maxRetries: 1 },
    )
    const usage = toTextUsage(res.usage)
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}") as { score?: unknown; reason?: unknown }
    const score = Math.round(Number(parsed.score))
    if (!Number.isFinite(score) || score < 1 || score > 5) return null
    return { score, reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 300) : "", usage, costUsd: textCostUsd(MODELS.vision, usage) }
  } catch (err) {
    console.error("[image-alignment] check failed (non-fatal):", err instanceof Error ? err.message : err)
    return null
  }
}

function sampleRate(): number {
  const raw = Number(process.env.QUALITY_VISION_SAMPLE_RATE)
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0.25
}

/**
 * Sampled, after-response alignment check for one generated image. Records a
 * "quality_checked" content event (meta: format, kind, score -- never the
 * reason text). No brief = nothing to check against = no-op.
 */
export function sampleImageAlignment(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  userId: string | null
  brandId: string
  contentType: ContentEventType
  contentId?: string | null
  format: string
  imageUrl: string
  brief: VisualBrief | null | undefined
}): void {
  const brief = params.brief
  if (!brief || Math.random() >= sampleRate()) return
  const run = async () => {
    const result = await checkImageAlignment({ imageUrl: params.imageUrl, brief })
    if (!result) return
    await insertContentEvents(params.supabase, [{
      userId: params.userId, brandId: params.brandId, contentType: params.contentType, contentId: params.contentId ?? null,
      event: "quality_checked", meta: { format: params.format, kind: brief.kind, score: result.score },
    }])
  }
  try {
    after(run)
  } catch {
    void run()
  }
}
