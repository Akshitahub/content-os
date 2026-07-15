import Link from "next/link"

export default function NotFound() {
  return (
    <div
      style={{ background: "#0f0f0f" }}
      className="flex min-h-screen flex-col items-center justify-center px-4 text-center"
    >
      <div className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-widest text-violet-400">⚡ SocioPosts</p>
      </div>

      <p className="mb-2 text-8xl font-black text-violet-500">404</p>
      <h1 className="mb-3 text-3xl font-bold text-white">This page doesn&apos;t exist</h1>
      <p className="mb-8 max-w-sm text-muted-foreground">
        The page you&apos;re looking for has moved, been deleted, or never existed.
      </p>

      <div className="flex flex-wrap gap-3 justify-center">
        <Link
          href="/dashboard"
          className="inline-flex h-10 items-center justify-center rounded-lg bg-violet-600 px-6 text-sm font-semibold text-white transition-colors hover:bg-violet-700"
        >
          Go to dashboard
        </Link>
        <Link
          href="/"
          className="inline-flex h-10 items-center justify-center rounded-lg border border-white/20 px-6 text-sm font-semibold text-white transition-colors hover:bg-white/10"
        >
          Go home
        </Link>
      </div>
    </div>
  )
}
