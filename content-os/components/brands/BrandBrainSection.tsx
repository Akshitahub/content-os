"use client"

import { useState } from "react"
import { ChevronDown, Loader2, Pencil, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { CURATED_FONTS, isFontId, type FontId } from "@/lib/design/fonts"
import { PREVIEW_FONT_CLASS } from "@/lib/design/preview-fonts"
import { useBrandBrain, useSaveBrandBrain, type BrandBrainEdits, type BrandBrainState } from "@/hooks/useBrandBrain"

// The Brand Brain fills itself (lib/ai/brand-brain-derive.ts) from the
// brand's website, Instagram and products: differentiators, phrases and
// claims to avoid, objections, visuals to avoid, photography style, fonts.
// Collapsed under one summary line; each value carries an "auto" tag (or
// "edited" once the user changed it, which re-derivation then never
// touches). Editing is optional.

const textareaClass = "flex min-h-[64px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

type ListField = "differentiators" | "phrases_to_avoid" | "claims_never_to_make" | "objections" | "avoid_visuals"

const LIST_FIELDS: { field: ListField; section: "facts" | "voice" | "strategy" | "visual"; label: string; empty: string }[] = [
  { field: "differentiators", section: "facts", label: "What makes you different", empty: "Nothing stated on your website or Instagram yet." },
  { field: "phrases_to_avoid", section: "voice", label: "Phrases to avoid", empty: "None." },
  { field: "claims_never_to_make", section: "voice", label: "Claims never to make", empty: "None." },
  { field: "objections", section: "strategy", label: "Objections customers raise", empty: "No reviews or FAQ found yet." },
  { field: "avoid_visuals", section: "visual", label: "Never show in images", empty: "None." },
]

function valuesOf(state: BrandBrainState | undefined, field: ListField): string[] {
  const b = state?.brain
  if (!b) return []
  if (field === "differentiators") return b.facts?.differentiators ?? []
  if (field === "phrases_to_avoid") return b.voice?.phrases_to_avoid ?? []
  if (field === "claims_never_to_make") return b.voice?.claims_never_to_make ?? []
  if (field === "objections") return b.strategy?.objections ?? []
  return b.visual?.avoid_visuals ?? []
}

const toText = (items: string[]) => items.join("\n")
const toList = (text: string) => text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)

