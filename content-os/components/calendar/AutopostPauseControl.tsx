"use client"

import { useEffect, useState } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { Loader2, PauseCircle, PlayCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAutopostPause, useSetAutopostPause } from "@/hooks/useAutopostPause"

/**
 * "Pause all autoposting" / "Resume autoposting" -- the brand-level kill
 * switch (app/api/v1/brands/[brandId]/autopost-pause). Pausing stops
 * publishing only; generation and approval keep working. Pausing asks for
 * confirmation with the number of scheduled posts it will hold; resuming
 * reports how many overdue posts were marked missed instead of publishing late.
 */
export function AutopostPauseControl({ brandId }: { brandId: string }) {
  const { data: state, isLoading } = useAutopostPause(brandId)
  const setPause = useSetAutopostPause(brandId)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 8000)
    return () => clearTimeout(timer)
  }, [toast])

  if (isLoading || !state) return null
  const busy = setPause.isPending
  const held = state.scheduled_count

  function resume() {
    setPause.mutate(false, {
      onSuccess: ({ missed_count }) => {
        if (missed_count > 0) setToast(`${missed_count} post${missed_count === 1 ? " was" : "s were"} skipped while paused — reschedule ${missed_count === 1 ? "it" : "them"} from the calendar`)
      },
    })
  }

  return (
    <>
      {state.paused ? (
        <Button type="button" onClick={resume} disabled={busy} className="h-9 shrink-0 gap-1.5 rounded-full bg-emerald-600 px-4 font-semibold text-white hover:bg-emerald-700">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
          Resume autoposting
        </Button>
      ) : (
        <Button type="button" variant="outline" onClick={() => setConfirmOpen(true)} disabled={busy} className="h-9 shrink-0 gap-1.5 rounded-full border-amber-300 px-4 font-semibold text-amber-800 hover:bg-amber-50">
          <PauseCircle className="h-4 w-4" />
          Pause all autoposting
        </Button>
      )}
      {setPause.error && <p className="text-xs text-destructive">{setPause.error.message}</p>}

      <Dialog.Root open={confirmOpen} onOpenChange={(open) => { if (!busy) setConfirmOpen(open) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-xl border bg-background p-6 shadow-xl">
            <Dialog.Title className="text-lg font-semibold">Pause all autoposting?</Dialog.Title>
            <Dialog.Description className="text-sm text-muted-foreground">
              {held === 0
                ? "Nothing is scheduled right now. While paused, nothing will publish."
                : `${held} scheduled post${held === 1 ? "" : "s"} will be held and won't publish until you resume.`}{" "}
              Posts that come due while paused are marked missed when you resume, so you can reschedule them. Generating and approving content still works.
            </Dialog.Description>
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" disabled={busy}>Cancel</Button>
              </Dialog.Close>
              <Button
                type="button"
                disabled={busy}
                className="gap-1.5 bg-amber-600 text-white hover:bg-amber-700"
                onClick={() => setPause.mutate(true, { onSuccess: () => setConfirmOpen(false) })}
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Pause autoposting
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 z-[100] max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-full bg-gray-900 px-4 py-2 text-center text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
    </>
  )
}

/** Persistent while paused, so it's never forgotten that nothing will publish. */
export function AutopostPausedBanner({ brandId }: { brandId: string }) {
  const { data: state } = useAutopostPause(brandId)
  if (!state?.paused) return null
  return (
    <div role="status" className="mb-6 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
      <PauseCircle className="h-4 w-4 shrink-0" />
      Autoposting is paused — nothing will publish.
    </div>
  )
}
