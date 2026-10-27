/**
 * One-off backfill: runs lib/ai/brand-brain.ts's lesson distillation over
 * every existing content_feedback_notes row (oldest first), so feedback
 * given before brand_lessons existed (supabase/migrations/
 * 059_brand_lessons.sql) still becomes durable rules.
 *
 * DRY RUN BY DEFAULT -- calls the model for each note and prints the
 * decision (merge/create/skip) without writing anything. In a dry run a
 * later note can't merge into a lesson an earlier note would have created,
 * since nothing is written; --apply processes notes in the same order with
 * real writes, so it can.
 *
 * Not idempotent: re-applying would count every note twice, so --apply
 * refuses when 'feedback_note' lessons already exist unless --force.
 * Requires migration 059 to have been run.
 *
 * Run:
 *   npx tsx scripts/backfill-brand-lessons.ts            # dry run
 *   npx tsx scripts/backfill-brand-lessons.ts --apply    # writes lessons
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
 * GROQ_API_KEY, loaded from .env.local automatically if present.
 */
import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
import { applyLessonDecision, decideLesson, type DistillInput } from "@/lib/ai/brand-brain"

function loadEnvLocal(): void {
  const envPath = join(process.cwd(), ".env.local")
  if (!existsSync(envPath)) return
  const contents = readFileSync(envPath, "utf-8")
  for (const line of contents.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let value = trimmed.slice(eqIdx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

loadEnvLocal()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in .env.local or the environment.")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const APPLY = process.argv.includes("--apply")
const FORCE = process.argv.includes("--force")
const PAGE = 1000

// content_feedback_notes.content_type -> the table/column holding its text.
// Only caption/hook notes are written today (see migration 053).
const CONTENT_SOURCES: Record<string, { scope: DistillInput["scope"]; table: string; column: string }> = {
  caption: { scope: "caption", table: "captions", column: "caption_text" },
  hook: { scope: "hook", table: "hooks", column: "hook_text" },
}

type NoteRow = { id: string; brand_id: string; content_type: string; content_id: string; rating: number; note: string | null; created_at: string }

async function fetchNotes(): Promise<NoteRow[]> {
  const out: NoteRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("content_feedback_notes")
      .select("id, brand_id, content_type, content_id, rating, note, created_at")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`content_feedback_notes fetch failed: ${error.message}`)
    out.push(...((data ?? []) as NoteRow[]))
    if ((data ?? []).length < PAGE) break
  }
  return out
}

async function main(): Promise<void> {
  console.log(`Mode: ${APPLY ? "APPLY (writes brand_lessons)" : "DRY RUN (nothing is written)"}\n`)

  // Not a head:true count -- a HEAD request against a missing table comes
  // back with no error at all, which would hide an un-run migration.
  const { data: existingLessons, error: lessonsError } = await supabase
    .from("brand_lessons")
    .select("id")
    .eq("source", "feedback_note")
    .limit(1)
  const existingCount = existingLessons?.length ?? 0
  if (lessonsError) {
    const msg = `brand_lessons isn't readable (${lessonsError.message}) -- has migration 059 been run?`
    if (APPLY) {
      console.error(msg)
      process.exit(1)
    }
    console.warn(`WARNING: ${msg} Continuing the dry run without existing lessons.\n`)
  } else if (APPLY && existingCount > 0 && !FORCE) {
    console.error(`'feedback_note' lessons already exist -- re-applying would double-count. Pass --force to run anyway.`)
    process.exit(1)
  }

  const notes = await fetchNotes()
  const tally = { merge: 0, create: 0, skip: 0, failed: 0, ignored: 0 }

  for (const [i, row] of notes.entries()) {
    const source = CONTENT_SOURCES[row.content_type]
    const note = row.note?.trim()
    if (!source || !note) {
      tally.ignored++
      continue
    }
    const { data: content } = await supabase.from(source.table).select(source.column).eq("id", row.content_id).maybeSingle()
    const contentText = ((content as Record<string, unknown> | null)?.[source.column] as string | undefined) ?? ""

    const input: DistillInput = { brandId: row.brand_id, scope: source.scope, rating: row.rating, note, contentText }
    const result = await decideLesson(supabase, input)
    const prefix = `[${i + 1}/${notes.length}] ${row.created_at.slice(0, 10)} brand ${row.brand_id.slice(0, 8)} ${row.content_type} ${row.rating}/5 "${note.slice(0, 80)}"`
    if (!result) {
      tally.failed++
      console.log(`${prefix}\n    -> failed (see error above)`)
      continue
    }
    const d = result.decision
    tally[d.action]++
    const detail = d.action === "create" ? `create ${d.kind} [${d.scope}]: ${d.rule}`
      : d.action === "merge" ? `merge into "${result.existing.find((l) => l.id === d.lesson_id)?.rule}"`
      : "skip"
    console.log(`${prefix}\n    -> ${detail}`)
    if (APPLY) await applyLessonDecision(supabase, row.brand_id, d, result.existing)
  }

  console.log(`\n${notes.length} notes: ${tally.create} create, ${tally.merge} merge, ${tally.skip} skip, ${tally.failed} failed, ${tally.ignored} ignored (no note text or unsupported type).`)
  if (!APPLY) console.log("Dry run only. Re-run with --apply to write these lessons.")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
