"use client"

import { useState, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Globe, ArrowRight, Loader2, AlertCircle, ChevronDown } from "lucide-react"

function BrandSetupContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const scrapeFailed = searchParams.get("scrape_failed") === "1"
  const scrapeMsg = searchParams.get("msg") ?? "We couldn't access this website automatically — some brands block this for security reasons. Please fill in your brand details manually."

  const [url, setUrl] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [showManual, setShowManual] = useState(false)

  // Manual form state
  const [name, setName] = useState("")
  const [niche, setNiche] = useState("")
  const [targetAudience, setTargetAudience] = useState("")
  const [toneOfVoice, setToneOfVoice] = useState("")
  const [aiPersona, setAiPersona] = useState("")
  const [instagramHandle, setInstagramHandle] = useState("")
  const [websiteUrl, setWebsiteUrl] = useState("")
  const [manualLoading, setManualLoading] = useState(false)
  const [manualError, setManualError] = useState("")

  async function handleUrlSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    let cleanUrl = url.trim()
    if (!cleanUrl) return
    if (!/^https?:\/\//i.test(cleanUrl)) cleanUrl = `https://${cleanUrl}`
    setLoading(true)
    try {
      router.push(`/onboarding/analyzing?url=${encodeURIComponent(cleanUrl)}`)
    } catch {
      setLoading(false)
    }
  }

  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault()
    setManualError("")
    if (!name.trim() || !niche.trim() || !targetAudience.trim() || !toneOfVoice.trim()) {
      setManualError("Please fill in all required fields.")
      return
    }
    setManualLoading(true)
    try {
      const res = await fetch("/api/v1/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          niche: niche.trim(),
          target_audience: targetAudience.trim(),
          tone_of_voice: toneOfVoice.trim(),
          ai_persona: aiPersona.trim() || null,
          instagram_handle: instagramHandle.trim() || null,
          website_url: websiteUrl.trim() || null,
          brand_values: [],
          competitors: [],
        }),
      })
      const json = await res.json() as { data?: { id: string }; error?: { message: string } }
      if (!res.ok || !json.data?.id) {
        setManualError(json.error?.message ?? "Something went wrong. Please try again.")
        return
      }
      router.push(`/onboarding/brand-profile?brandId=${json.data.id}`)
    } catch {
      setManualError("Network error. Please check your connection and try again.")
    } finally {
      setManualLoading(false)
    }
  }

  const showManualForm = showManual || scrapeFailed

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

      {/* Scrape failed banner */}
      {scrapeFailed && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
          <p className="text-sm text-amber-300">{scrapeMsg}</p>
        </div>
      )}

      {/* URL form — hidden when viewing scrape_failed fallback */}
      {!scrapeFailed && (
        <form onSubmit={handleUrlSubmit} className="space-y-4">
          <div>
            <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 focus-within:border-violet-500 transition-colors">
              <Globe className="h-5 w-5 shrink-0 text-gray-500" />
              <input
                type="text"
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="yourbrand.com"
                className="flex-1 bg-transparent text-sm text-white placeholder-gray-600 outline-none"
                autoFocus
              />
            </div>
            <p className="mt-1.5 text-xs text-gray-600">Enter your homepage URL only, e.g. https://yourbrand.com</p>
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

          <button
            type="button"
            onClick={() => setShowManual(m => !m)}
            className="flex w-full items-center justify-center gap-1.5 text-xs text-gray-600 hover:text-gray-400 transition-colors py-1"
          >
            Fill in manually instead
            <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${showManual ? "rotate-180" : ""}`} />
          </button>
        </form>
      )}

      {/* Manual form */}
      {showManualForm && (
        <form onSubmit={handleManualSubmit} className={`space-y-4 ${!scrapeFailed ? "mt-6" : ""}`}>
          {!scrapeFailed && (
            <p className="text-sm font-semibold text-white">Fill in manually</p>
          )}

          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-400">
                Brand name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Kama Ayurveda"
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-gray-600 outline-none focus:border-violet-500 transition-colors"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-400">
                What you sell <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={niche}
                onChange={e => setNiche(e.target.value)}
                placeholder="e.g. Skincare, Streetwear, Home decor, Gaming accessories"
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-gray-600 outline-none focus:border-violet-500 transition-colors"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-400">
                Who buys from you <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={targetAudience}
                onChange={e => setTargetAudience(e.target.value)}
                placeholder="e.g. Women aged 18-35 who love skincare, Young gamers in India"
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-gray-600 outline-none focus:border-violet-500 transition-colors"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-400">
                Brand personality <span className="text-red-400">*</span>
              </label>
              <p className="mb-1.5 text-[11px] text-gray-600">How should your brand sound when it talks to people?</p>
              <input
                type="text"
                value={toneOfVoice}
                onChange={e => setToneOfVoice(e.target.value)}
                placeholder="e.g. Fun and casual, Bold and confident, Warm and friendly"
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-gray-600 outline-none focus:border-violet-500 transition-colors"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-400">
                Content style <span className="text-gray-600 font-normal">(optional)</span>
              </label>
              <p className="mb-1.5 text-[11px] text-gray-600">What personality should your AI content have?</p>
              <input
                type="text"
                value={aiPersona}
                onChange={e => setAiPersona(e.target.value)}
                placeholder="e.g. Hype and energetic, Calm and expert, Witty and playful"
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-gray-600 outline-none focus:border-violet-500 transition-colors"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-400">
                  Instagram <span className="text-gray-600 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={instagramHandle}
                  onChange={e => setInstagramHandle(e.target.value)}
                  placeholder="@yourbrand"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-gray-600 outline-none focus:border-violet-500 transition-colors"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-400">
                  Website <span className="text-gray-600 font-normal">(optional)</span>
                </label>
                <input
                  type="url"
                  value={websiteUrl}
                  onChange={e => setWebsiteUrl(e.target.value)}
                  placeholder="https://yourbrand.com"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-gray-600 outline-none focus:border-violet-500 transition-colors"
                />
              </div>
            </div>
          </div>

          {manualError && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {manualError}
            </div>
          )}

          <button
            type="submit"
            disabled={manualLoading}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-violet-600 py-3.5 text-sm font-semibold text-white transition-all hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {manualLoading ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Creating your brand…</>
            ) : (
              <>Create my brand <ArrowRight className="h-4 w-4" /></>
            )}
          </button>
        </form>
      )}

      {!showManualForm && (
        <div className="mt-8 rounded-xl border border-white/5 bg-white/5 p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">Works great with</p>
          <div className="flex flex-wrap gap-2">
            {["Shopify store", "D2C website", "Instagram link", "Meesho store", "Wix / Squarespace", "Any website"].map(t => (
              <span key={t} className="rounded-full border border-white/10 px-3 py-1 text-xs text-gray-400">{t}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function BrandSetupPage() {
  return (
    <Suspense fallback={
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
      </div>
    }>
      <BrandSetupContent />
    </Suspense>
  )
}
