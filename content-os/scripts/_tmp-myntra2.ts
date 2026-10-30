import { readFileSync } from "fs"
for (const line of readFileSync(".env.local", "utf-8").split("\n")) { const i = line.indexOf("="); if (i > 0 && !line.trim().startsWith("#")) process.env[line.slice(0, i).trim()] ??= line.slice(i + 1).trim().replace(/^["']|["']$/g, "") }
async function main() {
  const { createClient } = await import("@supabase/supabase-js")
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const id = "917db72f-5c4a-487c-8087-c7ece249cb82"
  const { data: s } = await db.from("stories").select("*").eq("brand_id", id).order("created_at", { ascending: false }).limit(1).single()
  console.log("ORIGINAL", JSON.stringify(s?.original_copy).slice(0, 2500))
  console.log("STORIES", JSON.stringify(s?.stories).slice(0, 2500))
  const { data: past } = await db.from("stories").select("stories,user_rating").eq("brand_id", id).gte("user_rating", 4)
  console.log("PAST(rated>=4)", JSON.stringify(past))
  const { count } = await db.from("stories").select("*", { count: "exact", head: true }).eq("brand_id", id)
  console.log("TOTAL STORIES", count)
  const { data: logs } = await db.from("ai_generation_logs").select("created_at,feature,credits_charged,success").eq("brand_id", id).order("created_at", { ascending: true })
  console.log("ALL LOGS", JSON.stringify(logs))
}
main()
