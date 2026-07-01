"use client"

import { useState, useRef } from "react"
import { Image, Upload, X, Loader2, ExternalLink } from "lucide-react"
import { useProducts } from "@/hooks/useProducts"
import Link from "next/link"

export interface PickedProduct {
  imageUrl?: string
  name: string
  description?: string
}

interface Props {
  brandId: string
  selected: PickedProduct | null
  onSelect: (p: PickedProduct | null) => void
  label?: string
}

export function ProductPicker({ brandId, selected, onSelect, label = "Product image (optional)" }: Props) {
  const { data: products, isLoading } = useProducts(brandId)
  const [open, setOpen] = useState(false)
  const [urlInput, setUrlInput] = useState("")
  const [urlLoading, setUrlLoading] = useState(false)
  const [urlError, setUrlError] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleUrlSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!urlInput.trim()) return
    setUrlLoading(true)
    setUrlError("")
    try {
      const res = await fetch("/api/v1/ai/extract/product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlInput.trim() }),
      })
      const json = await res.json() as {
        data?: { name: string; description?: string; image_urls?: string[] }
        scrape_failed?: boolean
      }
      if (json.scrape_failed || !json.data) {
        setUrlError("Couldn't load that page. Try uploading the image directly.")
        return
      }
      onSelect({
        name: json.data.name || urlInput,
        description: json.data.description,
        imageUrl: json.data.image_urls?.[0],
      })
      setOpen(false)
      setUrlInput("")
    } catch {
      setUrlError("Something went wrong. Try uploading the image directly.")
    } finally {
      setUrlLoading(false)
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string
      const img = new window.Image()
      img.onload = () => {
        if (img.naturalWidth > img.naturalHeight * 2.2) {
          setUrlError("This image looks like a screenshot. Please use a portrait or square product photo.")
          return
        }
        onSelect({ name: file.name.replace(/\.[^.]+$/, ""), imageUrl: dataUrl })
        setOpen(false)
      }
      img.onerror = () => {
        onSelect({ name: file.name.replace(/\.[^.]+$/, ""), imageUrl: dataUrl })
        setOpen(false)
      }
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
    e.target.value = ""
  }

  if (selected) {
    return (
      <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-2">
        {selected.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={selected.imageUrl}
            alt=""
            className="h-12 w-12 shrink-0 rounded-md border object-contain bg-white"
          />
        ) : (
          <div className="h-12 w-12 shrink-0 rounded-md border bg-secondary flex items-center justify-center">
            <Image className="h-5 w-5 text-muted-foreground" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate">{selected.name}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <button type="button" onClick={() => setOpen(true)} className="text-xs text-violet-600 hover:underline">
              Change
            </button>
            <button
              type="button"
              onClick={() => onSelect(null)}
              className="flex items-center gap-0.5 text-xs text-destructive hover:underline"
            >
              <X className="h-3 w-3" /> Remove
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/20 px-3 py-2.5 text-xs text-muted-foreground hover:border-violet-400 hover:text-violet-600 transition-colors"
      >
        <Image className="h-3.5 w-3.5 shrink-0" />
        {label}
      </button>
    )
  }

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold">{label}</p>
        <button type="button" onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Catalogue grid */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading products…
        </div>
      ) : products && products.length > 0 ? (
        <div>
          <p className="text-[11px] text-muted-foreground mb-2">Your products</p>
          <div className="grid grid-cols-3 gap-2">
            {products.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  onSelect({
                    name: p.name,
                    description: p.description ?? undefined,
                    imageUrl: p.image_urls?.[0],
                  })
                  setOpen(false)
                }}
                className="flex flex-col items-center gap-1 rounded-lg border p-2 hover:border-violet-400 hover:bg-violet-50/50 transition-colors text-center"
              >
                {p.image_urls?.[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.image_urls[0]}
                    alt={p.name}
                    className="h-14 w-14 rounded-md object-contain border bg-white"
                  />
                ) : (
                  <div className="h-14 w-14 rounded-md border bg-secondary flex items-center justify-center">
                    <Image className="h-6 w-6 text-muted-foreground" />
                  </div>
                )}
                <p className="text-[10px] font-medium leading-tight line-clamp-2">{p.name}</p>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-center py-2">
          <p className="text-xs text-muted-foreground mb-2">No products yet</p>
          <Link
            href={`/brands/${brandId}/products/new`}
            className="inline-flex items-center gap-1 text-xs text-violet-600 hover:underline"
          >
            <ExternalLink className="h-3 w-3" /> Add a product
          </Link>
        </div>
      )}

      {/* Upload */}
      <div>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/20 px-3 py-2.5 text-xs text-muted-foreground hover:border-violet-400 hover:text-violet-600 transition-colors"
        >
          <Upload className="h-3.5 w-3.5" /> Upload an image
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
      </div>

      {/* URL quick-add */}
      <form onSubmit={handleUrlSubmit} className="space-y-1.5">
        <p className="text-[11px] text-muted-foreground">Or paste a product link</p>
        <div className="flex gap-2">
          <input
            type="url"
            value={urlInput}
            onChange={(e) => { setUrlInput(e.target.value); setUrlError("") }}
            placeholder="https://yourstore.com/product/…"
            className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            type="submit"
            disabled={urlLoading || !urlInput.trim()}
            className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {urlLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Get"}
          </button>
        </div>
        {urlError && <p className="text-[11px] text-destructive">{urlError}</p>}
      </form>
    </div>
  )
}
