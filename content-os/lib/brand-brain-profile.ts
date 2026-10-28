import { z } from "zod"
import type { BrandBrain } from "@/types/app"

// brands.brand_brain (supabase/migrations/060_brand_brain_profile.sql): the
// structured Brand Brain profile. Pure (no server imports) so the brand page
// form, the API routes and every prompt builder share one parser. Model
// output and user input are both untrusted here -- parseBrandBrain never
// throws, drops anything malformed, trims and caps every list.

const MAX_ITEMS = 8
const MAX_ITEM_CHARS = 160
const MAX_TEXT_CHARS = 300
const MAX_URL_CHARS = 500

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function cleanList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out = v
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim().slice(0, MAX_ITEM_CHARS).trim())
    .filter(Boolean)
    .slice(0, MAX_ITEMS)
  return out.length ? out : undefined
}

function cleanText(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined
  const t = v.trim().slice(0, MAX_TEXT_CHARS).trim()
  return t || undefined
}

function cleanClaims(v: unknown): { claim: string; source_url: string }[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out = v
    .map(asObject)
    .filter((c): c is Record<string, unknown> => !!c && typeof c.claim === "string")
    .map((c) => ({
      claim: String(c.claim).trim().slice(0, MAX_ITEM_CHARS).trim(),
      source_url: typeof c.source_url === "string" ? c.source_url.trim().slice(0, MAX_URL_CHARS) : "",
    }))
    .filter((c) => c.claim)
    .slice(0, MAX_ITEMS)
  return out.length ? out : undefined
}

/** Drops undefined fields; returns undefined when nothing is left. */
function compact<T extends Record<string, unknown>>(o: T): T | undefined {
  const entries = Object.entries(o).filter(([, v]) => v !== undefined)
  return entries.length ? (Object.fromEntries(entries) as T) : undefined
}

/** Tolerant parse: missing/invalid data becomes {} pieces, never an error. */
export function parseBrandBrain(raw: unknown): BrandBrain {
  const r = asObject(raw)
  if (!r) return {}
  const facts = asObject(r.facts)
  const voice = asObject(r.voice)
  const visual = asObject(r.visual)
  const strategy = asObject(r.strategy)
  return compact({
    facts: facts ? compact({
      differentiators: cleanList(facts.differentiators),
      customer_problems: cleanList(facts.customer_problems),
      verified_claims: cleanClaims(facts.verified_claims),
    }) : undefined,
    voice: voice ? compact({
      phrases_to_use: cleanList(voice.phrases_to_use),
      phrases_to_avoid: cleanList(voice.phrases_to_avoid),
      claims_never_to_make: cleanList(voice.claims_never_to_make),
    }) : undefined,
    visual: visual ? compact({
      photography_style: cleanText(visual.photography_style),
      avoid_visuals: cleanList(visual.avoid_visuals),
    }) : undefined,
    strategy: strategy ? compact({
      audience_segments: cleanList(strategy.audience_segments),
      objections: cleanList(strategy.objections),
      campaign_goal: cleanText(strategy.campaign_goal),
      seasonal_context: cleanText(strategy.seasonal_context),
    }) : undefined,
  }) ?? {}
}

/** Request-body schema for brand_brain: checks the shape, then normalizes through parseBrandBrain. */
export const brandBrainSchema = z.object({
  facts: z.object({
    differentiators: z.array(z.string()).optional(),
    customer_problems: z.array(z.string()).optional(),
    verified_claims: z.array(z.object({ claim: z.string(), source_url: z.string() })).optional(),
  }).optional(),
  voice: z.object({
    phrases_to_use: z.array(z.string()).optional(),
    phrases_to_avoid: z.array(z.string()).optional(),
    claims_never_to_make: z.array(z.string()).optional(),
  }).optional(),
  visual: z.object({
    photography_style: z.string().optional(),
    avoid_visuals: z.array(z.string()).optional(),
  }).optional(),
  strategy: z.object({
    audience_segments: z.array(z.string()).optional(),
    objections: z.array(z.string()).optional(),
    campaign_goal: z.string().optional(),
    seasonal_context: z.string().optional(),
  }).optional(),
}).transform(parseBrandBrain)

/**
 * The non-empty Brand Brain parts as labelled brand-context lines -- shared
 * by lib/ai/prompts.ts's buildBrandContext and the carousel/story
 * generators' own short contexts. [] for an empty profile, so prompts are
 * unchanged for brands without one. Visual fields go to the image-prompt
 * writer instead (brandBrainImageConstraints).
 */
export function buildBrandBrainLines(brain: BrandBrain): string[] {
  const lines: string[] = []
  const list = (label: string, items?: string[]) => {
    if (items?.length) lines.push(`${label}: ${items.join("; ")}`)
  }
  list("Differentiators", brain.facts?.differentiators)
  list("Customer problems", brain.facts?.customer_problems)
  if (brain.facts?.verified_claims?.length) {
    lines.push(`Verified claims (stated by the brand itself -- safe to use as written): ${brain.facts.verified_claims.map((c) => c.claim).join("; ")}`)
  }
  list("Phrases to use", brain.voice?.phrases_to_use)
  list("Phrases to avoid", brain.voice?.phrases_to_avoid)
  if (brain.voice?.claims_never_to_make?.length) {
    lines.push(`Claims never to make (never state or imply these): ${brain.voice.claims_never_to_make.join("; ")}`)
  }
  list("Objections customers raise", brain.strategy?.objections)
  list("Audience segments", brain.strategy?.audience_segments)
  if (brain.strategy?.campaign_goal) lines.push(`Campaign goal: ${brain.strategy.campaign_goal}`)
  if (brain.strategy?.seasonal_context) lines.push(`Seasonal context: ${brain.strategy.seasonal_context}`)
  return lines
}

/** The Brand Brain's visual direction for the image-prompt writer's constraints. */
export function brandBrainImageConstraints(brain: BrandBrain): { photographyStyle?: string; avoidVisuals?: string[] } {
  return {
    ...(brain.visual?.photography_style ? { photographyStyle: brain.visual.photography_style } : {}),
    ...(brain.visual?.avoid_visuals?.length ? { avoidVisuals: brain.visual.avoid_visuals } : {}),
  }
}

/** True when a Supabase/PostgREST error is only "brand_brain doesn't exist yet" (migration 060 not run). */
export function isMissingBrandBrainColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  return !!error && ["PGRST204", "42703"].includes(error.code ?? "") && (error.message ?? "").includes("brand_brain")
}
