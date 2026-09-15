"use client"

import { useCallback, useRef, useState } from "react"

export type PromptWriterStage = "idle" | "writing" | "ready" | "error"

export interface PromptWriterConstraints {
  aspectRatioLabel?: string
  styleLabel?: string
  hasProductReference?: boolean
  role?: "hook" | "cta" | "body"
  allowTextInImage?: boolean
}

export interface PromptWriterArgs {
  flow: "post" | "story" | "carousel" | "ad_maker" | "image_tool"
  brandId: string
  productId?: string | null
  /** For flows (Carousel, Story) whose product picker only ever carries a
   * name/description client-side, never a database id -- see
   * app/api/v1/ai/image-prompt/write/route.ts's identical inline `product`
   * field. Ignored when productId is also present. */
  product?: { name: string; description?: string }
  rawInput?: string | null
  /** True for an explicit "Rewrite"/"Regenerate" call, as opposed to the
   * first write for this generation -- passed straight through to
   * /api/v1/ai/image-prompt/write, which tells Groq to give the rewrite a
   * genuinely different creative treatment. Callers should keep rawInput/
   * product/constraints identical between a first write and a rewrite (the
   * same stable seed, not the previous AI output) -- this flag is what
   * asks for variety, not a changed input. */
  isRewrite?: boolean
  constraints?: PromptWriterConstraints
}

/**
 * Drives app/api/v1/ai/image-prompt/write's streaming response into
 * whatever prompt field state the caller already owns (setPrompt) --
 * controlled, not self-owned state, so each of the 5 image-generation
 * flows can wire this straight into its own existing prompt field/store
 * instead of juggling two separate copies of the same text. Never charges
 * a credit (that route never does either) -- a failure here just means
 * `stage` becomes "error" and the caller's existing prompt field is left
 * exactly as it was, so the user can type one manually and generate
 * straight from that with nothing lost.
 */
export function usePromptWriter(setPrompt: (value: string) => void) {
  const [stage, setStage] = useState<PromptWriterStage>("idle")
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const write = useCallback(async (args: PromptWriterArgs) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setStage("writing")
    setError(null)
    setPrompt("")

    try {
      const res = await fetch("/api/v1/ai/image-prompt/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        let message = "Couldn't write a prompt automatically — write one yourself below."
        try {
          const json = await res.json()
          if (json?.error?.message) message = json.error.message
        } catch {}
        setError(message)
        setStage("error")
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let full = ""
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        full += decoder.decode(value, { stream: true })
        setPrompt(full)
      }

      if (!full.trim()) {
        setError("Couldn't write a prompt automatically — write one yourself below.")
        setStage("error")
        return
      }

      setStage("ready")
    } catch (err) {
      if (controller.signal.aborted) return
      console.error("[usePromptWriter] write failed:", err)
      setError("Couldn't write a prompt automatically — write one yourself below.")
      setStage("error")
    }
  }, [setPrompt])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setStage("idle")
    setError(null)
    setPrompt("")
  }, [setPrompt])

  return { stage, error, write, reset }
}
