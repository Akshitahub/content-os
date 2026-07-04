import type { BrandRow } from "@/types/database"
import { buildBrandContext, QUALITY_BAR } from "./prompts"
import { MODELS, getGroqClient } from "./models"
import type { AccountInsightsData, AccountMedia } from "@/lib/social/instagram-insights"

export interface BestPost {
  permalink: string
  caption: string | null
  likeCount: number
  commentsCount: number
  timestamp: string
  engagement: number
}

/**
 * Real math only — ranks the account's own recent media by real
 * like/comment counts. Nothing here is AI-estimated.
 */
export function calculateBestPerformingPosts(media: AccountMedia[], limit: number = 5): BestPost[] {
  return media
    .map((m) => ({
      permalink: m.permalink,
      caption: m.caption,
      likeCount: m.like_count,
      commentsCount: m.comments_count,
      timestamp: m.timestamp,
      engagement: m.like_count + m.comments_count,
    }))
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, limit)
}

/**
 * The one AI-generated part of the dashboard. Every number is passed in
 * already calculated from real Instagram Insights/media data — the model
 * is only asked to observe patterns and explicitly say when it doesn't
 * have enough to support a claim, following the same strict-honesty
 * discipline as lib/ai/competitor-analysis.ts.
 */
export async function generateAccountInsights(
  brand: BrandRow,
  insights: AccountInsightsData,
  bestPosts: BestPost[]
): Promise<{ text: string; model: string; usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined }> {
  const groq = getGroqClient()
  const model = MODELS.generation

  const brandContext = buildBrandContext(brand)

  const reachLine = insights.reach.available
    ? `Reach over the last ${insights.windowDays} days: ${insights.reach.value!.total.toLocaleString()} accounts reached (summed across daily Insights data).`
    : `Reach data: not available (${insights.reach.note}).`

  const followerLine = insights.followerGrowth.available
    ? `Follower change over the last ${insights.windowDays} days: ${insights.followerGrowth.value!.netChange >= 0 ? "+" : ""}${insights.followerGrowth.value!.netChange}.`
    : `Follower growth data: not available (${insights.followerGrowth.note}).`

  const engagementLine = insights.engagement.available
    ? `Total interactions over the last ${insights.windowDays} days: ${insights.engagement.value!.totalInteractions.toLocaleString()}${
        insights.engagement.value!.accountsEngaged !== null ? ` across ${insights.engagement.value!.accountsEngaged.toLocaleString()} engaged accounts` : ""
      }.`
    : `Engagement data: not available (${insights.engagement.note}).`

  const bestPostsLines = bestPosts.length > 0
    ? bestPosts
        .map((p, i) => `${i + 1}. "${(p.caption ?? "(no caption)").trim().slice(0, 300)}" — ${p.likeCount} likes, ${p.commentsCount} comments`)
        .join("\n")
    : "No recent posts with engagement data available."

  const systemPrompt = `You are a social media performance analyst for D2C brands.

STRICT HONESTY RULE — this overrides every other instruction:
- Only make a claim if it is directly grounded in the metrics or captions provided below.
- If a metric says "not available", say plainly that there isn't enough data for that metric — never invent a number or trend to fill the gap.
- Never invent, recalculate, or estimate a number. All numeric values below are already calculated — restate them if relevant, don't guess new ones.
- Do not pad the analysis with generic filler like "engagement is strong" unless a specific number or post supports it.

${QUALITY_BAR}

Respond with two clearly labeled sections in plain text (no markdown headers, no JSON, no bullet symbols other than plain dashes if needed):
INSIGHTS: 2-3 short paragraphs on what the real data shows (or explicitly doesn't).
SUGGESTIONS: 2-4 concrete, specific improvement suggestions grounded in the brand's context and the actual data provided — not generic social media advice.`

  const userPrompt = `${brandContext}

${reachLine}
${followerLine}
${engagementLine}

Best-performing recent posts by engagement (likes + comments):
${bestPostsLines}

Write the INSIGHTS and SUGGESTIONS now, following the strict honesty rule above.`

  const response = await groq.chat.completions.create({
    model,
    temperature: 0.4,
    max_tokens: 700,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  })

  const text = response.choices[0]?.message?.content?.trim() ?? "Analysis unavailable."

  return { text, model, usage: response.usage ?? undefined }
}
