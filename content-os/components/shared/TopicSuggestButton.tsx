"use client"

import { useState } from "react"
import { Sparkles, Loader2 } from "lucide-react"

type ContentType = "hook" | "carousel" | "story" | "meme"

interface TopicSuggestButtonProps {
  brandId: string
  productId?: string | null
  contentType: ContentType
  onSelectTopic: (topic: string) => void
}

export function TopicSuggestButton({ brandId, productId, contentType, onSelectTopic }: TopicSuggestButtonProps) {
  const [loading, setLoading] = useState(false)
  const [topics, setTopics] = useState<string[]>([])
  const [error, setError] = useState("")

  async function fetchSuggestions() {
    setLoading(true)
    setError("")
    setTopics([])
    try {
      const res = await fetch("/api/v1/ai/topics/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, productId: productId ?? null, contentType }),
      })
      const json = await res.json() as { data?: { topics: string[] }; error?: { message?: string } }
      if (!res.ok || !json.data) throw new Error(json.error?.message ?? "Failed to fetch suggestions")
      setTopics(json.data.topics)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load suggestions")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={fetchSuggestions}
        disabled={loading}
        className="flex items-center gap-1.5 text-xs font-medium text-violet-600 hover:text-violet-800 disabled:opacity-50 transition-colors"
      >
        {loading
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : <Sparkles className="h-3.5 w-3.5" />
        }
        {loading ? "Getting ideas…" : "✨ Help me write a topic"}
      </button>

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {topics.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {topics.map((topic, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                onSelectTopic(topic)
                setTopics([])
              }}
              className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100 hover:border-violet-300 transition-colors text-left"
            >
              {topic}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
