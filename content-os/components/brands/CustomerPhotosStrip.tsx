"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Copy, ExternalLink, Loader2 } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { isApiError } from "@/types/api"
import { readJsonResponse } from "@/lib/utils/read-json-response"

// "Customer photos": photos customers tagged the brand in on Instagram
// (migration 069). None is ever used until its creator says yes: "Ask to
// repost" shows a ready DM the owner copies and sends THEMSELVES (we never
// send DMs), "They said yes" marks it granted -- then posts may use it,
// credited "📸 @handle" in the caption.

type Rights = "none" | "requested" | "granted" | "declined"
interface CustomerPhoto { id: string; url: string; creator_handle: string; permalink: string | null; rights_status: Rights; dm: string }

const key = (brandId: string) => ["customer-photos", brandId] as const

async function readData<T>(res: Response, fallback: string): Promise<T> {
  const json: unknown = await readJsonResponse(res)
  if (!res.ok || isApiError(json)) throw new Error(isApiError(json) ? json.error.message : fallback)
  return (json as { data: T }).data
}

const BADGE: Record<Rights, string | null> = { none: null, requested: "Asked", granted: "Can repost", declined: "Said no" }

export function CustomerPhotosStrip({ brandId }: { brandId: string }) {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: key(brandId),
    queryFn: async () => readData<{ instagramConnected: boolean; photos: CustomerPhoto[] }>(await fetch(`/api/v1/brands/${brandId}/customer-photos`), "Couldn't load customer photos."),
  })
  const setRights = useMutation({
    mutationFn: async ({ id, rights_status }: { id: string; rights_status: Rights }) => readData(
      await fetch(`/api/v1/brands/${brandId}/customer-photos/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rights_status }) }),
      "Couldn't save that. Please try again.",
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(brandId) }),
  })
  const [asking, setAsking] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Only for a brand with Instagram connected -- that's where tags come from.
  if (isLoading || !data?.instagramConnected) return null
  const photos = data.photos
  const open = photos.find((p) => p.id === asking) ?? null

  async function copyDm(p: CustomerPhoto) {
    try {
      await navigator.clipboard.writeText(p.dm)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      if (p.rights_status === "none") setRights.mutate({ id: p.id, rights_status: "requested" })
    } catch {
      // The DM stays on screen to select by hand.
    }
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="text-sm">Customer photos</CardTitle>
        <CardDescription>Photos customers tag you in. We only use one after its owner says yes, and credit them in the caption.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {photos.length === 0 ? (
          <p className="text-sm text-muted-foreground">No customer photos yet. When customers tag you on Instagram, they&apos;ll show up here.</p>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {photos.map((p) => (
              <button key={p.id} type="button" onClick={() => setAsking(p.id === asking ? null : p.id)}
                className={`relative h-28 w-24 shrink-0 overflow-hidden rounded-md border bg-muted text-left ${p.id === asking ? "ring-2 ring-violet-500" : ""}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={`Photo by @${p.creator_handle}`} className="h-20 w-full object-cover" loading="lazy" />
                <span className="block truncate px-1 pt-0.5 text-[10px] text-muted-foreground">@{p.creator_handle}</span>
                {BADGE[p.rights_status] && (
                  <span className={`absolute left-1 top-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${p.rights_status === "granted" ? "bg-emerald-600 text-white" : "bg-black/60 text-white"}`}>
                    {BADGE[p.rights_status]}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        {open && (
          <div className="rounded-lg border bg-muted/40 p-3">
            {open.rights_status === "granted" ? (
              <p className="text-sm">@{open.creator_handle} said yes. Posts can use this photo, credited 📸 @{open.creator_handle}.</p>
            ) : (
              <>
                <p className="text-xs font-medium">Ask to repost: copy this and send it to @{open.creator_handle} on Instagram</p>
                <p className="mt-2 whitespace-pre-wrap rounded-md bg-background p-2 text-sm">{open.dm}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => copyDm(open)}>
                    {copied ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />}{copied ? "Copied" : "Copy message"}
                  </Button>
                  <a href={`https://instagram.com/${encodeURIComponent(open.creator_handle)}`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium hover:bg-muted">
                    <ExternalLink className="mr-1 h-3.5 w-3.5" /> Open @{open.creator_handle}
                  </a>
                  <Button size="sm" disabled={setRights.isPending} onClick={() => setRights.mutate({ id: open.id, rights_status: "granted" })}>
                    {setRights.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null} They said yes
                  </Button>
                  {open.rights_status !== "declined" && (
                    <Button size="sm" variant="ghost" onClick={() => setRights.mutate({ id: open.id, rights_status: "declined" })}>They said no</Button>
                  )}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">We never send DMs ourselves.</p>
              </>
            )}
          </div>
        )}
        {setRights.error && <p className="text-xs text-destructive">{setRights.error.message}</p>}
      </CardContent>
    </Card>
  )
}
