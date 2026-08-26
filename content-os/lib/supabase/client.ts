import { createBrowserClient } from "@supabase/ssr"
import type { Database } from "@/types/database"

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set.")
  }
  return createBrowserClient<Database>(url, anonKey, {
    auth: {
      // This client is only ever used for one-shot auth actions (login,
      // signup, magic link, OAuth kickoff, sign out — see the handful of
      // call sites, all under app/(auth) plus the sign-out button) and
      // never for an ongoing session (all real data fetching goes through
      // /api/v1/* routes, each backed by its own server-side client). Its
      // default autoRefreshToken:true (see createBrowserClient's own
      // defaults) ran a background refresh timer that served no purpose
      // here but competed with proxy.ts's server-side refresh over the
      // same one-time-use refresh token — losing that race clears the
      // session outright (see proxy.ts's matcher comment for the full
      // mechanism). Disabling it removes this client as a racing party
      // entirely; nothing in this app depends on it keeping a session
      // fresh in the background.
      autoRefreshToken: false,
    },
  })
}
