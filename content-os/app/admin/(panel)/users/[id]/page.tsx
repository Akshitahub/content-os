import { notFound } from "next/navigation"
import Link from "next/link"
import { getAdminUserDetail } from "@/lib/admin/get-user-detail"

type PageParams = { params: Promise<{ id: string }> }

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{value}</dd>
    </div>
  )
}

export default async function AdminUserDetailPage({ params }: PageParams) {
  const { id } = await params
  const detail = await getAdminUserDetail(id)
  if (!detail) notFound()

  const { profile, brands, activity, purchases, creditSummary, postCosts } = detail

  return (
    <div className="space-y-8">
      <div>
        <Link href="/admin/users" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
          ← Users
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">{profile.full_name || profile.email}</h1>
        <p className="text-sm text-muted-foreground">{profile.email}</p>
      </div>

      {/* Profile summary */}
      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Profile</h2>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <SummaryItem label="Plan" value={profile.plan} />
          <SummaryItem label="Billing period" value={profile.plan_billing_period ?? "—"} />
          <SummaryItem label="Trialing" value={creditSummary.trialing ? `Yes (${creditSummary.trialDaysLeft}d left)` : "No"} />
          <SummaryItem label="Subscribed" value={profile.subscribed_at ? new Date(profile.subscribed_at).toLocaleDateString() : "No"} />
          <SummaryItem label="Credits used" value={`${creditSummary.used.toLocaleString()} / ${creditSummary.limit.toLocaleString()}`} />
          <SummaryItem label="Top-up balance" value={creditSummary.topupBalance.toLocaleString()} />
          <SummaryItem label="Total remaining" value={creditSummary.remaining.toLocaleString()} />
          <SummaryItem label="Last active" value={profile.last_active_at ? new Date(profile.last_active_at).toLocaleString() : "Never"} />
          <SummaryItem label="Joined" value={new Date(profile.created_at).toLocaleDateString()} />
          <SummaryItem label="Marketing opt-out" value={profile.marketing_emails_opted_out ? "Yes" : "No"} />
        </dl>
      </section>

      {/* Brands */}
      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Brands ({brands.length})</h2>
        {brands.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No brands yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {brands.map((brand) => (
              <li key={brand.id} className="flex items-center justify-between text-sm">
                <span>{brand.name}</span>
                <span className="text-xs text-muted-foreground">{new Date(brand.created_at).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Activity table */}
      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Recent activity{activity.length > 0 ? ` (last ${activity.length})` : ""}
        </h2>
        {activity.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No generations yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Feature</th>
                  <th className="py-2 pr-4 font-medium">Model</th>
                  <th className="py-2 pr-4 font-medium">Credits</th>
                  <th className="py-2 pr-4 font-medium">Cost</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="py-2 pr-4">{row.feature}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{row.model}</td>
                    <td className="py-2 pr-4">{row.credits_charged ?? "—"}</td>
                    <td className="py-2 pr-4">{row.cost_usd !== null ? `$${row.cost_usd.toFixed(4)}` : "—"}</td>
                    <td className="py-2 pr-4">
                      <span className={row.success ? "text-green-600" : "text-destructive"}>
                        {row.success ? "Success" : "Failed"}
                      </span>
                    </td>
                    <td className="py-2 text-muted-foreground">{new Date(row.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Cost per post (ai_generation_cost_by_project, migration 056) */}
      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Cost per post{postCosts && postCosts.length > 0 ? ` (last ${postCosts.length})` : ""}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Create → Full Post only (text + image, retries included). Latency is the sum of every call, not wall-clock time.
        </p>
        {postCosts === null ? (
          <p className="mt-3 text-sm text-muted-foreground">Not available yet. Run migration 056 in the Supabase SQL Editor.</p>
        ) : postCosts.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No posts with tracked cost yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Post</th>
                  <th className="py-2 pr-4 font-medium">Cost</th>
                  <th className="py-2 pr-4 font-medium">Tokens</th>
                  <th className="py-2 pr-4 font-medium">Latency</th>
                  <th className="py-2 pr-4 font-medium">Calls</th>
                  <th className="py-2 font-medium">Last</th>
                </tr>
              </thead>
              <tbody>
                {postCosts.map((row) => (
                  <tr key={row.content_project_id} className="border-b last:border-0">
                    <td className="max-w-[16rem] truncate py-2 pr-4">{row.title ?? row.content_project_id}</td>
                    <td className="py-2 pr-4">{row.total_cost_usd !== null ? `$${row.total_cost_usd.toFixed(4)}` : "—"}</td>
                    <td className="py-2 pr-4">{row.total_tokens !== null ? row.total_tokens.toLocaleString() : "—"}</td>
                    <td className="py-2 pr-4">{row.total_latency_ms !== null ? `${(row.total_latency_ms / 1000).toFixed(1)}s` : "—"}</td>
                    <td className="py-2 pr-4">
                      {row.log_rows}
                      {row.failed_rows > 0 && <span className="text-destructive"> ({row.failed_rows} failed)</span>}
                    </td>
                    <td className="py-2 text-muted-foreground">{new Date(row.last_logged_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Purchases table */}
      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Credit purchases ({purchases.length})</h2>
        {purchases.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No purchases yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Pack</th>
                  <th className="py-2 pr-4 font-medium">Credits</th>
                  <th className="py-2 pr-4 font-medium">Paid</th>
                  <th className="py-2 pr-4 font-medium">Payment ID</th>
                  <th className="py-2 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="py-2 pr-4">{row.pack_id}</td>
                    <td className="py-2 pr-4">{row.credits.toLocaleString()}</td>
                    <td className="py-2 pr-4">₹{row.amount_paid.toLocaleString("en-IN")}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{row.razorpay_payment_id}</td>
                    <td className="py-2 text-muted-foreground">{new Date(row.purchased_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
