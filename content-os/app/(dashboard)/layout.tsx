import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { DashboardShell } from "@/components/layout/DashboardShell"
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
    .select("full_name, plan")
    .eq("id", user.id)
    .single<Pick<UserRow, "full_name" | "plan">>()

  return (
    <DashboardShell
      userEmail={user.email}
      userName={profile?.full_name ?? undefined}
    >
      {children}
    </DashboardShell>
  )
}
