// Dev-only, fully offline check of lib/ai/brand-brain-derive.ts's write
// rules (writeBrainFields' read-merge-update fallback, the same rules as
// set_brand_brain_fields in migration 065) -- no model calls, no network,
// no database: an in-memory stand-in plays Supabase. Run manually:
// `npx tsx scripts/test-brand-brain-derive.ts`. Exits non-zero if any
// case fails.
//
// NOT reachable in production: a standalone script, never served by
// Next.js. The NODE_ENV guard is defense-in-depth only, same as
// scripts/test-fact-guard.ts.
import { isEmptyBrainValue, writeBrainFields } from "@/lib/ai/brand-brain-derive"

if (process.env.NODE_ENV === "production") {
  console.error("[test-brand-brain-derive] refusing to run with NODE_ENV=production -- this is a dev-only check.")
  process.exit(1)
}

type Brain = Record<string, unknown>

// Supabase stand-in: the RPC reports "function missing" (before 065), so
// writeBrainFields takes its read-merge-update fallback; the brand's
// brand_brain is read from / written back to `row`.
function fakeDb(row: { brand_brain: Brain }) {
  return {
    rpc: async () => ({ error: { code: "PGRST202", message: "Could not find the function public.set_brand_brain_fields" } }),
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { brand_brain: row.brand_brain }, error: null }) }) }),
      update: (values: { brand_brain: Brain }) => ({ eq: async () => { row.brand_brain = values.brand_brain; return { error: null } } }),
    }),
  }
}

const derived = { facts: { differentiators: ["Hand-poured in small batches"] } }

async function differentiatorsAfter(brain: Brain): Promise<unknown> {
  const row = { brand_brain: brain }
  await writeBrainFields(fakeDb(row), "brand-1", derived, true)
  return (row.brand_brain.facts as Brain | undefined)?.differentiators
}

let failures = 0
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` -- got ${JSON.stringify(detail)}`}`)
  if (!ok) failures++
}

async function main() {
  // The bug: BrandBrainSection saved empty boxes as [], and that [] (no
  // field_meta) counted as the user's own, so the brand was never filled.
  const fromEmptyBox = await differentiatorsAfter({ facts: { differentiators: [] } })
  check("[] with no field_meta is auto-filled", JSON.stringify(fromEmptyBox) === JSON.stringify(derived.facts.differentiators), fromEmptyBox)

  for (const empty of [null, "", {}]) {
    const got = await differentiatorsAfter({ facts: { differentiators: empty } })
    check(`${JSON.stringify(empty)} with no field_meta is auto-filled`, JSON.stringify(got) === JSON.stringify(derived.facts.differentiators), got)
  }

  const missing = await differentiatorsAfter({})
  check("missing field is auto-filled", JSON.stringify(missing) === JSON.stringify(derived.facts.differentiators), missing)

  // Still the user's own: a non-empty value from before field_meta, or an edit.
  const typedBefore = await differentiatorsAfter({ facts: { differentiators: ["Our own words"] } })
  check("non-empty value with no field_meta is kept", JSON.stringify(typedBefore) === JSON.stringify(["Our own words"]), typedBefore)

  const edited = await differentiatorsAfter({ facts: { differentiators: [] }, field_meta: { differentiators: { auto: false } } })
  check("auto: false is kept even when empty", JSON.stringify(edited) === JSON.stringify([]), edited)

  check("isEmptyBrainValue: plain text is not empty", !isEmptyBrainValue("x"))
  check("isEmptyBrainValue: [\"\"] is not empty (same as the SQL rule)", !isEmptyBrainValue([""]))

  const total = 9
  console.log(`\n[test-brand-brain-derive] ${total - failures}/${total} passed`)
  if (failures > 0) process.exit(1)
}

main()
