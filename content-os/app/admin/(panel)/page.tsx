import { getAdminDashboardStats } from "@/lib/admin/dashboard-stats"

export default async function AdminOverviewPage() {
  const stats = await getAdminDashboardStats()

  const cards = [
    { label: "Starter users", value: stats.usersByPlan.starter.toLocaleString("en-IN") },
    { label: "Pro users", value: stats.usersByPlan.pro.toLocaleString("en-IN") },
    { label: "Agency users", value: stats.usersByPlan.agency.toLocaleString("en-IN") },
    { label: "Trialing", value: stats.trialingCount.toLocaleString("en-IN") },
    { label: "Subscribed", value: stats.subscribedCount.toLocaleString("en-IN") },
    { label: "Active in last 7 days", value: stats.activeLast7DaysCount.toLocaleString("en-IN") },
    { label: "This month's AI cost", value: `$${stats.monthCostUsd.toFixed(2)}` },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">Account and usage snapshot.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border bg-card p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{card.label}</p>
            <p className="mt-2 text-2xl font-bold tracking-tight">{card.value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
