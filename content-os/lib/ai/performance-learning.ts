import type { BrandLesson, LessonScope } from "./brand-brain"

/**
 * Learning from real results, weekly per brand (app/api/v1/cron/
 * learn-from-results, migration 070). Once a brand has MIN_ITEMS posted
 * items with engagement:
 * - each item's score weights saves and shares above comments above likes,
 *   per account reached when the brand's items carry reach;
 * - each item's performance is its score / the brand's own median score
 *   (its recent posts, not anyone else's);
 * - results are attributed to the template, hook type, content angle,
 *   photo source (real / ugc / ai), time slot and format each item had;
 * - only a value seen on MIN_GROUP+ items whose median sits MIN_GAP+ away
 *   from the brand's median becomes a lesson (brand_lessons, source
 *   'performance', with its evidence and a LESSON_DAYS expiry that each
 *   run refreshes while it stays true).
 * Nothing here invents a number: every figure in a lesson is counted from
 * the brand's own posts.
 */

export const MIN_ITEMS = 12
export const MIN_GROUP = 4
export const MIN_GAP = 0.25
export const LESSON_DAYS = 60
export const WINDOW_DAYS = 90
/** Saves and shares count most: they mean "worth keeping / sending". */
export const WEIGHTS = { likes: 1, comments: 2, saves: 3, shares: 3 } as const
/** Reach-normalise when at least this share of items has reach. */
const REACH_COVERAGE = 0.75

export const ATTRIBUTES = ["template", "hook_type", "content_angle", "photo_source", "time_slot", "format"] as const
export type Attribute = (typeof ATTRIBUTES)[number]

export interface PostedItem {
  id: string
  likes: number
  comments: number
  saves: number | null
  shares: number | null
  reach: number | null
  attrs: Partial<Record<Attribute, string>>
}