function Tag({ meta }: { meta: { auto?: boolean } | undefined }) {
  if (!meta) return null
  return (
    <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${meta.auto === false ? "bg-muted text-muted-foreground" : "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300"}`}>
      {meta.auto === false ? "edited" : "auto"}
    </span>
  )
}

export function BrandBrainSection({ brandId }: { brandId: string }) {
  const { data, isLoading } = useBrandBrain(brandId)
  const save = useSaveBrandBrain(brandId)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Record<string, string> | null>(null)

  const running = data?.status.status === "running"
  const failed = data?.status.status === "failed"
  const visual = data?.brain.visual
  const filledCount = LIST_FIELDS.filter((f) => valuesOf(data, f.field).length).length + (visual?.photography_style ? 1 : 0)

  const summary = isLoading
    ? "Loading…"
    : running
      ? "Setting up from your website and Instagram…"
      : failed && filledCount === 0
        ? "We couldn't read enough to set this up yet -- it will try again. You can add details here any time."
        : "Your brand voice, claims and visuals are set up automatically."

  function startEdit() {
    setDraft({
      ...Object.fromEntries(LIST_FIELDS.map((f) => [f.field, toText(valuesOf(data, f.field))])),
      photography_style: visual?.photography_style ?? "",
      heading_font: visual?.heading_font ?? "",
      body_font: visual?.body_font ?? "",
    })
  }

  function onSave() {
    if (!draft) return
    // Only what changed -- each changed field becomes the user's (auto: false).
    const edits: BrandBrainEdits = {}
    const put = (section: keyof BrandBrainEdits, field: string, value: unknown) => {
      (edits as Record<string, Record<string, unknown>>)[section] = { ...((edits as Record<string, Record<string, unknown>>)[section] ?? {}), [field]: value }
    }
    for (const f of LIST_FIELDS) {
      const next = toList(draft[f.field] ?? "")
      if (JSON.stringify(next) !== JSON.stringify(valuesOf(data, f.field))) put(f.section, f.field, next)
    }
    if ((draft.photography_style ?? "") !== (visual?.photography_style ?? "")) put("visual", "photography_style", draft.photography_style ?? "")
    for (const k of ["heading_font", "body_font"] as const) {
      if ((draft[k] ?? "") !== (visual?.[k] ?? "") && isFontId(draft[k])) put("visual", k, draft[k])
    }
    if (Object.keys(edits).length === 0) {
      setDraft(null)
      return
    }
    save.mutate(edits, { onSuccess: () => setDraft(null) })
  }

  const fontSelect = (key: "heading_font" | "body_font", label: string, sample: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`bb-${key}`}>{label}</Label>
      <div className="flex items-center gap-3">
        <select id={`bb-${key}`} value={draft?.[key] ?? ""} onChange={(e) => setDraft((d) => (d ? { ...d, [key]: e.target.value } : d))} className="h-9 rounded-md border bg-background px-2 text-sm">
          {CURATED_FONTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
        {isFontId(draft?.[key]) && <span className={`text-lg ${PREVIEW_FONT_CLASS[draft![key] as FontId]}`}>{sample}</span>}
      </div>
    </div>
  )

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm">Brand Brain</CardTitle>
            <CardDescription className="flex items-center gap-1.5">
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : !isLoading && !failed ? <Sparkles className="h-3.5 w-3.5" /> : null}
              {summary}
            </CardDescription>
          </div>
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </CardHeader>
      {open && !isLoading && (
        <CardContent className="space-y-4">
          {running && !draft ? (
            <p className="text-sm text-muted-foreground">Reading your website, Instagram and products -- this takes a minute. Nothing for you to do.</p>
          ) : draft ? (
            <>
              {LIST_FIELDS.map((f) => (
                <div key={f.field} className="space-y-1.5">
                  <Label htmlFor={`bb-${f.field}`}>{f.label}</Label>
                  <textarea id={`bb-${f.field}`} rows={2} className={textareaClass} value={draft[f.field] ?? ""} onChange={(e) => setDraft((d) => (d ? { ...d, [f.field]: e.target.value } : d))} placeholder="One per line" />
                </div>
              ))}
              <div className="space-y-1.5">
                <Label htmlFor="bb-photography_style">Photography style</Label>
                <Input id="bb-photography_style" value={draft.photography_style ?? ""} onChange={(e) => setDraft((d) => (d ? { ...d, photography_style: e.target.value } : d))} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {fontSelect("heading_font", "Heading font", "Headline")}
                {fontSelect("body_font", "Body font", "Body text")}
              </div>
              <div className="flex items-center justify-end gap-3">
                {save.error && <p className="text-xs text-destructive">{save.error.message}</p>}
                <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={save.isPending}>Cancel</Button>
                <Button type="button" size="sm" onClick={onSave} disabled={save.isPending}>
                  {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save
                </Button>
              </div>
            </>
          ) : (
            <>
              {LIST_FIELDS.map((f) => {
                const values = valuesOf(data, f.field)
                return (
                  <div key={f.field} className="space-y-1">
                    <p className="flex items-center text-xs font-medium">{f.label}<Tag meta={data?.field_meta[f.field]} /></p>
                    {values.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {values.map((v) => <span key={v} className="rounded-full border bg-muted px-2.5 py-0.5 text-xs">{v}</span>)}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">{f.empty}</p>
                    )}
                  </div>
                )
              })}
              <div className="space-y-1">
                <p className="flex items-center text-xs font-medium">Photography style<Tag meta={data?.field_meta.photography_style} /></p>
                <p className="text-xs text-muted-foreground">{visual?.photography_style || "Comes from your brand look."}</p>
              </div>
              <div className="space-y-1">
                <p className="flex items-center text-xs font-medium">Fonts<Tag meta={data?.field_meta.heading_font} /></p>
                <p className="text-xs text-muted-foreground">
                  {isFontId(visual?.heading_font) ? <span className={PREVIEW_FONT_CLASS[visual!.heading_font as FontId]}>{CURATED_FONTS.find((c) => c.id === visual!.heading_font)?.label}</span> : "Automatic"}
                  {" / "}
                  {isFontId(visual?.body_font) ? <span className={PREVIEW_FONT_CLASS[visual!.body_font as FontId]}>{CURATED_FONTS.find((c) => c.id === visual!.body_font)?.label}</span> : "Automatic"}
                </p>
              </div>
              <div className="flex justify-end">
                <Button type="button" size="sm" variant="outline" onClick={startEdit}>
                  <Pencil className="h-3.5 w-3.5" /> Edit (optional)
                </Button>
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  )
}
