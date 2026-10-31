import { z } from "zod"
import type { BrandRow, ProductRow } from "@/types/database"
import { MODELS } from "./models"
import { createTextCompletion } from "@/lib/ai/provider-fallback"
import { buildBrandContext } from "./prompts"
import { factRetryTimeoutMs } from "./fact-guard"
import { addTextUsage, sumCostUsd, textCostUsd, toTextUsage, type TextUsage } from "./pricing"
import { artDirectionGateLines, findTextBearingSubject, type VisualBrief } from "./visual-brief"
import { artDirectionFrom } from "./brand-brain"

// Pre-image quality gate (spec §8): before any image is made, one cheap
// MODELS.scoring call checks the generated copy + visual briefs against the
// brand/product facts. Critical issues (unsupported claims, visuals that
// don't show the copy) get ONE targeted repair through the original
// generator's own call; passing items are never touched. Fully fail-soft:
// any gate error means "skipped", never a failed generation.
//
// With the user's topic, every item must also be ON it (off_topic, critical):
// off-topic items get the same targeted repair, a cheap re-check reports any
// still off-topic (GateReport.offTopic), and onTopicOrRegenerate regenerates
// once before failing with OffTopicError -- never a silent off-topic result.

export const GATE_CHECKS = ["unsupported_claim", "visual_mismatch", "off_topic", "generic", "duplicate"] as const
export type GateCheck = (typeof GATE_CHECKS)[number]
const CRITICAL = new Set<GateCheck>(["unsupported_claim", "visual_mismatch", "off_topic"])

export type GateFormat = "carousel" | "story" | "post" | "ad"
export type GateIssue = { item: number; check: GateCheck; detail: string; fix_hint: string }

export type GateCheckResult = {
  ok: boolean
  skipped: boolean
  issues: GateIssue[]
  model: string
  usage: TextUsage | undefined
  costUsd: number | null
}

/** What a generator returns about its gate run -- issue details for harnesses, counts for logging. */
export type GateReport = {
  skipped: boolean
  /** Issues found BEFORE any repair. */
  issues: GateIssue[]
  counts: Record<GateCheck, number>
  repaired: boolean
  /** Why a needed repair didn't run (no time, or it failed). */
  repairSkipped: string | null
  /** The gate call's own usage/cost (repair cost is counted by the generator). */
  usage: TextUsage | undefined
  costUsd: number | null
  /** Items still off the user's topic after the repair (empty = on topic, or no topic given). */
  offTopic: number[]
}

type GateItem = { label: string; copy: string; visual?: VisualBrief | null }

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "")
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null)

// ─── Items per format (labels match how the repair asks for them) ──────────

function itemsFor(format: GateFormat, data: unknown): GateItem[] {
  const d = obj(data) ?? {}
  if (format === "carousel") {
    const slides = Array.isArray(d.slides) ? d.slides : []
    const items = slides.map((s, i) => {
      const o = obj(s) ?? {}
      const points = Array.isArray(o.points) ? o.points.map(text).filter(Boolean).join(" / ") : ""
      return { label: `slides[${i}]`, copy: [text(o.headline), text(o.subtext), points].filter(Boolean).join(" -- "), visual: (o.visual as VisualBrief) ?? null }
    })
    const cta = obj(d.cta_slide)
    if (cta) items.push({ label: "cta_slide", copy: [text(cta.headline), text(cta.cta)].filter(Boolean).join(" -- "), visual: (cta.visual as VisualBrief) ?? null })
    return items
  }
  if (format === "story") {
    const stories = Array.isArray(d.stories) ? d.stories : []
    return stories.map((s, i) => {
      const o = obj(s) ?? {}
      return { label: `stories[${i}]`, copy: [text(o.text), text(o.subtext)].filter(Boolean).join(" -- "), visual: (o.visual as VisualBrief) ?? null }
    })
  }
  if (format === "ad") {
    const variants = Array.isArray(d.variants) ? d.variants : []
    return variants.map((v, i) => {
      const o = obj(v) ?? {}
      return { label: `variants[${i}]`, copy: [text(o.headline), text(o.primary_text)].filter(Boolean).join(" -- "), visual: (o.visual as VisualBrief) ?? null }
    })
  }
  return [{
    label: "the caption",
    copy: [text(d.suggested_overlay_text) && `overlay: ${text(d.suggested_overlay_text)}`, text(d.caption_text)].filter(Boolean).join(" -- "),
    visual: (d.visual as VisualBrief) ?? null,
  }]
}

