import Link from "next/link"
import { getContentMetrics, METRIC_WINDOWS, type MetricWindow } from "@/lib/admin/metrics"

type PageProps = {
  searchParams: Promise<{ days?: string }>
}

const TYPE_LABELS: Record<string, string> = {
  caption: "Captions",
  hook: "Hooks",
  carousel: "Carousels",
  story: "Stories",
  ad_copy: "Ad copy",
  post_image: "Post images",
  ad_maker: "Ad Maker",
}

const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(0)}%`)
const num = (v: number | null, digits = 1) => (v == null ? "—" : v.toFixed(digits))
const usd = (v: number | null) => (v == null ? "—" : `$${v.toFixed(4)}`)

export default async function AdminMetricsPage({ searchParams }: PageProps) {
  const { days: daysParam } = await searchParams
  const days: MetricWindow = Number(daysParam) === 30 ? 30 : 7
  const { rows, since, truncated, error } = await getContentMetrics(days)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Content quality</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What happened to content generated since {new Date(since).toLocaleDateString("en-IN")} (from content_events).
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border bg-card p-1">
          {METRIC_WINDOWS.map((d) => (
            <Link
              key={d}
              href={d === 7 ? "/admin/metrics" : `/admin/metrics?days=${d}`}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${d === days ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {d} days
            </Link>
          ))}
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Couldn&apos;t read metrics ({error}). If content_events doesn&apos;t exist yet, run supabase/migrations/061_content_events.sql.
        </p>
      )}
      {truncated && (
        <p className="rounded-lg border bg-card p-3 text-sm text-muted-foreground">Row limit reached -- these numbers cover only part of the window.</p>
      )}

      <section className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Content type</th>
              <th className="px-4 py-3 font-medium text-right">Generated</th>
              <th className="px-4 py-3 font-medium text-right">Acceptance</th>
              <th className="px-4 py-3 font-medium text-right">First-pass publishable</th>
              <th className="px-4 py-3 font-medium text-right">Edit burden</th>
              <th className="px-4 py-3 font-medium text-right">Low-rating rate</th>
              <th className="px-4 py-3 font-medium text-right">Cost / usable item (approx.)</th>
              <th className="px-4 py-3 font-medium text-right">Specificity</th>
              <th className="px-4 py-3 font-medium text-right">Message–visual alignment</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.contentType} className="border-b last:border-0">
                <td className="px-4 py-3 font-medium">{TYPE_LABELS[r.contentType] ?? r.contentType}</td>
                <td className="px-4 py-3 text-right tabular-nums">{r.generated.toLocaleString("en-IN")}</td>
                <td className="px-4 py-3 text-right tabular-nums">{pct(r.acceptanceRate)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{pct(r.firstPassRate)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{num(r.editBurden)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{r.rated > 0 ? `${pct(r.lowRatingRate)} of ${r.rated}` : "—"}</td>
                <td className="px-4 py-3 text-right tabular-nums">{usd(r.costPerUsableItem)}</td>
                {/* TODO(quality-gate): filled by the quality gate later. */}
                <td className="px-4 py-3 text-right text-muted-foreground">—</td>
                <td className="px-4 py-3 text-right text-muted-foreground">—</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="space-y-1 text-xs text-muted-foreground">
        <p>Acceptance = items saved or scheduled ÷ generated. First-pass publishable = accepted with no regenerate or edit before acceptance ÷ generated. Edit burden = edits per accepted item.</p>
        <p>Cost per usable item is approximate: ai_generation_logs cost for the matching features ÷ accepted items (logs aren&apos;t linked per item except posts).</p>
        <p>Generated rows are already saved by default, so &quot;saved&quot; only counts explicit saves; scheduling is recorded for Autopilot entries only (manual scheduling has no source id yet).</p>
      </div>
    </div>
  )
}
