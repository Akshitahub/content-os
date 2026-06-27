"use client"

import { useState, useRef, useCallback } from "react"
import { Upload, Wand2, Download, Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"

const SCENE_PRESETS = [
  "Studio white",
  "Luxury marble",
  "Outdoor natural",
  "Festive Indian",
  "Dark dramatic",
  "Pastel soft",
]

interface SceneComposerProps {
  brandId: string
}

export function SceneComposer({ brandId: _brandId }: SceneComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [originalFile, setOriginalFile] = useState<File | null>(null)
  const [originalPreview, setOriginalPreview] = useState<string | null>(null)
  const [removedBgDataUrl, setRemovedBgDataUrl] = useState<string | null>(null)
  const [removingBg, setRemovingBg] = useState(false)
  const [removeBgError, setRemoveBgError] = useState<string | null>(null)

  const [sceneDescription, setSceneDescription] = useState("")
  const [compositing, setCompositing] = useState(false)
  const [resultDataUrl, setResultDataUrl] = useState<string | null>(null)
  const [composeError, setComposeError] = useState<string | null>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setOriginalFile(file)
    setRemovedBgDataUrl(null)
    setResultDataUrl(null)
    setRemoveBgError(null)
    setComposeError(null)
    const reader = new FileReader()
    reader.onload = () => setOriginalPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const handleRemoveBackground = useCallback(async () => {
    if (!originalFile) return
    setRemovingBg(true)
    setRemoveBgError(null)
    try {
      const formData = new FormData()
      formData.append("image", originalFile)
      const res = await fetch("/api/v1/ai/remove-background", {
        method: "POST",
        body: formData,
      })
      const json = await res.json() as { data?: { base64: string }; error?: { message?: string } }
      if (!res.ok || !json.data) {
        throw new Error(json.error?.message ?? "Failed to remove background")
      }
      setRemovedBgDataUrl(`data:image/png;base64,${json.data.base64}`)
    } catch (err) {
      setRemoveBgError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setRemovingBg(false)
    }
  }, [originalFile])

  const handleCompose = useCallback(async () => {
    if (!removedBgDataUrl || !sceneDescription.trim()) return
    setCompositing(true)
    setComposeError(null)
    setResultDataUrl(null)

    try {
      const bgPrompt = encodeURIComponent(`${sceneDescription.trim()}, product photography background, high quality, 8k`)
      const bgUrl = `https://image.pollinations.ai/prompt/${bgPrompt}?width=1080&height=1080&seed=${Date.now() % 9999}&nologo=true&model=flux`

      await new Promise<void>((resolve, reject) => {
        const canvas = canvasRef.current
        if (!canvas) { reject(new Error("Canvas not found")); return }
        canvas.width = 1080
        canvas.height = 1080
        const ctx = canvas.getContext("2d")
        if (!ctx) { reject(new Error("Canvas context not found")); return }

        const bg = new Image()
        bg.crossOrigin = "anonymous"
        bg.src = bgUrl
        bg.onload = () => {
          ctx.drawImage(bg, 0, 0, 1080, 1080)
          const fg = new Image()
          fg.src = removedBgDataUrl
          fg.onload = () => {
            const maxSize = 1080 * 0.72
            const scale = Math.min(maxSize / fg.width, maxSize / fg.height)
            const w = fg.width * scale
            const h = fg.height * scale
            const x = (1080 - w) / 2
            const y = (1080 - h) / 2
            ctx.drawImage(fg, x, y, w, h)
            setResultDataUrl(canvas.toDataURL("image/png"))
            resolve()
          }
          fg.onerror = () => reject(new Error("Failed to load product image"))
        }
        bg.onerror = () => reject(new Error("Failed to load background — Pollinations may be slow, try again"))
      })
    } catch (err) {
      setComposeError(err instanceof Error ? err.message : "Composition failed")
    } finally {
      setCompositing(false)
    }
  }, [removedBgDataUrl, sceneDescription])

  function handleDownload() {
    if (!resultDataUrl) return
    const a = document.createElement("a")
    a.href = resultDataUrl
    a.download = "product-scene.png"
    a.click()
  }

  function handleReset() {
    setOriginalFile(null)
    setOriginalPreview(null)
    setRemovedBgDataUrl(null)
    setResultDataUrl(null)
    setRemoveBgError(null)
    setComposeError(null)
    setSceneDescription("")
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Place your product in a scene</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Remove background from your product photo, then drop it into an AI-generated scene.
          </p>
        </div>
        {(originalFile || resultDataUrl) && (
          <button onClick={handleReset} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
            <X className="h-3.5 w-3.5" /> Reset
          </button>
        )}
      </div>

      {/* Hidden canvas for compositing */}
      <canvas ref={canvasRef} className="hidden" />

      <div className="rounded-lg border bg-card p-5 space-y-5">
        {/* Step 1: Upload */}
        <div className="space-y-2">
          <Label className="text-xs">Step 1 — Upload product photo</Label>
          {!originalPreview ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30 py-8 text-center hover:border-primary/40 hover:bg-muted/30 transition-colors"
            >
              <Upload className="h-8 w-8 text-muted-foreground/40 mb-2" />
              <p className="text-sm font-medium text-muted-foreground">Click to upload</p>
              <p className="text-xs text-muted-foreground/60 mt-0.5">JPG or PNG, max 10MB</p>
            </button>
          ) : (
            <div className="flex items-start gap-4">
              {/* Original */}
              <div className="space-y-1 flex-1">
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Original</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={originalPreview}
                  alt="Original product"
                  className="w-full max-w-[140px] rounded-lg border object-contain"
                  style={{ aspectRatio: "1/1" }}
                />
              </div>
              {/* Removed bg */}
              {removedBgDataUrl && (
                <div className="space-y-1 flex-1">
                  <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">No background</p>
                  <div
                    className="w-full max-w-[140px] rounded-lg border overflow-hidden"
                    style={{
                      backgroundImage: "repeating-conic-gradient(#eee 0% 25%, white 0% 50%) 0 0 / 16px 16px",
                      aspectRatio: "1/1",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={removedBgDataUrl}
                      alt="Background removed"
                      className="w-full h-full object-contain"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleFileChange}
          />

          {originalFile && !removedBgDataUrl && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleRemoveBackground}
              disabled={removingBg}
              className="gap-2"
            >
              {removingBg ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Removing background…</>
              ) : (
                <><Wand2 className="h-3.5 w-3.5" /> Remove background</>
              )}
            </Button>
          )}
          {removeBgError && <p className="text-xs text-destructive">{removeBgError}</p>}
        </div>

        {/* Step 2: Scene description */}
        {removedBgDataUrl && (
          <div className="space-y-2">
            <Label className="text-xs">Step 2 — Describe the scene</Label>
            <textarea
              rows={2}
              placeholder="e.g. Marble surface with soft morning light, minimalist studio"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              value={sceneDescription}
              onChange={(e) => setSceneDescription(e.target.value)}
            />
            <div className="flex flex-wrap gap-1.5">
              {SCENE_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setSceneDescription(preset)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    sceneDescription === preset
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>

            <Button
              className="w-full gap-2 mt-2"
              onClick={handleCompose}
              disabled={compositing || !sceneDescription.trim()}
            >
              {compositing ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Composing scene…</>
              ) : (
                <><Wand2 className="h-4 w-4" /> Compose scene</>
              )}
            </Button>
            {composeError && <p className="text-xs text-destructive">{composeError}</p>}
          </div>
        )}

        {/* Step 3: Result */}
        {resultDataUrl && (
          <div className="space-y-3">
            <Label className="text-xs">Result</Label>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={resultDataUrl}
              alt="Composited scene"
              className="w-full max-w-sm rounded-xl border shadow-md"
            />
            <Button variant="outline" className="gap-2" onClick={handleDownload}>
              <Download className="h-4 w-4" />
              Download image
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
