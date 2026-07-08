export interface RatedItem {
  text: string
  rating: number
}

const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "your", "this", "that", "with", "from",
  "have", "has", "our", "was", "were", "will", "just", "into", "out", "about", "get", "got",
  "its", "it's", "can", "all", "more", "than", "them", "they", "their", "what", "when",
  "where", "which", "who", "why", "how", "here", "there", "some", "then", "now",
])

function extractKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w))
  )
}

function jaccardOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const word of a) if (b.has(word)) intersection++
  const union = a.size + b.size - intersection
  return union > 0 ? intersection / union : 0
}

/**
 * A rough, honest keyword-overlap comparison against the brand's own rating
 * history — a pattern-match observation, not a scored prediction or an
 * engagement guarantee. Returns null when there isn't enough rating history
 * (fewer than 3 rated items) to say anything meaningful.
 */
export function buildPatternNote(newText: string, rated: RatedItem[]): string | null {
  if (rated.length < 3) return null

  const newKeywords = extractKeywords(newText)
  if (newKeywords.size === 0) return null

  const highlyRated = rated.filter((r) => r.rating >= 4)
  let bestOverlap = 0
  for (const item of highlyRated) {
    const overlap = jaccardOverlap(newKeywords, extractKeywords(item.text))
    if (overlap > bestOverlap) bestOverlap = overlap
  }

  if (highlyRated.length > 0 && bestOverlap >= 0.15) {
    return "This caption's tone is similar to captions you've rated highly before."
  }
  return "You haven't tried this angle before for this brand."
}