/** Puts back ONLY the failing items from the repaired output; everything else stays as first generated. */
function mergeRepaired(format: GateFormat, original: unknown, repaired: unknown, failing: Set<number>): unknown {
  const o = obj(original) ?? {}
  const r = obj(repaired) ?? {}
  if (format === "post") return failing.has(0) ? { ...o, ...r } : o
  const key = format === "carousel" ? "slides" : format === "story" ? "stories" : "variants"
  const orig = Array.isArray(o[key]) ? [...(o[key] as unknown[])] : []
  const rep = Array.isArray(r[key]) ? (r[key] as unknown[]) : []
  for (const i of failing) if (i < orig.length && rep[i] !== undefined) orig[i] = rep[i]
  const merged: Record<string, unknown> = { ...o, [key]: orig }
  if (format === "carousel" && failing.has(orig.length) && r.cta_slide !== undefined) merged.cta_slide = r.cta_slide
  return merged
}

// ─── The check ────────────────────────────────────────────────────────────

const responseSchema = z.object({
  issues: z.array(z.object({
    item: z.number().int(),
    check: z.string(),
    detail: z.string().default(""),
    fix_hint: z.string().default(""),
  })).default([]),
})

const SYSTEM_PROMPT = "You are a strict pre-publication QA checker for social media creative. You compare generated copy and image briefs against a brand's facts and report only real problems. Respond with valid JSON only."

function buildPrompt(items: GateItem[], brand: BrandRow, product: ProductRow | null | undefined, brief: string[], topic: string | null): string {
  const lines = items.map((it, i) => {
    const visual = it.visual ? `visual: ${it.visual.kind} -- ${it.visual.must_show}` : "visual: (none)"
    return `[${i}] ${it.label}\n    copy: ${it.copy || "(empty)"}\n    ${visual}`
  })
  return `FACTS -- the ONLY allowed source of truth:
${buildBrandContext(brand, product ?? null)}
${brief.length ? `\nUser brief (also allowed): ${brief.join(" | ")}` : ""}
${artDirectionGateLines(artDirectionFrom(brand))}
${topic ? `\nPOST TOPIC -- the user's own request; every item must be about it: "${topic}"\n` : ""}
ITEMS:
${lines.join("\n")}

Report problems with these checks:
- unsupported_claim: a factual claim about the brand, product, a client project, materials, features, specifications, results or guarantees that the FACTS do not state. Words count, not just numbers (e.g. "breathable leather suited for Delhi's climate" when the facts say nothing about leather or climate). General advice, opinions and tone are NOT claims.
- visual_mismatch: the visual brief doesn't show what that item's copy says, or its kind contradicts its must_show, or it centres on something that carries readable text (a screen, document, sign, calendar, chart), or (when a brand art direction is given) it ignores the brand palette or uses a scene from its never-list.
- generic: a line with no concrete information -- a slogan that says nothing specific.
- duplicate: two items with the same angle, subject or visual (report it on the later item).
${topic ? `- off_topic: the item is about a different subject, occasion, offer or product than the POST TOPIC -- e.g. a styling tip when the topic is a sale. Items that serve the topic (its hook, a benefit, a step, the CTA for it) are on topic; judge the copy, not the visual alone.${(topic.trim().match(/\S+/g) ?? []).length <= 3 ? ` The topic is a short phrase, so the FIRST item must use its own words ("${topic.trim()}") -- a synonym or a fragment of it (e.g. "Birthday" for "Bday sale") is off_topic.` : ""}\n` : ""}
Return {"issues":[{"item": <the [index] above>, "check": "unsupported_claim | visual_mismatch | ${topic ? "off_topic | " : ""}generic | duplicate", "detail": "short: what is wrong", "fix_hint": "short: how to fix it"}]}. Empty array if everything passes. Only report real problems.`
}

/** One MODELS.scoring call over a generated batch. Never throws -- any error returns { ok: true, skipped: true }. */
export async function checkCreative(params: {
  format: GateFormat
  data: unknown
  brand: BrandRow
  product?: ProductRow | null
  brief?: (string | null | undefined)[]
  /** The user's topic -- adds the off_topic check. */
  topic?: string | null
}): Promise<GateCheckResult> {
  const skipped: GateCheckResult = { ok: true, skipped: true, issues: [], model: MODELS.scoring, usage: undefined, costUsd: null }
  try {
    const items = itemsFor(params.format, params.data)
    if (items.length === 0) return skipped
    const { response: res, model: answered } = await createTextCompletion(
      {
        model: MODELS.scoring,
        // GPT-OSS reasoning tokens count against max_tokens (lib/ai/models.ts).
        reasoning_effort: "low",
        max_tokens: 1500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildPrompt(items, params.brand, params.product, (params.brief ?? []).filter((b): b is string => !!b?.trim()), params.topic?.trim() || null) },
        ],
      },
      { stage: "quality_gate", timeout: 15_000 },
    )
    const usage = toTextUsage(res.usage)
    // Priced at the model that answered (Groq, or OpenAI on a fallback).
    const costUsd = textCostUsd(answered, usage)
    const parsed = responseSchema.safeParse(JSON.parse(res.choices[0]?.message?.content ?? "{}"))
    if (!parsed.success) {
      console.error(`[quality-gate] ${params.format}: unparseable response (skipped)`)
      return { ...skipped, usage, costUsd }
    }
    const issues = parsed.data.issues
      .filter((i): i is GateIssue => (GATE_CHECKS as readonly string[]).includes(i.check) && i.item >= 0 && i.item < items.length)
    return { ok: !issues.some((i) => CRITICAL.has(i.check)), skipped: false, issues, model: answered, usage, costUsd }
  } catch (err) {
    console.error(`[quality-gate] ${params.format}: check failed (skipped):`, err instanceof Error ? err.message : err)
    return skipped
  }
}

// Marks the deterministic text-bearing-subject issues among the model's.
export const TEXT_BEARING_DETAIL_PREFIX = "[text-bearing]"

/**
 * The cheap deterministic part of the gate (no model call): every item
 * whose visual brief shows a text-bearing object (lib/ai/visual-brief.ts
 * findTextBearingSubject) is a visual_mismatch, so the targeted repair
 * rewrites that brief. Runs even when the model check is skipped.
 */
function textBearingIssues(items: GateItem[], productReference: boolean): GateIssue[] {
  return items.flatMap((it, i) => {
    const subject = findTextBearingSubject(it.visual, { productReference })
    if (!subject) return []
    return [{
      item: i,
      check: "visual_mismatch" as const,
      detail: `${TEXT_BEARING_DETAIL_PREFIX} the brief shows "${subject}", which carries readable text the image model will garble`,
      fix_hint: `rewrite the visual so no "${subject}" with readable text is shown: put it face-down, its screen dark or out of focus, or show the person's reaction or the physical result instead -- readable words belong to the text overlay`,
    }]
  })
}

