"use client"

import { Link2, Loader2 } from "lucide-react"
import { useCopyPreviewLink } from "@/hooks/useCopyPreviewLink"
import { CopyLinkToast } from "@/components/shared/CopyLinkToast"

/**
 * The dashboard's "Today's draft" hero card (app/(dashboard)/dashboard/page.tsx)
 * is a server component, so its old wa.me "Send" `<a>` couldn't just gain
 * an onClick -- this is the small client island that replaces it, wired to
 * the same useCopyPreviewLink hook every library card menu now uses.
 */
export function CopyPreviewLinkButton({ brandId, contentId }: { brandId: string; contentId: string }) {
  const { copyPreviewLink, isPending, feedback } = useCopyPreviewLink()
  return (
    <>
      <CopyLinkToast feedback={feedback} />
      <button
        type="button"
        onClick={() => copyPreviewLink(brandId, "daily_draft", contentId)}
        disabled={isPending}
        className="inline-flex h-9 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-60"
      >
        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
        {isPending ? "Copying…" : "Copy preview link"}
      </button>
    </>
  )
}
