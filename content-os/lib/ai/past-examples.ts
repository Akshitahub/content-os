import type { ContentFormat } from "@/types/app"

function extractCarouselSummary(slides: unknown): string | null {
  if (!Array.isArray(slides)) return null
  const headlines = slides
    .map((s) => (s && typeof s === "object" && "headline" in s ? String((s as { headline: unknown }).headline) : null))
    .filter((h): h is string => !!h)
  return headlines.length > 0 ? headlines.join(" / ") : null
}

function extractStorySummary(stories: unknown): string | null {
  if (!Array.isArray(stories)) return null
  const texts = stories
    .map((s) => (s && typeof s === "object" && "text" in s ? String((s as { text: unknown }).text) : null))
    .filter((t): t is string => !!t)
  return texts.length > 0 ? texts.join(" / ") : null
}

/**
 * Feeds the brand's own past highly-rated content of this same format back
 * as few-shot examples. Non-fatal on failure and returns [] when nothing
 * qualifies — never fabricates a style pattern for a brand with no history.
 * Shared by every route that calls generateContent/generateValidatedCaption
 * so this fetch — and its DB schema per format — can't drift between them;
 * previously only app/api/v1/ai/content/generate/route.ts had this, leaving
 * app/api/v1/ai/fullpost/generate/route.ts (the Create → Full Post flow)
 * with no brand-voice grounding from past examples at all.
 */
export async function fetchPastExamples(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  brandId: string,
  format: ContentFormat
): Promise<string[]> {
  try {
    if (format === "social_post") {
      const { data } = await supabase.from("captions")
        .select("caption_text")
        .eq("brand_id", brandId)
        .gte("user_rating", 4)
        .order("user_rating", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(5) as { data: { caption_text: string }[] | null }
      return (data ?? []).map((c: { caption_text: string }) => c.caption_text)
    }

    if (format === "reel_script") {
      const { data } = await supabase.from("reel_scripts")
        .select("hook, caption")
        .eq("brand_id", brandId)
        .gte("user_rating", 4)
        .order("user_rating", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(5) as { data: { hook: string; caption: string | null }[] | null }
      return (data ?? []).map((r: { hook: string; caption: string | null }) =>
        r.caption ? `Hook: ${r.hook}\nCaption: ${r.caption}` : `Hook: ${r.hook}`
      )
    }

    if (format === "carousel") {
      const { data } = await supabase.from("carousels")
        .select("slides")
        .eq("brand_id", brandId)
        .gte("user_rating", 4)
        .order("user_rating", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(5) as { data: { slides: unknown }[] | null }
      return (data ?? [])
        .map((c: { slides: unknown }) => extractCarouselSummary(c.slides))
        .filter((s: string | null): s is string => !!s)
    }

    if (format === "ad_copy") {
      const { data } = await supabase.from("ad_copies")
        .select("headline, primary_text")
        .eq("brand_id", brandId)
        .gte("user_rating", 4)
        .order("user_rating", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(5) as { data: { headline: string; primary_text: string }[] | null }
      return (data ?? []).map((a: { headline: string; primary_text: string }) => `${a.headline} — ${a.primary_text}`)
    }

    if (format === "story") {
      const { data } = await supabase.from("stories")
        .select("stories")
        .eq("brand_id", brandId)
        .gte("user_rating", 4)
        .order("user_rating", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(5) as { data: { stories: unknown }[] | null }
      return (data ?? [])
        .map((s: { stories: unknown }) => extractStorySummary(s.stories))
        .filter((s: string | null): s is string => !!s)
    }

    return []
  } catch (err) {
    console.error("[past-examples] fetchPastExamples failed (non-fatal):", err)
    return []
  }
}
