"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronDown, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { parseBrandBrain } from "@/lib/brand-brain-profile"
import { CURATED_FONTS, isFontId, type FontId } from "@/lib/design/fonts"
import { PREVIEW_FONT_CLASS } from "@/lib/design/preview-fonts"
import type { BrandBrain } from "@/types/app"

// The editable slice of the Brand Brain profile (lib/brand-brain-profile.ts).
// Plain comma/line-separated text, saved through the existing brand update
// route (PUT /api/v1/brands/[brandId]); fields not shown here (verified
// claims, customer problems, phrases to use, ...) are carried over as-is.

const textareaClass = "flex min-h-[64px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

function toText(items?: string[]): string {
  return (items ?? []).join("\n")
}

function toList(text: string): string[] {
  return text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
}

export function BrandBrainSection({ brandId, brandBrain }: { brandId: string; brandBrain: BrandBrain }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [fields, setFields] = useState({
    phrases_to_avoid: toText(brandBrain.voice?.phrases_to_avoid),
    claims_never_to_make: toText(brandBrain.voice?.claims_never_to_make),
    avoid_visuals: toText(brandBrain.visual?.avoid_visuals),
    objections: toText(brandBrain.strategy?.objections),
    differentiators: toText(brandBrain.facts?.differentiators),
    photography_style: brandBrain.visual?.photography_style ?? "",
    heading_font: brandBrain.visual?.heading_font ?? "",
    body_font: brandBrain.visual?.body_font ?? "",
  })
  const set = (key: keyof typeof fields) => (e: { target: { value: string } }) => setFields((f) => ({ ...f, [key]: e.target.value }))

  async function save() {
    setSaving(true)
    setMessage(null)
    const next = parseBrandBrain({
      ...brandBrain,
      facts: { ...brandBrain.facts, differentiators: toList(fields.differentiators) },
      voice: { ...brandBrain.voice, phrases_to_avoid: toList(fields.phrases_to_avoid), claims_never_to_make: toList(fields.claims_never_to_make) },
      visual: {
        ...brandBrain.visual,
        photography_style: fields.photography_style,
        avoid_visuals: toList(fields.avoid_visuals),
        heading_font: isFontId(fields.heading_font) ? fields.heading_font : undefined,
        body_font: isFontId(fields.body_font) ? fields.body_font : undefined,
      },
      strategy: { ...brandBrain.strategy, objections: toList(fields.objections) },
    })
    try {
      const res = await fetch(`/api/v1/brands/${brandId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand_brain: next }),
      })
      if (!res.ok) throw new Error()
      setMessage({ ok: true, text: "Saved. New content will follow these." })
      router.refresh()
    } catch {
      setMessage({ ok: false, text: "Couldn't save. Please try again." })
    } finally {
      setSaving(false)
    }
  }

  const fontSelect = (key: "heading_font" | "body_font", label: string, sample: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`bb-${key}`}>{label}</Label>
      <div className="flex items-center gap-3">
        <select id={`bb-${key}`} value={fields[key]} onChange={set(key)} className="h-9 rounded-md border bg-background px-2 text-sm">
          <option value="">Automatic (from your vibe)</option>
          {CURATED_FONTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
        {isFontId(fields[key]) && <span className={`text-lg ${PREVIEW_FONT_CLASS[fields[key] as FontId]}`}>{sample}</span>}
      </div>
    </div>
  )

  const area = (key: Exclude<keyof typeof fields, "photography_style" | "heading_font" | "body_font">, label: string, placeholder: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`bb-${key}`}>{label}</Label>
      <textarea id={`bb-${key}`} rows={2} className={textareaClass} placeholder={placeholder} value={fields[key]} onChange={set(key)} />
    </div>
  )

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm">Brand Brain</CardTitle>
            <CardDescription>Rules every generation follows. One per line or comma-separated.</CardDescription>
          </div>
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          {area("differentiators", "What makes you different", "e.g. Made to measure, Delivered in 2 weeks")}
          {area("phrases_to_avoid", "Phrases to avoid", "e.g. game-changer, luxury")}
          {area("claims_never_to_make", "Claims never to make", "e.g. Cheapest in India, Clinically proven")}
          {area("objections", "Objections customers raise", "e.g. Custom furniture takes too long")}
          {area("avoid_visuals", "Never show in images", "e.g. People's faces, Cluttered desks")}
          <div className="space-y-1.5">
            <Label htmlFor="bb-photography_style">Photography style</Label>
            <Input id="bb-photography_style" placeholder="e.g. Warm natural light, wide interiors, muted tones" value={fields.photography_style} onChange={set("photography_style")} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {fontSelect("heading_font", "Heading font", "Headline")}
            {fontSelect("body_font", "Body font", "Body text")}
          </div>
          <div className="flex items-center justify-end gap-3">
            {message && <p className={`text-xs ${message.ok ? "text-muted-foreground" : "text-destructive"}`}>{message.text}</p>}
            <Button type="button" size="sm" onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  )
}
