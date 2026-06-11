import { createClient } from "@/lib/supabase/server"
import type { UserRow } from "@/types/database"

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [profileResult, countResult] = await Promise.all([
    supabase
      .from("users")
      .select("full_name, plan")
      .eq("id", user!.id)
      .single<Pick<UserRow, "full_name" | "plan">>(),
    supabase
      .from("brands")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user!.id),
  ])

  const profile = profileResult.data
  const brandCount = countResult.count
  const firstName = profile?.full_name?.split(" ")[0] ?? "there"

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          Good morning, {firstName} 👋
        </h1>
        <p className="mt-1 text-muted-foreground">
          Here&apos;s what&apos;s happening with your content today.
        </p>
      </div>

      {brandCount === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-16 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <svg
              className="h-6 w-6 text-primary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold">Create your first brand</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Add your brand identity — tone, audience, values — so the AI can
            generate content that actually sounds like you.
          </p>
          <a
            href="/brands/new"
            className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Create brand
          </a>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border bg-card p-6">
            <p className="text-sm text-muted-foreground">Brands</p>
            <p className="mt-1 text-3xl font-bold">{brandCount ?? 0}</p>
          </div>
        </div>
      )}
    </div>
  )
}
