"use client"

import { useState, useRef, useEffect } from "react"
import { ImageIcon, Download, RefreshCw, Info, Check, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { GeneratingState } from "@/components/shared/GeneratingState"
import { useGenerateImage, ApiResponseError, type GenerateImageOutcome } from "@/hooks/useGeneration"
import { useGenerationStore } from "@/stores/generationStore"
import { usePromptWriter } from "@/hooks/usePromptWriter"
import { PromptWriterField } from "@/components/generate/PromptWriterField"
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
  const {
    selectedProductId, setSelectedProductId, images, addImage,
    imagePrompt: prompt, setImagePrompt,
    imageStyle: style, setImageStyle,
    imageAspectRatio: aspectRatio, setImageAspectRatio,
  } = useGenerationStore()

  const [justSaved, setJustSaved] = useState(false)
  const [textWarning, setTextWarning] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const promptWriter = usePromptWriter(setImagePrompt)

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

  // Shared success handler for both the normal generate and the
  // "Generate anyway" override -- a warning outcome (prompt asked for
  // rendered text) surfaces the choice instead of looking like a broken
  // success.
  //
  // Used to also fire 2 extra client-side Pollinations requests here for
  // free "bonus variations" with different seeds -- removed along with
  // Pollinations, not replaced with a Flux equivalent: Flux is a real
  // paid-per-call Replicate request, so generating 2 extra variations here
  // would silently 3x this tool's per-click cost with no way to charge for
  // it. The single real generated image now just joins the existing
  // "images generated" grid below like any other saved image.
  function handleImageOutcome(outcome: GenerateImageOutcome) {
    if (outcome.kind === "warning") {
      setTextWarning(outcome.message)
      return
    }
    setTextWarning(null)
    addImage(outcome.data)
    setJustSaved(true)
    setTimeout(() => setJustSaved(false), 6000)
  }

  function runGenerate(allowTextInImage: boolean) {
    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()
    setJustSaved(false)
    generateImage(
      allowTextInImage
        ? { brandId, productId: selectedProductId ?? undefined, prompt: prompt.trim(), style, aspectRatio, allowTextInImage: true }
        : { brandId, productId: selectedProductId ?? undefined, prompt: prompt.trim(), style, aspectRatio },
      { onSuccess: handleImageOutcome }
    )
  }

  // Two-phase Generate: the first click (or any click while the field is
  // empty) sends whatever the user typed -- a real description, or nothing
  // at all -- to the prompt-writing stage first, streaming SocioPosts'
  // authored prompt live into this same field instead of going straight to
  // Flux. Only once that's written (and the user has had a chance to read
  // or edit it) does a second click actually generate, using the exact
  // text left in the field at that click -- never re-processed again.
  function handleGenerate() {
    if (promptWriter.stage === "writing") return
    if (promptWriter.stage === "idle" || !prompt.trim()) {
      promptWriter.write({
        flow: "image_tool",
        brandId,
        productId: selectedProductId ?? undefined,
        rawInput: prompt.trim() || null,
        constraints: {
          aspectRatioLabel: aspectRatio,
          styleLabel: STYLES.find((s) => s.value === style)?.label,
          hasProductReference: !!selectedProductId,
        },
      })
      return
    }
    setTextWarning(null)
    runGenerate(false)
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

        <PromptWriterField
          label="Describe what you want to generate (optional)"
          prompt={prompt}
          onChange={setImagePrompt}
          stage={promptWriter.stage}
          error={promptWriter.error}
          onRewrite={() => promptWriter.write({
            flow: "image_tool",
            brandId,
            productId: selectedProductId ?? undefined,
            rawInput: prompt.trim() || null,
            constraints: {
              aspectRatioLabel: aspectRatio,
              styleLabel: STYLES.find((s) => s.value === style)?.label,
              hasProductReference: !!selectedProductId,
            },
          })}
          placeholder="e.g. 'merch giveaway visual with confetti' or 'product on marble with morning light' — or leave blank and let SocioPosts write one"
          rows={2}
        />

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

        <Button className="w-full" onClick={handleGenerate} disabled={isPending || promptWriter.stage === "writing"}>
          {isPending ? (
            <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Generating: {prompt.slice(0, 30)}{prompt.length > 30 ? "…" : ""}</>
          ) : promptWriter.stage === "writing" ? (
            <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Writing your prompt…</>
          ) : (
            <><ImageIcon className="h-4 w-4 mr-2" /> Generate image</>
          )}
        </Button>

        {textWarning && !isPending && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-3">
            <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="flex-1 space-y-2">
              <p className="text-sm text-amber-900 font-medium">{textWarning}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleGenerate}
                  className="rounded-full border border-amber-300 bg-white px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                >
                  Generate background only
                </button>
                <button
                  onClick={() => runGenerate(true)}
                  className="rounded-full px-3 py-1 text-xs font-semibold text-amber-700 hover:text-amber-900"
                >
                  Generate anyway
                </button>
              </div>
            </div>
          </div>
        )}

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
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-green-700">
          <Check className="h-4 w-4 shrink-0" />
          <span className="text-sm font-medium">✓ Saved</span>
        </div>
      )}

      {/* Previous images */}
      {!isPending && images.length > 0 && (
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
