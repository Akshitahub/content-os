import { z } from "zod"
import type { PostTemplateId } from "./post-templates"

/**
 * The copy and settings of a designed feed post (lib/image/post-design.ts) --
 * shared by the client (Full Post editor, calendar re-edit) and the server,
 * so it has no server imports. Stored on a scheduled post as
 * platform_specific_data.post_design next to its clean base_image_url.
 */

/** Templates drawn in the story frame language; blank, hard_truth_checklist and annotated_product keep their own rendering. */
export const POST_DESIGN_TEMPLATES = ["bold_statement", "product_focus", "quote_card", "minimal", "listicle_cover", "festive_poster", "review_card"] as const
export type PostDesignTemplate = (typeof POST_DESIGN_TEMPLATES)[number]
/** The looks any post can switch between; the data-bound three need their own data. */
export const POST_DESIGN_LOOKS = ["bold_statement", "product_focus", "quote_card", "minimal"] as const satisfies readonly PostDesignTemplate[]

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
  /** listicle_cover: the real item count; festive_poster: the occasion (lib/ai/post-template-rules.ts). */
  badge?: string
  /** review_card: the customer's words, as given. */
  quote?: string
  /** listicle_cover: the list itself -- drawn under the number, which is its count. */
  items?: string[]
}

/** What the render / schedule / re-edit routes accept as a post's design. */
export const postDesignSchema = z.object({
  template: z.enum(POST_DESIGN_TEMPLATES),
  big_words: z.string().trim().min(1).max(80),
  script_line: z.string().max(120).default(""),
  seed: z.number().int().min(0).max(2 ** 31),
  aspect: z.enum(["4:5", "1:1", "9:16"]).optional(),
  badge: z.string().max(40).optional(),
  items: z.array(z.string().max(120)).max(10).optional(),
  quote: z.string().max(240).optional(),
})

export function isPostDesignTemplate(id: PostTemplateId | string | null | undefined): id is PostDesignTemplate {
  return !!id && (POST_DESIGN_TEMPLATES as readonly string[]).includes(id)
}

const clampWords = (s: string | null | undefined, max: number) => (s?.trim().match(/\S+/g) ?? []).slice(0, max).join(" ").replace(/[,;:\-–—]+$/, "")

/** Word limits applied (1-4 display words, a script line of <= 6). */
export function clampPostDesign(d: PostDesign): PostDesign {
  return {
    ...d,
    big_words: clampWords(d.big_words, d.template === "listicle_cover" ? 5 : POST_BIG_WORDS_MAX),
    script_line: clampWords(d.script_line, POST_SCRIPT_LINE_MAX),
    seed: Math.abs(Math.floor(d.seed)) % 2 ** 30,
    ...(d.badge ? { badge: clampWords(d.badge, 3) } : {}),
    ...(d.quote ? { quote: clampWords(d.quote, 24) } : {}),
  }
}

/**
 * The design for a new post: the caption call's post_big_words /
 * post_script_line, else display words from the overlay text or hook.
 * Null when the template draws something else.
 */
export interface PostDesignCaptionFields {
  post_big_words?: string | null
  post_script_line?: string | null
  fallbackWords?: (string | null | undefined)[]
  // The data-bound templates' checked fields (lib/ai/post-template-rules.ts).
  listicle_title?: string | null
  listicle_count?: number | null
  listicle_items?: string[] | null
  festive_occasion?: string | null
  festive_greeting?: string | null
  festive_line?: string | null
  review_quote?: string | null
  review_author?: string | null
}

export function initialPostDesign(template: PostTemplateId | string | null | undefined, fields: PostDesignCaptionFields, seed = Math.floor(Math.random() * 2 ** 30)): PostDesign | null {
  if (!isPostDesignTemplate(template)) return null
  // A data-bound template draws only its own checked data -- without it, the bold look.
  // The number only with its list on the image: no items, no listicle.
  const items = (fields.listicle_items ?? []).map((i) => i.trim()).filter(Boolean)
  if (template === "listicle_cover" && fields.listicle_count && fields.listicle_title?.trim() && items.length === fields.listicle_count) {
    return { template, big_words: clampWords(fields.listicle_title, 5), script_line: clampWords(fields.post_script_line, POST_SCRIPT_LINE_MAX), badge: String(items.length), items, seed }
  }
  if (template === "festive_poster" && fields.festive_occasion?.trim() && fields.festive_greeting?.trim()) {
    return { template, big_words: clampWords(fields.festive_greeting, POST_BIG_WORDS_MAX + 1), script_line: clampWords(fields.festive_line, POST_SCRIPT_LINE_MAX), badge: fields.festive_occasion.trim(), seed }
  }
  if (template === "review_card" && fields.review_quote?.trim()) {
    return { template, big_words: clampWords(fields.review_quote, POST_BIG_WORDS_MAX), script_line: clampWords(fields.review_author, POST_SCRIPT_LINE_MAX), quote: fields.review_quote.trim(), seed }
  }
  const look = (POST_DESIGN_LOOKS as readonly string[]).includes(template) ? template as PostDesignTemplate : "bold_statement"
  const bigWords = clampWords(fields.post_big_words, POST_BIG_WORDS_MAX) || clampWords(fields.fallbackWords?.find((w) => w?.trim()), POST_BIG_WORDS_MAX)
  if (!bigWords) return null
  return { template: look, big_words: bigWords, script_line: clampWords(fields.post_script_line, POST_SCRIPT_LINE_MAX), seed }
}

/** The looks this design can switch between: the four, plus its own data-bound template. */
export function postDesignLooks(d: PostDesign): PostDesignTemplate[] {
  const own = d.quote ? "review_card" : d.badge ? (/^\d+$/.test(d.badge) ? "listicle_cover" : "festive_poster") : null
  return own ? [...POST_DESIGN_LOOKS, own] : [...POST_DESIGN_LOOKS]
}
