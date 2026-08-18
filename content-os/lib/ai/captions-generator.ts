import type { BrandRow, ProductRow } from "@/types/database"
import type { GeneratedCaption, Platform } from "@/types/app"
import { buildCaptionSystemPrompt, buildCaptionUserPrompt, PLATFORM_CHAR_LIMITS } from "./prompts"
import { MODELS, getGroqClient } from "./models"

const MIN_HASHTAGS = 15
const MAX_HASHTAGS = 20

function parseCaptionJson(raw: string): GeneratedCaption {
  let cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").replace(/[\x00-\x1F\x7F]/g, " ").trim()
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (jsonMatch) cleaned = jsonMatch[0]

  let parsed: GeneratedCaption
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    console.error("[captions-generator] JSON parse failed. Raw:", raw.slice(0, 500))
    throw new Error("AI returned invalid JSON for caption")
  }

  if (!parsed.caption_text) {
    throw new Error("AI response missing caption_text")
  }

  return parsed
}

/** Case-insensitive substring check against only the last 2 non-empty lines — matches the "last 1-2 lines" instruction without demanding byte-exact formatting. */
function endsWithCtaAndHandle(captionText: string, ctaPhrase: string, handle: string): boolean {
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
function validateCaption(parsed: GeneratedCaption, ctaPhrase: string, handle: string, platform: Platform): string[] {
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

  return issues
}

/** Mechanical fixups applied only if a real retry still fails validation — makes the shipped output compliant rather than silently accepting a rule-violating caption, logged loudly so it's never a silent fallback. */
function applyLastResortFixes(parsed: GeneratedCaption, brand: BrandRow, ctaPhrase: string, handle: string, platform: Platform): GeneratedCaption {
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

export async function generateCaption(
  brand: BrandRow,
  options: {
    hookText?: string
    platform: Platform
    contentType: string
    additionalContext?: string
    product?: ProductRow | null
    pastExamples?: string[]
  }
): Promise<{ caption: GeneratedCaption; model: string; usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined }> {
  const groq = getGroqClient()
  const model = MODELS.generation

  const b = brand as BrandRow & { cta_phrase?: string | null }
  const ctaPhrase = b.cta_phrase || "Shop now"
  const handle = brand.instagram_handle ? `@${brand.instagram_handle}` : ""

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [
    { role: "system", content: buildCaptionSystemPrompt(brand.vibe) },
    { role: "user", content: buildCaptionUserPrompt(brand, options) },
  ]

  // GPT-OSS reasoning tokens count against max_tokens. Measured live:
  // this exact caption task at reasoning_effort "medium" burned 1079 of
  // 1239 completion tokens (87%) on hidden reasoning — wildly wasteful
  // for short, punchy copywriting. "low" dropped that to 232/364 (64%,
  // but a much smaller absolute budget) with equally valid output, so
  // that's what's used here. max_tokens raised well past the old
  // Llama-era 400, which now 400s outright ("json_validate_failed") once
  // reasoning tokens are in play at all.
  const requestParams = {
    model,
    temperature: 0.8,
    reasoning_effort: "low" as const,
    max_tokens: 1200,
    response_format: { type: "json_object" as const },
  }

  let response = await groq.chat.completions.create({ ...requestParams, messages })
  let raw = response.choices[0]?.message?.content ?? "{}"
  let parsed = parseCaptionJson(raw)

  let issues = validateCaption(parsed, ctaPhrase, handle, options.platform)

  if (issues.length > 0) {
    console.error(`[captions-generator] validation failed, retrying once: ${issues.join(" ")}`)
    messages.push({ role: "assistant", content: raw })
    messages.push({
      role: "user",
      content: `Your response had the following problems — respond again with the SAME JSON schema, fixing all of them:\n${issues.map((i) => `- ${i}`).join("\n")}`,
    })

    const retryResponse = await groq.chat.completions.create({ ...requestParams, messages })
    const retryRaw = retryResponse.choices[0]?.message?.content ?? "{}"
    const retryParsed = parseCaptionJson(retryRaw)
    const retryIssues = validateCaption(retryParsed, ctaPhrase, handle, options.platform)

    response = retryResponse
    raw = retryRaw
    parsed = retryParsed
    issues = retryIssues

    if (issues.length > 0) {
      // Retry still didn't comply — don't ship a rule-violating caption as
      // a silent success. Fix mechanically instead of failing outright, so
      // a generation credit isn't wasted on nothing — but this is loudly
      // logged, never a quiet fallback.
      console.error(`[captions-generator] retry still failed validation, applying last-resort fixes: ${issues.join(" ")}`)
      parsed = applyLastResortFixes(parsed, brand, ctaPhrase, handle, options.platform)
    }
  }

  parsed.character_count = parsed.caption_text.length

  return { caption: parsed, model, usage: response.usage ?? undefined }
}
