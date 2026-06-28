"use client"

import { useState, useRef } from "react"
import { Loader2, Copy, Check, RefreshCw, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { RepurposedContent } from "@/app/api/v1/ai/repurpose/route"

interface Props {
  brandId: string
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {}
      }}
      className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}

function Section({ title, badge, children }: { title: string; badge: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-semibold text-violet-700">{badge}</span>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function TextCard({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border bg-card px-3 py-2.5">
      <p className="flex-1 text-sm leading-relaxed">{text}</p>
      <CopyButton text={text} />
    </div>
  )
}

export function ContentRepurposer({ brandId }: Props) {
  const [content, setContent] = useState("")
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<RepurposedContent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  async function handleRepurpose() {
    if (!content.trim() || content.length < 20) return
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch("/api/v1/ai/repurpose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, content: content.trim() }),
      })
      const json = await res.json() as { data?: RepurposedContent; error?: { message: string } }
      if (!res.ok || !json.data) {
        throw new Error(json.error?.message ?? "Repurpose failed. Please try again.")
      }
      setResult(json.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Input */}
      <div className="rounded-xl border bg-card p-5">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-500" />
          <h2 className="text-base font-semibold">Content Repurposer</h2>
          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">AI</span>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          Paste any content — a blog post, caption, video transcript, or idea — and AI will turn it into hooks, carousels, reels, tweets, and a LinkedIn post.
        </p>
        <textarea
          ref={textareaRef}
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="Paste your content here (min 20 characters)..."
          className="w-full resize-none rounded-lg border bg-background px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-violet-500/30"
          rows={6}
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{content.length}/5000 characters</span>
          <Button
            onClick={handleRepurpose}
            disabled={loading || content.trim().length < 20}
            className="gap-2"
          >
            {loading ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Repurposing…</>
            ) : (
              <><RefreshCw className="h-4 w-4" /> Repurpose content</>
            )}
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-8 rounded-xl border bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Repurposed content</h2>
            <button
              type="button"
              onClick={handleRepurpose}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw className="h-3 w-3" />
              Regenerate
            </button>
          </div>

          {/* Hooks */}
          <Section title="Scroll-stopping hooks" badge="5 hooks">
            {result.hooks.map((hook, i) => (
              <TextCard key={i} text={hook} />
            ))}
          </Section>

          {/* Tweets */}
          <Section title="Tweets / X posts" badge="5 tweets">
            {result.tweets.map((tweet, i) => (
              <TextCard key={i} text={tweet} />
            ))}
          </Section>

          {/* Carousel ideas */}
          <Section title="Carousel ideas" badge="3 carousels">
            {result.carousel_ideas.map((carousel, i) => (
              <div key={i} className="rounded-lg border bg-background p-3">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold">{carousel.title}</p>
                  <CopyButton text={`${carousel.title}\n${carousel.slides.map((s, si) => `Slide ${si + 1}: ${s}`).join("\n")}`} />
                </div>
                <ol className="space-y-1">
                  {carousel.slides.map((slide, si) => (
                    <li key={si} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[10px] font-bold text-violet-700">{si + 1}</span>
                      {slide}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </Section>

          {/* Reel scripts */}
          <Section title="Reel scripts" badge="2 reels">
            {result.reel_scripts.map((reel, i) => (
              <div key={i} className="rounded-lg border bg-background p-3">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-violet-700">&ldquo;{reel.hook}&rdquo;</p>
                  <CopyButton text={`Hook: ${reel.hook}\n${reel.scenes.map((s, si) => `Scene ${si + 1}: ${s}`).join("\n")}`} />
                </div>
                <ol className="space-y-1">
                  {reel.scenes.map((scene, si) => (
                    <li key={si} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-bold text-indigo-700">{si + 1}</span>
                      {scene}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </Section>

          {/* LinkedIn */}
          <Section title="LinkedIn post" badge="1 post">
            <div className="flex items-start gap-2 rounded-lg border bg-background px-3 py-3">
              <p className="flex-1 whitespace-pre-wrap text-sm leading-relaxed">{result.linkedin}</p>
              <CopyButton text={result.linkedin} />
            </div>
          </Section>
        </div>
      )}
    </div>
  )
}
