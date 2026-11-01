import { createAdminClient } from "@/lib/supabase/server"

// /admin/metrics "What each brand has learned": per brand, its live
// performance lessons -- what's working / what isn't, from its own posts'
// results (lib/ai/performance-learning.ts). Plain words, newest first.

export interface BrandLearned {
  brandId: string
  brandName: string
  working: string[]
  notWorking: string[]
}

export async function getLearnedByBrand(): Promise<{ brands: BrandLearned[]; error: string | null }> {
  const admin = await createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin.from("brand_lessons") as any)
    .select("brand_id, kind, rule, source, expires_at, last_seen_at")
    .eq("source", "performance")
    .eq("status", "active")
    .order("last_seen_at", { ascending: false })
    .limit(1000) as { data: { brand_id: string; kind: "do" | "avoid"; rule: string; source: string; expires_at?: string | null }[] | null; error: { message: string } | null }
  if (error) return { brands: [], error: error.message }
  const now = Date.now()
  const live = (data ?? []).filter((l) => !l.expires_at || Date.parse(l.expires_at) > now)
  const ids = [...new Set(live.map((l) => l.brand_id))]
  const { data: brands } = ids.length ? await admin.from("brands").select("id, name").in("id", ids).returns<{ id: string; name: string }[]>() : { data: [] }
  const name = new Map((brands ?? []).map((b) => [b.id, b.name]))
  const out = new Map<string, BrandLearned>()
  for (const l of live) {
    const b = out.get(l.brand_id) ?? { brandId: l.brand_id, brandName: name.get(l.brand_id) ?? l.brand_id, working: [], notWorking: [] }
    if (l.kind === "do") b.working.push(l.rule)
    else b.notWorking.push(l.rule)
    out.set(l.brand_id, b)
  }
  return { brands: [...out.values()].sort((a, b) => a.brandName.localeCompare(b.brandName)), error: null }
}
