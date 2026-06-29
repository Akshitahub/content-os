"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowRight, Loader2, AlertCircle } from "lucide-react"

interface Brand {
  id: string
  name: string
  description: string | null
  niche: string | null
  target_audience: string | null
  tone_of_voice: string | null
  brand_values: string[] | null
  vibe: string | null
  brand_personality: string | null
}

const VIBE_LABELS: Record<string, string> = {
  fun_playful: "Fun & Playful 🎉",
  clean_minimal: "Clean & Minimal 🤍",
  bold_dramatic: "Bold & Dramatic 🖤",
  warm_cozy: "Warm & Cozy 🧡",
  professional: "Professional 💼",
  trendy_genz: "Trendy & Gen Z ✨",
}

export default function BrandProfilePage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const brandId = searchParams.get("brandId") ?? ""

  const [brand, setBrand] = useState<Brand | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!brandId) {
      router.replace("/onboarding/brand-setup")
      return
    }
    async function load() {
      try {
        const res = await fetch(`/api/v1/brands/${brandId}`)
        const json = await res.json() as { data?: Brand; error?: { message: string } }
        if (!res.ok || !json.data) {
          setError(json.error?.message ?? "Couldn't load your brand profile.")
        } else {
          setBrand(json.data)
        }
      } catch {
        setError("Network error. Please try again.")
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [brandId, router])

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
        <p className="text-sm text-gray-400">Loading your brand profile…</p>
      </div>
    )
  }

  if (error || !brand) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="mx-auto mb-4 h-8 w-8 text-red-400" />
        <p className="text-sm text-gray-400">{error || "Something went wrong."}</p>
        <button onClick={() => router.back()} className="mt-4 text-sm text-violet-400 hover:underline">
          Go back
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-8">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-violet-400">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-600 text-white text-[10px]">2</span>
          Step 2 of 4
        </div>
        <h1 className="text-2xl font-bold text-white sm:text-3xl">Your brand profile</h1>
        <p className="mt-2 text-sm text-gray-400">Here&apos;s what we learned from your website.</p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-1">Brand name</p>
          <p className="text-lg font-bold text-white">{brand.name}</p>
        </div>

        {brand.description && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-1">What you do</p>
            <p className="text-sm text-gray-300 leading-relaxed">{brand.description}</p>
          </div>
        )}

        {brand.niche && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-1">Niche</p>
            <p className="text-sm text-gray-300">{brand.niche}</p>
          </div>
        )}

        {brand.target_audience && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-1">Target audience</p>
            <p className="text-sm text-gray-300">{brand.target_audience}</p>
          </div>
        )}

        {brand.tone_of_voice && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-1">Tone of voice</p>
            <p className="text-sm text-gray-300">{brand.tone_of_voice}</p>
          </div>
        )}

        {brand.vibe && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-1">Vibe</p>
            <span className="rounded-full border border-violet-500/30 bg-violet-600/20 px-3 py-1 text-sm text-violet-300">
              {VIBE_LABELS[brand.vibe] ?? brand.vibe}
            </span>
          </div>
        )}

        {brand.brand_values && brand.brand_values.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">Brand values</p>
            <div className="flex flex-wrap gap-2">
              {brand.brand_values.map(v => (
                <span key={v} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-gray-300">{v}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <p className="text-xs text-gray-600">You can edit all of this in your brand settings later.</p>
        <button
          onClick={() => router.push(`/onboarding/content-plan?brandId=${brandId}`)}
          className="flex items-center gap-2 rounded-full bg-violet-600 px-6 py-2.5 text-sm font-semibold text-white transition-all hover:bg-violet-700"
        >
          Looks good <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
