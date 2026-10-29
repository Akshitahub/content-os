import type { BrandRow, ProductRow } from "@/types/database"
import type { GeneratedCaption, GeneratedHook, HookType, Platform } from "@/types/app"
import { generateContent } from "./content-generator"
import { generateHooks } from "./hooks-generator"
import { UsageCarryingError, type TextUsage } from "./pricing"
import type { BrandLesson } from "./brand-brain"

/**
 * A single post's hook + caption, in that dependency order: the caption
 * (Full Post's generateContent -- post_plan, visual brief, fact guard,
 * quality gate) is written first, then the hook is written FROM its plan --
 * the one core message and the caption's opening -- so the two can't say
 * different things. Shared by Full Post, calendar regenerate, the daily
 * draft and Autopilot post slots.
 *
 * The hook falls back to the caption's own first line (instead of failing)
 * when too little of the deadline is left for the hook call, or when that
 * call fails or returns nothing.
 */

// The hook call's own timeout (hooks-generator.ts) plus room for its
// fact-guard retry -- below this much time left, the hook isn't attempted.
const HOOK_MIN_REMAINING_MS = 25_000

export type PostCopyStep = "caption" | "hook"

export interface PostCopyOptions {
  product?: ProductRow | null
  platform?: Platform
  additionalContext?: string
  pastExamples?: string[]
  availableColorThemes?: { id: string; label: string }[]
  /** Epoch ms the text steps must finish by (fact guard / gate / the hook-call cutoff). */
  factGuardDeadline?: number
  captionLessons?: BrandLesson[]
  hookLessons?: BrandLesson[]
  hookTypes?: HookType[]
  /** Called as soon as each billed call completes (or fails with usage), so
   * a caller's tracking never loses one call's usage to the other's failure. */
  onUsage?: (step: PostCopyStep, usage: TextUsage | undefined, costUsd: number | null) => void
}

export interface PostCopyResult {
  caption: Awaited<ReturnType<typeof generateContent>>
  /** Same shape as generateHooks' result; when the hook came from the
   * caption's first line, model is the caption's and usage/cost are empty. */
  hook: { hooks: GeneratedHook[]; model: string; usage: TextUsage | undefined; costUsd: number | null }
  hookSource: "plan" | "caption_first_line"
}

/** The caption's first non-empty line, as a hook (capped at a word boundary). */
export function hookFromCaptionFirstLine(captionText: string): string {
  const line = captionText.split("\n").map((l) => l.trim()).find(Boolean) ?? ""
  if (line.length <= 120) return line
  const cut = line.slice(0, 120)
  return `${cut.slice(0, cut.lastIndexOf(" ") > 60 ? cut.lastIndexOf(" ") : 120).trim()}…`
}

export async function generatePostCopy(brand: BrandRow, opts: PostCopyOptions): Promise<PostCopyResult> {
  // 1. The caption and its plan.
  let caption: Awaited<ReturnType<typeof generateContent>>
  try {
    caption = await generateContent(brand, "social_post", {
      product: opts.product,
      platform: opts.platform,
      additionalContext: opts.additionalContext,
      pastExamples: opts.pastExamples,
      includeImagePrompt: true,
      availableColorThemes: opts.availableColorThemes,
      factGuardDeadline: opts.factGuardDeadline,
      lessons: opts.captionLessons,
    })
  } catch (err) {
    if (err instanceof UsageCarryingError) opts.onUsage?.("caption", err.usage, err.costUsd)
    throw err
  }
  opts.onUsage?.("caption", caption.usage, caption.costUsd)

  const data = caption.data as GeneratedCaption
  const fallback = (reason: string): PostCopyResult => {
    console.log(`[post-copy] hook taken from the caption's first line (${reason})`)
    return {
      caption,
      hook: {
        hooks: [{ hook_text: hookFromCaptionFirstLine(data.caption_text), hook_type: "bold_statement", reasoning: "The caption's own opening line." }],
        model: caption.model,
        usage: undefined,
        costUsd: null,
      },
      hookSource: "caption_first_line",
    }
  }

  // 2. The hook, written from the caption's plan -- if there's time for it.
  if (opts.factGuardDeadline !== undefined && opts.factGuardDeadline - Date.now() < HOOK_MIN_REMAINING_MS) {
    return fallback(`${Math.max(0, opts.factGuardDeadline - Date.now())}ms left before the deadline`)
  }
  const message = data.post_plan?.message?.trim()
  const opening = hookFromCaptionFirstLine(data.caption_text) || null
  try {
    const hook = await generateHooks(brand, {
      hookTypes: opts.hookTypes ?? ["bold_statement", "question", "story"],
      count: 1,
      platform: opts.platform,
      additionalContext: opts.additionalContext,
      product: opts.product,
      factGuardDeadline: opts.factGuardDeadline,
      lessons: opts.hookLessons,
      // No plan (a caption without one) -> the opening alone still anchors it.
      postPlan: message ? { message, opening } : opening ? { message: opening, opening } : null,
    })
    opts.onUsage?.("hook", hook.usage, hook.costUsd)
    if (!hook.hooks[0]?.hook_text?.trim()) return fallback("hook call returned no hook")
    return { caption, hook, hookSource: "plan" }
  } catch (err) {
    if (err instanceof UsageCarryingError) opts.onUsage?.("hook", err.usage, err.costUsd)
    console.error("[post-copy] hook generation failed, using the caption's first line:", err instanceof Error ? err.message : err)
    return fallback("hook call failed")
  }
}
