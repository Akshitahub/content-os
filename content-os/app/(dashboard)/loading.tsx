export default function DashboardLoading() {
  return (
    <div className="px-4 py-6 md:p-8">
      {/* Header skeleton */}
      <div className="mb-8">
        <div className="h-8 w-56 animate-pulse rounded-lg bg-secondary mb-2" />
        <div className="h-4 w-72 animate-pulse rounded-lg bg-secondary" />
      </div>

      {/* Stats cards skeleton */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-lg border bg-card p-6">
            <div className="h-3 w-24 animate-pulse rounded bg-secondary mb-3" />
            <div className="h-8 w-16 animate-pulse rounded bg-secondary" />
          </div>
        ))}
      </div>

      {/* Content skeleton */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-6">
          <div className="h-4 w-32 animate-pulse rounded bg-secondary mb-4" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="mb-3 flex items-center gap-3">
              <div className="h-8 w-8 animate-pulse rounded-full bg-secondary shrink-0" />
              <div className="flex-1">
                <div className="h-3 w-full animate-pulse rounded bg-secondary mb-1" />
                <div className="h-3 w-3/4 animate-pulse rounded bg-secondary" />
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-lg border bg-card p-6">
          <div className="h-4 w-32 animate-pulse rounded bg-secondary mb-4" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="mb-3 h-16 animate-pulse rounded-lg bg-secondary" />
          ))}
        </div>
      </div>
    </div>
  )
}
