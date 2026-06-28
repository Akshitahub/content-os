"use client"

import { useState, useRef, useEffect } from "react"
import Link from "next/link"
import { ImageIcon, Download, RefreshCw, Info, Check, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { GeneratingState } from "@/components/shared/GeneratingState"
import { useGenerateImage, ApiResponseError } from "@/hooks/useGeneration"
import { useGenerationStore } from "@/stores/generationStore"
import type { ProductRow } from "@/types/database"
import type { ImageStyle, AspectRatio } from "@/types/app"

const STYLES: { value: ImageStyle; label: string }[] = [
  { value: "product_photography", label: "Product photography" },
  { value: "lifestyle", label: "Lifestyle" },
  { value: "flat_lay", label: "Flat lay" },
  { value: "minimal_studio", label: "Minimal studio" },
  { value: "festive", label: "Festive" },
  { value: "ugc_style", label: "UGC style" },
]

const ASPECT_RATIOS: { value: AspectRatio; label: string }[] = [
  { value: "1:1", label: "Square (1:1)" },
  { value: "4:5", label: "Portrait (4:5)" },
  { value: "9:16", label: "Story / Reel (9:16)" },
  { value: "16:9", label: "Landscape (16:9)" },
]

const DIMS: Record<AspectRatio, string> = {
  "1:1": "width=1080&height=1080",
  "4:5": "width=1080&height=1350",
  "9:16": "width=1080&height=1920",
  "16:9": "width=1920&height=1080",
}

interface ImageGeneratorProps {
  brandId: string
  products: ProductRow[]
}

export function ImageGenerator({ brandId, products }: ImageGeneratorProps) {
  const { mutate: generateImage, isPending, error } = useGenerateImage()
  const {
    selectedProductId, setSelectedProductId, images, addImage,
    imagePrompt: prompt, setImagePrompt,
    imageStyle: style, setImageStyle,
    imageAspectRatio: aspectRatio, setImageAspectRatio,
  } = useGenerationStore()

  const [justSaved, setJustSaved] = useState(false)
  const [promptError, setPromptError] = useState("")
  const [variations, setVariations] = useState<string[]>([])
  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (images.length === 0) {
      const saved = sessionStorage.getItem(`images_${brandId}`)
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          if (Array.isArray(parsed)) parsed.forEach((img) => addImage(img))
        } catch {}
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId])

  useEffect(() => {
    if (images.length > 0) sessionStorage.setItem(`images_${brandId}`, JSON.stringify(images))
  }, [images, brandId])

  useEffect(() => () => { abortControllerRef.current?.abort() }, [])

  function handleGenerate() {
    if (!prompt.trim()) {
      setPromptError("Please describe what you want to generate")
      return
    }
    setPromptError("")
    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()
    setJustSaved(false)
    setVariations([])

    generateImage(
      { brandId, productId: selectedProductId ?? undefined, prompt: prompt.trim(), style, aspectRatio },
      {
        onSuccess: (data) => {
          addImage(data)
          setJustSaved(true)
          setTimeout(() => setJustSaved(false), 6000)

          // Generate 2 additional Pollinations variants with different seeds
          const fp = data.full_prompt ?? data.prompt
          const dims = DIMS[aspectRatio]
          const encoded = encodeURIComponent(fp)
          const s1 = Math.floor(Math.random() * 99999)
          const s2 = Math.floor(Math.random() * 99999)
          setVariations([
            data.public_url,
            `https://image.pollinations.ai/prompt/${encoded}?${dims}&seed=${s1}&nologo=true&model=flux&enhance=true`,
            `https://image.pollinations.ai/prompt/${encoded}?${dims}&seed=${s2}&nologo=true&model=flux&enhance=true`,
          ])
        },
      }
    )
  }

  return (
    <div className="space-y-6">
      {products.length === 0 && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 flex items-start gap-2">
          <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700">
            Add products to generate product-specific images.{" "}
            <a href={`/brands/${brandId}/products`} className="underline font-medium">Add products →</a>
          </p>
        </div>
      )}

      <div className="rounded-lg border bg-card p-5 space-y-4">
        <h3 className="text-sm font-semibold">Image Settings</h3>

        {products.length > 0 && (
          <div className="space-y-1.5">
            <Label className="text-xs">Product</Label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={selectedProductId ?? ""}
              onChange={(e) => setSelectedProductId(e.target.value || null)}
            >
              <option value="">No specific product</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs">Describe what you want to generate</Label>
          <textarea
            rows={2}
            placeholder="e.g. 'merch giveaway visual with confetti' or 'product on marble with morning light'"
            className={`w-full rounded-md border px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none ${promptError ? "border-destructive" : "border-input bg-background"}`}
            value={prompt}
            onChange={(e) => { setImagePrompt(e.target.value); if (e.target.value.trim()) setPromptError("") }}
          />
          {promptError && (
            <div className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5" />
              {promptError}
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Style</Label>
          <div className="flex flex-wrap gap-1.5">
            {STYLES.map((s) => (
              <button key={s.value} type="button" onClick={() => setImageStyle(s.value as ImageStyle)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${style === s.value ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Aspect ratio</Label>
          <div className="flex flex-wrap gap-1.5">
            {ASPECT_RATIOS.map((a) => (
              <button key={a.value} type="button" onClick={() => setImageAspectRatio(a.value as AspectRatio)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${aspectRatio === a.value ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}>
                {a.label}
              </button>
            ))}
          </div>
        </div>

        <Button className="w-full" onClick={handleGenerate} disabled={isPending}>
          {isPending ? (
            <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Generating: {prompt.slice(0, 30)}{prompt.length > 30 ? "…" : ""}</>
          ) : (
            <><ImageIcon className="h-4 w-4 mr-2" /> Generate image</>
          )}
        </Button>

        {error && (
          error instanceof ApiResponseError && error.code === "USAGE_LIMIT_EXCEEDED" ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-50 p-3 text-center space-y-0.5">
              <p className="text-sm font-semibold text-amber-900">{error.message}</p>
              <p className="text-xs text-amber-700">Upgrade your plan to keep creating.</p>
            </div>
          ) : (
            <p className="text-xs text-destructive">{error.message}</p>
          )
        )}
      </div>

      {isPending && <GeneratingState message={`Generating: ${prompt.slice(0, 50)}${prompt.length > 50 ? "…" : ""}  •  This takes 10–20 seconds`} />}

      {justSaved && (
        <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <div className="flex items-center gap-2 text-green-700">
            <Check className="h-4 w-4 shrink-0" />
            <span className="text-sm font-medium">✓ Saved to My Content</span>
          </div>
          <Link href={`/brands/${brandId}/library?tab=images`}
            className="text-xs font-medium text-green-700 underline underline-offset-2 hover:text-green-900 shrink-0">
            View in My Content →
          </Link>
        </div>
      )}

      {/* 3 Variations */}
      {!isPending && variations.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium">3 variations — pick the one you love ↓</p>
          <div className="grid grid-cols-3 gap-3">
            {variations.map((url, i) => (
              <div key={i} className="group relative rounded-lg border bg-card overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`Variation ${i + 1}`} className="w-full aspect-square object-cover" loading={i === 0 ? "eager" : "lazy"} />
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/60 px-2 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="text-[10px] text-white font-medium">#{i + 1}</span>
                  <a href={url} download={`image-variation-${i + 1}.jpg`} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[10px] text-white hover:text-yellow-300">
                    <Download className="h-3 w-3" /> Save
                  </a>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Variation 1 is saved to My Content. Hover any variation to download.</p>
        </div>
      )}

      {/* Previous images */}
      {!isPending && variations.length === 0 && images.length > 0 && (
        <div className="space-y-4">
          <p className="text-sm font-medium">{images.length} image{images.length > 1 ? "s" : ""} generated</p>
          <div className="grid grid-cols-2 gap-3">
            {images.map((image, i) => (
              <div key={image.id ?? `image-${i}`} className="group relative rounded-lg border bg-card overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.public_url} alt={image.prompt} className="w-full aspect-square object-cover" />
                <a href={image.public_url} download target="_blank" rel="noopener noreferrer"
                  className="absolute top-2 right-2 rounded-full bg-background/90 p-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Download className="h-3.5 w-3.5" />
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
