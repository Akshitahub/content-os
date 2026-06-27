"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

interface ErrorPageProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function DashboardError({ error, reset }: ErrorPageProps) {
  const router = useRouter()

  useEffect(() => {
    console.error("[dashboard/error]", error)
  }, [error])

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      <h2 className="mb-3 text-xl font-bold tracking-tight">Something went wrong</h2>
      <p className="mb-4 text-sm text-muted-foreground max-w-sm">
        This section encountered an error. Try again or go back.
      </p>

      {error.message && (
        <pre className="mb-6 max-w-lg rounded-lg bg-muted px-4 py-3 text-left text-xs text-muted-foreground overflow-auto whitespace-pre-wrap">
          {error.message}
        </pre>
      )}

      <div className="flex flex-wrap gap-3 justify-center">
        <button
          onClick={reset}
          className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Try again
        </button>
        <button
          onClick={() => router.back()}
          className="inline-flex h-9 items-center justify-center rounded-lg border border-input px-5 text-sm font-semibold transition-colors hover:bg-secondary"
        >
          Go back
        </button>
      </div>
    </div>
  )
}
