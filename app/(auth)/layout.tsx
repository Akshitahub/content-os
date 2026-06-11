import type { Metadata } from "next"

export const metadata: Metadata = {
  title: {
    default: "Sign in",
    template: "%s | ContentOS",
  },
}

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/30 px-4 py-12">
      <div className="mb-8 flex items-center gap-2">
        {/* Logo mark */}
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
          <svg
            className="h-4 w-4 text-primary-foreground"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M13 10V3L4 14h7v7l9-11h-7z"
            />
          </svg>
        </div>
        <span className="text-xl font-semibold tracking-tight">ContentOS</span>
      </div>
      {children}
    </div>
  )
}
