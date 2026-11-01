"use client"

import { useRef, useState } from "react"
import { Camera, CheckCircle2, ImagePlus, Loader2, XCircle } from "lucide-react"

// The phone page's picker (app/send-photos/[token]): pick from the gallery or
// shoot, each photo shrunk on the phone (longest side 2048, JPEG) and sent
// one at a time, so a slow connection still gets most of them through.

type Item = { key: string; preview: string; state: "waiting" | "sending" | "done" | "failed"; error?: string }

const MAX_SIDE = 2048

async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88))
    return blob ?? file
  } catch {
    // A format the browser can't draw (some HEIC): send it as it is.
    return file
  }
}

export function PhoneUploader({ token, max }: { token: string; max: number }) {
  const [items, setItems] = useState<Item[]>([])
  const [busy, setBusy] = useState(false)
  const pick = useRef<HTMLInputElement>(null)
  const shoot = useRef<HTMLInputElement>(null)
  const sent = items.filter((i) => i.state === "done").length
  const left = max - items.filter((i) => i.state !== "failed").length

  const update = (key: string, patch: Partial<Item>) => setItems((all) => all.map((i) => (i.key === key ? { ...i, ...patch } : i)))

  async function send(files: FileList | null) {
    if (!files?.length) return
    const chosen = Array.from(files).filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name)).slice(0, Math.max(0, left))
    const batch = chosen.map((f, n) => ({ file: f, item: { key: `${Date.now()}-${n}-${f.name}`, preview: URL.createObjectURL(f), state: "waiting" as const } }))
    setItems((all) => [...all, ...batch.map((b) => b.item)])
    setBusy(true)
    for (const { file, item } of batch) {
      update(item.key, { state: "sending" })
      try {
        const body = new FormData()
        body.append("photo", await shrink(file), "photo.jpg")
        const res = await fetch(`/api/v1/photo-link/${token}`, { method: "POST", body })
        const json = await res.json().catch(() => null)
        if (!res.ok) update(item.key, { state: "failed", error: json?.error?.message ?? "Couldn't send" })
        else update(item.key, { state: "done" })
      } catch {
        update(item.key, { state: "failed", error: "No connection" })
      }
    }
    setBusy(false)
  }

  return (
    <div className="mt-6">
      <div className="grid grid-cols-2 gap-3">
        <button type="button" disabled={busy || left <= 0} onClick={() => pick.current?.click()}
          className="flex flex-col items-center gap-2 rounded-2xl bg-violet-600 px-4 py-5 text-sm font-semibold text-white disabled:opacity-50">
          <ImagePlus className="h-6 w-6" /> Pick photos
        </button>
        <button type="button" disabled={busy || left <= 0} onClick={() => shoot.current?.click()}
          className="flex flex-col items-center gap-2 rounded-2xl border border-violet-200 bg-white px-4 py-5 text-sm font-semibold text-violet-700 disabled:opacity-50">
          <Camera className="h-6 w-6" /> Take a photo
        </button>
      </div>
      <input ref={pick} type="file" accept="image/*" multiple hidden onChange={(e) => { void send(e.target.files); e.target.value = "" }} />
      <input ref={shoot} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void send(e.target.files); e.target.value = "" }} />

      {items.length > 0 && (
        <>
          <p className="mt-6 text-sm font-medium">
            {busy ? `Sending… ${sent} of ${items.length}` : `${sent} sent. ${left > 0 ? "Add more any time, or close this page." : "That's the most this link takes."}`}
          </p>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {items.map((i) => (
              <div key={i.key} className="relative aspect-square overflow-hidden rounded-lg bg-neutral-200" title={i.error}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={i.preview} alt="" className={`h-full w-full object-cover ${i.state === "done" ? "" : "opacity-60"}`} />
                <span className="absolute bottom-1 right-1 rounded-full bg-white/90 p-0.5">
                  {i.state === "done" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    : i.state === "failed" ? <XCircle className="h-4 w-4 text-red-600" />
                    : <Loader2 className="h-4 w-4 animate-spin text-neutral-500" />}
                </span>
              </div>
            ))}
          </div>
          {items.some((i) => i.state === "failed") && <p className="mt-2 text-xs text-red-600">{items.find((i) => i.state === "failed")?.error}. Try those again.</p>}
        </>
      )}
    </div>
  )
}