function countIssues(issues: GateIssue[]): Record<GateCheck, number> {
  const counts = Object.fromEntries(GATE_CHECKS.map((c) => [c, 0])) as Record<GateCheck, number>
  for (const i of issues) counts[i.check]++
  return counts
}

/** The repair instruction: only the failing items, the same schema, unsupported claims rewritten to the principle. */
function buildRepairInstruction(items: GateItem[], issues: GateIssue[], topic?: string | null): string {
  const lines = issues.map((i) => `- ${items[i.item]?.label ?? `item ${i.item}`}: [${i.check}] ${i.fix_hint || i.detail}`)
  const offTopic = topic?.trim() && issues.some((i) => i.check === "off_topic")
  return `QUALITY FIX -- revise ONLY the items listed below and return the COMPLETE JSON in exactly the same schema as before. Every item not listed must stay word-for-word identical.
${lines.join("\n")}
For any claim that the brand or product facts do not support, rewrite that line to state the general principle instead -- never keep or reword the claim itself.${offTopic ? `\nEvery off_topic item must be rewritten to be about the topic "${topic!.trim()}" -- its copy and its visual.` : ""}`
}

/**
 * Gate + at most one targeted repair. `repair` re-runs the ORIGINAL
 * generator call with this correction as a follow-up (same mechanism the
 * fact guard uses) and returns data in the same schema. Repaired items are
 * merged back by position; non-critical issues are only logged. Skips the
 * repair (logged) when the deadline leaves no time, like the fact guard.
 */
