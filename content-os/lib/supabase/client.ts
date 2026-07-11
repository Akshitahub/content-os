import { createBrowserClient } from "@supabase/ssr"
import type { Database } from "@/types/database"

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set.")
  }
  return createBrowserClient<Database>(url, anonKey)
}
