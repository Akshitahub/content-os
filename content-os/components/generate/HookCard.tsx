"use client"

import { useState } from "react"
import { Copy, Check, Sparkles } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { GeneratedHook } from "@/types/app"

type HookWithId = GeneratedHook & { id: string | null }

const HOOK_TYPE_LABELS: Record<string, string> = {
  question: "Question",
  bold_statement: "Bold Statement",
  story: "Story",
  statistic: "Statistic",
  controversial: "Controversial",
  how_to: "How-To",
}

const HOOK_TYPE_COLORS: Record<string, string> = {
  question: "bg-blue-50 text-blue-700",
  bold_statement: "bg-orange-50 text-orange-700",
  story: "bg-purple-50 text-purple-700",
  statistic: "bg-green-50 text-green-700",
  controversial: "bg-red-50 text-red-700",
  how_to: "bg-teal-50 text-teal-700",
}

interface HookCardProps {
  hook: HookWithId
  isSelected?: boolean
  onSelect?: (hook: HookWithId) => void
}

export function HookCard({ hook, isSelected, onSelect }: HookCardProps) {
  const [copied, setCopied] = useState(false)

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation()
    await navigator.clipboard.writeText(hook.hook_text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card
      className={`cursor-pointer transition-all hover:shadow-md ${isSelected ? "ring-2 ring-primary" : ""}`}
      onClick={() => onSelect?.(hook)}
    >
      <CardContent className="pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="mb-2 flex items-center gap-2 flex-wrap">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${HOOK_TYPE_COLORS[hook.hook_type] ?? "bg-secondary text-secondary-foreground"}`}>
                {HOOK_TYPE_LABELS[hook.hook_type] ?? hook.hook_type}
              </span>
              {isSelected && (
                <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  <Sparkles className="h-3 w-3" /> Selected
                </span>
              )}
            </div>
            <p className="text-sm font-medium leading-relaxed">{hook.hook_text}</p>
            {hook.reasoning && (
              <p className="mt-1.5 text-xs text-muted-foreground italic">{hook.reasoning}</p>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground"
            onClick={handleCopy}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
