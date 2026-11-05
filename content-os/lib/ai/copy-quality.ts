import { MODELS } from "./models"
import { createTextCompletion } from "./provider-fallback"
import { buildBrandContext } from "./prompts"
import { findContentQualityIssues, sanitizeLeakedArtifacts } from "./content-quality-check"
import { sumCostUsd, textCostUsd, toTextUsage } from "./pricing"
import type { BrandRow } from "@/types/database"

/**
 * The quality pass on text-only outputs (hooks, Content-tab captions, ad
 * copy, reel scripts, blog posts): one MODELS.scoring call scores the text
 * 1-10 on COPY_CRITERIA. Below COPY_PASS, one rewrite with the scorer's
 * reasons, re-scored, and the better-scoring version is kept. No credit
 * change, never throws -- any failure keeps the original.
 *
 * The rewrite goes through the existing content-quality guard
 * (lib/ai/content-quality-check.ts) and is dropped if it adds a number the
 * original didn't have (a new price, stat or claim), so it can only reword
 * what was already true.
 */

export const COPY_CRITERIA = [
  { id: "stops_scroll", ask: "Does the FIRST line stop the scroll -- specific, surprising or tense, not a warm-up?" },
  { id: "speaks_to_buyer", ask: "Does it talk to this brand's actual buyer about something they care about?" },
  { id: "one_message", ask: "Is there exactly one clear message?" },
  { id: "reason_to_act", ask: "Is there a concrete reason to save, tap, buy or reply now?" },
  { id: "sounds_human", ask: "Does it sound like a real person wrote it -- not AI, not a template, no filler or buzzwords?" },
] as const

export const COPY_PASS = 8

export type CopyKind = "hooks" | "caption" | "ad_copy" | "reel_script" | "blog_post"

const KIND_LABEL: Record<CopyKind, string> = {
  hooks: "a set of alternative Instagram hooks (each one is judged as an opening line)",
  caption: "an Instagram caption",
  ad_copy: "Meta ad copy",
  reel_script: "an Instagram reel script",
  blog_post: "a blog post",
}

export interface CopyScore { overall: number; reasons: string[] }

const clamp = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.max(1, Math.min(10, n)) : null)
const asText = (fields: Record<string, string>) => Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n")
const json = (raw: string) => JSON.parse(raw.replace(/```json\n?|```\n?/g, "").trim()) as Record<string, unknown>

/** The scorer's JSON -> the average and its reasons; null if unreadable. Exported for tests. */
export function parseCopyScore(raw: string): CopyScore | null {
  try {
    const data = json(raw) as { scores?: Record<string, unknown>; reasons?: unknown }
    const values = COPY_CRITERIA.map((c) => clamp(data.scores?.[c.id]))
    if (values.some((v) => v == null)) return null
    const overall = Math.round((values.reduce((a, b) => a! + b!, 0)! / values.length) * 10) / 10
    const reasons = Array.isArray(data.reasons) ? data.reasons.filter((r): r is string => typeof r === "string").map((r) => r.slice(0, 200)).slice(0, 5) : []
    return { overall, reasons }
  } catch {
    return null
  }
}

/** Numbers (prices, stats, counts) in a text -- a rewrite may not add any. */
const numbersIn = (s: string) => new Set(s.match(/\d+(?:[.,]\d+)?/g) ?? [])

/**
 * The rewrite's fields, cleaned by the content-quality guard; null when a
 * field is missing / empty or it adds a number. Exported for tests.
 */
export function acceptRewrite(original: Record<string, string>, raw: string): Record<string, string> | null {
  try {
    const data = json(raw)
    const before = numbersIn(Object.values(original).join(" "))
    const out: Record<string, string> = {}
    for (const key of Object.keys(original)) {
      const v = data[key]
      if (typeof v !== "string" || !v.trim()) return null
      const cleaned = findContentQualityIssues(v).length > 0 ? sanitizeLeakedArtifacts(v) : v
      if ([...numbersIn(cleaned)].some((n) => !before.has(n))) return null
      out[key] = cleaned.trim()
    }
    return out
  } catch {
    return null
  }
}

