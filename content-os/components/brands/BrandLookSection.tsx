"use client"

import { useState, type KeyboardEvent } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { AlertTriangle, Loader2, Pencil, RefreshCw, Sparkles, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { useArtDirection, useRefreshArtDirection, useSaveArtDirection } from "@/hooks/useArtDirection"
import { paletteRoles, type BrandPalette } from "@/lib/design/color-themes"
import { AA_BODY, AA_GRAPHIC, bestContrast, hexContrast } from "@/lib/design/contrast-math"
import type { ArtDirection } from "@/lib/ai/brand-brain"

// "Brand look": the art direction the AI derived for this brand
// (lib/ai/art-direction.ts, brand_brain.art_direction) -- shown, editable,
// and previewed. Saving marks it edited_by_user, so it's never re-derived
// automatically; only "Refresh from brand" replaces it.

type Role = keyof ArtDirection["palette"]

const ROLES: { key: Role; label: string; use: string }[] = [
  { key: "deep", label: "Deep", use: "Text and strips" },
  { key: "base", label: "Base", use: "Backgrounds" },
  { key: "accent", label: "Accent", use: "Signature colour" },
  { key: "pop", label: "Pop", use: "Highlights" },
]

const MAX_MOTIFS = 6
const MAX_AVOID = 10
const HEX = /^#[0-9a-f]{6}$/i

/** Palette pairs that miss WCAG AA -- warned about, never blocking (the compositors adjust when drawing). */
function contrastWarnings(p: ArtDirection["palette"]): string[] {
  if (!Object.values(p).every((c) => HEX.test(c))) return []
  const out: string[] = []
  const ratio = (n: number) => `${n.toFixed(1)}:1`
  const deepOnBase = hexContrast(p.deep, p.base)
  if (deepOnBase < AA_BODY) out.push(`Deep text on Base is hard to read (${ratio(deepOnBase)}, needs ${AA_BODY}:1).`)
  const onAccent = hexContrast(bestContrast(p.accent, ["#ffffff", p.base, p.deep]), p.accent)
  if (onAccent < AA_BODY) out.push(`No text colour reads well on Accent (${ratio(onAccent)}, needs ${AA_BODY}:1) -- strips will use Deep instead.`)
  const popOnBase = hexContrast(p.pop, p.base)
  if (popOnBase < AA_GRAPHIC) out.push(`Pop highlights barely show on Base (${ratio(popOnBase)}, needs ${AA_GRAPHIC}:1).`)
  const popOnDeep = hexContrast(p.pop, p.deep)
  if (popOnDeep < AA_GRAPHIC) out.push(`Pop highlights barely show on Deep (${ratio(popOnDeep)}, needs ${AA_GRAPHIC}:1).`)
  return out
}

/** A mini post drawn with the palette's roles (CSS only) -- the same roles the compositors use. */
function PalettePreview({ palette, mood }: { palette: ArtDirection["palette"]; mood: string }) {
  if (!Object.values(palette).every((c) => HEX.test(c))) return null
  const p: BrandPalette = { ...palette, source: "art_direction" }
  const r = paletteRoles(p)
  return (
    <div className="w-44 shrink-0 overflow-hidden rounded-lg border shadow-sm" style={{ aspectRatio: "4 / 5", background: p.base }} aria-label="Preview of a post in this palette">
      <div className="relative flex h-[62%] flex-col justify-end p-3" style={{ background: `linear-gradient(135deg, ${p.accent}, ${p.deep})` }}>
        <div className="absolute inset-0" style={{ background: `linear-gradient(to top, ${r.scrim}cc, transparent 70%)` }} />
        <p className="relative text-[9px] font-bold uppercase tracking-widest" style={{ color: bestContrast(r.scrim, [p.pop, r.onImage]) }}>{mood || "New drop"}</p>
        <p className="relative text-sm font-extrabold leading-tight" style={{ color: r.onImage }}>
          Made for <span style={{ background: `${p.pop}66`, borderRadius: 3, padding: "0 2px" }}>your</span> people
        </p>
      </div>
      <div className="flex h-[38%] flex-col justify-between p-3">
        <p className="text-[10px] leading-snug" style={{ color: r.ink }}>Small-batch, made to last. <span style={{ color: r.inkMuted }}>Ships in 2 days.</span></p>
        <span className="self-start rounded-full px-2.5 py-1 text-[9px] font-bold" style={{ background: r.band, color: r.bandText }}>Shop now</span>
      </div>
    </div>
  )
}

function Chips({ items, editing, max, onChange, placeholder, label }: {
  items: string[]; editing: boolean; max: number; onChange: (next: string[]) => void; placeholder: string; label: string
}) {
  const [draft, setDraft] = useState("")
  const add = () => {
    const value = draft.trim()
    if (!value || items.length >= max || items.some((i) => i.toLowerCase() === value.toLowerCase())) return
    onChange([...items, value])
    setDraft("")
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      add()
    }
  }
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span key={item} className="inline-flex items-center gap-1 rounded-full border bg-muted px-2.5 py-0.5 text-xs">
            {item}
            {editing && (
              <button type="button" aria-label={`Remove ${item}`} className="text-muted-foreground hover:text-foreground" onClick={() => onChange(items.filter((i) => i !== item))}>
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
        {items.length === 0 && <span className="text-xs text-muted-foreground">None yet</span>}
      </div>
      {editing && items.length < max && (
        <div className="flex gap-2">
          <Input aria-label={`Add to ${label}`} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} placeholder={placeholder} className="h-8 text-xs" maxLength={120} />
          <Button type="button" size="sm" variant="outline" onClick={add} disabled={!draft.trim()}>Add</Button>
        </div>
      )}
    </div>
  )
}

