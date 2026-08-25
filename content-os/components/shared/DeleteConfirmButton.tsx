"use client"

import { useState } from "react"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"

interface DeleteConfirmButtonProps {
  /** Throw to signal failure -- the inline error resets the confirm state
   * so the user can retry rather than being stuck. On success, the caller
   * is expected to remove/invalidate whatever made this item visible; this
   * component doesn't reset itself afterward since it's normally unmounted
   * along with the item it belonged to. */
  onDelete: () => Promise<void>
  /** "icon" for a compact trash icon (Library cards, alongside star rating/
   * copy) — "text" for a labeled "Delete" button, visually distinct from
   * Schedule/Copy so it can't be mis-clicked (ContentDetailPanel). */
  variant?: "icon" | "text"
  className?: string
  /** Controlled mode -- when both are provided, the confirm/cancel state
   * is owned by the parent instead of this component's own internal
   * state. Lets a separate trigger elsewhere on the same card (e.g. a
   * quick-actions dropdown's "Delete" item) reveal this exact same
   * confirmation UI instead of a second one being built for it. */
  confirming?: boolean
  onConfirmingChange?: (confirming: boolean) => void
}

// Same inline "Are you sure? Yes, delete / Cancel" pattern Settings' brand
// deletion already uses, rather than a native confirm() or a silent
// one-click delete -- reused here instead of re-invented.
export function DeleteConfirmButton({ onDelete, variant = "icon", className, confirming: confirmingProp, onConfirmingChange }: DeleteConfirmButtonProps) {
  const [confirmingState, setConfirmingState] = useState(false)
  const confirming = confirmingProp ?? confirmingState
  const setConfirming = onConfirmingChange ?? setConfirmingState
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    setDeleting(true)
    setError(null)
    try {
      await onDelete()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete.")
      setDeleting(false)
    }
  }

  if (confirming) {
    return (
      <div className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}>
        <span className="text-xs text-muted-foreground">Are you sure?</span>
        <Button variant="destructive" size="sm" disabled={deleting} onClick={handleConfirm}>
          {deleting ? "Deleting…" : "Yes, delete"}
        </Button>
        <Button variant="ghost" size="sm" disabled={deleting} onClick={() => { setConfirming(false); setError(null) }}>
          Cancel
        </Button>
        {error && <p className="w-full text-xs text-destructive">{error}</p>}
      </div>
    )
  }

  if (variant === "text") {
    return (
      <Button
        variant="ghost"
        size="sm"
        className={`gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive ${className ?? ""}`}
        onClick={() => setConfirming(true)}
      >
        <Trash2 className="h-3.5 w-3.5" /> Delete
      </Button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className={`rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive ${className ?? ""}`}
      aria-label="Delete"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  )
}
