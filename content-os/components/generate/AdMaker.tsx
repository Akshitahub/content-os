"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { Upload, Check, Loader2, Download, RefreshCw, ChevronRight, AlertCircle, X, CalendarClock } from "lucide-react"
import { useBrand } from "@/hooks/useBrand"
import { GenerationWarning } from "@/components/shared/GenerationWarning"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { isApiError } from "@/types/api"
import Link from "next/link"

// ─── Scene definitions ─────────────────────────────────────────────────────

const SCENES = [
  { id: "white_studio",   emoji: "🤍", name: "White Studio",    desc: "Clean, professional, premium" },
  { id: "dark_studio",    emoji: "🖤", name: "Dark Studio",     desc: "Moody, luxury, dramatic" },
  { id: "marble_surface", emoji: "🪨", name: "Marble Surface",  desc: "Elegant, minimal, classy" },
  { id: "wooden_table",   emoji: "🪵", name: "Wooden Table",    desc: "Warm, natural, cozy" },
  { id: "nature_green",   emoji: "🌿", name: "Nature & Green",  desc: "Fresh, organic, outdoor" },
  { id: "beach_summer",   emoji: "🏖️", name: "Beach & Summer",  desc: "Fun, bright, seasonal" },
  { id: "urban_street",   emoji: "🌆", name: "Urban Street",    desc: "Trendy, bold, editorial" },
  { id: "cozy_cafe",      emoji: "☕", name: "Cozy Cafe",       desc: "Warm, aesthetic, relatable" },
  { id: "diwali_glow",    emoji: "🪔", name: "Diwali Glow",     desc: "Festive, golden, celebration" },
  { id: "christmas",      emoji: "🎄", name: "Christmas",       desc: "Warm, gifting, holiday" },
  { id: "party_fun",      emoji: "🎉", name: "Party & Fun",     desc: "Energetic, colorful, exciting" },
  { id: "custom",         emoji: "✨", name: "Custom Scene",    desc: "Describe your own" },
]

const SCENE_PROMPTS: Record<string, string> = {
  white_studio: "pure white studio background, soft box lighting, minimal shadows, professional product photography, no props",
  dark_studio: "dark charcoal studio background, dramatic side lighting, luxury product photography, moody atmosphere",
  marble_surface: "white marble surface, soft window light, minimal aesthetic, luxury lifestyle photography, elegant",
  wooden_table: "rustic wooden table, warm morning sunlight, cozy lifestyle photography, natural wood texture",
  nature_green: "lush green nature background, golden hour sunlight, bokeh effect, organic lifestyle photography",
  beach_summer: "sandy beach, turquoise water, bright summer day, lifestyle photography, fun and vibrant",
  urban_street: "urban city street, brick wall background, trendy editorial fashion photography, street art",
  cozy_cafe: "cozy cafe interior, warm lighting, wooden tables, coffee aesthetic, lifestyle photography",
  diwali_glow: "Diwali festival decoration, earthen diyas, marigold flowers, warm golden light, Indian festive celebration",
  christmas: "Christmas decorations, pine branches, fairy lights, warm bokeh, festive gifting photography",
  party_fun: "colorful party background, balloons, confetti, celebration, fun and energetic",
}

const LOADING_MSGS = [
  "Generating your scene… 🎨",
  "Placing your product… 📸",
  "Adding finishing touches… ✨",
  "Almost ready… 🚀",
]

// ─── Canvas compositing ────────────────────────────────────────────────────

