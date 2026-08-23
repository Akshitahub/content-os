import type { BrandRow } from "@/types/database"
import type { GeneratedCaption, Platform } from "@/types/app"
import { PLATFORM_CHAR_LIMITS } from "./prompts"

export const MIN_HASHTAGS = 15
export const MAX_HASHTAGS = 20

// Short list of genuinely common AI-sounding offenders — matches the
// examples named in QUALITY_BAR's own anti-cliché instruction (prompts.ts)
// so the model is told about exactly what gets checked, not a longer
// hidden list it can't see. Deliberately narrow multi-word phrases, not
// single words like "elevate" or "unlock" alone — a substring match on
// just "elevate" would flag "elevate your everyday coffee ritual" (a fine,
// specific sentence) as readily as the generic "elevate your ___"
// template. "elevate your"/"unlock the power of" stay on the list as
// two-word-plus phrases because even filled in with something specific
// (e.g. "elevate your morning routine") they still read as the same
// templated marketing pattern regardless of what follows — that's the
// actual offender the task named, not just the bare word.
export const CLICHE_PHRASES = [
  "in today's fast-paced world",
  "unlock the power of",
  "elevate your",
  "game-changer",
  "game changer",
  "look no further",
  "take it to the next level",
]

/** Case-insensitive substring check against the full caption_text (not just the opener — a cliché mid-caption is just as generic-sounding as one in the hook line). */
export function findClichePhrases(captionText: string): string[] {
  const lower = captionText.toLowerCase()
  return CLICHE_PHRASES.filter((phrase) => lower.includes(phrase))
}

export type CaptionChatMessage = { role: "system" | "user" | "assistant"; content: string }
export type CaptionModelUsage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }

export function parseCaptionJson(raw: string): GeneratedCaption {
  let cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").replace(/[\x00-\x1F\x7F]/g, " ").trim()
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (jsonMatch) cleaned = jsonMatch[0]

  let parsed: GeneratedCaption
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    console.error("[caption-validation] JSON parse failed. Raw:", raw.slice(0, 500))
    throw new Error("AI returned invalid JSON for caption")
  }

  if (!parsed.caption_text) {
    throw new Error("AI response missing caption_text")
  }

  return parsed
}

/** Case-insensitive substring check against only the last 2 non-empty lines — matches the "last 1-2 lines" instruction without demanding byte-exact formatting. */
export function endsWithCtaAndHandle(captionText: string, ctaPhrase: string, handle: string): boolean {
  const lines = captionText.trim().split("\n").map((l) => l.trim()).filter(Boolean)
  const tail = lines.slice(-2).join("\n").toLowerCase()
  const hasCta = tail.includes(ctaPhrase.toLowerCase())
  const hasHandle = !handle || tail.includes(handle.toLowerCase())
  return hasCta && hasHandle
}

/**
 * Checks the model's output against the rules the prompt itself states as
 * mandatory but has no structural enforcement for (see
 * docs/research/captions-generation-audit.md §4) — real production
 * samples violated the hashtag-count and CTA-ending rules 8/8 times
 * despite both being stated multiple times in the prompt. Returns a list
 * of specific, model-facing correction instructions (empty = compliant).
 */
export function validateCaption(parsed: GeneratedCaption, ctaPhrase: string, handle: string, platform: Platform): string[] {
  const issues: string[] = []

  const hashtagCount = Array.isArray(parsed.hashtags) ? parsed.hashtags.length : 0
  if (hashtagCount < MIN_HASHTAGS || hashtagCount > MAX_HASHTAGS) {
    issues.push(`You returned ${hashtagCount} hashtags — exactly ${MIN_HASHTAGS}-${MAX_HASHTAGS} are required (5 niche-specific, 5 brand-specific, 5 broad/trending), in the separate "hashtags" field only.`)
  }

  if (!endsWithCtaAndHandle(parsed.caption_text, ctaPhrase, handle)) {
    const ending = handle ? `${ctaPhrase} 👇\n${handle}` : `${ctaPhrase} 👇`
    issues.push(`Your caption_text must end with: "${ending}" — check the last 1-2 lines, this was missing or didn't match.`)
  }

  const limit = PLATFORM_CHAR_LIMITS[platform]
  if (parsed.caption_text.length > limit) {
    issues.push(`Your caption_text is ${parsed.caption_text.length} characters — it must be under ${limit} characters for ${platform}.`)
  }

  const cliches = findClichePhrases(parsed.caption_text)
  if (cliches.length > 0) {
    issues.push(`Your caption_text contains generic AI-sounding phrase(s): ${cliches.map((c) => `"${c}"`).join(", ")} — rewrite that part in specific, natural language about this brand, not a cliché.`)
  }

  return issues
}

