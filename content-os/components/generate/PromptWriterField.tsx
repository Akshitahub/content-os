"use client"

import { Loader2, Sparkles } from "lucide-react"
import type { PromptWriterStage } from "@/hooks/usePromptWriter"

interface PromptWriterFieldProps {
  label: string
  prompt: string
  onChange: (value: string) => void
  stage: PromptWriterStage
  error: string | null
  onRewrite: () => void
  placeholder?: string
  rows?: number
}

// Shared UI for the "SocioPosts is writing your prompt..." stage every
// image-generation flow now goes through (Post, Story, Carousel, Ad Maker,
// Image Generator) -- streams live into the textarea below, stays fully
// editable once writing finishes (or if it fails), and never mentions Groq
// by name anywhere user-visible per the branding requirement.
export function PromptWriterField({ label, prompt, onChange, stage, error, onRewrite, placeholder, rows = 3 }: PromptWriterFieldProps) {
  const isWriting = stage === "writing"
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium">{label}</label>
        <button
          type="button"
          onClick={onRewrite}
          disabled={isWriting}
          className="flex items-center gap-1 text-[11px] font-medium text-violet-600 hover:text-violet-700 disabled:opacity-50"
        >
          <Sparkles className="h-3 w-3" /> {prompt.trim() ? "Rewrite" : "Write for me"}
        </button>
      </div>
      <textarea
        rows={rows}
        value={prompt}
        onChange={(e) => onChange(e.target.value)}
        readOnly={isWriting}
        placeholder={placeholder}
        className={`w-full rounded-md border px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none ${isWriting ? "bg-muted/50" : "border-input bg-background"}`}
      />
      {isWriting && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> SocioPosts is writing your prompt…
        </p>
      )}
      {stage === "error" && error && <p className="text-xs text-amber-600">{error}</p>}
    </div>
  )
}