async function scoreCopy(brand: BrandRow, kind: CopyKind, fields: Record<string, string>, label: string): Promise<{ score: CopyScore | null; costUsd: number | null }> {
  try {
    const { response: res, model } = await createTextCompletion(
      {
        model: MODELS.scoring,
        reasoning_effort: "low",
        max_completion_tokens: 1200,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You are a demanding Instagram copy chief scoring ${KIND_LABEL[kind]} for an Indian D2C brand. Ordinary copy is a 5 or 6, an 8 is genuinely good, a 10 is rare.

${buildBrandContext(brand)}

Score 1-10 on each:
${COPY_CRITERIA.map((c) => `- "${c.id}": ${c.ask}`).join("\n")}

Give up to 3 short, specific reasons (what to fix).

Respond with valid JSON only, no markdown:
{"scores": {${COPY_CRITERIA.map((c) => `"${c.id}": 1-10`).join(", ")}}, "reasons": ["..."]}`,
          },
          { role: "user", content: asText(fields).slice(0, 12_000) },
        ],
      },
      { stage: "copy_quality", timeout: 20_000 },
    )
    return { score: parseCopyScore(res.choices[0]?.message?.content ?? ""), costUsd: textCostUsd(model, toTextUsage(res.usage)) }
  } catch (err) {
    console.error(`[copy-quality] ${label}: scoring failed (keeping the text):`, err instanceof Error ? err.message : err)
    return { score: null, costUsd: null }
  }
}

async function rewriteCopy(brand: BrandRow, kind: CopyKind, fields: Record<string, string>, reasons: string[], label: string): Promise<{ fields: Record<string, string> | null; costUsd: number | null }> {
  try {
    const long = kind === "blog_post"
    const { response: res, model } = await createTextCompletion(
      {
        model: MODELS.creative,
        reasoning_effort: "low",
        max_completion_tokens: long ? 8000 : 2500,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You rewrite ${KIND_LABEL[kind]} for an Indian D2C brand so it scores 8+ on: ${COPY_CRITERIA.map((c) => c.ask).join(" ")}

${buildBrandContext(brand)}

Rules: keep the same message, facts and language; never add a number, price, claim, offer or result that isn't already there; keep each field's role and roughly its length; sound like a real person. Return the SAME JSON keys with rewritten string values, nothing else.`,
          },
          { role: "user", content: `Fix: ${reasons.join("; ") || "make it sharper and more human"}\n\n${JSON.stringify(fields)}` },
        ],
      },
      { stage: "copy_quality_rewrite", timeout: long ? 60_000 : 25_000 },
    )
    return { fields: acceptRewrite(fields, res.choices[0]?.message?.content ?? ""), costUsd: textCostUsd(model, toTextUsage(res.usage)) }
  } catch (err) {
    console.error(`[copy-quality] ${label}: rewrite failed (keeping the text):`, err instanceof Error ? err.message : err)
    return { fields: null, costUsd: null }
  }
}

/**
 * Score -> (below 8) rewrite once with the reasons -> re-score -> keep the
 * better. `fields` are the item's text fields; `apply` writes rewritten
 * fields back into a copy of the item.
 */
export async function copyQualityPass<T>(params: {
  brand: BrandRow
  kind: CopyKind
  item: T
  fields: Record<string, string>
  apply: (item: T, fields: Record<string, string>) => T
  label: string
}): Promise<{ item: T; score: number | null; rewritten: boolean; costUsd: number | null }> {
  const { brand, kind, fields, label } = params
  const first = await scoreCopy(brand, kind, fields, label)
  if (!first.score || first.score.overall >= COPY_PASS) {
    return { item: params.item, score: first.score?.overall ?? null, rewritten: false, costUsd: first.costUsd }
  }
  const rewrite = await rewriteCopy(brand, kind, fields, first.score.reasons, label)
  if (!rewrite.fields) {
    console.log(`[copy-quality] ${label}: scored ${first.score.overall}, rewrite unusable -- kept the original`)
    return { item: params.item, score: first.score.overall, rewritten: false, costUsd: sumCostUsd(first.costUsd, rewrite.costUsd) }
  }
  const second = await scoreCopy(brand, kind, rewrite.fields, label)
  const costUsd = sumCostUsd(first.costUsd, rewrite.costUsd, second.costUsd)
  const better = !!second.score && second.score.overall > first.score.overall
  console.log(`[copy-quality] ${label}: scored ${first.score.overall}, rewrite ${second.score?.overall ?? "unscored"} -- kept the ${better ? "rewrite" : "original"}`)
  return better
    ? { item: params.apply(params.item, rewrite.fields), score: second.score!.overall, rewritten: true, costUsd }
    : { item: params.item, score: first.score.overall, rewritten: false, costUsd }
}