export interface Finding {
  attribute: Attribute
  value: string
  kind: "do" | "avoid"
  /** Items with this value. */
  count: number
  /** The group's median performance minus 1 (0.4 = 40% above the brand's median). */
  gap: number
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

/** The weighted engagement of one item (no reach applied). */
export function weightedEngagement(i: Pick<PostedItem, "likes" | "comments" | "saves" | "shares">): number {
  return i.likes * WEIGHTS.likes + i.comments * WEIGHTS.comments + (i.saves ?? 0) * WEIGHTS.saves + (i.shares ?? 0) * WEIGHTS.shares
}

/**
 * Each item's performance relative to the brand's own median (1 = a typical
 * post). Per account reached when most items carry reach (items without it
 * are left out then); raw otherwise. Empty when the median is 0.
 */
export function relativePerformance(items: PostedItem[]): Map<string, number> {
  const withReach = items.filter((i) => (i.reach ?? 0) > 0)
  const useReach = items.length > 0 && withReach.length / items.length >= REACH_COVERAGE
  const scored = (useReach ? withReach : items).map((i) => ({ id: i.id, score: weightedEngagement(i) / (useReach ? i.reach! : 1) }))
  const m = median(scored.map((s) => s.score))
  if (m <= 0) return new Map()
  return new Map(scored.map((s) => [s.id, s.score / m]))
}

/** What the brand's results say, strongest first: a value only with MIN_GROUP+ items and a MIN_GAP+ gap. */
export function attributeFindings(items: PostedItem[]): Finding[] {
  const rel = relativePerformance(items)
  const findings: Finding[] = []
  for (const attribute of ATTRIBUTES) {
    const groups = new Map<string, number[]>()
    for (const item of items) {
      const value = item.attrs[attribute]
      const r = rel.get(item.id)
      if (!value || r === undefined) continue
      groups.set(value, [...(groups.get(value) ?? []), r])
    }
    // A value every item shares says nothing about what works.
    if (groups.size < 2) continue
    for (const [value, rs] of groups) {
      if (rs.length < MIN_GROUP) continue
      const gap = median(rs) - 1
      if (Math.abs(gap) < MIN_GAP) continue
      findings.push({ attribute, value, kind: gap > 0 ? "do" : "avoid", count: rs.length, gap: Math.round(gap * 100) / 100 })
    }
  }
  return findings.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
}

const human = (v: string) => v.replace(/_/g, " ")

function subject(f: Pick<Finding, "attribute" | "value">): string {
  switch (f.attribute) {
    case "template": return `the "${human(f.value)}" layout`
    case "hook_type": return `${human(f.value)} hooks`
    case "content_angle": return `${human(f.value)} posts`
    case "photo_source": return f.value === "ugc" ? "customer photos" : f.value === "real" ? "the brand's own real photos" : "generated images"
    case "time_slot": return `posting in the ${f.value}`
    case "format": return `${human(f.value)}s`
  }
}

/** The lesson in plain words, every number counted from the brand's own posts. */
export function findingRule(f: Finding): string {
  const pct = Math.round(Math.abs(f.gap) * 100)
  const what = subject(f)
  const evidence = `${f.count} of this brand's posts with ${what} got ${pct}% ${f.gap > 0 ? "more" : "less"} saves, shares and engagement than its typical post`
  return f.kind === "do" ? `Prefer ${what} when it fits -- ${evidence}.` : `Use ${what} less -- ${evidence}.`
}

/** Which prompts a finding reaches: layouts the caption writer picks, hooks the hook writer; the rest are insights (mix, critic, admin). */
export function findingScope(attribute: Attribute): LessonScope | "insight" {
  return attribute === "template" ? "caption" : attribute === "hook_type" ? "hook" : "insight"
}

export const lessonKey = (f: Pick<Finding, "attribute" | "value">) => `${f.attribute}:${f.value}`

/** IST time-of-day bucket for a post. */
export function timeSlot(scheduledTime: string | null | undefined, publishedAt: string | null | undefined): string | null {
  let hour: number | null = null
  const hm = scheduledTime?.match(/^(\d{1,2}):\d{2}/)
  if (hm) hour = Number(hm[1])
  else if (publishedAt) {
    const t = Date.parse(publishedAt)
    if (!Number.isNaN(t)) hour = new Date(t + 330 * 60_000).getUTCHours()
  }
  if (hour === null) return null
  return hour >= 5 && hour < 11 ? "morning" : hour >= 11 && hour < 16 ? "afternoon" : hour >= 16 && hour < 21 ? "evening" : "night"
}

// ─── Database ──────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

type EntryRow = { id: string; content_type: string | null; scheduled_time: string | null; updated_at: string; hook_id: string | null; platform_specific_data: Record<string, unknown> | null }
type EngagementRow = { calendar_entry_id: string; like_count: number; comments_count: number; saves?: number | null; shares?: number | null; reach?: number | null }

/** The brand's published items of the last WINDOW_DAYS that have engagement, with their attributes. */
export async function collectPostedItems(db: Db, brandId: string, now = Date.now()): Promise<PostedItem[]> {
  const since = new Date(now - WINDOW_DAYS * 86_400_000).toISOString()
  const { data: entries } = await db.from("calendar_entries")
    .select("id, content_type, scheduled_time, updated_at, hook_id, platform_specific_data")
    .eq("brand_id", brandId).eq("status", "published").gte("updated_at", since)
    .order("updated_at", { ascending: false }).limit(200) as { data: EntryRow[] | null }
  if (!entries?.length) return []
  const ids = entries.map((e) => e.id)
  const full = await db.from("content_engagement")
    .select("calendar_entry_id, like_count, comments_count, saves, shares, reach").in("calendar_entry_id", ids) as { data: EngagementRow[] | null; error: unknown }
  let engagement = full.data
  // Before migration 070: likes and comments only.
  if (full.error) ({ data: engagement } =await db.from("content_engagement").select("calendar_entry_id, like_count, comments_count").in("calendar_entry_id", ids) as { data: EngagementRow[] | null })
  const byEntry = new Map((engagement ?? []).map((e) => [e.calendar_entry_id, e]))
  const hookIds = [...new Set(entries.map((e) => e.hook_id).filter((h): h is string => !!h))]
  const { data: hooks } = hookIds.length ? await db.from("hooks").select("id, hook_type").in("id", hookIds) as { data: { id: string; hook_type: string | null }[] | null } : { data: [] }
  const hookType = new Map((hooks ?? []).map((h) => [h.id, h.hook_type]))

  const items: PostedItem[] = []
  for (const e of entries) {
    const eng = byEntry.get(e.id)
    if (!eng) continue
    const psd = e.platform_specific_data ?? {}
    const learning = (psd.learning ?? {}) as Record<string, unknown>
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined)
    const format = psd.content_format === "video" ? "reel" : psd.content_format === "carousel" ? "carousel" : str(e.content_type) ?? "post"
    items.push({
      id: e.id,
      likes: eng.like_count ?? 0,
      comments: eng.comments_count ?? 0,
      saves: eng.saves ?? null,
      shares: eng.shares ?? null,
      reach: eng.reach ?? null,
      attrs: {
        format,
        template: str((psd.post_design as Record<string, unknown> | undefined)?.template) ?? str(learning.template),
        hook_type: str(learning.hook_type) ?? (e.hook_id ? str(hookType.get(e.hook_id)) : undefined),
        content_angle: str(learning.content_angle),
        photo_source: str(learning.photo_source),
        time_slot: timeSlot(e.scheduled_time, e.updated_at) ?? undefined,
      },
    })
  }
  return items
}

