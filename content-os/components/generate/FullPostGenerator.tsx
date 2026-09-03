"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { Sparkles, RefreshCw, Copy, Check, Download, Archive, Loader2, AlertCircle, Upload, X } from "lucide-react"
import { ProductPicker, type PickedProduct } from "@/components/shared/ProductPicker"
import { ScheduleAction } from "@/components/shared/ScheduleAction"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import Link from "next/link"
import { GeneratingState } from "@/components/shared/GeneratingState"
import { UsageLimitBanner } from "@/components/generate/UsageLimitBanner"
import { POST_TEMPLATES, DEFAULT_POST_TEMPLATE_ID } from "@/lib/design/post-templates"
import type { PostTemplateId } from "@/lib/design/post-templates"
import { resolveColorThemes } from "@/lib/design/color-themes"
import { resolveFonts, DEFAULT_FONT_ID } from "@/lib/design/fonts"
import type { FontId } from "@/lib/design/fonts"
import { useGenerateFullPost, useGeneratePostImage, useGenerateFullPostFromPhoto } from "@/hooks/useGeneration"
import { POST as POST_CREDIT_COST, PHOTO_CAPTION } from "@/lib/usage/credit-costs"
import { useGenerationStore } from "@/stores/generationStore"
import { useBrand } from "@/hooks/useBrand"
import type { FullPostResult, ContentResult } from "@/hooks/useGeneration"
import type { ProductRow } from "@/types/database"
import type { GeneratedHook, GeneratedCaption, ReelScript, CarouselContent, BlogPost, AdCopy } from "@/types/app"

// ─── Canvas compositing helpers ──────────────────────────────────────────────

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

interface ProductCardResult {
  dataUrl: string
  /** false when the product photo itself failed to load (commonly CORS) —
   * the returned card still renders (gradient + hook text), but without
   * the actual product photo. Callers should treat this as a failure to
   * surface, not a silent downgrade — see FIX 3 in FullPostGenerator's
   * handleGenerate/runProductCardComposite. */
  photoLoaded: boolean
}

async function compositeProductCard(
  productImageUrl: string,
  hookText: string,
  primaryColor: string,
  secondaryColor: string,
  brandName: string,
): Promise<ProductCardResult> {
  const size = 1080
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext("2d")!

  // Gradient background
  const grad = ctx.createLinearGradient(0, 0, size, size)
  grad.addColorStop(0, primaryColor)
  grad.addColorStop(1, secondaryColor)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)

  // Dark overlay for text legibility
  ctx.fillStyle = "rgba(0,0,0,0.28)"
  ctx.fillRect(0, 0, size, size)

  // Product image — upper 62% of the card
  let photoLoaded = true
  try {
    const img = await loadImage(productImageUrl)
    const pad = 100
    const maxW = size - pad * 2
    const maxH = size * 0.58
    const ratio = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight)
    const w = img.naturalWidth * ratio
    const h = img.naturalHeight * ratio
    ctx.drawImage(img, (size - w) / 2, size * 0.06, w, h)
  } catch {
    // CORS or load failure — still render the branded text card below, but
    // the caller needs to know the photo itself didn't make it in.
    photoLoaded = false
  }

  // Hook text — bottom third, word-wrapped to 2 lines
  ctx.fillStyle = "#ffffff"
  ctx.textAlign = "center"
  ctx.textBaseline = "top"
  ctx.font = `bold 68px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
  const words = hookText.split(" ")
  const lines: string[] = []
  let cur = ""
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word
    if (ctx.measureText(test).width > size - 140) {
      if (cur) lines.push(cur)
      cur = word
      if (lines.length >= 1) break
    } else {
      cur = test
    }
  }
  if (cur && lines.length < 2) lines.push(cur)
  const lineH = 82
  const textY = size * 0.70
  lines.forEach((line, i) => ctx.fillText(line, size / 2, textY + i * lineH))

  // Brand name — bottom
  ctx.font = `34px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
  ctx.fillStyle = "rgba(255,255,255,0.60)"
  ctx.fillText(brandName, size / 2, size * 0.93)

  return { dataUrl: canvas.toDataURL("image/jpeg", 0.90), photoLoaded }
}

interface Props {
  brandId: string
  products: ProductRow[]
}

