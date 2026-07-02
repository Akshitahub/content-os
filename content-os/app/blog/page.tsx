import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Blog — ContentOS",
  description: "AI content generation tips, guides, and case studies for Indian D2C brands and creators.",
}

export default function BlogPage() {
  return (
    <main className="min-h-screen bg-white px-6 py-16 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8">
          <Link href="/" className="text-sm text-violet-600 hover:underline">
            ← ContentOS
          </Link>
        </div>

        <h1 className="text-3xl font-bold tracking-tight text-gray-900">ContentOS Blog</h1>
        <p className="mt-3 text-lg text-gray-500">
          Tips, guides, and case studies for Indian D2C brands and creators.
        </p>

        <div className="mt-12 divide-y divide-gray-100">
          <article className="py-8">
            <div className="mb-3 flex items-center gap-2">
              <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-600">Guide</span>
              <span className="text-xs text-gray-400">2026</span>
            </div>
            <h2 className="text-xl font-bold text-gray-900">
              <Link
                href="/blog/ai-content-generator-india"
                className="transition-colors hover:text-violet-600"
              >
                Best AI Content Generator for Indian D2C Brands &amp; Creators (2026)
              </Link>
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-500">
              Discover how Indian D2C brands are using AI to generate 30 days of Instagram content in minutes.
              Complete guide to AI content generation for Indian businesses.
            </p>
            <Link
              href="/blog/ai-content-generator-india"
              className="mt-4 inline-block text-sm font-medium text-violet-600 hover:underline"
            >
              Read article →
            </Link>
          </article>
        </div>
      </div>
    </main>
  )
}
