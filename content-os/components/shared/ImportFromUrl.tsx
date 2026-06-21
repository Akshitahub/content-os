"use client"

import { useState } from "react"
import { Link2, Loader2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface ImportFromUrlProps<T> {
  label: string
  placeholder: string
  helperText: string
  useExtractHook: () => {
    mutate: (url: string, opts: { onSuccess: (data: T) => void; onError?: (err: Error) => void }) => void
    isPending: boolean
  }
  onExtracted: (data: T, url: string) => void
}

export function ImportFromUrl<T>({ label, placeholder, helperText, useExtractHook, onExtracted }: ImportFromUrlProps<T>) {
  const [url, setUrl] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const { mutate, isPending } = useExtractHook()

  function handleFetch() {
    if (!url.trim()) return
    setError(null)
    setSuccess(false)
    const trimmedUrl = url.trim()
    mutate(trimmedUrl, {
      onSuccess: (data) => {
        onExtracted(data, trimmedUrl)
        setSuccess(true)
      },
      onError: (err) => setError(err.message),
    })
  }

  return (
    <div className="rounded-lg border border-dashed bg-muted/30 p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Link2 className="h-4 w-4 text-primary" />
        {label}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{helperText}</p>

      <div className="mt-3 flex gap-2">
        <Input
          type="url"
          placeholder={placeholder}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleFetch() } }}
          disabled={isPending}
        />
        <Button type="button" variant="secondary" onClick={handleFetch} disabled={isPending || !url.trim()}>
          {isPending ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Reading…</>
          ) : (
            <><Sparkles className="h-4 w-4" /> Fetch details</>
          )}
        </Button>
      </div>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      {success && !error && (
        <p className="mt-2 text-xs text-primary">
          Done — fields below were filled in. Review and edit anything before saving.
        </p>
      )}
    </div>
  )
}
