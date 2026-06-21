"use client"

import { useState } from "react"
import { ImageIcon, Download, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
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

interface ImageGeneratorProps {
  brandId: string
  products: ProductRow[]
}

export function ImageGenerator({ brandId, products }: ImageGeneratorProps) {
  const { mutate: generateImage, isPending, error } = useGenerateImage()
  const { selectedProductId, setSelectedProductId, images, addImage } = useGenerationStore()
  const [prompt, setPrompt] = useState("")
  const [style, setStyle] = useState<ImageStyle>("product_photography")
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("1:1")

  function handleGenerate() {
    if (!prompt.trim()) return
    generateImage(
      {
        brandId,
        productId: selectedProductId ?? undefined,
        prompt: prompt.trim(),
        style,
        aspectRatio,
      },
      {
        onSuccess: (data) => addImage(data),
      }
    )
  }

  return (
    <div className="space-y-6">
      {/* Controls */}
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
          <Label className="text-xs">Describe the image</Label>
          <textarea
            rows={2}
            placeholder="e.g. 'Rose quartz bracelet on a marble surface with soft morning light'"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Style</Label>
          <div className="flex flex-wrap gap-1.5">
            {STYLES.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setStyle(s.value)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  style === s.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Aspect ratio</Label>
          <div className="flex flex-wrap gap-1.5">
            {ASPECT_RATIOS.map((a) => (
              <button
                key={a.value}
                type="button"
                onClick={() => setAspectRatio(a.value)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  aspectRatio === a.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>

        <Button className="w-full" onClick={handleGenerate} disabled={isPending || !prompt.trim()}>
          {isPending ? (
            <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Generating image…</>
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

      {/* Generated images */}
      {images.length > 0 && (
        <div className="space-y-4">
          <p className="text-sm font-medium">{images.length} image{images.length > 1 ? "s" : ""} generated</p>
          <div className="grid grid-cols-2 gap-3">
            {images.map((image, i) => {
              const imageId = image.id ?? `image-${i}`
              return (
                <div key={imageId} className="group relative rounded-lg border bg-card overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.public_url}
                    alt={image.prompt}
                    className="w-full aspect-square object-cover"
                  />
                  <a
                    href={image.public_url}
                    download
                    target="_blank"
                    rel="noopener noreferrer"
                    className="absolute top-2 right-2 rounded-full bg-background/90 p-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </a>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
