import { z } from "zod"
import type { PostTemplateId } from "./post-templates"

/**
 * The copy and settings of a designed feed post (lib/image/post-design.ts) --
 * shared by the client (Full Post editor, calendar re-edit) and the server,
 * so it has no server imports. Stored on a scheduled post as
 * platform_specific_data.post_design next to its clean base_image_url.
 */

/** Templates drawn in the story frame language; blank, hard_truth_checklist and annotated_product keep their own rendering. */
export const POST_DESIGN_TEMPLATES = ["bold_statement", "product_focus", "quote_card", "minimal"] as const
export type PostDesignTemplate = (typeof POST_DESIGN_TEMPLATES)[number]

export const POST_BIG_WORDS_MAX = 4
export const POST_SCRIPT_LINE_MAX = 6

export interface PostDesign {
  template: PostDesignTemplate
  big_words: string
  script_line: string
  /** Rotations / offsets / grain -- the same render every time. */
  seed: number
  /** The canvas it was made for; absent = 4:5. */
  aspect?: "4:5" | "1:1" | "9:16"
}

/** What the render / schedule / re-edit routes accept as a post's design. */
export const postDesignSchema = z.object({
  template: z.enum(POST_DESIGN_TEMPLATES),
  big_words: z.string().trim().min(1).max(80),
  script_line: z.string().max(120).default(""),
  seed: z.number().int().min(0).max(2 ** 31),
  aspect: z.enum(["4:5", "1:1", "9:16"]).optional(),
})

export function isPostDesignTemplate(id: PostTemplateId | string | null | undefined): id is PostDesignTemplate {
  return !!id && (POST_DESIGN_TEMPLATES as readonly string[]).includes(id)
}

const clampWords = (s: string | null | undefined, max: number) => (s?.trim().match(/\S+/g) ?? []).slice(0, max).join(" ").replace(/[,;:\-–—]+$/, "")

/** Word limits applied (1-4 display words, a script line of <= 6). */
export function clampPostDesign(d: PostDesign): PostDesign {
  return { ...d, big_words: clampWords(d.big_words, POST_BIG_WORDS_MAX), script_line: clampWords(d.script_line, POST_SCRIPT_LINE_MAX), seed: Math.abs(Math.floor(d.seed)) % 2 ** 30 }
}

/**
 * The design for a new post: the caption call's post_big_words /
 * post_script_line, else display words from the overlay text or hook.
 * Null when the template draws something else.
 */
export function initialPostDesign(template: PostTemplateId | string | null | undefined, fields: { post_big_words?: string | null; post_script_line?: string | null; fallbackWords?: (string | null | undefined)[] }, seed = Math.floor(Math.random() * 2 ** 30)): PostDesign | null {
  if (!isPostDesignTemplate(template)) return null
  const bigWords = clampWords(fields.post_big_words, POST_BIG_WORDS_MAX) || clampWords(fields.fallbackWords?.find((w) => w?.trim()), POST_BIG_WORDS_MAX)
  if (!bigWords) return null
  return { template, big_words: bigWords, script_line: clampWords(fields.post_script_line, POST_SCRIPT_LINE_MAX), seed }
}