type ImageFormat = "square" | "portrait" | "story"
type TextColor = "white" | "dark" | "violet"
type TextPosition = "top" | "center" | "bottom"

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load: ${src.slice(0, 60)}`))
    img.src = src
  })
}

// Exponential backoff for failed Pollinations loads: 500ms, 1s, 2s over up
// to 3 retries, regenerating a fresh seed each attempt rather than failing
// immediately on the first bad/rate-limited response.
async function loadBackgroundWithRetry(backgroundUrl: string, initialSeed: number, maxRetries = 3): Promise<HTMLImageElement> {
  const delays = [500, 1000, 2000]
  let seed = initialSeed
  for (let attempt = 0; ; attempt++) {
    const bgUrl = backgroundUrl.replace(/seed=\d+/, `seed=${seed}`)
    try {
      return await loadImage(bgUrl)
    } catch (err) {
      if (attempt >= maxRetries) throw err
      const delay = delays[attempt] ?? delays[delays.length - 1]
      console.warn(`[AdMaker] Background image load failed, retrying with a new seed in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`)
      await new Promise((resolve) => setTimeout(resolve, delay))
      seed = Math.floor(Math.random() * 99999)
    }
  }
}

function getBackgroundUrl(scene: string, customScene: string, brandNiche: string, format: ImageFormat, seed: number): string {
  const dims: Record<ImageFormat, string> = {
    square: "width=1080&height=1080",
    portrait: "width=1080&height=1350",
    story: "width=1080&height=1920",
  }
  const sceneDesc = scene === "custom" ? customScene : (SCENE_PROMPTS[scene] ?? SCENE_PROMPTS.white_studio)
  const prompt = `${sceneDesc}, ${brandNiche} brand, no people, no text, no watermarks, no logos, photorealistic, 8K`
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${dims[format]}&seed=${seed}&nologo=true&model=flux&enhance=true`
}

async function compositeAd(
  productDataUrl: string,
  backgroundUrl: string,
  hookText: string,
  showText: boolean,
  textPosition: TextPosition,
  textColor: TextColor,
  format: ImageFormat,
  brandName: string,
  instagramHandle: string
): Promise<string[]> {
  const sizes: Record<ImageFormat, { w: number; h: number }> = {
    square: { w: 1080, h: 1080 },
    portrait: { w: 1080, h: 1350 },
    story: { w: 1080, h: 1920 },
  }
  const { w, h } = sizes[format]
  const seeds = [
    Math.floor(Math.random() * 99999),
    Math.floor(Math.random() * 99999),
    Math.floor(Math.random() * 99999),
  ]
  const results: string[] = []

  for (const seed of seeds) {
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d")!

    const bg = await loadBackgroundWithRetry(backgroundUrl, seed)
    ctx.drawImage(bg, 0, 0, w, h)

    if (showText && hookText) {
      ctx.fillStyle = "rgba(0,0,0,0.2)"
      ctx.fillRect(0, 0, w, h)
    }

    const product = await loadImage(productDataUrl)
    const maxW = w * 0.75
    const maxH = h * 0.65
    const scale = Math.min(maxW / product.width, maxH / product.height)
    const pw = product.width * scale
    const ph = product.height * scale
    const px = (w - pw) / 2
    const py = h - ph - (h * 0.1)
    ctx.drawImage(product, px, py, pw, ph)

    if (showText && hookText) {
      const colors: Record<TextColor, string> = { white: "#ffffff", dark: "#111111", violet: "#818cf8" }
      ctx.fillStyle = colors[textColor]
      ctx.shadowColor = textColor === "white" ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.3)"
      ctx.shadowBlur = 15

      const fontSize = w * 0.052
      ctx.font = `800 ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`
      ctx.textAlign = "center"

      const maxTextWidth = w * 0.82
      const words = hookText.split(" ")
      const lines: string[] = []
      let line = ""
      for (const word of words) {
        const test = line + (line ? " " : "") + word
        if (ctx.measureText(test).width > maxTextWidth && line) {
          lines.push(line)
          line = word
        } else {
          line = test
        }
      }
      lines.push(line)

      const lineH = fontSize * 1.25
      const totalH = lines.length * lineH
      const startY = textPosition === "top"
        ? fontSize * 2.5
        : textPosition === "center"
        ? (h / 2) - (totalH / 2)
        : py - totalH - 48

      lines.forEach((l, i) => ctx.fillText(l, w / 2, startY + i * lineH))
      ctx.shadowBlur = 0
    }

    ctx.fillStyle = "rgba(255,255,255,0.85)"
    ctx.font = `500 ${w * 0.022}px -apple-system, sans-serif`
    ctx.textAlign = "left"
    ctx.shadowBlur = 0
    const handle = instagramHandle ? `@${instagramHandle.replace("@", "")}` : brandName
    ctx.fillText(handle, w * 0.05, h - (h * 0.035))

    results.push(canvas.toDataURL("image/png", 0.95))
  }

  return results
}

