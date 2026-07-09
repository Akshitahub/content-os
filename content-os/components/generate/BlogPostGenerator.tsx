"use client"

import { useState, useCallback } from "react"
import Link from "next/link"
import { Loader2, Copy, Check, RefreshCw, AlertCircle, Sparkles, Star } from "lucide-react"
import { GenerationWarning } from "@/components/shared/GenerationWarning"
import { getFriendlyError } from "@/lib/utils/error-messages"

interface BlogPostResult {
  id: string | null
  title: string
  body: string
  meta_description: string
  suggested_tags?: string[]
}

interface SuggestionState {
  loading: boolean
  suggestions: string[]
  enhancedPrompt: string | null
  error: string | null
}

function StarRating({ value, onChange, disabled }: { value: number | null; onChange: (r: number) => void; disabled?: boolean }) {
  const [hover, setHover] = useState<number | null>(null)
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={disabled}
          onClick={() => onChange(star)}
          onMouseEnter={() => setHover(star)}
          onMouseLeave={() => setHover(null)}
          className="rounded p-0.5 transition-colors hover:text-yellow-400 focus-visible:outline-none disabled:cursor-not-allowed"
        >
          <Star className={`h-4 w-4 transition-colors ${(hover ?? value ?? 0) >= star ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/40"}`} />
        </button>
      ))}
    </div>
  )
}

