"use client"

import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Loader2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { useBrand, useUpdateBrand, brandKeys } from "@/hooks/useBrand"
import { isApiError } from "@/types/api"
import { readJsonResponse } from "@/lib/utils/read-json-response"
import { LOGO_POSITION_OPTIONS, frameLogo, type LogoPositionOption } from "@/lib/design/logo-settings"

const POSITION_LABEL: Record<LogoPositionOption, string> = {
  auto: "Auto (emptiest corner)",
  "top-left": "Top left",
  "top-right": "Top right",
  "bottom-left": "Bottom left",
  "bottom-right": "Bottom right",
}

/**
 * Brand settings -> "Brand logo": upload (PNG / JPG / SVG -- stored in our
 * storage, replacing the scraped logo; a JPG's background is removed and a
 * light / dark variant made so it reads on any photo), shown on light and
 * dark previews, plus "Show logo on posts" and its corner.
 */
export function BrandLogoSection({ brandId }: { brandId: string }) {
  const { data: brand } = useBrand(brandId)
  const update = useUpdateBrand(brandId)
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const logoLum = useLogoLuminance(brand?.logo_url ?? null)
  if (!brand) return null
  const logo = frameLogo(brand)

  async function upload(file: File) {
    setUploading(true)
    setError(null)
    setMessage(null)
    try {
      const form = new FormData()
      form.append("logo", file)
      const res = await fetch(`/api/v1/brands/${brandId}/logo`, { method: "POST", body: form })
      const json: unknown = await readJsonResponse(res)
      if (!res.ok || isApiError(json)) throw new Error(isApiError(json) ? json.error.message : "Couldn't upload the logo.")
      const data = (json as { data: { background_removed: boolean; reads_on_light: boolean; reads_on_dark: boolean } }).data
      setMessage([
        "Logo saved.",
        data.background_removed ? "Its background was removed." : "",
        !data.reads_on_light || !data.reads_on_dark ? `A ${data.reads_on_dark ? "dark" : "light"} version is used where the original wouldn't read.` : "",
      ].filter(Boolean).join(" "))
      await queryClient.invalidateQueries({ queryKey: brandKeys.detail(brandId) })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't upload the logo.")
    } finally {
      setUploading(false)
      if (input.current) input.current.value = ""
    }
  }

  const save = (fields: { logo_on_posts?: boolean; logo_position?: LogoPositionOption }) => {
    setError(null)
    update.mutate(fields, { onError: (err) => setError(err instanceof Error ? err.message : "Couldn't save.") })
  }

  /** The logo (or its variant where it reads better) on a light and a dark tile. */
  const tile = (bg: string, dark: boolean) => {
    // The variant is the logo's inverse: shown where the original wouldn't read (as the frames do).
    const originalReads = logoLum == null || (dark ? logoLum > 0.45 : logoLum < 0.6)
    const src = !originalReads && logo.logo_variant_url ? logo.logo_variant_url : logo.logo_url
    return (
      <div className="flex h-20 w-32 items-center justify-center rounded-md border" style={{ background: bg }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {src ? <img src={src} alt={`${brand.name} logo on a ${dark ? "dark" : "light"} background`} className="max-h-12 max-w-24 object-contain" /> : <span className={`text-xs ${dark ? "text-white/70" : "text-muted-foreground"}`}>No logo</span>}
      </div>
    )
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="text-sm">Brand logo</CardTitle>
        <CardDescription>Shown small in an empty corner of your posts, the first and last carousel slides and story openers -- never over a face or the product.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          {tile("#f7f5f0", false)}
          {tile("#1d1f24", true)}
          <div className="space-y-1">
            <input ref={input} type="file" accept="image/png,image/jpeg,image/svg+xml" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f) }} />
            <Button size="sm" variant="outline" disabled={uploading} onClick={() => input.current?.click()}>
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              <span className="ml-1.5">{brand.logo_url ? "Replace logo" : "Upload logo"}</span>
            </Button>
            <p className="text-[11px] text-muted-foreground">PNG, JPG or SVG, up to 5 MB</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={logo.show_logo} disabled={update.isPending} onChange={(e) => save({ logo_on_posts: e.target.checked })} />
            Show logo on posts
          </label>
          <div className="flex items-center gap-2">
            <Label htmlFor="logo-position" className="text-sm">Position</Label>
            <select
              id="logo-position"
              value={logo.logo_position}
              disabled={update.isPending || !logo.show_logo}
              onChange={(e) => save({ logo_position: e.target.value as LogoPositionOption })}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            >
              {LOGO_POSITION_OPTIONS.map((pos) => <option key={pos} value={pos}>{POSITION_LABEL[pos]}</option>)}
            </select>
          </div>
        </div>
        {message && <p className="text-xs text-green-700 dark:text-green-400">{message}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}

/** The logo's mean luminance (0 dark .. 1 light) over its opaque pixels, read in the browser; null until known or if unreadable. */
function useLogoLuminance(url: string | null): number | null {
  const [lum, setLum] = useState<{ url: string; value: number | null } | null>(null)
  useEffect(() => {
    if (!url) return
    let cancelled = false
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas")
        canvas.width = 64
        canvas.height = Math.max(1, Math.round((64 * img.naturalHeight) / Math.max(1, img.naturalWidth)))
        const c = canvas.getContext("2d")
        if (!c) return
        c.drawImage(img, 0, 0, canvas.width, canvas.height)
        const d = c.getImageData(0, 0, canvas.width, canvas.height).data
        let sum = 0, n = 0
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3]! < 128) continue
          sum += (0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!) / 255
          n++
        }
        if (!cancelled) setLum({ url, value: n ? sum / n : null })
      } catch {
        if (!cancelled) setLum({ url, value: null })
      }
    }
    img.onerror = () => { if (!cancelled) setLum({ url, value: null }) }
    img.src = url
    return () => { cancelled = true }
  }, [url])
  return lum && lum.url === url ? lum.value : null
}
