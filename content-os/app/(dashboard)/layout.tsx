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

  const { data: profile } = await supabase
    .from("users")
    .select("full_name, plan, generation_count")
    .eq("id", user.id)
    .single<Pick<UserRow, "full_name" | "plan" | "generation_count">>()

  return (
    <>
      <NextTopLoader color="#7c3aed" height={3} showSpinner={false} />
      <DashboardShell
        userEmail={user.email}
        userName={profile?.full_name ?? undefined}
        generationCount={profile?.generation_count ?? 0}
        plan={profile?.plan ?? "free"}
      >
        {children}
      </DashboardShell>
      <ProductTour />
    </>
  )
}
