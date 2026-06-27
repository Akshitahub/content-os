import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { SettingsContent } from "@/components/settings/SettingsContent"
import type { Metadata } from "next"
import type { UserRow, BrandRow } from "@/types/database"

export const metadata: Metadata = { title: "Settings — ContentOS" }

export default async function SettingsPage() {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    redirect("/login")
  }

  const [profileResult, brandsResult] = await Promise.all([
    supabase
      .from("users")
      .select("full_name, email, plan, generation_count, generation_count_reset_at")
      .eq("id", user.id)
      .single<Pick<UserRow, "full_name" | "email" | "plan" | "generation_count" | "generation_count_reset_at">>(),
    supabase
      .from("brands")
      .select("id, name, niche, is_active")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .returns<Pick<BrandRow, "id" | "name" | "niche" | "is_active">[]>(),
  ])

  const profile = profileResult.data
  const brands = brandsResult.data ?? []

  return (
    <div className="px-4 py-6 md:p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-muted-foreground">
          Manage your account, plan, and brands.
        </p>
      </div>
      <SettingsContent
        user={{
          full_name: profile?.full_name ?? null,
          email: profile?.email ?? user.email ?? "",
          plan: profile?.plan ?? "free",
          generation_count: profile?.generation_count ?? 0,
          generation_count_reset_at: profile?.generation_count_reset_at ?? null,
        }}
        brands={brands}
      />
    </div>
  )
}
