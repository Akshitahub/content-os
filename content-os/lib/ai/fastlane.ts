import OpenAI from "openai"
import { MODELS, NVIDIA_BASE_URL, getApiKey } from "./models"
import type { BrandRow, ProductRow } from "@/types/database"
import type { ContentStrategy, ContentSlot, FastlaneResult, Platform } from "@/types/app"
import type { SupabaseClient } from "@supabase/supabase-js"

function sanitizeJsonString(raw: string): string {
  return raw
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .trim()
}

function buildStrategySystemPrompt(): string {
  return `You are a senior content strategist specializing in Indian D2C brands.
You create 30-day content calendars that drive engagement, build brand equity, and convert followers to buyers.
Consider platform-specific best practices, posting cadence, content variety, and seasonal relevance.
Always respond with valid JSON only. No markdown, no explanation outside the JSON.`
}

function buildStrategyUserPrompt(brand: BrandRow, products: ProductRow[]): string {
  const productNames = products.map(p => p.name).join(", ")
  return `Create a 30-day content strategy for this brand.

Brand: ${brand.name}
Niche: ${brand.niche ?? "General"}
Audience: ${brand.target_audience ?? "General audience"}
Tone: ${brand.tone_of_voice ?? "Conversational"}
${productNames ? `Products: ${productNames}` : ""}

Return ONLY this JSON (no markdown, no explanation):
{
  "strategy_summary": "2-3 sentences on the strategy",
  "slots": [
    { "day": 1, "platform": "instagram", "content_type": "hooks", "theme": "Brand intro", "product_focus": null, "priority": "high" }
  ]
}

Rules:
- Exactly 30 slots, days 1-30
- content_type: "hooks" | "caption" | "reel_script" | "carousel" | "ad_copy"
- platform: "instagram" | "tiktok" | "youtube" | "facebook" | "linkedin" | "twitter"
- priority: "high" | "medium" | "low"
- product_focus: product name string or null
- Vary content types and platforms across 30 days`
}

function buildSlotContentPrompt(brand: BrandRow, slot: ContentSlot, product: ProductRow | null): string {
  const productCtx = product ? ` Product: ${product.name}.` : ""
  return `Write a ${slot.content_type} for ${brand.name} (${brand.niche ?? "D2C brand"}) for ${slot.platform} about: ${slot.theme}.${productCtx}

JSON format:
{"title": "short title", "content": "the actual content text", "notes": "one tip"}`
}

export async function generateContentStrategy(brand: BrandRow, products: ProductRow[]): Promise<ContentStrategy> {
  const openai = new OpenAI({ apiKey: getApiKey(), baseURL: NVIDIA_BASE_URL })
  const res = await openai.chat.completions.create({
    model: MODELS.generation,
    temperature: 0.7,
    max_tokens: 8000,
    messages: [
      { role: "system", content: buildStrategySystemPrompt() },
      { role: "user", content: buildStrategyUserPrompt(brand, products) },
    ],
  })

  const raw = res.choices[0]?.message?.content ?? "{}"
  const cleaned = sanitizeJsonString(raw)
  let parsed: ContentStrategy
  try {
    parsed = JSON.parse(cleaned) as ContentStrategy
  } catch {
    console.error("[fastlane] JSON parse failed. Raw:", raw.slice(0, 500))
    throw new Error("AI returned invalid JSON for content strategy")
  }

  if (!Array.isArray(parsed.slots) || parsed.slots.length === 0) {
    console.error("[fastlane] No slots in response:", JSON.stringify(parsed).slice(0, 300))
    throw new Error("AI returned strategy with no content slots")
  }

  return parsed
}

