import { createAdminClient } from "@/lib/supabase/server"
import type { ContentEventType } from "@/lib/usage/content-events"

// Quality metrics for /admin/metrics, computed server-side from
// content_events (supabase/migrations/061) and ai_generation_logs. One query
// per metric family (events, cost), paged, aggregated in memory -- no
// per-item queries. Same admin-client pattern as lib/admin/list-users.ts.

export const METRIC_CONTENT_TYPES: ContentEventType[] = ["caption", "hook", "carousel", "story", "ad_copy", "post_image", "ad_maker"]
export const METRIC_WINDOWS = [7, 30] as const
export type MetricWindow = (typeof METRIC_WINDOWS)[number]

const PAGE = 1000
const MAX_ROWS = 50_000

export interface ContentTypeMetrics {
  contentType: ContentEventType
  generated: number
  /** Items generated in the window that were later saved or scheduled. */
  accepted: number
  acceptanceRate: number | null
  /** Accepted with no regenerated/edited event before the accept. */
  firstPassRate: number | null
  /** Average edited events per accepted item. */
  editBurden: number | null
  rated: number
  lowRatingRate: number | null
  /** Approximate: summed by feature from ai_generation_logs (not linked per item except posts). */
  costUsd: number | null
  costPerUsableItem: number | null
  /** Share of gated generations with no unsupported_claim/generic issue before repair (lib/ai/quality-gate.ts). */
  specificity: number | null
  /** Average "quality_checked" image-alignment score, 1-5 (lib/ai/image-alignment.ts, sampled). */
  alignment: number | null
  /** Text calls Groq couldn't serve that OpenAI answered instead ("provider_fallback", lib/ai/provider-fallback.ts). */
  providerFallbacks: number
  /** Average critic score, 1-10 ("critic_scored", lib/ai/critic.ts) -- Autopilot and manual. */
  criticScore: number | null
  criticScored: number
  /** Autopilot items the critic scored below the bar (flagged "Needs approval") ÷ Autopilot items scored. */
  autopilotNeedsApprovalRate: number | null
}

export interface ContentMetricsResult {
  days: MetricWindow
  since: string
  rows: ContentTypeMetrics[]
  /** True if a query hit MAX_ROWS -- the numbers then cover only part of the window. */
  truncated: boolean
  /** Set when content_events can't be read (e.g. migration 061 not run). */
  error: string | null
}

type EventRow = { content_type: string; content_id: string | null; event: string; meta: Record<string, unknown> | null; created_at: string }
type LogRow = { feature: string | null; cost_usd: number | string | null }

// ai_generation_logs.feature -> content type, for the approximate cost
// column. fullpost_social_post covers its hook + caption calls together.
function contentTypeForFeature(feature: string): ContentEventType | null {
  if (feature === "captions" || feature === "fullpost_social_post" || feature === "content_social_post") return "caption"
  if (feature === "hooks") return "hook"
  if (feature.startsWith("carousel") || feature === "fullpost_carousel" || feature === "content_carousel") return "carousel"
  if (feature.startsWith("story") || feature === "content_story") return "story"
  if (feature === "content_ad_copy" || feature === "fullpost_ad_copy") return "ad_copy"
  if (feature === "post_image") return "post_image"
  if (feature === "ad_maker") return "ad_maker"
  return null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAll<T>(build: (from: number, to: number) => any): Promise<{ rows: T[]; truncated: boolean; error: string | null }> {
  const rows: T[] = []
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1) as { data: T[] | null; error: { message: string } | null }
    if (error) return { rows, truncated: false, error: error.message }
    rows.push(...(data ?? []))
    if ((data ?? []).length < PAGE) return { rows, truncated: false, error: null }
  }
  return { rows, truncated: true, error: null }
}

const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null)

function criticMetrics(events: EventRow[]): Pick<ContentTypeMetrics, "criticScore" | "criticScored" | "autopilotNeedsApprovalRate"> {
  const scored = events.filter((e) => e.event === "critic_scored" && Number.isFinite(Number(e.meta?.score)))
  const autopilot = scored.filter((e) => e.meta?.source === "autopilot")
  return {
    criticScore: scored.length ? scored.reduce((a, e) => a + Number(e.meta?.score), 0) / scored.length : null,
    criticScored: scored.length,
    autopilotNeedsApprovalRate: ratio(autopilot.filter((e) => e.meta?.needs_approval === true).length, autopilot.length),
  }
}

