import { MODELS, getGroqClient } from "./models"
import { getCompetitorSnapshot, type BusinessDiscoveryData } from "@/lib/social/instagram-business-discovery"
import type { BrandRow } from "@/types/database"

const DELAY_BETWEEN_LOOKUPS_MS = 300
const MAX_CANDIDATE_NAMES_FROM_FIELD = 8
const MAX_HANDLE_GUESSES_PER_NAME = 4

export type CompetitorSource = "brand_field" | "ai_guess"

export interface VerifiedCompetitor {
  candidateName: string
  handle: string
  source: CompetitorSource
  data: BusinessDiscoveryData
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function sanitizeJsonString(raw: string): string {
  return raw
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .trim()
}

/**
 * Best-effort Instagram handle guesses for a brand name — strip
 * spaces/punctuation, try common patterns (lowercase-no-spaces,
 * brandname_official, etc). Not guaranteed; each guess gets verified
 * separately via Business Discovery before ever being shown to the user.
 */
function guessHandlesForName(name: string): string[] {
  const stripped = name.trim().replace(/^@/, "")
  const cleaned = stripped.toLowerCase()
  const noSpaces = cleaned.replace(/[^a-z0-9]+/g, "")

  const variants: string[] = []
  // Already handle-shaped (e.g. the competitors field holds a handle, not a
  // name) — try it verbatim first since that's the most likely match.
  if (/^[a-z0-9._]+$/i.test(stripped) && !stripped.includes(" ")) {
    variants.push(cleaned)
  }
  if (noSpaces) {
    variants.push(noSpaces, `${noSpaces}official`, `${noSpaces}_official`, `the${noSpaces}`)
  }

  return Array.from(new Set(variants)).filter(Boolean).slice(0, MAX_HANDLE_GUESSES_PER_NAME)
}

/**
 * Suggests real competitor brand names using Groq's knowledge of the
 * brand's niche/audience/tone. This is a LOWER-CONFIDENCE fallback used
 * only when brands.competitors is empty or doesn't yield enough verified
 * accounts — callers must label results sourced from here as AI-guessed,
 * not verified-from-your-data.
 */
export async function suggestCompetitorNamesWithAI(brand: BrandRow, count: number = 5): Promise<string[]> {
  const groq = getGroqClient()
  const niche = brand.niche ?? "D2C consumer brand"
  const audience = brand.target_audience ?? "general consumers"
  const tone = brand.tone_of_voice ?? "conversational"

  try {
    const res = await groq.chat.completions.create({
      model: MODELS.extraction,
      temperature: 0.7,
      max_tokens: 400,
      messages: [
        {
          role: "system",
          content: "You are a competitive intelligence analyst for D2C brands. Respond with valid JSON only. No markdown.",
        },
        {
          role: "user",
          content: `For a brand in the "${niche}" niche, targeting "${audience}", with a "${tone}" tone, suggest ${count} REAL, currently operating companies/brands that are direct competitors and are known to have an active Instagram presence.

Requirements:
- Real, actual brands — never invent a name
- Prefer well-known brands with a genuine Instagram Business/Creator account
- Give the brand name as commonly known (not a handle guess)

Return ONLY a JSON array of brand name strings: ["Brand One", "Brand Two", ...]`,
        },
      ],
    })

    const raw = res.choices[0]?.message?.content ?? "[]"
    const parsed = JSON.parse(sanitizeJsonString(raw)) as unknown
    if (Array.isArray(parsed)) {
      return parsed.filter((n): n is string => typeof n === "string" && n.trim().length > 0).slice(0, count)
    }
  } catch (err) {
    console.error("[competitor-discovery] AI name suggestion failed:", err instanceof Error ? err.message : err)
  }
  return []
}

/**
 * Tries each handle guess for a candidate name in turn, keeping the first
 * one that verifies as a real, public Instagram Business/Creator account.
 * Failed guesses are discarded silently — a wrong guess is an internal
 * implementation detail, never shown to the user as an error.
 */
async function resolveAndVerify(
  candidateName: string,
  source: CompetitorSource,
  igBusinessAccountId: string,
  accessToken: string
): Promise<VerifiedCompetitor | null> {
  const guesses = guessHandlesForName(candidateName)

  for (const handle of guesses) {
    const snapshot = await getCompetitorSnapshot(igBusinessAccountId, accessToken, handle)
    await sleep(DELAY_BETWEEN_LOOKUPS_MS)
    if (snapshot.success) {
      return { candidateName, handle: snapshot.data.username, source, data: snapshot.data }
    }
  }
  return null
}

/**
 * Full auto-discover flow: prefer the brand's own competitors field
 * (higher confidence — names the user actually entered), falling back to
 * AI-guessed competitor names only if that field is empty or doesn't
 * yield enough verified accounts. Every entry returned here has already
 * been confirmed as a real, public Instagram Business/Creator account —
 * nothing unverified is ever returned.
 */
export async function discoverAndVerifyCompetitors(
  brand: BrandRow,
  igBusinessAccountId: string,
  accessToken: string,
  maxResults: number = 5
): Promise<VerifiedCompetitor[]> {
  const verified: VerifiedCompetitor[] = []
  const triedNames = new Set<string>()

  const fieldCandidates = (brand.competitors ?? [])
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, MAX_CANDIDATE_NAMES_FROM_FIELD)

  for (const name of fieldCandidates) {
    if (verified.length >= maxResults) break
    if (triedNames.has(name.toLowerCase())) continue
    triedNames.add(name.toLowerCase())

    const result = await resolveAndVerify(name, "brand_field", igBusinessAccountId, accessToken)
    if (result) verified.push(result)
  }

  if (verified.length < maxResults) {
    const needed = maxResults - verified.length
    // Ask for a few extra since not every AI-guessed name/handle will verify.
    const aiNames = await suggestCompetitorNamesWithAI(brand, Math.max(needed + 2, 5))

    for (const name of aiNames) {
      if (verified.length >= maxResults) break
      if (triedNames.has(name.toLowerCase())) continue
      triedNames.add(name.toLowerCase())

      const result = await resolveAndVerify(name, "ai_guess", igBusinessAccountId, accessToken)
      if (result) verified.push(result)
    }
  }

  return verified
}
