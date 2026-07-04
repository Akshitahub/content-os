import type { BrandRow } from "@/types/database"
import { buildBrandContext, QUALITY_BAR } from "./prompts"
import { MODELS, getGroqClient } from "./models"
import type { BusinessDiscoveryData } from "@/lib/social/instagram-business-discovery"

const MS_PER_DAY = 1000 * 60 * 60 * 24

export interface AccountMetrics {
  handle: string
  followersCount: number
  mediaCount: number
  sampledPostCount: number
  /** null means there wasn't enough post history to calculate a real rate */
  postsPerWeek: number | null
  /** fraction of followers (e.g. 0.023 = 2.3%); null if it can't be calculated */
  avgEngagementRate: number | null
}

export interface ViralPost {
  permalink: string
  caption: string | null
  likeCount: number
  commentsCount: number
  timestamp: string
  engagement: number
  multipleOfAverage: number
}

export interface CompetitorMetrics extends AccountMetrics {
  viralPosts: ViralPost[]
}

/**
 * Real math only — posting frequency, engagement rate, and viral-post
 * detection are all calculated directly from the media timestamps/likes/
 * comments Business Discovery returns. Nothing here is AI-estimated.
 */
export function calculateAccountMetrics(data: BusinessDiscoveryData): AccountMetrics {
  const posts = data.media
  const followersCount = data.followers_count

  let postsPerWeek: number | null = null
  if (posts.length >= 2) {
    const timestamps = posts
      .map((p) => new Date(p.timestamp).getTime())
      .filter((t) => !Number.isNaN(t))
      .sort((a, b) => a - b)
    if (timestamps.length >= 2) {
      const spanDays = (timestamps[timestamps.length - 1]! - timestamps[0]!) / MS_PER_DAY
      if (spanDays > 0) {
        postsPerWeek = Math.round(((posts.length - 1) / (spanDays / 7)) * 10) / 10
      }
    }
  }

  let avgEngagementRate: number | null = null
  if (followersCount > 0 && posts.length > 0) {
    const rates = posts.map((p) => (p.like_count + p.comments_count) / followersCount)
    avgEngagementRate = rates.reduce((a, b) => a + b, 0) / rates.length
  }

  return {
    handle: data.username,
    followersCount,
    mediaCount: data.media_count,
    sampledPostCount: posts.length,
    postsPerWeek,
    avgEngagementRate,
  }
}

export function calculateCompetitorMetrics(data: BusinessDiscoveryData): CompetitorMetrics {
  const base = calculateAccountMetrics(data)
  const posts = data.media

  const viralPosts: ViralPost[] = []
  if (posts.length >= 2) {
    const engagements = posts.map((p) => p.like_count + p.comments_count)
    const avgEngagement = engagements.reduce((a, b) => a + b, 0) / engagements.length
    if (avgEngagement > 0) {
      posts.forEach((p, i) => {
        const engagement = engagements[i]!
        if (engagement > avgEngagement * 2) {
          viralPosts.push({
            permalink: p.permalink,
            caption: p.caption,
            likeCount: p.like_count,
            commentsCount: p.comments_count,
            timestamp: p.timestamp,
            engagement,
            multipleOfAverage: Math.round((engagement / avgEngagement) * 10) / 10,
          })
        }
      })
    }
  }
  viralPosts.sort((a, b) => b.engagement - a.engagement)

  return { ...base, viralPosts }
}

/**
 * The one AI-generated part of the analysis. Everything numeric is passed
 * in already calculated — the model is only asked to observe patterns in
 * the actual caption text and explicitly say when it doesn't have enough
 * to support a claim, rather than fill the gap with generic filler.
 */
export async function generateCompetitorInsights(
  brand: BrandRow,
  competitorData: BusinessDiscoveryData,
  competitorMetrics: CompetitorMetrics,
  ownMetrics: AccountMetrics | null
): Promise<{ analysis: string; model: string; usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined }> {
  const groq = getGroqClient()
  const model = MODELS.generation

  const brandContext = buildBrandContext(brand)

  const captionedPosts = competitorData.media.filter((m) => m.caption && m.caption.trim().length > 0)
  const captionSample = captionedPosts
    .slice(0, 15)
    .map((m, i) => `${i + 1}. "${m.caption!.trim().slice(0, 400)}" (${m.like_count} likes, ${m.comments_count} comments)`)
    .join("\n")

  const ownDataLine = ownMetrics
    ? `Your brand's own Instagram (@${ownMetrics.handle}): ${ownMetrics.followersCount} followers, ${ownMetrics.sampledPostCount} recent posts sampled, ` +
      `${ownMetrics.postsPerWeek !== null ? `${ownMetrics.postsPerWeek} posts/week` : "not enough post history to calculate a posting cadence"}, ` +
      `${ownMetrics.avgEngagementRate !== null ? `${(ownMetrics.avgEngagementRate * 100).toFixed(2)}% avg engagement rate` : "not enough data to calculate an engagement rate"}.`
    : `No data is available yet for your brand's own Instagram performance (not connected, or too little post history). Do NOT invent or estimate a comparison to the brand's own performance — say plainly that there's nothing to compare against yet.`

  const systemPrompt = `You are a social media competitive analyst for D2C brands.

STRICT HONESTY RULE — this overrides every other instruction:
- Only make a claim if it is directly grounded in the caption text or metrics provided below.
- If there isn't enough data to support a specific claim (too few captions, no baseline data for the brand, thin engagement numbers), say so explicitly and plainly — e.g. "Not enough data to determine X" — instead of writing a generic-sounding but ungrounded observation.
- Never invent, recalculate, or estimate a number. All numeric claims (posting frequency, engagement rate, viral posts) are already calculated for you — restate them if relevant, don't guess new ones.
- Do not pad the analysis with filler like "they post great content" or "their engagement is strong" unless you point at the specific caption(s) or number that supports it.

${QUALITY_BAR}

Respond with 3-5 short paragraphs of plain text (no markdown headers, no JSON, no bullet lists) covering: content patterns you can actually observe in the captions provided, and a content gap — something the competitor does that this brand's context suggests it currently doesn't do.`

  const userPrompt = `${brandContext}

COMPETITOR: @${competitorMetrics.handle}
Followers: ${competitorMetrics.followersCount}
Posting frequency: ${competitorMetrics.postsPerWeek !== null ? `${competitorMetrics.postsPerWeek} posts/week (calculated from ${competitorMetrics.sampledPostCount} sampled posts)` : "not enough sampled posts to calculate"}
Average engagement rate: ${competitorMetrics.avgEngagementRate !== null ? `${(competitorMetrics.avgEngagementRate * 100).toFixed(2)}%` : "not enough data to calculate"}
Flagged viral posts (2x+ their own average engagement): ${competitorMetrics.viralPosts.length}

Recent captions sampled (${captionedPosts.length} of ${competitorMetrics.sampledPostCount} posts had caption text):
${captionSample || "No caption text available in the sampled posts — do not describe their content style, say there isn't enough caption data."}

${ownDataLine}

Write the competitive content/gap analysis now, following the strict honesty rule above.`

  const response = await groq.chat.completions.create({
    model,
    temperature: 0.4,
    max_tokens: 700,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  })

  const analysis = response.choices[0]?.message?.content?.trim() ?? "Analysis unavailable."

  return { analysis, model, usage: response.usage ?? undefined }
}