export function BrandLookSection({ brandId }: { brandId: string }) {
  const { data: artDirection, isLoading, error } = useArtDirection(brandId)
  const save = useSaveArtDirection(brandId)
  const refresh = useRefreshArtDirection(brandId)
  const [draft, setDraft] = useState<ArtDirection | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [saved, setSaved] = useState(false)

  const editing = !!draft
  const shown = draft ?? artDirection ?? null
  const warnings = shown ? contrastWarnings(shown.palette) : []
  const invalid = !!draft && (!draft.mood.trim() || !draft.photo_style.trim() || draft.motifs.length === 0 || draft.avoid.length === 0 || !Object.values(draft.palette).every((c) => HEX.test(c)))

  const update = (patch: Partial<ArtDirection>) => setDraft((d) => (d ? { ...d, ...patch } : d))
  const setColor = (role: Role, value: string) => setDraft((d) => (d ? { ...d, palette: { ...d.palette, [role]: value } } : d))

  function onSave() {
    if (!draft || invalid) return
    setSaved(false)
    save.mutate({ ...draft, mood: draft.mood.trim(), photo_style: draft.photo_style.trim() }, {
      onSuccess: () => {
        setDraft(null)
        setSaved(true)
      },
    })
  }

  function onRefresh() {
    setSaved(false)
    refresh.mutate(undefined, {
      onSuccess: () => {
        setDraft(null)
        setConfirmOpen(false)
      },
    })
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm">Brand look</CardTitle>
            <CardDescription>
              The palette, mood and visual rules every image and design uses.
              {artDirection && (artDirection.edited_by_user ? " Edited by you." : " Suggested from your brand.")}
            </CardDescription>
          </div>
          {artDirection && !editing && (
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => { setSaved(false); setDraft(artDirection) }}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmOpen(true)} disabled={refresh.isPending}>
                <RefreshCw className="h-3.5 w-3.5" /> Refresh from brand
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : error ? (
          <p className="text-sm text-destructive">{error.message}</p>
        ) : !shown ? (
          <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-4">
            <p className="text-sm font-medium">Your brand look is being set up</p>
            <p className="text-xs text-muted-foreground">We build it from your colours, description, logo and product photos. It usually appears after your first generation, or you can create it now.</p>
            <Button type="button" size="sm" onClick={onRefresh} disabled={refresh.isPending}>
              {refresh.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Generate now
            </Button>
            {refresh.error && <p className="text-xs text-destructive">{refresh.error.message}</p>}
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-4 sm:flex-row">
              <div className="grid flex-1 grid-cols-2 gap-3">
                {ROLES.map((role) => (
                  <div key={role.key} className="flex items-center gap-2.5">
                    {editing ? (
                      <input
                        type="color"
                        aria-label={`${role.label} colour`}
                        value={HEX.test(shown.palette[role.key]) ? shown.palette[role.key] : "#000000"}
                        onChange={(e) => setColor(role.key, e.target.value)}
                        className="h-10 w-10 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
                      />
                    ) : (
                      <span className="h-10 w-10 shrink-0 rounded-md border" style={{ background: shown.palette[role.key] }} />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{role.label}</p>
                      <p className="text-xs text-muted-foreground">{role.use}</p>
                      {editing ? (
                        <Input
                          aria-label={`${role.label} hex`}
                          value={shown.palette[role.key]}
                          onChange={(e) => setColor(role.key, e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`)}
                          className="mt-1 h-7 w-24 font-mono text-xs"
                          maxLength={7}
                        />
                      ) : (
                        <p className="font-mono text-xs text-muted-foreground">{shown.palette[role.key]}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <PalettePreview palette={shown.palette} mood={shown.mood} />
            </div>

            {warnings.length > 0 && (
              <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
                {warnings.map((w) => (
                  <p key={w} className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{w}</p>
                ))}
                <p className="pl-5 text-amber-800/80 dark:text-amber-300/80">You can still save -- designs nudge these colours where needed so text stays readable.</p>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="bl-mood">Mood</Label>
                {editing
                  ? <Input id="bl-mood" value={shown.mood} onChange={(e) => update({ mood: e.target.value })} maxLength={80} placeholder="e.g. Warm, crafted, unhurried" />
                  : <p className="text-sm">{shown.mood}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bl-photo-style">Photo style</Label>
                {editing
                  ? <Input id="bl-photo-style" value={shown.photo_style} onChange={(e) => update({ photo_style: e.target.value })} maxLength={300} placeholder="e.g. Soft daylight, muted tones, close crops" />
                  : <p className="text-sm">{shown.photo_style}</p>}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Motifs</Label>
              <Chips label="motifs" items={shown.motifs} editing={editing} max={MAX_MOTIFS} onChange={(motifs) => update({ motifs })} placeholder="e.g. brass, block-print fabric" />
            </div>
            <div className="space-y-1.5">
              <Label>Never show</Label>
              <Chips label="never show" items={shown.avoid} editing={editing} max={MAX_AVOID} onChange={(avoid) => update({ avoid })} placeholder="e.g. stock office handshakes" />
            </div>

            {editing && (
              <div className="flex flex-wrap items-center justify-end gap-3">
                {invalid && <p className="text-xs text-muted-foreground">Needs a mood, a photo style, at least one motif and one &quot;never show&quot;, and four valid colours.</p>}
                {save.error && <p className="text-xs text-destructive">{save.error.message}</p>}
                <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={save.isPending}>Cancel</Button>
                <Button type="button" size="sm" onClick={onSave} disabled={save.isPending || invalid}>
                  {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save
                </Button>
              </div>
            )}
            {!editing && saved && <p className="text-right text-xs text-muted-foreground">Saved. New content will use this look.</p>}
            {!editing && refresh.error && <p className="text-right text-xs text-destructive">{refresh.error.message}</p>}
          </>
        )}
      </CardContent>

      <Dialog.Root open={confirmOpen} onOpenChange={(open) => { if (!refresh.isPending) setConfirmOpen(open) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-xl border bg-background p-6 shadow-xl">
            <Dialog.Title className="text-lg font-semibold">Refresh from brand?</Dialog.Title>
            <Dialog.Description className="text-sm text-muted-foreground">
              This replaces your edits with a fresh suggestion.
            </Dialog.Description>
            {refresh.error && <p className="text-sm text-destructive">{refresh.error.message}</p>}
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" disabled={refresh.isPending}>Cancel</Button>
              </Dialog.Close>
              <Button type="button" onClick={onRefresh} disabled={refresh.isPending}>
                {refresh.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Replace
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </Card>
  )
}
