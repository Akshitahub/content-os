"use client"

import { useState, useRef, useEffect } from "react"
import { Image, Upload, X, Loader2, ExternalLink } from "lucide-react"
import { useProducts } from "@/hooks/useProducts"
import { useExtractProductFromUrl } from "@/hooks/useExtraction"
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
  const [urlError, setUrlError] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Whichever Create tab this picker lives in stays mounted even while a
  // different tab is active (hidden via CSS — see GenerationPanel.tsx). If
  // this panel was left open on a tab the user then navigated away from, a
  // document-level paste listener would otherwise still fire there.
  // Checked at paste time via offsetParent (null when this subtree — or an
  // ancestor — is display:none).
  const panelRef = useRef<HTMLDivElement>(null)
  const extractProduct = useExtractProductFromUrl()

  function handleUrlSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!urlInput.trim()) return
    setUrlError("")
    const trimmedUrl = urlInput.trim()
    extractProduct.mutate(trimmedUrl, {
      onSuccess: (data) => {
        onSelect({
          name: data.name || trimmedUrl,
          description: data.description,
          imageUrl: data.image_urls?.[0],
        })
        setOpen(false)
        setUrlInput("")
      },
      onError: (err) => {
        setUrlError(err.message || "Couldn't load that page. Try uploading the image directly.")
      },
    })
  }

  // Shared by file-browse and clipboard paste so validation/preview logic
  // lives in exactly one place instead of being duplicated per input
  // method (mirrors components/generate/AdMaker.tsx's processImageFile).
  function processImageFile(file: File | undefined | null) {
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
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    processImageFile(e.target.files?.[0])
    e.target.value = ""
  }

  // Native ClipboardEvent, not React.ClipboardEvent — listened for at the
  // document level (see the useEffect below), not as this button's onPaste.
  // The button's onClick already opens the native file picker, so clicking
  // it to focus it before pasting would launch that dialog instead of just
  // focusing the element — there's no way to "click to focus, then paste"
  // on the same element that also opens a file browser on click.
  function handlePaste(e: ClipboardEvent) {
    if (panelRef.current && panelRef.current.offsetParent === null) return
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile()
        if (file) {
          processImageFile(file)
          break
        }
      }
    }
  }

  // Active only while the picker panel is open (this upload button is only
  // ever shown then) — works anywhere on the page during that window.
  useEffect(() => {
    if (!open) return
    document.addEventListener("paste", handlePaste)
    return () => document.removeEventListener("paste", handlePaste)
  // handlePaste is a plain (unmemoized) function recreated every render —
  // its behavior only meaningfully depends on `open`, already listed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

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
    <div ref={panelRef} className="rounded-xl border bg-card p-4 space-y-4">
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
        <p className="mt-1 text-center text-[10px] text-muted-foreground/60">or paste from clipboard (Ctrl+V)</p>
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
            disabled={extractProduct.isPending || !urlInput.trim()}
            className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {extractProduct.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Get"}
          </button>
        </div>
        {urlError && <p className="text-[11px] text-destructive">{urlError}</p>}
      </form>
    </div>
  )
}
