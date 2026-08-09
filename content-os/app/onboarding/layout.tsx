import type { Metadata } from "next"
import Link from "next/link"
import { LogoIcon } from "@/components/shared/LogoIcon"

export const metadata: Metadata = {
  title: { default: "Getting started", template: "%s | SocioPosts" },
}

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen" style={{ backgroundColor: "#0f0f0f" }}>
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <Link href="/" className="flex items-center gap-2">
          <LogoIcon size={20} />
          <span className="font-semibold text-white" style={{ fontSize: "0.9rem" }}>SocioPosts</span>
        </Link>
        <Link href="/login" className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
          Already have an account? Sign in
        </Link>
      </header>
      <main className="mx-auto max-w-2xl px-6 pb-16 pt-8 sm:px-10">
        {children}
      </main>
    </div>
  )
}
