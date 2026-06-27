import OpenAI from "openai"
import { MODELS, NVIDIA_BASE_URL, getApiKey } from "./models"
import type { BrandRow, ProductRow } from "@/types/database"
import type { ContentStrategy, ContentSlot, FastlaneResult, Platform } from "@/types/app"
import type { SupabaseClient } from "@supabase/supabase-js"

function buildStrategySystemPrompt(): string {
  return `You are a senior content strategist specializing in Indian D2C brands.
You create 30-day content calendars that drive engagement, build brand equity, and convert followers to buyers.
Consider platform-specific best practices, posting cadence, content variety, and seasonal relevance.
Always respond with valid JSON only. No markdown, no explanation outside the JSON.`
}

function buildStrategyUserPrompt(brand: BrandRow, products: ProductRow[]): string {
  const productList = products.map(p => `- ${p.name}${p.description ? `: ${p.description}` : ""}`).join("\n")
  return `Create a comprehensive 30-day content strategy for this brand.

Brand: ${brand.name}
Niche: ${brand.niche ?? "General"}
Target Audience: ${brand.target_audience ?? "General audience"}
Tone of Voice: ${brand.tone_of_voice ?? "Conversational"}
Brand Values: ${brand.brand_values?.join(", ") ?? "Quality, Trust"}
AI Persona: ${brand.ai_persona ?? "Friendly brand voice"}
${productList ? `\nProducts:\n${productList}` : ""}

Return a JSON object with this exact shape:
{
  "strategy_summary": "2-3 sentence overview of the strategy",
  "recommended_platforms": ["instagram", "tiktok"],
  "posting_frequency": [{ "platform": "instagram", "posts_per_week": 5 }],
  "content_mix": [{ "type": "educational", "percentage": 30, "reasoning": "..." }],
  "monthly_themes": [{ "week": 1, "theme": "Brand Story", "rationale": "..." }, { "week": 2, "theme": "...", "rationale": "..." }, { "week": 3, "theme": "...", "rationale": "..." }, { "week": 4, "theme": "...", "rationale": "..." }],
  "slots": [
    { "day": 1, "platform": "instagram", "content_type": "hooks", "theme": "Brand intro", "product_focus": "product name or null", "priority": "high" }
  ]
}

Generate exactly 30 slots (one per day). Vary platforms, content types (hooks/caption/reel_script/carousel/ad_copy), and themes across the 30 days.
content_type must be one of: "hooks", "caption", "reel_script", "carousel", "ad_copy"
platform must be one of: "instagram", "tiktok", "youtube", "facebook", "linkedin", "twitter"
priority must be one of: "high", "medium", "low"`
}

function buildSlotContentPrompt(brand: BrandRow, slot: ContentSlot, product: ProductRow | null): string {
  const productCtx = product ? `\nProduct: ${product.name}\nDescription: ${product.description ?? ""}\nKey Benefits: ${product.key_benefits?.join(", ") ?? ""}` : ""
  return `Generate ${slot.content_type} content for this brand for day ${slot.day}.

Brand: ${brand.name} | Niche: ${brand.niche ?? "General"} | Tone: ${brand.tone_of_voice ?? "Conversational"}
Platform: ${slot.platform} | Theme: ${slot.theme} | Priority: ${slot.priority}${productCtx}

Return a JSON object with:
{
  "title": "Content title/heading",
  "content": "Main content text (hook line, caption, script, etc.)",
  "notes": "Brief production notes or tips"
}`
}

export async function generateContentStrategy(brand: BrandRow, products: ProductRow[]): Promise<ContentStrategy> {
  const openai = new OpenAI({ apiKey: getApiKey(), baseURL: NVIDIA_BASE_URL })
  const res = await openai.chat.completions.create({
    model: MODELS.generation,
    temperature: 0.7,
    max_tokens: 4000,
    messages: [
      { role: "system", content: buildStrategySystemPrompt() },
      { role: "user", content: buildStrategyUserPrompt(brand, products) },
    ],
  })

  const raw = res.choices[0]?.message?.content ?? "{}"
  const parsed = JSON.parse(raw) as ContentStrategy

  if (!Array.isArray(parsed.slots)) {
    throw new Error("Strategy response missing slots array")
  }

  return parsed
}

async function generateSlotContent(
  brand: BrandRow,
  slot: ContentSlot,
  product: ProductRow | null
): Promise<{ title: string; content: string; notes: string }> {
  const openai = new OpenAI({ apiKey: getApiKey(), baseURL: NVIDIA_BASE_URL })
  const res = await openai.chat.completions.create({
    model: MODELS.generation,
    temperature: 0.8,
    max_tokens: 600,
    messages: [
      { role: "system", content: "You are an expert social media content writer. Respond with valid JSON only." },
      { role: "user", content: buildSlotContentPrompt(brand, slot, product) },
    ],
  })
  return JSON.parse(res.choices[0]?.message?.content ?? '{"title":"","content":"","notes":""}')
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function executeFastlane(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  brandId: string
): Promise<FastlaneResult> {
  const errors: string[] = []

  // Fetch brand
  const { data: brand, error: brandErr } = await supabase
    .from("brands")
    .select("*")
    .eq("id", brandId)
    .eq("user_id", userId)
    .single<BrandRow>()

  if (brandErr || !brand) throw new Error("Brand not found")

  // Fetch products
  const { data: products } = await supabase
    .from("products")
    .select("*")
    .eq("brand_id", brandId)
    .eq("is_active", true)
    .returns<ProductRow[]>()

  const productList: ProductRow[] = products ?? []

  // Build product lookup by name
  const productByName = new Map(productList.map(p => [p.name.toLowerCase(), p]))

  // Generate strategy
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

  // Process in batches of 5 with 500ms delay between batches
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

        // Insert calendar entry
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
      })
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