// ─── Step indicator ────────────────────────────────────────────────────────

function StepDot({ n, current }: { n: number; current: number }) {
  const done = n < current
  const active = n === current
  return (
    <div className="flex items-center gap-2">
      {n > 1 && <div className={`h-px w-8 ${current > n ? "bg-violet-500" : "bg-border"}`} />}
      <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-all ${done ? "bg-emerald-500 text-white" : active ? "bg-violet-600 text-white" : "bg-muted text-muted-foreground"}`}>
        {done ? <Check className="h-3.5 w-3.5" /> : n}
      </div>
      <span className={`text-xs ${active ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
        {n === 1 ? "Upload" : n === 2 ? "Scene" : "Generate"}
      </span>
    </div>
  )
}

// ─── Schedule to Instagram/Facebook ──────────────────────────────────────────

interface ConnectionStatus {
  connected: boolean
  facebook_connected: boolean
  instagram_connected: boolean
}

function ScheduleAction({
  brandId,
  imageUrl,
  caption,
  hashtags,
}: {
  brandId: string
  imageUrl: string
  caption: string
  hashtags: string[]
}) {
  const [open, setOpen] = useState(false)
  const [connection, setConnection] = useState<ConnectionStatus | null>(null)
  const [checkingConnection, setCheckingConnection] = useState(false)
  const [connectionError, setConnectionError] = useState(false)
  const [platform, setPlatform] = useState<"instagram" | "facebook">("instagram")
  const [date, setDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return d.toISOString().split("T")[0]
  })
  const [time, setTime] = useState("10:00")
  const [submitState, setSubmitState] = useState<"idle" | "loading" | "success" | "error">("idle")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successInfo, setSuccessInfo] = useState<{ platform: string; date: string; time: string } | null>(null)

  const checkConnection = useCallback(async () => {
    setCheckingConnection(true)
    setConnectionError(false)
    try {
      const res = await fetch(`/api/v1/brands/${brandId}/social-connections`)
      const json: unknown = await res.json()
      if (res.ok && !isApiError(json)) {
        const data = (json as { data: ConnectionStatus }).data
        setConnection(data)
        setPlatform(data.instagram_connected ? "instagram" : "facebook")
      } else {
        setConnectionError(true)
      }
    } catch {
      setConnectionError(true)
    } finally {
      setCheckingConnection(false)
    }
  }, [brandId])

  const openPanel = useCallback(() => {
    setOpen(true)
    if (!connection && !checkingConnection) checkConnection()
  }, [connection, checkingConnection, checkConnection])

  const closePanel = useCallback(() => {
    setOpen(false)
    setSubmitState("idle")
    setErrorMsg(null)
    setSuccessInfo(null)
  }, [])

  const handleConfirm = useCallback(async () => {
    setSubmitState("loading")
    setErrorMsg(null)
    try {
      const res = await fetch("/api/v1/calendar/schedule-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          platform,
          imageUrl,
          caption,
          hashtags: hashtags.map((h) => h.replace(/^#+/, "")),
          scheduledDate: date,
          scheduledTime: time,
        }),
      })
      const json: unknown = await res.json()
      if (!res.ok || isApiError(json)) {
        const msg = isApiError(json) ? json.error.message : "Failed to schedule post."
        setErrorMsg(msg)
        setSubmitState("error")
        return
      }
      setSuccessInfo({ platform, date, time })
      setSubmitState("success")
    } catch {
      setErrorMsg("Network error. Please try again.")
      setSubmitState("error")
    }
  }, [brandId, platform, imageUrl, caption, hashtags, date, time])

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={openPanel} className="flex items-center gap-1.5">
        <CalendarClock className="h-3.5 w-3.5" /> Schedule to Instagram/Facebook
      </Button>
    )
  }

  // Only ever show platforms that are actually connected — never a disabled
  // button for one that isn't.
  const connectedPlatforms: { id: "instagram" | "facebook"; label: string }[] = connection
    ? [
        ...(connection.instagram_connected ? [{ id: "instagram" as const, label: "Instagram" }] : []),
        ...(connection.facebook_connected ? [{ id: "facebook" as const, label: "Facebook" }] : []),
      ]
    : []

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Schedule post</span>
        <button type="button" onClick={closePanel} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          Close
        </button>
      </div>

      {checkingConnection && (
        <p className="text-sm text-muted-foreground">Checking your connection…</p>
      )}

      {!checkingConnection && connectionError && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-1.5">
          <p className="text-sm text-amber-900">Couldn&apos;t check your connection status.</p>
          <button
            type="button"
            onClick={checkConnection}
            className="text-xs font-semibold text-amber-700 underline underline-offset-2 hover:text-amber-900"
          >
            Try again
          </button>
        </div>
      )}

      {!checkingConnection && !connectionError && connection && (!connection.connected || connectedPlatforms.length === 0) && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-1.5">
          <p className="text-sm text-amber-900">Connect Instagram or Facebook first to schedule posts.</p>
          <Link
            href={`/brands/${brandId}`}
            className="text-xs font-semibold text-amber-700 underline underline-offset-2 hover:text-amber-900"
          >
            Go to brand settings →
          </Link>
        </div>
      )}

      {!checkingConnection && !connectionError && connection?.connected && connectedPlatforms.length > 0 && submitState !== "success" && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Platform</Label>
            <div className="flex gap-1.5">
              {connectedPlatforms.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPlatform(p.id)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    platform === p.id ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Time</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>

          <Button size="sm" className="w-full" onClick={handleConfirm} disabled={submitState === "loading"}>
            {submitState === "loading" ? "Scheduling…" : "Confirm schedule"}
          </Button>

          {submitState === "error" && errorMsg && (
            <p className="text-sm text-destructive">{errorMsg}</p>
          )}
        </div>
      )}

      {submitState === "success" && successInfo && (
        <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2">
          <Check className="h-4 w-4 text-green-500 shrink-0" />
          <span className="text-sm font-medium text-green-700">
            Scheduled for {successInfo.platform === "instagram" ? "Instagram" : "Facebook"} on {successInfo.date} at {successInfo.time}
          </span>
        </div>
      )}
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────

