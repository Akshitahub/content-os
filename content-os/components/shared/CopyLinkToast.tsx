"use client"

import type { CopyPreviewLinkFeedback } from "@/hooks/useCopyPreviewLink"

/**
 * Small fixed-position toast for useCopyPreviewLink's feedback -- this
 * codebase has no toast/notification library yet, so this is the one
 * minimal, reusable piece for it rather than duplicating an ad-hoc
 * "copied" message per call site. Render once wherever the hook is used;
 * each caller owns its own hook instance/feedback state, so only the menu
 * item actually clicked ever has something to show.
 */
export function CopyLinkToast({ feedback }: { feedback: CopyPreviewLinkFeedback | null }) {
  if (!feedback) return null
  return (
    <div
      role="status"
      className={`fixed bottom-6 left-1/2 z-[100] -translate-x-1/2 rounded-full px-4 py-2 text-sm font-medium text-white shadow-lg ${
        feedback.type === "success" ? "bg-gray-900" : "bg-destructive"
      }`}
    >
      {feedback.message}
    </div>
  )
}
