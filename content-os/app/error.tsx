"use client"

import { useEffect } from "react"
import Link from "next/link"

interface ErrorPageProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function GlobalError({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error("[app/error]", error)
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center bg-background">
      <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-muted-foreground">⚡ ContentOS</p>
      <h1 className="mb-3 text-3xl font-bold tracking-tight">Something went wrong</h1>
      <p className="mb-4 text-muted-foreground max-w-sm">
        An unexpected error occurred. You can try again or go back to the dashboard.
      </p>

      {/* The raw error message is only ever shown in development — in
          production it may contain internal details (file paths, query
          info, third-party error bodies) that were never meant for an
          end user. error.digest is Next.js's own safe correlation ID for
          this exact case: it's a stable per-error hash you can grep server
          logs for, without exposing what actually went wrong. */}
      {process.env.NODE_ENV === "development" && error.message ? (
        <pre className="mb-6 max-w-lg rounded-lg bg-muted px-4 py-3 text-left text-xs text-muted-foreground overflow-auto whitespace-pre-wrap">
          {error.message}
        </pre>
      ) : error.digest ? (
        <p className="mb-6 text-xs text-muted-foreground">Reference code: {error.digest}</p>
      ) : null}

      <div className="flex flex-wrap gap-3 justify-center">
        <button
          onClick={reset}
          className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Try again
        </button>
        <Link
          href="/dashboard"
          className="inline-flex h-10 items-center justify-center rounded-lg border border-input px-6 text-sm font-semibold transition-colors hover:bg-secondary"
        >
          Go to dashboard
        </Link>
      </div>
    </div>
  )
}
