import { readFileSync } from "fs"
for (const line of readFileSync(".env.local", "utf-8").split("\n")) { const i = line.indexOf("="); if (i > 0 && !line.trim().startsWith("#")) process.env[line.slice(0, i).trim()] ??= line.slice(i + 1).trim().replace(/^["']|["']$/g, "") }
async function main() {
  const { createClient } = await import("@supabase/supabase-js")
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const id = "917db72f-5c4a-487c-8087-c7ece249cb82"
  const { data: brand } = await db.from("brands").select("*").eq("id", id).single()
  console.log("BRAND", JSON.stringify({ name: brand?.name, niche: brand?.niche, desc: brand?.description, vibe: brand?.vibe, brain: brand?.brand_brain }).slice(0, 1500))
  const { data: stories } = await db.from("stories").select("*").eq("brand_id", id).order("created_at", { ascending: false }).limit(10)
  for (const s of stories ?? []) console.log("STORY", s.created_at, JSON.stringify({ topic: s.topic, n: Array.isArray(s.stories) ? s.stories.length : null, keys: Object.keys(s) }), JSON.stringify(s.stories).slice(0, 900))
  const { data: logs } = await db.from("ai_generation_logs").select("*").eq("brand_id", id).order("created_at", { ascending: false }).limit(15)
  for (const l of logs ?? []) console.log("LOG", l.created_at, l.feature, l.model, l.success, (l.error_message ?? "").slice(0, 120), JSON.stringify(Object.keys(l)))
  const { data: lessons, error: le } = await db.from("brand_lessons").select("*").eq("brand_id", id)
  console.log("LESSONS", le?.message, JSON.stringify(lessons))
}
main()