export async function runQualityGate<T>(params: {
  format: GateFormat
  data: T
  brand: BrandRow
  product?: ProductRow | null
  brief?: (string | null | undefined)[]
  deadline?: number
  normalTimeoutMs: number
  repair: (correction: string, timeoutMs: number) => Promise<T>
  /** The brand's real product photo is the image reference -- its packaging/label is real, not invented text. */
  productReference?: boolean
  /** The user's own topic: every item must be about it (off_topic). Omitted = no topic check. */
  topic?: string | null
}): Promise<{ data: T; gate: GateReport }> {
  const check = await checkCreative(params)
  // The model's issues plus the deterministic text-bearing-subject ones.
  const issues = [...check.issues, ...textBearingIssues(itemsFor(params.format, params.data), !!params.productReference)]
  const report: GateReport = {
    skipped: check.skipped,
    issues,
    counts: countIssues(issues),
    repaired: false,
    repairSkipped: null,
    usage: check.usage,
    costUsd: check.costUsd,
    offTopic: [],
  }
  const offTopicAt = (list: GateIssue[]) => [...new Set(list.filter((i) => i.check === "off_topic").map((i) => i.item))]
  const critical = issues.filter((i) => CRITICAL.has(i.check))
  const nonCritical = issues.filter((i) => !CRITICAL.has(i.check))
  if (nonCritical.length) console.log(`[quality-gate] ${params.format}: non-critical issues (logged only): ${nonCritical.map((i) => `${i.item}:${i.check}`).join(", ")}`)
  if (critical.length === 0) return { data: params.data, gate: report }

  const timeoutMs = factRetryTimeoutMs(params.deadline, params.normalTimeoutMs)
  if (timeoutMs === null) {
    report.repairSkipped = "no time left before the deadline"
    report.offTopic = offTopicAt(critical)
    console.log(`[quality-gate] ${params.format}: ${critical.length} critical issue(s), repair skipped (deadline)`)
    return { data: params.data, gate: report }
  }
  try {
    const items = itemsFor(params.format, params.data)
    const repaired = await params.repair(buildRepairInstruction(items, critical, params.topic), timeoutMs)
    const failing = new Set(critical.map((i) => i.item))
    report.repaired = true
    console.log(`[quality-gate] ${params.format}: repaired item(s) ${[...failing].join(", ")}`)
    const merged = mergeRepaired(params.format, params.data, repaired, failing) as T
    // Off-topic items get one cheap re-check after their repair; any still off are reported.
    if (offTopicAt(critical).length) {
      const recheck = await checkCreative({ ...params, data: merged })
      report.usage = addTextUsage(report.usage, recheck.usage)
      report.costUsd = sumCostUsd(report.costUsd, recheck.costUsd)
      report.offTopic = recheck.skipped ? [] : offTopicAt(recheck.issues)
      if (report.offTopic.length) console.log(`[quality-gate] ${params.format}: still off topic after repair: ${report.offTopic.join(", ")}`)
    }
    return { data: merged, gate: report }
  } catch (err) {
    report.repairSkipped = `repair failed: ${err instanceof Error ? err.name : "error"}`
    report.offTopic = offTopicAt(critical)
    console.error(`[quality-gate] ${params.format}: repair failed, keeping the original:`, err instanceof Error ? err.message : err)
    return { data: params.data, gate: report }
  }
}

/** content_event meta for a gate run: counts and check names only, never content. */
export function gateEventMeta(gate: GateReport | null | undefined): Record<string, unknown> | undefined {
  if (!gate) return undefined
  return { gate: { issues: gate.counts, repaired: gate.repaired, skipped: gate.skipped, off_topic: gate.offTopic.length } }
}

/** The generation stayed off the user's topic after its repair and one full regeneration. */
export class OffTopicError extends Error {
  usage: TextUsage | undefined = undefined
  costUsd: number | null = null
  constructor(readonly topic: string, readonly items: number) {
    super(`The generated content didn't stay on the topic "${topic}" (${items} item(s) off topic after a repair and a regeneration).`)
    this.name = "OffTopicError"
  }
}

/** The message routes show for OffTopicError. */
export function offTopicMessage(topic: string): string {
  return `We couldn't keep this on your topic ("${topic.trim().slice(0, 80)}"). Please try again, or add a little more detail to the topic.`
}

/**
 * Runs a generation; if its gate still found items off the user's topic
 * after the targeted repair, regenerates ONCE, and if that is off topic too,
 * throws OffTopicError -- never a silent off-topic result. Usage and cost of
 * both runs are summed.
 */
export async function onTopicOrRegenerate<R extends { gate?: GateReport; usage: TextUsage | undefined; costUsd: number | null }>(
  topic: string | null | undefined,
  run: () => Promise<R>,
): Promise<R> {
  const first = await run()
  if (!topic?.trim() || !first.gate?.offTopic.length) return first
  console.log(`[quality-gate] off topic after repair (${first.gate.offTopic.length} item(s)) -- regenerating once`)
  const second = await run()
  const merged = { ...second, usage: addTextUsage(first.usage, second.usage), costUsd: sumCostUsd(first.costUsd, second.costUsd) }
  if (second.gate?.offTopic.length) {
    const err = new OffTopicError(topic, second.gate.offTopic.length)
    err.usage = merged.usage
    err.costUsd = merged.costUsd
    throw err
  }
  return merged
}
