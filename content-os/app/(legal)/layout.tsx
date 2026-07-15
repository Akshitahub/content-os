import type { ReactNode } from "react"
import Link from "next/link"

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Header */}
      <header className="border-b border-gray-100 px-6 py-4">
        <div className="mx-auto max-w-3xl">
          <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-gray-900 hover:text-violet-600 transition-colors">
            <svg width="20" height="20" viewBox="0 0 22 22" fill="none" aria-hidden="true">
              <path d="M13 2L4 13h7l-2 7 9-11h-7l2-7z" fill="#6366f1" strokeLinejoin="round" />
            </svg>
            SocioPosts
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-3xl px-6 py-12 sm:py-16" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-100 px-6 py-8">
        <div className="mx-auto max-w-3xl flex flex-wrap items-center justify-between gap-4 text-sm text-gray-500">
          <span>&copy; {new Date().getFullYear()} SocioPosts. All rights reserved.</span>
          <nav className="flex items-center gap-4">
            <Link href="/" className="hover:text-gray-900 transition-colors">Home</Link>
            <Link href="/terms" className="hover:text-gray-900 transition-colors">Terms</Link>
            <Link href="/privacy" className="hover:text-gray-900 transition-colors">Privacy</Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