async function generateSlotContent(
  brand: BrandRow,
  slot: ContentSlot,
  product: ProductRow | null,
): Promise<{ title: string; content: string; notes: string }> {
  const openai = new OpenAI({ apiKey: getApiKey(), baseURL: NVIDIA_BASE_URL })
  const res = await openai.chat.completions.create({
    model: MODELS.extraction,
    temperature: 0.8,
    max_tokens: 800,
    messages: [
      { role: "system", content: "You are a content writer. Respond with valid JSON only. No markdown." },
      { role: "user", content: buildSlotContentPrompt(brand, slot, product) },
    ],
  })

  const raw = res.choices[0]?.message?.content ?? ""
  const cleaned = sanitizeJsonString(raw)

  try {
    return JSON.parse(cleaned)
  } catch {
    const titleMatch = cleaned.match(/"title"\s*:\s*"([^"]*)"/)
    const contentMatch = cleaned.match(/"content"\s*:\s*"([\s\S]*?)"(?:\s*,|\s*\})/)
    const notesMatch = cleaned.match(/"notes"\s*:\s*"([^"]*)"/)
    return {
      title: titleMatch?.[1] ?? "Content piece",
      content: contentMatch?.[1]?.replace(/\\n/g, " ") ?? "Generated content",
      notes: notesMatch?.[1] ?? "",
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function executeFastlane(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  brandId: string,
): Promise<FastlaneResult> {
  const errors: string[] = []

  const { data: brand, error: brandErr } = await supabase
    .from("brands")
    .select("*")
    .eq("id", brandId)
    .eq("user_id", userId)
    .single<BrandRow>()

  if (brandErr || !brand) throw new Error("Brand not found")

  const { data: products } = await supabase
    .from("products")
    .select("*")
    .eq("brand_id", brandId)
    .eq("is_active", true)
    .returns<ProductRow[]>()

  const productList: ProductRow[] = products ?? []
  const productByName = new Map(productList.map(p => [p.name.toLowerCase(), p]))

  let strategy: ContentStrategy
  try {
    strategy = await generateContentStrategy(brand, productList)
  } catch (err) {
    console.error("[fastlane] generateContentStrategy failed:", err)
    throw new Error("Failed to generate content strategy")
  }

  const slots = strategy.slots.slice(0, 30)
  const slotsPlanned = slots.length
  let slotsGenerated = 0
  let calendarEntriesCreated = 0

  const batchSize = 5
  const baseDate = new Date()
  baseDate.setHours(0, 0, 0, 0)

  for (let i = 0; i < slots.length; i += batchSize) {
    if (i > 0) await sleep(500)

    const batch = slots.slice(i, i + batchSize)
    const results = await Promise.allSettled(
      batch.map(async (slot) => {
        const product = slot.product_focus
          ? (productByName.get(slot.product_focus.toLowerCase()) ?? null)
          : null

        const slotDate = new Date(baseDate)
        slotDate.setDate(baseDate.getDate() + slot.day - 1)
        const scheduledDate = slotDate.toISOString().split("T")[0]

        const generated = await generateSlotContent(brand, slot, product)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: insertErr } = await (supabase.from("calendar_entries") as any).insert({
          brand_id: brandId,
          title: generated.title || slot.theme,
          scheduled_date: scheduledDate,
          platform: slot.platform as Platform,
          content_type: slot.content_type === "hooks" ? "post"
            : slot.content_type === "reel_script" ? "reel"
            : slot.content_type === "carousel" ? "carousel"
            : "post",
          status: "planned",
          notes: `${generated.content}\n\n${generated.notes}`.trim(),
          color: slot.priority === "high" ? "#ef4444" : slot.priority === "medium" ? "#f59e0b" : "#6366f1",
        })

        if (insertErr) throw new Error(`Calendar insert failed for day ${slot.day}: ${insertErr.message}`)
        return true
      }),
    )

    for (const result of results) {
      if (result.status === "fulfilled") {
        slotsGenerated++
        calendarEntriesCreated++
      } else {
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason)
        errors.push(msg)
        console.error("[fastlane] slot error:", msg)
      }
    }
  }

  return {
    brand_id: brandId,
    slots_planned: slotsPlanned,
    slots_generated: slotsGenerated,
    calendar_entries_created: calendarEntriesCreated,
    strategy_summary: strategy.strategy_summary,
    errors,
  }
}
