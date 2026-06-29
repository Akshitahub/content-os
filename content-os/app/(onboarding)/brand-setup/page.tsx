"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Globe, ArrowRight, Loader2, AlertCircle } from "lucide-react"

export default function BrandSetupPage() {
  const router = useRouter()
  const [url, setUrl] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")

    let cleanUrl = url.trim()
    if (!cleanUrl) return

    if (!/^https?:\/\//i.test(cleanUrl)) {
      cleanUrl = `https://${cleanUrl}`
    }

    setLoading(true)
    try {
      router.push(`/onboarding/analyzing?url=${encodeURIComponent(cleanUrl)}`)
    } catch {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="mb-8">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-violet-400">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-600 text-white text-[10px]">1</span>
          Step 1 of 4
        </div>
        <h1 className="text-2xl font-bold text-white sm:text-3xl">What&apos;s your brand website?</h1>
        <p className="mt-2 text-gray-400 text-sm">
          Paste your homepage or store URL. We&apos;ll read it to understand your brand.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 focus-within:border-violet-500 transition-colors">
          <Globe className="h-5 w-5 shrink-0 text-gray-500" />
          <input
            type="text"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="yourbrand.com"
            className="flex-1 bg-transparent text-sm text-white placeholder-gray-600 outline-none"
            autoFocus
            required
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !url.trim()}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-violet-600 py-3.5 text-sm font-semibold text-white transition-all hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Analysing…</>
          ) : (
            <>Analyse my brand <ArrowRight className="h-4 w-4" /></>
          )}
        </button>
      </form>

      <div className="mt-8 rounded-xl border border-white/5 bg-white/5 p-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">Works great with</p>
        <div className="flex flex-wrap gap-2">
          {["Shopify store", "D2C website", "Instagram link", "Meesho store", "Wix / Squarespace", "Any website"].map(t => (
            <span key={t} className="rounded-full border border-white/10 px-3 py-1 text-xs text-gray-400">{t}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
