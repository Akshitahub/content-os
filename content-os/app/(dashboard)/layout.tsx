import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { DashboardShell } from "@/components/layout/DashboardShell"
import { ProductTour } from "@/components/shared/ProductTour"
import NextTopLoader from "nextjs-toploader"
import type { UserRow } from "@/types/database"

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
    .select("full_name")
    .eq("id", user.id)
    .single<Pick<UserRow, "full_name">>()

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
