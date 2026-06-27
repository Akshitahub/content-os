import type { FetchedPage } from "@/lib/web/fetch-page"
import { MODELS, getGroqClient } from "./models"

export class ExtractionError extends Error {}

function buildPageContext(page: FetchedPage): string {
  const lines: string[] = [
    `URL: ${page.url}`,
    `Page title: ${page.title || page.ogTitle || "(none found)"}`,
  ]
  if (page.metaDescription || page.ogDescription) {
    lines.push(`Meta description: ${page.metaDescription || page.ogDescription}`)
  }
  if (page.jsonLd.length) {
    lines.push(`Structured data found on page (JSON-LD): ${JSON.stringify(page.jsonLd).slice(0, 2000)}`)
  }
  lines.push(`Visible page text:\n${page.text}`)
  return lines.join("\n\n")
}

// ---------------- Brand extraction ----------------

export interface ExtractedBrandData {
  name: string
  description: string
  niche: string
  target_audience: string
  tone_of_voice: string
  brand_values: string[]
  instagram_handle: string
}

export async function extractBrandFromPage(page: FetchedPage): Promise<ExtractedBrandData> {
  let groq
  try {
    groq = getGroqClient()
  } catch {
    throw new ExtractionError("GROQ_API_KEY is not configured on the server.")
  }

  const response = await groq.chat.completions.create({
    model: MODELS.extraction,
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content: `You read a brand's website (usually a homepage or "about" page) and extract a structured brand profile for use in an AI content-generation tool. Infer sensibly from tone and content even if a field isn't stated outright — but don't invent specific facts (like an Instagram handle) that aren't actually present on the page. If something genuinely can't be determined, return an empty string or empty array for it.

Respond with this exact JSON shape:
{
  "name": "the brand's name",
  "description": "one-sentence description of what the brand does/sells",
  "niche": "the industry/category, e.g. 'Handmade gemstone jewellery'",
  "target_audience": "who the brand seems to be targeting, e.g. 'Women 22-35 into mindful living'",
  "tone_of_voice": "2-4 adjectives describing the brand's writing tone, e.g. 'Warm, grounded, a little poetic'",
  "brand_values": ["up to 5 short value words/phrases evident from the copy, e.g. 'Handmade', 'Sustainability'"],
  "instagram_handle": "the handle without @ if visibly present on the page, else empty string"
}`,
      },
      { role: "user", content: buildPageContext(page) },
    ],
  })

  const raw = response.choices[0]?.message?.content ?? "{}"
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").replace(/[\x00-\x1F\x7F]/g, " ").trim()
  let parsed: Partial<ExtractedBrandData>
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    console.error("[url-extractor/brand] JSON parse failed. Raw:", raw.slice(0, 500))
    throw new ExtractionError("Couldn't parse brand details from that page.")
  }

  return {
    name: parsed.name ?? "",
    description: parsed.description ?? "",
    niche: parsed.niche ?? "",
    target_audience: parsed.target_audience ?? "",
    tone_of_voice: parsed.tone_of_voice ?? "",
    brand_values: Array.isArray(parsed.brand_values) ? parsed.brand_values.slice(0, 10) : [],
    instagram_handle: (parsed.instagram_handle ?? "").replace(/^@/, ""),
  }
}

// ---------------- Product extraction ----------------

export interface ExtractedProductData {
  name: string
  description: string
  price: number | null
  category: string
  target_customer: string
  ingredients: string
  key_benefits: string[]
  image_urls: string[]
}

export async function extractProductFromPage(page: FetchedPage): Promise<ExtractedProductData> {
  let groq
  try {
    groq = getGroqClient()
  } catch {
    throw new ExtractionError("GROQ_API_KEY is not configured on the server.")
  }

  const response = await groq.chat.completions.create({
    model: MODELS.extraction,
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content: `You read a single product page (often from a Shopify or D2C store) and extract structured product details for an AI content-generation tool. Prefer JSON-LD structured data for price if present — it's the most reliable source. Don't invent facts not present on the page; use an empty string/array/null if something isn't there.

Respond with this exact JSON shape:
{
  "name": "the product's name",
  "description": "1-2 sentence description of what it is / does",
  "price": 999.00 or null if not found,
  "category": "short category, e.g. 'Skincare' or 'Jewellery'",
  "target_customer": "who this product seems to be for, if inferable, else empty string",
  "ingredients": "ingredients or materials list as a short comma-separated string, else empty string",
  "key_benefits": ["up to 6 short benefit phrases evident from the copy"],
  "image_urls": ["product image URLs found on the page, prefer og:image and JSON-LD image fields"]
}`,
      },
      { role: "user", content: buildPageContext(page) },
    ],
  })

  const raw = response.choices[0]?.message?.content ?? "{}"
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").replace(/[\x00-\x1F\x7F]/g, " ").trim()
  let parsed: Partial<ExtractedProductData>
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    console.error("[url-extractor/product] JSON parse failed. Raw:", raw.slice(0, 500))
    throw new ExtractionError("Couldn't parse product details from that page.")
  }

  return {
    name: parsed.name ?? "",
    description: parsed.description ?? "",
    price: typeof parsed.price === "number" ? parsed.price : null,
    category: parsed.category ?? "",
    target_customer: parsed.target_customer ?? "",
    ingredients: parsed.ingredients ?? "",
    key_benefits: Array.isArray(parsed.key_benefits) ? parsed.key_benefits.slice(0, 10) : [],
    image_urls: Array.isArray(parsed.image_urls)
      ? parsed.image_urls.filter((u): u is string => typeof u === "string").slice(0, 10)
      : page.ogImages.slice(0, 5),
  }
}