/** Mechanical fixups applied only if a real retry still fails validation — makes the shipped output compliant rather than silently accepting a rule-violating caption, logged loudly so it's never a silent fallback. */
export function applyLastResortFixes(parsed: GeneratedCaption, brand: BrandRow, ctaPhrase: string, handle: string, platform: Platform): GeneratedCaption {
  let captionText = parsed.caption_text
  let hashtags = Array.isArray(parsed.hashtags) ? [...new Set(parsed.hashtags.map((h) => h.replace(/^#/, "")))] : []

  if (!endsWithCtaAndHandle(captionText, ctaPhrase, handle)) {
    const ending = handle ? `${ctaPhrase} 👇\n${handle}` : `${ctaPhrase} 👇`
    captionText = `${captionText.trim()}\n\n${ending}`
  }

  const limit = PLATFORM_CHAR_LIMITS[platform]
  if (captionText.length > limit) {
    captionText = captionText.slice(0, limit).trimEnd()
  }

  if (hashtags.length < MIN_HASHTAGS) {
    const fillers = [
      brand.name.replace(/[^a-zA-Z0-9]/g, ""),
      ...(brand.niche ? brand.niche.split(/[,\s]+/).filter(Boolean).map((w) => w.replace(/[^a-zA-Z0-9]/g, "")) : []),
      "DTC", "ShopIndia", "SmallBusiness", "MadeInIndia", "OnlineShopping", "IndianBrand", "SupportLocal",
    ].filter((f): f is string => !!f && f.length > 1)
    for (const filler of fillers) {
      if (hashtags.length >= MIN_HASHTAGS) break
      if (!hashtags.some((h) => h.toLowerCase() === filler.toLowerCase())) hashtags.push(filler)
    }
  }
  if (hashtags.length > MAX_HASHTAGS) hashtags = hashtags.slice(0, MAX_HASHTAGS)

  return { ...parsed, caption_text: captionText, hashtags }
}

/**
 * The full call → validate → retry-once → mechanical-fix cycle shared by
 * every caption-producing path (lib/ai/captions-generator.ts's
 * generateCaption and lib/ai/content-generator.ts's social_post case) so
 * the hashtag-count/CTA-ending/char-limit enforcement fixed in 6a132d7
 * can't drift between them again — both callers run this exact function,
 * not two independent copies of the retry loop. `callModel` is injected so
 * this stays decoupled from the Groq SDK's message/response types.
 */
export async function generateValidatedCaption(params: {
  messages: CaptionChatMessage[]
  callModel: (messages: CaptionChatMessage[]) => Promise<{ content: string; usage?: CaptionModelUsage }>
  brand: BrandRow
  ctaPhrase: string
  handle: string
  platform: Platform
}): Promise<{ caption: GeneratedCaption; usage?: CaptionModelUsage }> {
  const { messages, callModel, brand, ctaPhrase, handle, platform } = params

  let call = await callModel(messages)
  let parsed = parseCaptionJson(call.content)
  let issues = validateCaption(parsed, ctaPhrase, handle, platform)

  if (issues.length > 0) {
    console.error(`[caption-validation] validation failed, retrying once: ${issues.join(" ")}`)
    const retryMessages: CaptionChatMessage[] = [
      ...messages,
      { role: "assistant", content: call.content },
      {
        role: "user",
        content: `Your response had the following problems — respond again with the SAME JSON schema, fixing all of them:\n${issues.map((i) => `- ${i}`).join("\n")}`,
      },
    ]

    call = await callModel(retryMessages)
    const retryParsed = parseCaptionJson(call.content)
    const retryIssues = validateCaption(retryParsed, ctaPhrase, handle, platform)

    parsed = retryParsed
    issues = retryIssues

    if (issues.length > 0) {
      // Retry still didn't comply — don't ship a rule-violating caption as
      // a silent success. Fix mechanically instead of failing outright, so
      // a generation credit isn't wasted on nothing — but this is loudly
      // logged, never a quiet fallback.
      console.error(`[caption-validation] retry still failed validation, applying last-resort fixes: ${issues.join(" ")}`)
      parsed = applyLastResortFixes(parsed, brand, ctaPhrase, handle, platform)
    }
  }

  parsed.character_count = parsed.caption_text.length

  return { caption: parsed, usage: call.usage }
}
