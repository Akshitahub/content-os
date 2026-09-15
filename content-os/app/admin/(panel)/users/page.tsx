import Link from "next/link"
import { getAdminUserList } from "@/lib/admin/list-users"
import type { UserPlan } from "@/types/app"

type PageProps = {
  searchParams: Promise<{ search?: string; plan?: string; page?: string }>
}

const PLAN_OPTIONS: { value: UserPlan; label: string }[] = [
  { value: "starter", label: "Starter" },
  { value: "pro", label: "Pro" },
  { value: "agency", label: "Agency" },
]

function statusLabel(user: { trialing: boolean; subscribed: boolean }): string {
  if (user.subscribed) return "Subscribed"
  if (user.trialing) return "Trialing"
  return "Trial expired"
}

// Preserves whichever of search/plan are already set while changing only
// `page` -- shared by the Prev/Next links below.
function buildHref(search: string | undefined, plan: string | undefined, page: number): string {
  const qs = new URLSearchParams()
  if (search) qs.set("search", search)
  if (plan) qs.set("plan", plan)
  if (page > 1) qs.set("page", String(page))
  const query = qs.toString()
  return query ? `/admin/users?${query}` : "/admin/users"
}

export default async function AdminUsersPage({ searchParams }: PageProps) {
  const { search, plan: planParam, page: pageParam } = await searchParams
  const plan = planParam && PLAN_OPTIONS.some((p) => p.value === planParam) ? (planParam as UserPlan) : undefined
  const page = Number(pageParam) > 0 ? Number(pageParam) : 1

  const { users, total, pageSize } = await getAdminUserList({ search, plan, page })
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">{total.toLocaleString("en-IN")} total.</p>
      </div>

      <form className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4">
        <input
          type="text"
          name="search"
          defaultValue={search ?? ""}
          placeholder="Search by email or name…"
          className="h-9 min-w-[220px] flex-1 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <select
          name="plan"
          defaultValue={plan ?? ""}
          className="h-9 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All plans</option>
          {PLAN_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
        <button
          type="submit"
          className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Filter
        </button>
        {(search || plan) && (
          <Link href="/admin/users" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
            Clear
          </Link>
        )}
      </form>

      <section className="rounded-xl border bg-card p-5">
        {users.length === 0 ? (
          <p className="text-sm text-muted-foreground">No users match.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">User</th>
                  <th className="py-2 pr-4 font-medium">Plan</th>
                  <th className="py-2 pr-4 font-medium">Credits used / limit</th>
                  <th className="py-2 pr-4 font-medium">Remaining</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Last active</th>
                  <th className="py-2 font-medium">Joined</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <Link key={user.id} href={`/admin/users/${user.id}`} className="contents">
                    <tr className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/40">
                      <td className="py-2 pr-4">
                        <div className="font-medium">{user.full_name || user.email}</div>
                        {user.full_name && <div className="text-xs text-muted-foreground">{user.email}</div>}
                      </td>
                      <td className="py-2 pr-4 capitalize">{user.plan}</td>
                      <td className="py-2 pr-4">{user.creditsUsed.toLocaleString()} / {user.creditsLimit.toLocaleString()}</td>
                      <td className="py-2 pr-4">{user.creditsRemaining.toLocaleString()}</td>
                      <td className="py-2 pr-4">{statusLabel(user)}</td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {user.last_active_at ? new Date(user.last_active_at).toLocaleDateString() : "Never"}
                      </td>
                      <td className="py-2 text-muted-foreground">{new Date(user.created_at).toLocaleDateString()}</td>
                    </tr>
                  </Link>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link href={buildHref(search, plan, page - 1)} className="rounded-md border px-3 py-1.5 transition-colors hover:bg-muted/40">
                  ← Previous
                </Link>
              )}
              {page < totalPages && (
                <Link href={buildHref(search, plan, page + 1)} className="rounded-md border px-3 py-1.5 transition-colors hover:bg-muted/40">
                  Next →
                </Link>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
