"use client"

import { useState, useCallback } from "react"
import { Copy, Check } from "lucide-react"
import { Button } from "@/components/ui/button"

interface QuickCopyButtonProps {
  text: string
  platform?: string
  hashtags?: string[]
  cta?: string | null
  label?: string
  className?: string
  size?: "sm" | "default"
}

function formatForPlatform(
  text: string,
  platform: string,
  hashtags: string[],
  cta: string | null,
): string {
  const tags = hashtags.map(h => `#${h.replace(/^#/, "")}`).join(" ")

  if (platform === "instagram") {
    const parts = [text]
    if (cta) parts.push(cta)
    if (tags) parts.push(tags)
    return parts.join("\n\n")
  }
  if (platform === "twitter") {
    const base = `${text}${cta ? ` ${cta}` : ""}`
    return base.length > 260 ? base.slice(0, 257) + "…" : base
  }
  if (platform === "linkedin") {
    const parts = [text]
    if (cta) parts.push(cta)
    if (tags) parts.push(tags)
    return parts.join("\n\n")
  }
  // default
  const parts = [text]
  if (cta) parts.push(cta)
  if (tags) parts.push(tags)
  return parts.join("\n\n")
}

export function QuickCopyButton({
  text,
  platform,
  hashtags = [],
  cta = null,
  label,
  className,
  size = "sm",
}: QuickCopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    const formatted = platform
      ? formatForPlatform(text, platform, hashtags, cta)
      : text
    await navigator.clipboard.writeText(formatted)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text, platform, hashtags, cta])

  const displayLabel =
    label ?? (platform ? `Copy for ${platform.charAt(0).toUpperCase() + platform.slice(1)}` : "Copy")

  return (
    <Button variant="ghost" size={size} onClick={handleCopy} className={className}>
      {copied ? (
        <Check className="h-3.5 w-3.5 mr-1 text-green-500" />
      ) : (
        <Copy className="h-3.5 w-3.5 mr-1" />
      )}
      {copied ? "Copied!" : displayLabel}
    </Button>
  )
}
