"use client"

import { useEffect, useState } from "react"
import { Check, Copy, Loader2, MessageCircle, Smartphone, X } from "lucide-react"
import { useBrandPhotos } from "@/hooks/useBrandPhotos"

// "Send photos from your phone": a QR code and a WhatsApp-friendly link to
// app/send-photos/[token] (7 days, this brand only, no login). Always one
// tap away as a small button; opened by itself ONCE (per brand, per browser)
// when the brand has fewer than 10 usable real photos -- never a required
// step, and dismissable.

const REAL_KINDS = new Set(["person", "product_in_use", "lifestyle", "flatlay"])
const FEW_PHOTOS = 10
const promptKey = (brandId: string) => `sp-phone-photos-prompted:${brandId}`

type Link = { url: string; qrSvg: string; whatsappUrl: string; expiresAt: string }

export function PhonePhotosCard({ brandId, tone = "light" }: { brandId: string; tone?: "light" | "dark" }) {
  const { data: photos, isSuccess } = useBrandPhotos(brandId)
  // null = the owner hasn't opened or closed it themselves.
  const [userOpen, setOpen] = useState<boolean | null>(null)
  const [promptedBefore] = useState(() => {
    try {
      return !!localStorage.getItem(promptKey(brandId))
    } catch {
      return true
    }
  })
  const [link, setLink] = useState<Link | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const dark = tone === "dark"

  // The gentle prompt: once, only for a brand short on real photos.
  const fewPhotos = isSuccess && (photos ?? []).filter((p) => p.kind && REAL_KINDS.has(p.kind)).length < FEW_PHOTOS
  const prompting = !promptedBefore && fewPhotos
  const open = userOpen ?? prompting
  useEffect(() => {
    if (!prompting) return
    try {
      localStorage.setItem(promptKey(brandId), "1")
    } catch {
      // Private mode: it may show again next visit -- harmless.
    }
  }, [prompting, brandId])

  useEffect(() => {
    if (!open || link) return
    let cancelled = false
    fetch(`/api/v1/brands/${brandId}/photo-link`, { method: "POST" })
      .then(async (res) => {
        const json = await res.json().catch(() => null)
        if (cancelled) return
        if (!res.ok || !json?.data) setError(json?.error?.message ?? "Couldn't make a link. Try again.")
        else setLink(json.data as Link)
      })
      .catch(() => !cancelled && setError("Couldn't make a link. Try again."))
    return () => { cancelled = true }
  }, [open, link, brandId])

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError("Couldn't copy. Long-press the link instead.")
    }
  }

  const muted = dark ? "text-gray-400" : "text-muted-foreground"
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 text-xs font-medium ${dark ? "text-violet-300 hover:text-violet-200" : "text-violet-600 hover:text-violet-700"}`}>
        <Smartphone className="h-3.5 w-3.5" /> Send photos from your phone
      </button>
    )
  }

  return (
    <div className={`relative rounded-xl border p-4 text-left ${dark ? "border-white/10 bg-white/5 text-white" : "bg-violet-50/60 border-violet-100"}`}>
      <button type="button" aria-label="Close" onClick={() => setOpen(false)} className={`absolute right-2 top-2 rounded p-1 ${muted} hover:opacity-80`}>
        <X className="h-4 w-4" />
      </button>
      <p className="flex items-center gap-1.5 text-sm font-semibold"><Smartphone className="h-4 w-4" /> Send photos from your phone</p>
      <p className={`mt-1 text-xs ${muted}`}>
        Real photos of your products in use, your shop or your team make the best posts. Scan this with your phone and pick a few -- no login. Optional, any time.
      </p>
      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="h-36 w-36 shrink-0 overflow-hidden rounded-lg bg-white p-1.5">
          {link ? (
            // The QR is our own server-rendered SVG (qrcode), not user content.
            <div className="h-full w-full [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: link.qrSvg }} />
          ) : (
            <div className="flex h-full items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <a href={link?.whatsappUrl} target="_blank" rel="noopener noreferrer" aria-disabled={!link}
            className={`inline-flex items-center justify-center gap-1.5 rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 ${link ? "" : "pointer-events-none opacity-50"}`}>
            <MessageCircle className="h-3.5 w-3.5" /> Send the link on WhatsApp
          </a>
          <button type="button" onClick={copy} disabled={!link}
            className={`inline-flex items-center justify-center gap-1.5 rounded-full border px-4 py-2 text-xs font-medium disabled:opacity-50 ${dark ? "border-white/20" : "bg-white"}`}>
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy link"}
          </button>
          <p className={`text-[11px] ${muted}`}>Works for 7 days, up to 30 photos.</p>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  )
}