export async function getContentMetrics(days: MetricWindow): Promise<ContentMetricsResult> {
  const admin = await createAdminClient()
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const [events, logs] = await Promise.all([
    fetchAll<EventRow>((from, to) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (admin.from("content_events" as any) as any)
        .select("content_type, content_id, event, meta, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: true })
        .range(from, to)),
    fetchAll<LogRow>((from, to) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (admin.from("ai_generation_logs" as any) as any)
        .select("feature, cost_usd")
        .gte("created_at", since)
        .order("created_at", { ascending: true })
        .range(from, to)),
  ])

  const costByType = new Map<ContentEventType, number>()
  for (const log of logs.rows) {
    const type = log.feature ? contentTypeForFeature(log.feature) : null
    const cost = Number(log.cost_usd)
    if (type && Number.isFinite(cost)) costByType.set(type, (costByType.get(type) ?? 0) + cost)
  }

  const rows = METRIC_CONTENT_TYPES.map((contentType): ContentTypeMetrics => {
    const typeEvents = events.rows.filter((e) => e.content_type === contentType)
    const generatedEvents = typeEvents.filter((e) => e.event === "generated")
    const generated = generatedEvents.length

    // Per item (events are already in time order).
    const byItem = new Map<string, EventRow[]>()
    for (const e of typeEvents) {
      if (!e.content_id) continue
      const list = byItem.get(e.content_id) ?? []
      list.push(e)
      byItem.set(e.content_id, list)
    }
    let accepted = 0
    let firstPass = 0
    let edits = 0
    for (const id of new Set(generatedEvents.map((e) => e.content_id).filter((id): id is string => !!id))) {
      const list = byItem.get(id) ?? []
      const acceptAt = list.findIndex((e) => e.event === "saved" || e.event === "scheduled")
      if (acceptAt === -1) continue
      accepted++
      if (!list.slice(0, acceptAt).some((e) => e.event === "regenerated" || e.event === "edited")) firstPass++
      edits += list.filter((e) => e.event === "edited").length
    }

    // Specificity: gated generations whose copy had no unsupported claim and
    // no generic line BEFORE repair. Skipped gates don't count either way.
    const gated = generatedEvents
      .map((e) => (e.meta?.gate ?? null) as { skipped?: boolean; issues?: Record<string, number> } | null)
      .filter((g): g is { skipped?: boolean; issues?: Record<string, number> } => !!g && !g.skipped)
    const specific = gated.filter((g) => !(g.issues?.unsupported_claim ?? 0) && !(g.issues?.generic ?? 0)).length
    const scores = typeEvents.filter((e) => e.event === "quality_checked").map((e) => Number(e.meta?.score)).filter((n) => Number.isFinite(n))

    const ratedEvents = typeEvents.filter((e) => e.event === "rated")
    const lowRated = ratedEvents.filter((e) => Number(e.meta?.rating) <= 2).length
    const costUsd = costByType.get(contentType) ?? null

    return {
      contentType,
      generated,
      accepted,
      acceptanceRate: ratio(accepted, generated),
      firstPassRate: ratio(firstPass, generated),
      editBurden: ratio(edits, accepted),
      rated: ratedEvents.length,
      lowRatingRate: ratio(lowRated, ratedEvents.length),
      costUsd,
      costPerUsableItem: costUsd != null && accepted > 0 ? costUsd / accepted : null,
      specificity: ratio(specific, gated.length),
      alignment: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      providerFallbacks: typeEvents.filter((e) => e.event === "provider_fallback").length,
      ...criticMetrics(typeEvents),
    }
  })

  return {
    days,
    since,
    rows,
    truncated: events.truncated || logs.truncated,
    error: events.error ? `content_events: ${events.error}` : logs.error ? `ai_generation_logs: ${logs.error}` : null,
  }
}