export function FullPostGenerator({ brandId, products }: Props) {
  const { mutate: generate, isPending, error } = useGenerateFullPost()
  const { mutate: generatePostImageMutate, isPending: imageGenerating } = useGeneratePostImage()
  const { mutateAsync: generateFromPhotoAsync, isPending: photoGenerating, error: photoError } = useGenerateFullPostFromPhoto()
  const {
    fullPostResult,
    setFullPostResult,
    selectedProductId,
    setSelectedProductId,
    occasionContext,
    pendingTopic,
    setPendingTopic,
  } = useGenerationStore()
  const { data: brand } = useBrand(brandId)

  const palette = brand?.color_palette as Record<string, unknown> | null | undefined
  const paletteColors = palette ? Object.values(palette).filter((v): v is string => typeof v === "string") : []
  const primaryColor = paletteColors[0] ?? "#6366f1"
  const secondaryColor = paletteColors[1] ?? "#818cf8"
  const brandName = brand?.name ?? "Brand"

  const colorThemes = useMemo(() => resolveColorThemes(brand ?? null), [brand])
  const fonts = useMemo(() => resolveFonts(), [])

  const [additionalContext, setAdditionalContext] = useState("")
  const [copied, setCopied] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)
  const [selectedLayout, setSelectedLayout] = useState<PostTemplateId>(DEFAULT_POST_TEMPLATE_ID)
  const [selectedColorThemeId, setSelectedColorThemeId] = useState<string>("")
  // Fully opt-in — empty by default produces a clean, text-free image.
  // Only what's typed here ever gets composited onto the generated photo;
  // no more auto-filled headline from the picked hook or auto-filled CTA
  // from brand.cta_phrase.
  const [imageCaptionText, setImageCaptionText] = useState("")
  const [selectedFontId, setSelectedFontId] = useState<FontId>(DEFAULT_FONT_ID)
  const [postImageUrl, setPostImageUrl] = useState<string | null>(null)
  const [imageSource, setImageSource] = useState<"ai" | "product_photo" | "user_upload" | null>(null)
  // Full Post's real charge depends on which path actually ran, not a
  // single fixed cost like Carousel/Story/Ad Maker -- the text-generation
  // step itself always charges 0 (see CONTENT_FORMAT_CREDIT_COSTS'
  // comment in lib/usage/credit-costs.ts): the AI-image path bills the
  // bundled POST cost at the image step, the uploaded-photo path bills
  // PHOTO_CAPTION at the vision/caption step, and the product-photo path
  // composites client-side with no server call at all, so it's genuinely
  // 0. null while the image step hasn't resolved yet (imageSource unset),
  // so the confirmation banner doesn't show a cost before it's known.
  const creditsUsedForResult = imageSource === "user_upload" ? PHOTO_CAPTION : imageSource === "product_photo" ? 0 : imageSource === "ai" ? POST_CREDIT_COST : null
  const [imageError, setImageError] = useState<string | null>(null)
  const [postSessionId, setPostSessionId] = useState<string | null>(null)
  const [selectedProduct, setSelectedProduct] = useState<PickedProduct | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // "Upload your own photo" — a genuinely different path from the Product
  // picker above (not tied to a saved Product) and from AI image generation
  // (no Flux/Pollinations background gets generated at all; this exact
  // photo, unmodified, becomes the post image). Mirrors the file input +
  // drag-drop + document-level Ctrl+V paste pattern already shipped for
  // AdMaker/ProductPicker/SceneComposer rather than a fourth variant.
  const [uploadedPhotoDataUrl, setUploadedPhotoDataUrl] = useState<string | null>(null)
  const [uploadedPhotoError, setUploadedPhotoError] = useState<string | null>(null)
  const [isDraggingPhoto, setIsDraggingPhoto] = useState(false)
  const photoInputRef = useRef<HTMLInputElement>(null)
  // Checked at paste time via offsetParent (null when this subtree — or an
  // ancestor, e.g. a hidden Create tab — is display:none), same gating as
  // ProductPicker/AdMaker's own document-level paste listeners.
  const photoDropzoneRef = useRef<HTMLDivElement>(null)

  // colorThemes only resolves once the brand has loaded — falls back to the
  // first available theme (always non-empty, curated presets included).
  const effectiveColorThemeId = selectedColorThemeId || colorThemes[0]?.id || ""

  const runImageGeneration = useCallback((data: FullPostResult, sessionId: string) => {
    const caption = data.content.content as GeneratedCaption
    const imagePrompt = (caption.image_prompt?.trim() || `${data.hook.hook_text}, ${brand?.niche ?? "brand"} product`).slice(0, 500)
    // Fully opt-in — no auto-fill from the picked hook or brand.cta_phrase.
    // Empty means a clean, text-free image; fontId only matters when
    // there's actually text to render with it.
    const captionText = imageCaptionText.trim() || undefined

    setImageError(null)
    generatePostImageMutate(
      {
        brandId,
        productId: selectedProductId ?? undefined,
        imagePrompt,
        template: selectedLayout,
        colorThemeId: effectiveColorThemeId,
        captionText,
        fontId: captionText ? selectedFontId : undefined,
        postSessionId: sessionId,
        contentProjectId: data.contentProjectId ?? undefined,
      },
      {
        onSuccess: (imgData) => {
          setPostImageUrl(imgData.public_url)
          setImageSource("ai")
        },
        onError: (err) => {
          setImageError(err instanceof Error ? err.message : "Couldn't generate the post image. Please try again.")
        },
      }
    )
  }, [brand, brandId, selectedProductId, selectedLayout, effectiveColorThemeId, imageCaptionText, selectedFontId, generatePostImageMutate])

  // FIX 3: a failed product-photo load (commonly CORS) used to silently
  // fall back to a photo-less gradient card and still report success — the
  // user had no idea their photo didn't make it in. Now surfaced through
  // the same imageError UI the AI-generation path already uses.
  const runProductCardComposite = useCallback((imageUrl: string, hookText: string) => {
    setImageError(null)
    compositeProductCard(imageUrl, hookText, primaryColor, secondaryColor, brandName)
      .then((result) => {
        if (!result.photoLoaded) {
          setImageError("Couldn't load your product photo into the post. It may be blocking this kind of use. Try a different image, or remove it to use an AI-generated background instead.")
          return
        }
        setPostImageUrl(result.dataUrl)
        setImageSource("product_photo")
      })
      .catch(() => {
        // Compositing itself failed (e.g. a CORS-tainted canvas rejecting
        // toDataURL) — fall back to the raw photo URL so the user at least
        // sees their actual photo instead of nothing.
        setPostImageUrl(imageUrl)
        setImageSource("product_photo")
      })
  }, [primaryColor, secondaryColor, brandName])

  const handleRegenerateImage = useCallback(() => {
    if (!fullPostResult || !postSessionId) return
    // Retry whatever path is currently configured — if a product photo is
    // still selected, retry compositing it; otherwise retry AI generation.
    if (selectedProduct?.imageUrl) {
      runProductCardComposite(selectedProduct.imageUrl, fullPostResult.hook.hook_text)
    } else {
      runImageGeneration(fullPostResult, postSessionId)
    }
  }, [fullPostResult, postSessionId, selectedProduct, runProductCardComposite, runImageGeneration])

  // Caption editing — this result is still pre-save local/store state at
  // this point (the captions row this generation already wrote server-side
  // has no id threaded back to the client at all to PUT an edit onto, see
  // app/api/v1/ai/fullpost/generate/route.ts's captions insert), so
  // "saving" an edit here just means updating fullPostResult itself.
  // Confirmed this is enough for the one downstream action that actually
  // reads it before this result is replaced or navigated away from:
  // getScheduleCaption(result) below derives scheduleCaption fresh from
  // this same result on every render, so ScheduleAction's Confirm button
  // sends whatever this holds at click time, edited or not.
  const handleSaveCaption = useCallback((text: string) => {
    if (!fullPostResult || fullPostResult.content.format !== "social_post") return
    setFullPostResult({
      ...fullPostResult,
      content: { ...fullPostResult.content, content: { ...fullPostResult.content.content, caption_text: text } },
    })
  }, [fullPostResult, setFullPostResult])

  // Shared by file-browse, drag-drop, and clipboard paste — same
  // one-validation-path convention as AdMaker/ProductPicker's own
  // processImageFile.
  function processUploadedPhotoFile(file: File | undefined | null) {
    if (!file) return
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setUploadedPhotoError("Please use a JPG, PNG, or WEBP image.")
      return
    }
    setUploadedPhotoError(null)
    const reader = new FileReader()
    reader.onload = () => setUploadedPhotoDataUrl(reader.result as string)
    reader.readAsDataURL(file)
  }

  function handlePhotoFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    processUploadedPhotoFile(e.target.files?.[0])
    e.target.value = ""
  }

  function handlePhotoDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDraggingPhoto(false)
    processUploadedPhotoFile(e.dataTransfer.files?.[0])
  }

  // Native ClipboardEvent, not React.ClipboardEvent — same reasoning as
  // AdMaker/ProductPicker: the only interactive element in the empty
  // dropzone opens the native file browser on click, so there's no element
  // to "click to focus, then paste" onto.
  function handlePhotoPaste(e: ClipboardEvent) {
    if (photoDropzoneRef.current && photoDropzoneRef.current.offsetParent === null) return
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile()
        if (file) {
          processUploadedPhotoFile(file)
          break
        }
      }
    }
  }

  // Active only while the dropzone is actually showing (no photo picked
  // yet) — same scoping as AdMaker's own paste listener.
  useEffect(() => {
    if (uploadedPhotoDataUrl) return
    document.addEventListener("paste", handlePhotoPaste)
    return () => document.removeEventListener("paste", handlePhotoPaste)
  // handlePhotoPaste is a plain (unmemoized) function recreated every
  // render — its behavior only meaningfully depends on uploadedPhotoDataUrl,
  // already listed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadedPhotoDataUrl])

  const handleGenerateFromPhoto = useCallback(async () => {
    if (!uploadedPhotoDataUrl) return
    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()
    setJustSaved(false)
    setPostImageUrl(null)
    setImageSource(null)
    setImageError(null)
    setPostSessionId(null)

    try {
      const data = await generateFromPhotoAsync({
        brandId,
        imageDataUrl: uploadedPhotoDataUrl,
        additionalContext: additionalContext || undefined,
      })
      // Reuses the exact same FullPostResult/postImageUrl/imageSource state
      // (and therefore the exact same FullPostResults/PostImagePreview
      // rendering) the AI-image and product-photo paths already use —
      // postSessionId stays null since there's no Flux/Pollinations image
      // to ever regenerate here, and imageSource "user_upload" already
      // correctly keeps showRegenerate false (that prop is only true for
      // "ai") without any new conditional needed downstream.
      setFullPostResult({
        hook: data.hook,
        content: data.content,
        postCardHtml: null,
        platform: data.platform,
        format: data.format,
        postSessionId: null,
        contentProjectId: data.contentProjectId,
      })
      setPostImageUrl(data.imageUrl)
      setImageSource("user_upload")
      setJustSaved(true)
      setTimeout(() => setJustSaved(false), 5000)
    } catch {
      // error surfaced via photoError below
    }
  }, [uploadedPhotoDataUrl, brandId, additionalContext, generateFromPhotoAsync, setFullPostResult])

  useEffect(() => {
    if (occasionContext) setAdditionalContext(occasionContext.angle)
  }, [occasionContext])

  // Consume a topic handed off from another generator, if any
  useEffect(() => {
    if (pendingTopic) {
      setAdditionalContext(pendingTopic)
      setPendingTopic(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Restore from sessionStorage on mount
  useEffect(() => {
    if (!fullPostResult) {
      const saved = sessionStorage.getItem(`fullpost_${brandId}`)
      if (saved) {
        try { setFullPostResult(JSON.parse(saved)) } catch {}
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId])

  // Persist to sessionStorage when result changes
  useEffect(() => {
    if (fullPostResult) {
      sessionStorage.setItem(`fullpost_${brandId}`, JSON.stringify(fullPostResult))
    }
  }, [fullPostResult, brandId])

  // Cleanup on unmount
  useEffect(() => {
    return () => abortControllerRef.current?.abort()
  }, [])

  const copy = useCallback((text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }, [])

  function handleGenerate() {
    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()
    setJustSaved(false)
    setPostImageUrl(null)
    setImageSource(null)
    setImageError(null)
    setPostSessionId(null)

    generate(
      {
        brandId,
        productId: selectedProductId ?? undefined,
        format: "social_post",
        platform: "instagram",
        additionalContext: additionalContext || undefined,
      },
      {
        onSuccess: (data) => {
          setFullPostResult(data)
          setPostSessionId(data.postSessionId)
          setJustSaved(true)
          setTimeout(() => setJustSaved(false), 5000)
          if (selectedProduct?.imageUrl) {
            runProductCardComposite(selectedProduct.imageUrl, data.hook.hook_text)
          } else if (data.postSessionId) {
            runImageGeneration(data, data.postSessionId)
          } else {
            setImageError("Couldn't start image generation. Please try again.")
          }
        },
      }
    )
  }

  // Whichever path applies right now — a stable local so JSX below can
  // narrow on it once instead of re-evaluating the same ternary repeatedly
  // (which TypeScript can't carry null-narrowing across).
  const activeError = uploadedPhotoDataUrl ? photoError : error
  const activeIsPending = uploadedPhotoDataUrl ? photoGenerating : isPending
  const activeGenerate = uploadedPhotoDataUrl ? handleGenerateFromPhoto : handleGenerate

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="rounded-lg border bg-card p-5 space-y-4">
        <h3 className="text-sm font-semibold">Full Post Settings</h3>

        {/* Product */}
        {products.length > 0 && (
          <div className="space-y-1.5">
            <Label className="text-xs">Product (optional)</Label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={selectedProductId ?? ""}
              onChange={(e) => setSelectedProductId(e.target.value || null)}
            >
              <option value="">No specific product</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Upload your own photo — mutually exclusive with the Product/
            AI-image controls below: a genuinely different capability, not
            a variation of either (not tied to a saved Product, and no
            Flux/Pollinations image ever gets generated — this exact photo
            becomes the post image, unmodified). Hiding the other image
            controls while a photo is uploaded avoids implying they'd
            somehow combine with it. */}
        <div ref={photoDropzoneRef} className="space-y-1.5">
          <Label className="text-xs">Or upload your own photo</Label>
          <p className="text-[11px] text-muted-foreground">
            We&apos;ll write your caption based on what&apos;s actually in the photo — no AI-generated image, this exact photo gets used.
          </p>
          {!uploadedPhotoDataUrl ? (
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDraggingPhoto(true) }}
              onDragLeave={() => setIsDraggingPhoto(false)}
              onDrop={handlePhotoDrop}
              className={`flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed py-6 text-center transition-colors ${
                isDraggingPhoto ? "border-violet-500 bg-violet-50" : "border-muted-foreground/30 hover:border-violet-400 hover:bg-violet-50/30"
              }`}
            >
              <Upload className="h-6 w-6 text-muted-foreground/40" />
              <p className="text-xs font-medium">Drop a photo here or click to browse</p>
              <p className="text-[10px] text-muted-foreground">or paste from clipboard (Ctrl+V) · JPG, PNG or WEBP</p>
            </button>
          ) : (
            <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={uploadedPhotoDataUrl} alt="Your uploaded photo" className="h-14 w-14 shrink-0 rounded-md border object-cover" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium">Photo ready</p>
                <p className="text-[11px] text-muted-foreground">This exact photo will be your post image.</p>
              </div>
              <button
                type="button"
                onClick={() => { setUploadedPhotoDataUrl(null); setUploadedPhotoError(null) }}
                className="flex shrink-0 items-center gap-0.5 text-xs text-destructive hover:underline"
              >
                <X className="h-3 w-3" /> Remove
              </button>
            </div>
          )}
          <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoFileChange} />
          {uploadedPhotoError && <p className="text-[11px] text-destructive">{uploadedPhotoError}</p>}
        </div>

        {!uploadedPhotoDataUrl && (
          <>
            {/* Product image for post graphic */}
            <div className="space-y-1.5">
              <Label className="text-xs">Product image for post graphic (optional)</Label>
              <ProductPicker
                brandId={brandId}
                selected={selectedProduct}
                onSelect={setSelectedProduct}
                label="Add product photo (composites on your post graphic)"
              />
            </div>

            {/* Layout + color theme — two independent choices, not preset combos.
                Only affect the AI-generated image path below; the product-photo
                path (compositeProductCard) keeps its own fixed look. */}
            <div className="space-y-1.5">
              <Label className="text-xs">Post image layout</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {POST_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedLayout(t.id)}
                    className={`relative rounded-lg border-2 p-2.5 text-left transition-all ${
                      selectedLayout === t.id ? "border-primary bg-primary/5 shadow-sm" : "border-muted hover:border-primary/40"
                    }`}
                  >
                    <p className="text-xs font-semibold">{t.label}</p>
                    <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{t.description}</p>
                    {selectedLayout === t.id && (
                      <div className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary">
                        <Check className="h-2.5 w-2.5 text-white" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Color theme</Label>
              <div className="flex flex-wrap gap-2">
                {colorThemes.map((theme) => (
                  <button
                    key={theme.id}
                    type="button"
                    onClick={() => setSelectedColorThemeId(theme.id)}
                    className={`flex items-center gap-1.5 rounded-full border-2 px-2.5 py-1.5 text-xs font-medium transition-all ${
                      effectiveColorThemeId === theme.id ? "border-primary shadow-sm" : "border-muted hover:border-primary/40"
                    }`}
                  >
                    <span
                      className="h-4 w-4 shrink-0 rounded-full border border-black/10"
                      style={{ background: `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})` }}
                    />
                    {theme.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Image caption text — fully opt-in. Empty (the default) produces
                a clean, text-free image; nothing auto-generated ever gets
                stamped on it unless typed here. */}
            <div className="space-y-1.5">
              <Label className="text-xs">Add text to your image (optional)</Label>
              <textarea
                rows={2}
                maxLength={150}
                placeholder="Leave blank for a clean, text-free image — or type what you want shown on it"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                value={imageCaptionText}
                onChange={(e) => setImageCaptionText(e.target.value)}
              />
              {imageCaptionText.trim() && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {fonts.map((font) => (
                    <button
                      key={font.id}
                      type="button"
                      onClick={() => setSelectedFontId(font.id)}
                      className={`rounded-full border-2 px-2.5 py-1.5 text-xs font-medium transition-all ${
                        selectedFontId === font.id ? "border-primary shadow-sm" : "border-muted hover:border-primary/40"
                      }`}
                    >
                      {font.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* Additional context */}
        <div className="space-y-1.5">
          <Label className="text-xs">Additional context (optional)</Label>
          <textarea
            rows={2}
            placeholder="e.g. 'Weekend flash sale, 20% off' or 'New packaging launch'"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            value={additionalContext}
            onChange={(e) => setAdditionalContext(e.target.value)}
          />
        </div>

        <Button className="w-full" onClick={activeGenerate} disabled={activeIsPending}>
          {activeIsPending ? (
            <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> {uploadedPhotoDataUrl ? "Writing your caption…" : "Generating full post…"}</>
          ) : (
            <><Sparkles className="h-4 w-4 mr-2" /> {uploadedPhotoDataUrl ? "Generate caption for this photo" : "Generate full post"}</>
          )}
        </Button>

        {activeError && <UsageLimitBanner error={activeError} onRetry={activeGenerate} />}
      </div>

      {activeIsPending && (
        <GeneratingState message={uploadedPhotoDataUrl ? "Looking at your photo and writing a caption…" : "Writing your full post…"} />
      )}

      {justSaved && (
        <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <div className="flex items-center gap-2 text-green-700">
            <Check className="h-4 w-4 shrink-0" />
            <span className="text-sm font-medium">
              ✓ Generated successfully{creditsUsedForResult !== null ? ` · ${creditsUsedForResult} credit${creditsUsedForResult !== 1 ? "s" : ""} used` : ""}. Scroll down to see your content
            </span>
          </div>
          <Link
            href={`/brands/${brandId}/library`}
            className="text-xs font-medium text-green-700 underline underline-offset-2 hover:text-green-900 shrink-0"
          >
            View →
          </Link>
        </div>
      )}

      {/* Results */}
      {fullPostResult && !isPending && (
        <FullPostResults
          result={fullPostResult}
          copied={copied}
          onCopy={copy}
          onSaveCaption={handleSaveCaption}
          brandId={brandId}
          brandName={brandName}
          postImageUrl={postImageUrl}
          imageGenerating={imageGenerating}
          imageError={imageError}
          imageSource={imageSource}
          onRegenerateImage={handleRegenerateImage}
        />
      )}
    </div>
  )
}

// ─── Result components ───────────────────────────────────────────────────────

function CopyBtn({ text, id, copied, onCopy }: { text: string; id: string; copied: string | null; onCopy: (t: string, k: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onCopy(text, id)}
      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied === id ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
      {copied === id ? "Copied" : "Copy"}
    </button>
  )
}

function HookSection({ hook, copied, onCopy }: { hook: GeneratedHook; copied: string | null; onCopy: (t: string, k: string) => void }) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Hook</span>
        <CopyBtn text={hook.hook_text} id="hook" copied={copied} onCopy={onCopy} />
      </div>
      <p className="text-sm font-semibold leading-relaxed">{hook.hook_text}</p>
      <p className="text-xs text-muted-foreground italic">{hook.reasoning}</p>
    </div>
  )
}

function ContentDisplay({ content, copied, onCopy, onSaveCaption }: { content: ContentResult; copied: string | null; onCopy: (t: string, k: string) => void; onSaveCaption?: (text: string) => void }) {
  // Caption editing (social_post only) -- mirrors
  // components/calendar/CalendarEntryPanel.tsx's Edit/Cancel/Save caption
  // pattern exactly, just without that component's PUT-to-database step
  // (see onSaveCaption's own call site for why: this content hasn't been
  // saved anywhere with an id to PUT back to yet at this point). Reset
  // whenever `content` itself changes (a fresh generation or Regenerate),
  // same as CalendarEntryPanel resets on a new `entry`.
  const [isEditingCaption, setIsEditingCaption] = useState(false)
  const [editCaptionText, setEditCaptionText] = useState(
    content.format === "social_post" ? (content.content as GeneratedCaption).caption_text : ""
  )
  useEffect(() => {
    if (content.format === "social_post") setEditCaptionText((content.content as GeneratedCaption).caption_text)
    setIsEditingCaption(false)
  }, [content])

  if (content.format === "social_post") {
    const c = content.content as GeneratedCaption
    const full = `${c.caption_text}\n\n${c.hashtags.map((h) => `#${h.replace(/^#+/, "")}`).join(" ")}`
    return (
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Caption</span>
          <div className="flex items-center gap-1">
            {!isEditingCaption && <CopyBtn text={full} id="caption" copied={copied} onCopy={onCopy} />}
            {onSaveCaption && (
              <button
                type="button"
                onClick={() => setIsEditingCaption((v) => !v)}
                className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                {isEditingCaption ? "Cancel" : "Edit"}
              </button>
            )}
          </div>
        </div>
        {isEditingCaption ? (
          <div className="space-y-2">
            <textarea
              rows={5}
              value={editCaptionText}
              onChange={(e) => setEditCaptionText(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
            <Button
              size="sm"
              onClick={() => {
                onSaveCaption?.(editCaptionText)
                setIsEditingCaption(false)
              }}
            >
              Save
            </Button>
          </div>
        ) : (
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{c.caption_text}</p>
        )}
        {!isEditingCaption && c.hashtags.length > 0 && (
          <p className="text-xs text-primary font-medium">{c.hashtags.map((h) => `#${h.replace(/^#+/, "")}`).join(" ")}</p>
        )}
        {!isEditingCaption && c.cta && <p className="text-xs text-muted-foreground">CTA: {c.cta}</p>}
      </div>
    )
  }

  if (content.format === "reel_script") {
    const c = content.content as ReelScript
    return (
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Reel Script · Storyboard</span>
          <CopyBtn
            text={`HOOK: ${c.hook}\n\n${c.scenes.map((s, i) => `Scene ${i + 1} (${s.duration_seconds}s)\nVisual: ${s.visual_direction}\nVoiceover: ${s.voiceover_or_text_overlay}`).join("\n\n")}\n\nCAPTION:\n${c.caption}\n\n${c.hashtags.map((h) => `#${h.replace(/^#+/, "")}`).join(" ")}`}
            id="reel"
            copied={copied}
            onCopy={onCopy}
          />
        </div>
        <div className="rounded-md bg-primary/5 border border-primary/10 p-3">
          <p className="text-xs font-semibold text-muted-foreground mb-1">Opening Hook</p>
          <p className="text-sm font-semibold">{c.hook}</p>
        </div>
        {/* Storyboard scene cards */}
        <div className="grid gap-3 sm:grid-cols-2">
          {c.scenes.map((scene, i) => {
            const imgPrompt = encodeURIComponent(`${scene.visual_direction}, cinematic, vertical video frame, 9:16`)
            const imgUrl = `https://image.pollinations.ai/prompt/${imgPrompt}?width=360&height=640&seed=${i + 1}&nologo=true&model=flux`
            return (
              <div key={i} className="rounded-md border overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imgUrl}
                  alt={`Scene ${i + 1}`}
                  width={360}
                  height={180}
                  className="w-full object-cover"
                  style={{ height: 120 }}
                  loading="lazy"
                />
                <div className="p-2.5 space-y-1 bg-secondary/30">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold">Scene {i + 1}</p>
                    <span className="text-xs text-muted-foreground">{scene.duration_seconds}s</span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{scene.voiceover_or_text_overlay}</p>
                  <p className="text-xs text-muted-foreground/70 italic line-clamp-1">{scene.visual_direction}</p>
                </div>
              </div>
            )
          })}
        </div>
        {c.caption && (
          <div className="rounded-md bg-secondary/50 p-3">
            <p className="text-xs font-semibold text-muted-foreground mb-1">Caption</p>
            <p className="text-xs">{c.caption}</p>
          </div>
        )}
        {c.hashtags.length > 0 && (
          <p className="text-xs text-primary font-medium">{c.hashtags.map((h) => `#${h.replace(/^#+/, "")}`).join(" ")}</p>
        )}
      </div>
    )
  }

  if (content.format === "carousel") {
    const c = content.content as CarouselContent
    return (
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Carousel · {c.slides.length} slides</span>
          <CopyBtn
            text={c.slides.map((s) => `Slide ${s.slide_number}: ${s.headline}\n${s.body}`).join("\n\n")}
            id="carousel"
            copied={copied}
            onCopy={onCopy}
          />
        </div>
        <div className="space-y-2">
          {c.slides.map((slide) => (
            <div key={slide.slide_number} className="rounded-md bg-secondary/50 p-3 space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">Slide {slide.slide_number}</p>
              <p className="text-sm font-semibold">{slide.headline}</p>
              <p className="text-xs text-muted-foreground">{slide.body}</p>
            </div>
          ))}
        </div>
        {c.hashtags.length > 0 && (
          <p className="text-xs text-primary font-medium">{c.hashtags.map((h) => `#${h.replace(/^#+/, "")}`).join(" ")}</p>
        )}
      </div>
    )
  }

  if (content.format === "blog_post") {
    const c = content.content as BlogPost
    return (
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Blog Post</span>
          <CopyBtn text={`${c.title}\n\n${c.body}`} id="blog" copied={copied} onCopy={onCopy} />
        </div>
        <p className="text-base font-bold leading-snug">{c.title}</p>
        <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{c.body}</p>
        <div className="rounded-md bg-secondary/50 p-3">
          <p className="text-xs font-semibold text-muted-foreground mb-1">Meta description</p>
          <p className="text-xs">{c.meta_description}</p>
        </div>
      </div>
    )
  }

  if (content.format === "ad_copy") {
    const c = content.content as AdCopy
    const full = `Headline: ${c.headline}\n\n${c.primary_text}\n\n${c.description}\n\nCTA: ${c.cta_button}`
    return (
      <div className="rounded-lg border bg-card p-4 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ad Copy</span>
          <CopyBtn text={full} id="adcopy" copied={copied} onCopy={onCopy} />
        </div>
        {/* Facebook/Instagram-style ad mockup */}
        <div className="mx-auto max-w-xs overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center gap-2.5 border-b px-3 py-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-[10px] font-bold text-white">AD</div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-900">Your Brand</p>
              <p className="text-[10px] text-gray-400">Sponsored · 🌐</p>
            </div>
            <span className="text-base text-gray-300 leading-none">···</span>
          </div>
          <div className="px-3 py-2">
            <p className="line-clamp-3 text-xs text-gray-800">{c.primary_text}</p>
          </div>
          <div className="flex h-36 w-full items-center justify-center bg-gradient-to-br from-violet-50 to-indigo-50">
            <p className="text-[10px] font-medium text-gray-400">Ad creative goes here</p>
          </div>
          <div className="flex items-center justify-between gap-2 border-t bg-gray-50 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[9px] uppercase tracking-wide text-gray-400">{c.description}</p>
              <p className="truncate text-xs font-bold text-gray-900">{c.headline}</p>
            </div>
            <span className="shrink-0 rounded-md bg-blue-600 px-2.5 py-1 text-[10px] font-semibold text-white">{c.cta_button}</span>
          </div>
        </div>
        <div className="space-y-2 text-sm">
          <div><p className="text-xs font-semibold text-muted-foreground mb-0.5">Headline <span className="font-normal">({c.headline.length}/40 chars)</span></p><p className="font-bold">{c.headline}</p></div>
          <div><p className="text-xs font-semibold text-muted-foreground mb-0.5">Primary text</p><p>{c.primary_text}</p></div>
          <div><p className="text-xs font-semibold text-muted-foreground mb-0.5">Description</p><p className="text-muted-foreground">{c.description}</p></div>
          <div className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1"><p className="text-xs font-semibold text-primary">{c.cta_button}</p></div>
        </div>
      </div>
    )
  }

  return null
}

// ─── Schedule to Instagram/Facebook ──────────────────────────────────────────

function getScheduleCaption(result: FullPostResult): { text: string; hashtags: string[] } | null {
  if (result.content.format === "social_post") {
    const c = result.content.content as GeneratedCaption
    return { text: c.caption_text, hashtags: c.hashtags }
  }
  if (result.content.format === "reel_script") {
    const c = result.content.content as ReelScript
    if (!c.caption) return null
    return { text: c.caption, hashtags: c.hashtags }
  }
  // Carousel/blog/ad copy don't map to a single caption+image Instagram
  // post — scheduling those needs separate client-side rendering work.
  return null
}

function PostImagePreview({
  postImageUrl,
  alt,
  imageGenerating,
  imageError,
  showRegenerate,
  onRegenerateImage,
}: {
  postImageUrl: string | null
  alt: string
  imageGenerating: boolean
  imageError: string | null
  showRegenerate: boolean
  onRegenerateImage: () => void
}) {
  if (imageGenerating) {
    return (
      <div className="rounded-lg border bg-card p-4 flex items-center gap-3">
        <Loader2 className="h-4 w-4 animate-spin text-violet-500 shrink-0" />
        <p className="text-sm text-muted-foreground">Generating post image…</p>
      </div>
    )
  }

  if (imageError) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
        <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
        <div className="flex-1 space-y-2">
          <p className="text-sm text-amber-900 font-medium">{imageError}</p>
          <button
            type="button"
            onClick={onRegenerateImage}
            className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 hover:text-amber-900"
          >
            🔄 Try again
          </button>
        </div>
      </div>
    )
  }

  if (!postImageUrl) return null

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Post Image</span>
        <div className="flex items-center gap-3">
          {showRegenerate && (
            <button
              type="button"
              onClick={onRegenerateImage}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Regenerate image
            </button>
          )}
          <a
            href={postImageUrl}
            download="post-image.png"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Download className="h-3.5 w-3.5" /> Download
          </a>
        </div>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={postImageUrl}
        alt={alt}
        className="w-full rounded-lg object-contain"
      />
    </div>
  )
}

function FullPostResults({
  result,
  copied,
  onCopy,
  onSaveCaption,
  brandId,
  brandName,
  postImageUrl,
  imageGenerating,
  imageError,
  imageSource,
  onRegenerateImage,
}: {
  result: FullPostResult
  copied: string | null
  onCopy: (text: string, key: string) => void
  onSaveCaption: (text: string) => void
  brandId: string
  brandName: string
  postImageUrl: string | null
  imageGenerating: boolean
  imageError: string | null
  imageSource: "ai" | "product_photo" | "user_upload" | null
  onRegenerateImage: () => void
}) {
  const scheduleCaption = getScheduleCaption(result)

  // Screen readers otherwise get nothing but "Generated post image" for a
  // composited PNG whose headline/CTA text isn't real, selectable DOM text
  // anywhere else. Reuses the AI's own image_prompt (already generated for
  // the image pipeline, no new LLM call) as the scene description when the
  // AI path produced it — it doesn't describe a user-uploaded product
  // photo, so that path falls back to a plain brand/headline template.
  const caption = result.content.content as GeneratedCaption
  const headline = result.hook.hook_text
  const scene = imageSource === "ai" ? caption.image_prompt?.trim() : null
  const postImageAlt = scene
    ? `${headline}: ${scene}`
    : `${imageSource === "ai" ? "AI-generated" : ""} Instagram post image for ${brandName}: ${headline}`.replace(/\s+/g, " ").trim()

  return (
    <div className="space-y-4">
      <HookSection hook={result.hook} copied={copied} onCopy={onCopy} />
      <ContentDisplay content={result.content} copied={copied} onCopy={onCopy} onSaveCaption={onSaveCaption} />

      {/* This IS the final post image — exactly what downloads and what
          gets scheduled, never a separate raw/unstyled preview. */}
      <PostImagePreview
        postImageUrl={postImageUrl}
        alt={postImageAlt}
        imageGenerating={imageGenerating}
        imageError={imageError}
        showRegenerate={imageSource === "ai"}
        onRegenerateImage={onRegenerateImage}
      />

      {postImageUrl && !imageGenerating && scheduleCaption && (
        <ScheduleAction
          brandId={brandId}
          imageUrl={postImageUrl}
          caption={scheduleCaption.text}
          hashtags={scheduleCaption.hashtags}
        />
      )}

      <div className="flex justify-end">
        <Link
          href={`/brands/${brandId}/library`}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Archive className="h-3.5 w-3.5" />
          View in library →
        </Link>
      </div>
    </div>
  )
}