export type LearningReport =
  | { status: "not_enough"; items: number }
  | { status: "learned"; items: number; findings: Finding[]; written: number; errors: string[] }

/** One brand's weekly pass: findings -> performance lessons (inserted, or refreshed by key). Never throws. */
export async function runPerformanceLearning(db: Db, brandId: string, now = Date.now()): Promise<LearningReport> {
  const errors: string[] = []
  try {
    const items = await collectPostedItems(db, brandId, now)
    if (items.length < MIN_ITEMS) return { status: "not_enough", items: items.length }
    const findings = attributeFindings(items)
    const { data: existing, error } = await db.from("brand_lessons").select("id, lesson_key, status").eq("brand_id", brandId).eq("source", "performance") as { data: { id: string; lesson_key: string | null; status: string }[] | null; error: { message: string } | null }
    if (error) return { status: "learned", items: items.length, findings, written: 0, errors: [`brand_lessons (migration 070?): ${error.message}`] }
    const byKey = new Map((existing ?? []).filter((l) => l.lesson_key).map((l) => [l.lesson_key!, l]))
    const stamp = new Date(now).toISOString()
    const expires = new Date(now + LESSON_DAYS * 86_400_000).toISOString()
    let written = 0
    for (const f of findings) {
      const row = {
        scope: findingScope(f.attribute), kind: f.kind, rule: findingRule(f), evidence_count: f.count, status: "active",
        last_seen_at: stamp, expires_at: expires,
        evidence: { attribute: f.attribute, value: f.value, items: f.count, gap: f.gap, out_of: items.length },
      }
      const known = byKey.get(lessonKey(f))
      // The owner removed this one (brand page): never brought back.
      if (known?.status === "retired") continue
      const id = known?.id
      const { error: writeError } = id
        ? await db.from("brand_lessons").update(row).eq("id", id)
        : await db.from("brand_lessons").insert({ ...row, brand_id: brandId, source: "performance", lesson_key: lessonKey(f) })
      if (writeError) errors.push(`${lessonKey(f)}: ${writeError.message}`)
      else written++
    }
    return { status: "learned", items: items.length, findings, written, errors }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err))
    return { status: "learned", items: 0, findings: [], written: 0, errors }
  }
}

export type PerformanceLesson = BrandLesson & { evidence: { attribute: Attribute; value: string; items: number; gap: number } | null }

/** The brand's live performance lessons, strongest first. [] on any error (or before migration 070). */
export async function getPerformanceLessons(db: Db, brandId: string, now = Date.now()): Promise<PerformanceLesson[]> {
  try {
    const { data, error } = await db.from("brand_lessons")
      .select("id, scope, kind, rule, evidence_count, last_seen_at, evidence, expires_at")
      .eq("brand_id", brandId).eq("source", "performance").eq("status", "active")
      .gt("expires_at", new Date(now).toISOString())
    if (error) return []
    return ((data ?? []) as PerformanceLesson[]).sort((a, b) => Math.abs(b.evidence?.gap ?? 0) - Math.abs(a.evidence?.gap ?? 0))
  } catch {
    return []
  }
}

/** Content angles (Autopilot pillars) that work for the brand -- the mix leans on them. */
export function winningAngles(lessons: PerformanceLesson[]): string[] {
  return lessons.filter((l) => l.kind === "do" && l.evidence?.attribute === "content_angle").map((l) => l.evidence!.value)
}

/**
 * About 70% of Autopilot slots lean on what works (the performance lessons
 * ride along); the other 30% explore without them, so a new layout / hook
 * still gets tried. Deterministic by slot index.
 */
export const exploresThisSlot = (slotIndex: number): boolean => slotIndex % 10 >= 7
