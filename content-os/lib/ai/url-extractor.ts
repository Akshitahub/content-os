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

// ---------------- Image extraction ----------------

export interface FetchedImage {
  url: string
  alt: string
  type: "product" | "lifestyle" | "logo" | "banner" | "other"
}

function classifyImage(src: string, alt: string): FetchedImage["type"] {
  const s = src.toLowerCase()
  const a = alt.toLowerCase()
  if (s.includes("logo") || a.includes("logo")) return "logo"
  if (s.includes("banner") || s.includes("hero")) return "banner"
  if (s.includes("product") || a.includes("product")) return "product"
  if (s.includes("lifestyle") || s.includes("model") || a.includes("lifestyle")) return "lifestyle"
  return "other"
}

export function extractImagesFromPage(pageUrl: string, pageHtml: string): FetchedImage[] {
  const images: FetchedImage[] = []
  const seen = new Set<string>()

  const ogImageMatch = pageHtml.match(/property="og:image"\s+content="([^"]+)"/)
  if (ogImageMatch?.[1]) {
    const url = ogImageMatch[1]
    if (!seen.has(url)) {
      seen.add(url)
      images.push({ url, alt: "Featured image", type: "lifestyle" })
    }
  }

  const imgRegex = /<img[^>]+src="([^"]+)"[^>]*(?:alt="([^"]*)")?[^>]*>/gi
  let match
  while ((match = imgRegex.exec(pageHtml)) !== null) {
    const src = match[1] ?? ""
    const alt = match[2] ?? ""
    if (!src || src.includes(".svg") || src.includes(".gif")) continue
    if (src.includes("pixel") || src.includes("tracking") || src.length < 10) continue
    try {
      const absoluteUrl = src.startsWith("http") ? src : new URL(src, pageUrl).toString()
      if (!seen.has(absoluteUrl)) {
        seen.add(absoluteUrl)
        images.push({ url: absoluteUrl, alt, type: classifyImage(src, alt) })
      }
    } catch {
      // skip malformed URLs
    }
    if (images.length >= 20) break
  }

  return images
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
  primary_color: string
  cta_phrase: string
  logo_url: string
  brand_personality: string
  content_pillars: string[]
  target_emotion: string
  vibe: string
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
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You read a brand's website (usually a homepage or "about" page) and extract a structured brand profile for use in an AI content-generation tool. Infer sensibly from tone and content even if a field isn't stated outright — but don't invent specific facts that aren't present on the page. If something genuinely can't be determined, return an empty string or empty array for it. Respond with ONLY the JSON object below — no preamble, no explanation, no markdown code fences.
{
  "name": "the brand's name",
  "description": "one-sentence description of what the brand does/sells",
  "niche": "the industry/category, e.g. 'Handmade gemstone jewellery'",
  "target_audience": "who the brand seems to be targeting, e.g. 'Women 22-35 into mindful living'",
  "tone_of_voice": "2-4 adjectives describing the brand's writing tone, e.g. 'Warm, grounded, a little poetic'",
  "brand_values": ["up to 5 short value words/phrases evident from the copy, e.g. 'Handmade', 'Sustainability'"],
  "instagram_handle": "handle without @ if visibly present on the page, else empty string",
  "primary_color": "dominant brand hex color if visible in the page design (e.g. '#FF5733'), else empty string",
  "cta_phrase": "the brand's call-to-action phrase visible on the page, e.g. 'Shop now', 'DM to order', 'Link in bio' — default to 'Shop now' if unclear",
  "logo_url": "absolute URL of the brand logo image if found on the page, else empty string",
  "brand_personality": "3 words describing the brand personality, e.g. 'Bold, fun, youthful'",
  "content_pillars": ["3-5 main topics this brand would post about based on their niche, e.g. 'Product features', 'Customer stories', 'Behind the scenes'"],
  "target_emotion": "the primary emotion this brand evokes in customers, e.g. 'Empowered', 'Joyful', 'Confident'",
  "vibe": "one of: fun_playful | clean_minimal | bold_dramatic | warm_cozy | professional | trendy_genz — which best matches this brand's visual and content style"
}`,
      },
      { role: "user", content: buildPageContext(page) },
    ],
  })

  const raw = response.choices[0]?.message?.content ?? "{}"
  let cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").replace(/[\x00-\x1F\x7F]/g, " ").trim()
  if (!cleaned.startsWith("{")) {
    const start = cleaned.indexOf("{")
    const end = cleaned.lastIndexOf("}")
    if (start !== -1 && end !== -1 && end > start) {
      cleaned = cleaned.slice(start, end + 1)
    }
  }
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
    primary_color: parsed.primary_color ?? "",
    cta_phrase: parsed.cta_phrase ?? "Shop now",
    logo_url: parsed.logo_url ?? "",
    brand_personality: parsed.brand_personality ?? "",
    content_pillars: Array.isArray(parsed.content_pillars) ? parsed.content_pillars.slice(0, 5) : [],
    target_emotion: parsed.target_emotion ?? "",
    vibe: parsed.vibe ?? "fun_playful",
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
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You read a single product page (often from a Shopify or D2C store) and extract structured product details for an AI content-generation tool. Prefer JSON-LD structured data for price if present — it's the most reliable source. Don't invent facts not present on the page; use an empty string/array/null if something isn't there. Respond with ONLY the JSON object below — no preamble, no explanation, no markdown code fences.
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
  let cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").replace(/[\x00-\x1F\x7F]/g, " ").trim()
  if (!cleaned.startsWith("{")) {
    const start = cleaned.indexOf("{")
    const end = cleaned.lastIndexOf("}")
    if (start !== -1 && end !== -1 && end > start) {
      cleaned = cleaned.slice(start, end + 1)
    }
  }
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
