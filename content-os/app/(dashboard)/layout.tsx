import { redirect } from "next/navigation"
import { after } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { DashboardShell } from "@/components/layout/DashboardShell"
import { ProductTour } from "@/components/shared/ProductTour"
import NextTopLoader from "nextjs-toploader"
import type { UserRow } from "@/types/database"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

// Throttle for the last_active_at write below -- deliberately not updated
// on every API call (pure write amplification for no real benefit here);
// once per ~2 hours per user, on a real authenticated dashboard page
// load, is more than enough resolution for the 14-day-inactivity
// lifecycle email this feeds (supabase/migrations/042_last_active_at.sql,
// app/api/v1/cron/send-lifecycle-emails/route.ts).
const ACTIVITY_THROTTLE_MS = 2 * 60 * 60 * 1000

// Pulled out of the layout component and into a plain function on
// purpose: this repo's React purity lint rule (eslint-plugin-react-hooks)
// statically rejects any Date.now()/new Date() call textually inside a
// component function, even one that (like this) only actually runs
// post-response inside after(). Being a non-component function is what
// exempts it.
async function recordActivityIfStale(
  supabase: SupabaseClient<Database>,
  userId: string,
  lastActiveAtIso: string | null
): Promise<void> {
  const lastActiveAtMs = lastActiveAtIso ? new Date(lastActiveAtIso).getTime() : 0
  if (Date.now() - lastActiveAtMs <= ACTIVITY_THROTTLE_MS) return

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from("users") as any)
    .update({ last_active_at: new Date().toISOString() })
    .eq("id", userId)
  if (error) {
    console.error("[dashboard/layout] last_active_at update failed:", error.message)
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    redirect("/login")
  }

  // plan/generation_count no longer queried here -- Header now reads
  // those live via useUserCredits() (hooks/useUserCredits.ts) instead of
  // a static server-rendered prop that never updated after this layout's
  // initial render (it persists across client-side navigation between
  // dashboard pages, unlike a leaf page's own data fetch).
  const { data: profile } = await supabase
    .from("users")
    .select("full_name, last_active_at")
    .eq("id", user.id)
    .single<Pick<UserRow, "full_name" | "last_active_at">>()

  // Fired via after() so the activity write never delays this layout's
  // own render/response -- same pattern already used elsewhere in this
  // codebase for post-response, non-blocking writes (e.g. the
  // ai_generation_logs inserts in the generation routes).
  after(() => recordActivityIfStale(supabase, user.id, profile?.last_active_at ?? null))

  return (
    <>
      <NextTopLoader color="#7c3aed" height={3} showSpinner={false} />
      <DashboardShell
        userEmail={user.email}
        userName={profile?.full_name ?? undefined}
      >
        {children}
      </DashboardShell>
      <ProductTour />
    </>
  )
}