interface AdMakerProps {
  brandId: string
}

export function AdMaker({ brandId }: AdMakerProps) {
  const { data: brand } = useBrand(brandId)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const STORAGE_KEY = `admaker_${brandId}`

  // Step 1
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [originalPreview, setOriginalPreview] = useState<string | null>(null)
  const [productDataUrl, setProductDataUrl] = useState<string | null>(null)
  const [removingBg, setRemovingBg] = useState(false)
  const [bgError, setBgError] = useState("")
  const [pasteUrl, setPasteUrl] = useState("")
  const [fetchingUrl, setFetchingUrl] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  // Step 2
  const [scene, setScene] = useState("white_studio")
  const [customScene, setCustomScene] = useState("")
  const [format, setFormat] = useState<ImageFormat>("square")

  // Step 3
  const [hookText, setHookText] = useState("")
  const [showText, setShowText] = useState(true)
  const [textColor, setTextColor] = useState<TextColor>("white")
  const [textPosition, setTextPosition] = useState<TextPosition>("top")

  // Results
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState("")
  const [results, setResults] = useState<string[]>([])
  const [expandedIdx, setExpandedIdx] = useState<number | null>(0)
  const [showSuccess, setShowSuccess] = useState(false)
  const [msgIdx, setMsgIdx] = useState(0)

  // Scheduling — the selected variation only exists as a data URL until
  // uploaded to real storage, which Instagram/Facebook's publish API needs.
  const [uploadingForSchedule, setUploadingForSchedule] = useState(false)
  const [scheduleImageUrl, setScheduleImageUrl] = useState<string | null>(null)
  const [scheduleError, setScheduleError] = useState("")

  useEffect(() => {
    if (!generating) return
    setMsgIdx(0)
    const t = setInterval(() => setMsgIdx(i => (i + 1) % LOADING_MSGS.length), 3000)
    return () => clearInterval(t)
  }, [generating])

  // Reset schedule state whenever the selected variation changes, so a
  // stale hosted URL from a different variation can never be scheduled.
  useEffect(() => {
    setScheduleImageUrl(null)
    setScheduleError("")
  }, [expandedIdx])

  // Restore from sessionStorage
  useEffect(() => {
    const saved = sessionStorage.getItem(STORAGE_KEY)
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { resultImages?: string[]; selectedScene?: string; productDataUrl?: string }
        if (parsed.resultImages && parsed.resultImages.length > 0) {
          setResults(parsed.resultImages)
          setExpandedIdx(0)
          setStep(3)
        } else if (parsed.productDataUrl) {
          setProductDataUrl(parsed.productDataUrl)
          setStep(2)
        }
        if (parsed.selectedScene) setScene(parsed.selectedScene)
      } catch {}
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId])

  // Persist results to sessionStorage
  useEffect(() => {
    if (results.length > 0) {
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ resultImages: results, selectedScene: scene }))
      } catch {}
    }
  }, [results, scene, STORAGE_KEY])

  // Persist productDataUrl (for step 2 restore) — only when no results yet
  useEffect(() => {
    if (productDataUrl && results.length === 0) {
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ productDataUrl, selectedScene: scene }))
      } catch {}
    }
  }, [productDataUrl, scene, results.length, STORAGE_KEY])

  // Shared by all three upload paths — file browse, drag-drop, and
  // clipboard paste — so validation/preview-setting logic lives in exactly
  // one place instead of being duplicated per input method.
  function processImageFile(file: File | undefined | null) {
    if (!file) return
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setBgError("Please use a JPG, PNG, or WEBP image.")
      return
    }
    setBgError("")
    setProductDataUrl(null)
    const reader = new FileReader()
    reader.onload = () => setOriginalPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    processImageFile(e.target.files?.[0])
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    processImageFile(e.dataTransfer.files?.[0])
  }

  function handlePaste(e: React.ClipboardEvent) {
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

  const handleRemoveBg = useCallback(async (file: File | null, dataUrl: string | null) => {
    if (!file && !dataUrl) return
    setRemovingBg(true)
    setBgError("")
    try {
      const formData = new FormData()
      if (file) {
        formData.append("image", file)
      } else {
        const res = await fetch(dataUrl!)
        const blob = await res.blob()
        formData.append("image", blob, "product.jpg")
      }
      const res = await fetch("/api/v1/ai/remove-background", { method: "POST", body: formData })
      const json = await res.json() as { data?: { base64: string }; error?: { message?: string } }
      if (!res.ok || !json.data) throw new Error(json.error?.message ?? "Background removal failed")
      setProductDataUrl(`data:image/png;base64,${json.data.base64}`)
      setTimeout(() => setStep(2), 600)
    } catch (err) {
      setBgError(err instanceof Error ? err.message : "Something went wrong")
      if (originalPreview) {
        setProductDataUrl(originalPreview)
        setTimeout(() => setStep(2), 600)
      }
    } finally {
      setRemovingBg(false)
    }
  }, [originalPreview])

  async function handleUrlFetch() {
    if (!pasteUrl.trim()) return
    setFetchingUrl(true)
    setBgError("")
    try {
      const res = await fetch(pasteUrl.trim())
      if (!res.ok) throw new Error(`Could not fetch image (${res.status})`)
      const blob = await res.blob()
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
      setOriginalPreview(dataUrl)
      await handleRemoveBg(null, dataUrl)
    } catch {
      setBgError("Couldn't fetch that image. Try downloading and uploading it instead.")
    } finally {
      setFetchingUrl(false)
    }
  }

  async function handleGenerate() {
    if (!productDataUrl) return
    setGenerating(true)
    setGenError("")
    setResults([])
    setExpandedIdx(null)
    try {
      const niche = brand?.niche ?? "lifestyle brand"
      const brandName = brand?.name ?? "Brand"
      const handle = brand?.instagram_handle ?? ""
      const bgSeed = Math.floor(Math.random() * 99999)
      const bgUrl = getBackgroundUrl(scene, customScene, niche, format, bgSeed)
      const variations = await compositeAd(productDataUrl, bgUrl, hookText, showText, textPosition, textColor, format, brandName, handle)
      setResults(variations)
      setExpandedIdx(0)
      setShowSuccess(true)
      setTimeout(() => setShowSuccess(false), 4000)
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Generation failed. Try again.")
    } finally {
      setGenerating(false)
    }
  }

  function downloadVariation(idx: number) {
    const url = results[idx]
    if (!url) return
    const a = document.createElement("a")
    a.href = url
    a.download = `ad-variation-${idx + 1}.png`
    a.click()
  }

  async function handleScheduleClick() {
    if (expandedIdx === null || !results[expandedIdx]) return
    setUploadingForSchedule(true)
    setScheduleError("")
    setScheduleImageUrl(null)
    try {
      const res = await fetch(`/api/v1/brands/${brandId}/ai/ad-maker/upload-variation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl: results[expandedIdx] }),
      })
      const json = await res.json() as { data?: { publicUrl: string }; error?: { message?: string } }
      if (!res.ok || !json.data) throw new Error(json.error?.message ?? "Failed to prepare image for scheduling.")
      setScheduleImageUrl(json.data.publicUrl)
    } catch (err) {
      setScheduleError(err instanceof Error ? err.message : "Failed to prepare image for scheduling.")
    } finally {
      setUploadingForSchedule(false)
    }
  }

  function reset() {
    setStep(1)
    setOriginalPreview(null)
    setProductDataUrl(null)
    setBgError("")
    setResults([])
    setExpandedIdx(null)
    setGenError("")
    setPasteUrl("")
    sessionStorage.removeItem(STORAGE_KEY)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-0">
        {[1, 2, 3].map(n => <StepDot key={n} n={n} current={step} />)}
        {results.length > 0 && (
          <button onClick={reset} className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" /> Start over
          </button>
        )}
      </div>

      {/* ─── STEP 1: Upload ──────────────────────────────── */}
      {step === 1 && (
        <div className="rounded-lg border bg-card p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold">Upload your product photo</h3>
            <p className="text-xs text-muted-foreground mt-0.5">We&apos;ll remove the background and place it in an AI-generated scene.</p>
          </div>

          {!originalPreview ? (
            <button type="button" tabIndex={0} onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onPaste={handlePaste}
              className={`flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-10 text-center transition-colors ${
                isDragging ? "border-violet-500 bg-violet-50" : "border-muted-foreground/30 hover:border-violet-400 hover:bg-violet-50/30"
              }`}>
              <Upload className="h-8 w-8 text-muted-foreground/40" />
              <div>
                <p className="text-sm font-medium">Drop your product photo here</p>
                <p className="text-xs text-muted-foreground mt-0.5">or click to browse</p>
                <p className="text-xs text-muted-foreground mt-0.5">or paste from clipboard (Ctrl+V)</p>
              </div>
              <p className="text-xs text-muted-foreground/60">JPG, PNG or WEBP · Max 10MB</p>
            </button>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-4">
                <div className="space-y-1 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Original</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={originalPreview} alt="Original" className="w-full max-w-[140px] rounded-lg border object-contain aspect-square" />
                </div>
                {productDataUrl && (
                  <div className="space-y-1 flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">No background</p>
                    <div className="w-full max-w-[140px] rounded-lg border overflow-hidden aspect-square"
                      style={{ backgroundImage: "repeating-conic-gradient(#eee 0% 25%, white 0% 50%) 0 0 / 16px 16px" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={productDataUrl} alt="No background" className="w-full h-full object-contain" />
                    </div>
                  </div>
                )}
              </div>

              {!productDataUrl && (
                <button onClick={() => {
                  if (!fileInputRef.current?.files?.[0]) return
                  handleRemoveBg(fileInputRef.current.files[0], null)
                }}
                  disabled={removingBg}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-violet-600 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:opacity-60">
                  {removingBg ? <><Loader2 className="h-4 w-4 animate-spin" /> Removing background… ✨ (5–10 seconds)</> : "Remove Background"}
                </button>
              )}

              {productDataUrl && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                  <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span className="text-sm text-emerald-700 font-medium">Background removed! ✓</span>
                  <button onClick={() => setStep(2)} className="ml-auto text-xs font-semibold text-violet-600 hover:underline">
                    Choose scene →
                  </button>
                </div>
              )}
            </div>
          )}

          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
            onChange={(e) => {
              handleFileChange(e)
            }} />

          {bgError && (
            <div className="flex items-start gap-2 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              {bgError}
            </div>
          )}

          <div className="border-t pt-3 space-y-2">
            <p className="text-xs text-muted-foreground">Have a product image URL instead?</p>
            <div className="flex gap-2">
              <input type="text" value={pasteUrl} onChange={e => setPasteUrl(e.target.value)}
                placeholder="Paste product image URL"
                className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
              <button onClick={handleUrlFetch} disabled={!pasteUrl.trim() || fetchingUrl}
                className="rounded-md bg-secondary px-3 py-1.5 text-xs font-medium hover:bg-secondary/80 disabled:opacity-50">
                {fetchingUrl ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Use →"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── STEP 2: Scene ───────────────────────────────── */}
      {step === 2 && (
        <div className="rounded-lg border bg-card p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold">Choose your scene</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Where should your product live?</p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {SCENES.map(s => (
              <button key={s.id} type="button" onClick={() => setScene(s.id)}
                className={`rounded-xl border-2 p-3 text-left transition-all hover:scale-[1.02] ${scene === s.id ? "border-violet-500 bg-violet-50 dark:bg-violet-950/30" : "border-border hover:border-violet-300"}`}>
                <div className="text-xl mb-1">{s.emoji}</div>
                <p className="text-xs font-semibold leading-tight">{s.name}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug hidden sm:block">{s.desc}</p>
              </button>
            ))}
          </div>

          {scene === "custom" && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Describe the scene</label>
              <input type="text" value={customScene} onChange={e => setCustomScene(e.target.value)}
                placeholder="e.g. Rooftop at sunset with city lights"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium">Format</label>
            <div className="flex gap-2">
              {([["square", "Square 1:1"], ["portrait", "Portrait 4:5"], ["story", "Story 9:16"]] as [ImageFormat, string][]).map(([id, label]) => (
                <button key={id} type="button" onClick={() => setFormat(id)}
                  className={`flex-1 rounded-lg border-2 py-2 text-xs font-medium transition-all ${format === id ? "border-violet-500 bg-violet-50 text-violet-700" : "border-border hover:border-violet-300"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <button onClick={() => setStep(3)}
            disabled={scene === "custom" && !customScene.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-violet-600 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50">
            Next: Customize & Generate <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ─── STEP 3: Customize ───────────────────────────── */}
      {step === 3 && !generating && results.length === 0 && (
        <div className="rounded-lg border bg-card p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold">Almost there! Add your message</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Optional hook text overlay on your ad.</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium">Text overlay (optional)</label>
            <input type="text" value={hookText} onChange={e => setHookText(e.target.value)}
              placeholder="e.g. Your closet called. It's bored."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Show on image</span>
            <button type="button" onClick={() => setShowText(v => !v)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${showText ? "bg-violet-600" : "bg-muted"}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${showText ? "translate-x-4" : "translate-x-0.5"}`} />
            </button>
          </div>

          {showText && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Text color</label>
                <div className="flex gap-2">
                  {([["white", "White text", "bg-white border border-gray-200"], ["dark", "Dark text", "bg-gray-900"], ["violet", "Neon violet", "bg-violet-500"]] as [TextColor, string, string][]).map(([id, label, cls]) => (
                    <button key={id} type="button" onClick={() => setTextColor(id)}
                      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${textColor === id ? "ring-2 ring-violet-500 ring-offset-1" : ""} ${cls} ${id === "white" ? "text-gray-800" : "text-white"}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Text position</label>
                <div className="flex gap-2">
                  {([["top", "Top"], ["center", "Center"], ["bottom", "Bottom"]] as [TextPosition, string][]).map(([id, label]) => (
                    <button key={id} type="button" onClick={() => setTextPosition(id)}
                      className={`flex-1 rounded-lg border-2 py-1.5 text-xs font-medium transition-all ${textPosition === id ? "border-violet-500 bg-violet-50 text-violet-700" : "border-border hover:border-violet-300"}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {genError && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-3">
              <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-amber-900 font-medium">{genError}</p>
                <button onClick={handleGenerate} className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-amber-700 hover:text-amber-900">
                  🔄 Try again
                </button>
              </div>
            </div>
          )}

          <GenerationWarning isPending={generating} />
          <button onClick={handleGenerate}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 py-3 text-sm font-semibold text-white shadow-md transition hover:from-violet-700 hover:to-indigo-700">
            ✨ Create my ad
          </button>
        </div>
      )}

      {/* ─── Loading ─────────────────────────────────────── */}
      {generating && (
        <div className="rounded-lg border bg-card p-8 text-center space-y-4">
          <div className="mx-auto h-16 w-full max-w-xs overflow-hidden rounded-full bg-muted">
            <div className="h-full animate-pulse rounded-full bg-gradient-to-r from-violet-500 via-indigo-400 to-violet-600" />
          </div>
          <p className="text-base font-semibold">{LOADING_MSGS[msgIdx]}</p>
          <p className="text-xs text-muted-foreground">Usually takes 15–20 seconds</p>
        </div>
      )}

      {showSuccess && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 animate-in fade-in duration-300">
          <Check className="h-4 w-4 text-green-500 shrink-0" />
          <span className="text-sm font-medium text-green-700">✓ Generated successfully — scroll down to see your content</span>
        </div>
      )}

      {/* ─── Results ─────────────────────────────────────── */}
      {results.length > 0 && !generating && (
        <div className="space-y-4">
          <p className="text-sm font-medium text-center text-muted-foreground">Pick the one you love ↑</p>
          <div className="grid grid-cols-3 gap-3">
            {results.map((url, i) => (
              <button key={i} type="button" onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                className={`overflow-hidden rounded-xl border-2 transition-all ${expandedIdx === i ? "border-violet-500 shadow-md" : "border-border hover:border-violet-300"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`Variation ${i + 1}`} className="w-full object-cover aspect-square" />
              </button>
            ))}
          </div>

          {expandedIdx !== null && results[expandedIdx] && (
            <div className="rounded-xl border bg-card p-4 space-y-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={results[expandedIdx]} alt="Selected variation" className="w-full max-w-xs mx-auto rounded-xl shadow-md" />
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => downloadVariation(expandedIdx!)}
                  className="flex items-center justify-center gap-1.5 rounded-full border border-input py-2 text-xs font-medium hover:bg-secondary">
                  <Download className="h-3.5 w-3.5" /> Download PNG
                </button>
                <button onClick={handleScheduleClick} disabled={uploadingForSchedule}
                  className="flex items-center justify-center gap-1.5 rounded-full border border-input py-2 text-xs font-medium hover:bg-secondary disabled:opacity-60">
                  {uploadingForSchedule ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />}
                  Schedule
                </button>
                <button onClick={() => { setResults([]); setGenError(""); setStep(2) }}
                  className="flex items-center justify-center gap-1.5 rounded-full border border-input py-2 text-xs font-medium hover:bg-secondary">
                  <RefreshCw className="h-3.5 w-3.5" /> Try different scene
                </button>
                <button onClick={handleGenerate}
                  className="flex items-center justify-center gap-1.5 rounded-full border border-input py-2 text-xs font-medium hover:bg-secondary col-span-1">
                  ✨ Generate again
                </button>
                <button onClick={() => {
                  downloadVariation(expandedIdx!)
                  window.location.href = `/brands/${brandId}/generate`
                }}
                  className="flex items-center justify-center gap-1.5 rounded-full bg-violet-600 py-2 text-xs font-semibold text-white hover:bg-violet-700 col-span-2">
                  📋 Use for my post
                </button>
              </div>

              {scheduleError && (
                <p className="text-xs text-destructive">{scheduleError}</p>
              )}

              {scheduleImageUrl && (
                <ScheduleAction
                  brandId={brandId}
                  imageUrl={scheduleImageUrl}
                  caption={hookText.trim() || "Check out our latest! ✨"}
                  hashtags={[]}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