export function BlogPostGenerator({ brandId }: { brandId: string }) {
  const [prompt, setPrompt] = useState("")
  const [inputError, setInputError] = useState("")
  const [loading, setLoading] = useState(false)
  const [apiError, setApiError] = useState("")
  const [post, setPost] = useState<BlogPostResult | null>(null)
  const [copied, setCopied] = useState(false)
  const [rating, setRating] = useState<number | null>(null)
  const [ratingSaving, setRatingSaving] = useState(false)

  const [suggestion, setSuggestion] = useState<SuggestionState | null>(null)

  const fetchSuggestions = useCallback(async () => {
    if (!prompt.trim()) return
    setSuggestion({ loading: true, suggestions: [], enhancedPrompt: null, error: null })
    try {
      const res = await fetch("/api/v1/ai/blog/suggest-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, prompt: prompt.trim() }),
      })
      const json = await res.json() as { data?: { suggestions: string[]; enhancedPrompt: string }; error?: { message?: string } }
      if (!res.ok || !json.data) throw new Error(json.error?.message ?? "Couldn't get suggestions.")
      setSuggestion({ loading: false, suggestions: json.data.suggestions, enhancedPrompt: json.data.enhancedPrompt, error: null })
    } catch (err) {
      setSuggestion({ loading: false, suggestions: [], enhancedPrompt: null, error: err instanceof Error ? err.message : "Couldn't get suggestions." })
    }
  }, [brandId, prompt])

  async function generate() {
    if (!prompt.trim()) {
      setInputError("Please enter a topic for your blog post.")
      return
    }
    setLoading(true)
    setInputError("")
    setApiError("")
    setPost(null)
    setRating(null)
    try {
      const res = await fetch("/api/v1/ai/blog/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, prompt: prompt.trim() }),
      })
      const json = await res.json() as { data?: BlogPostResult; error?: { message?: string } }
      if (!res.ok || !json.data) throw new Error(json.error?.message ?? "Generation failed")
      setPost(json.data)
    } catch (err) {
      setApiError(getFriendlyError(err))
    } finally {
      setLoading(false)
    }
  }

  function copyPost() {
    if (!post) return
    const tags = post.suggested_tags?.length ? `\n\nTags: ${post.suggested_tags.join(", ")}` : ""
    const text = `${post.title}\n\n${post.body}${tags}`
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  async function submitRating(value: number) {
    if (!post?.id) return
    setRating(value)
    setRatingSaving(true)
    try {
      await fetch(`/api/v1/brands/${brandId}/blog-posts/${post.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_rating: value }),
      })
    } catch {
      // Non-fatal — the rating just won't feed the ratings-based few-shot
      // examples for future generations if this fails.
    } finally {
      setRatingSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold">Write a blog post ✍️</h3>
          <p className="text-xs text-muted-foreground mt-0.5">SEO-friendly article for your brand&apos;s blog — starts from your own topic, always.</p>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What&apos;s the post about?</p>
          <textarea
            rows={2}
            value={prompt}
            onChange={(e) => { setPrompt(e.target.value); setInputError(""); setSuggestion(null) }}
            placeholder="e.g. How to choose the right skincare routine for humid Indian summers"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
          {inputError && (
            <div className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5" /> {inputError}
            </div>
          )}

          <button
            type="button"
            onClick={fetchSuggestions}
            disabled={!prompt.trim() || suggestion?.loading}
            className="flex items-center gap-1 text-xs font-medium text-primary underline underline-offset-2 disabled:opacity-50"
          >
            <Sparkles className="h-3 w-3" />
            {suggestion?.loading ? "Getting suggestions…" : "Get AI suggestions"}
          </button>

          {suggestion?.error && <p className="text-xs text-destructive">{suggestion.error}</p>}

          {suggestion && !suggestion.loading && suggestion.suggestions.length > 0 && (
            <div className="space-y-1.5 rounded-md bg-violet-50 p-2 text-xs text-violet-900">
              <ul className="list-disc space-y-0.5 pl-4">
                {suggestion.suggestions.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
              {suggestion.enhancedPrompt && suggestion.enhancedPrompt !== prompt && (
                <div className="rounded-md bg-white/70 p-1.5">
                  <p className="italic">&ldquo;{suggestion.enhancedPrompt}&rdquo;</p>
                  <button
                    type="button"
                    className="mt-1 font-medium text-primary underline underline-offset-2"
                    onClick={() => { setPrompt(suggestion.enhancedPrompt!); setSuggestion(null) }}
                  >
                    Use this version
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <GenerationWarning isPending={loading} />
        <button
          onClick={generate}
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 py-3 text-sm font-semibold text-white shadow-md transition hover:from-violet-700 hover:to-indigo-700 disabled:opacity-60"
        >
          {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Writing your post…</> : "✨ Generate blog post"}
        </button>

        {apiError && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-3">
            <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-amber-900 font-medium">{apiError}</p>
              <button onClick={generate} className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-amber-700 hover:text-amber-900">
                🔄 Try again
              </button>
            </div>
          </div>
        )}
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center py-10 gap-3 rounded-xl border bg-card">
          <Loader2 className="h-7 w-7 animate-spin text-violet-500" />
          <p className="text-sm text-muted-foreground">Writing your blog post…</p>
        </div>
      )}

      {post && !loading && (
        <div className="rounded-xl border bg-card p-4 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your blog post</p>
            {post.id && (
              <Link href={`/brands/${brandId}/library?tab=blog_posts`} className="text-xs font-medium text-green-700 underline underline-offset-2 hover:text-green-900">
                Saved to My Content →
              </Link>
            )}
          </div>

          <div className="space-y-2">
            <h4 className="text-base font-bold leading-snug">{post.title}</h4>
            <div className="space-y-3 text-sm leading-relaxed text-foreground whitespace-pre-wrap">
              {post.body}
            </div>
          </div>

          {post.meta_description && (
            <div className="rounded-lg bg-muted/50 p-3 space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">Meta description</p>
              <p className="text-xs text-muted-foreground">{post.meta_description}</p>
            </div>
          )}

          {post.suggested_tags && post.suggested_tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {post.suggested_tags.map((tag) => (
                <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{tag}</span>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
            <StarRating value={rating} onChange={submitRating} disabled={ratingSaving || !post.id} />
            <div className="flex flex-wrap gap-2">
              <button
                onClick={copyPost}
                className="flex items-center gap-1.5 rounded-full border border-input px-4 py-2 text-xs font-medium hover:bg-secondary"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                Copy article
              </button>
              <button
                onClick={generate}
                disabled={loading}
                className="flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-4 py-2 text-xs font-medium text-violet-700 hover:bg-violet-100"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Regenerate
              </button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Paste this into your website&apos;s blog or CMS (Shopify, WordPress, etc.) — direct publishing isn&apos;t available for blog posts on any connected platform today.
          </p>
        </div>
      )}
    </div>
  )
}
