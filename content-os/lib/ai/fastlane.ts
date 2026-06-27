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

interface SlotContent {
  title: string
  hook: string
  caption: string
  hashtags: string[]
  visual_direction: string
  audio_suggestion: string
  call_to_action: string
}

function buildSlotContentPrompt(brand: BrandRow, slot: ContentSlot, product: ProductRow | null): string {
  const productCtx = product
    ? `\nProduct: ${product.name}${product.description ? ` - ${product.description}` : ""}`
    : ""
  return `Create a complete ${slot.content_type} post for ${brand.name} on ${slot.platform}.
Brand niche: ${brand.niche ?? "D2C brand"}
Brand tone: ${brand.tone_of_voice ?? "conversational"}
Theme: ${slot.theme}${productCtx}

Return this exact JSON:
{"title":"post title","hook":"attention-grabbing opening line","caption":"full post caption (2-4 sentences, brand voice)","hashtags":["hashtag1","hashtag2","hashtag3","hashtag4","hashtag5"],"visual_direction":"describe the ideal image/video for this post","audio_suggestion":"suggested background music mood or sound","call_to_action":"what you want the audience to do"}`
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
): Promise<SlotContent> {
  const openai = new OpenAI({ apiKey: getApiKey(), baseURL: NVIDIA_BASE_URL })
  const res = await openai.chat.completions.create({
    model: MODELS.extraction,
    temperature: 0.8,
    max_tokens: 600,
    messages: [
      {
        role: "system",
        content: "You are an expert social media content creator. Generate complete, ready-to-post content. Respond with valid JSON only. No markdown.",
      },
      { role: "user", content: buildSlotContentPrompt(brand, slot, product) },
    ],
  })

  const raw = res.choices[0]?.message?.content ?? ""
  const cleaned = sanitizeJsonString(raw)

  try {
    return JSON.parse(cleaned) as SlotContent
  } catch {
    // Regex fallback for malformed JSON
    const titleMatch = cleaned.match(/"title"\s*:\s*"([^"]*)"/)
    const hookMatch = cleaned.match(/"hook"\s*:\s*"([^"]*)"/)
    const captionMatch = cleaned.match(/"caption"\s*:\s*"([\s\S]*?)"(?:\s*,|\s*\})/)
    const visualMatch = cleaned.match(/"visual_direction"\s*:\s*"([^"]*)"/)
    const audioMatch = cleaned.match(/"audio_suggestion"\s*:\s*"([^"]*)"/)
    const ctaMatch = cleaned.match(/"call_to_action"\s*:\s*"([^"]*)"/)

    let hashtags: string[] = []
    const hashtagsMatch = cleaned.match(/"hashtags"\s*:\s*\[([^\]]*)\]/)
    if (hashtagsMatch) {
      hashtags = hashtagsMatch[1]
        .split(",")
        .map(h => h.trim().replace(/^"|"$/g, "").replace(/^#/, "").trim())
        .filter(Boolean)
    }

    return {
      title: titleMatch?.[1] ?? slot.theme,
      hook: hookMatch?.[1] ?? `${slot.theme} — you need to see this`,
      caption: captionMatch?.[1]?.replace(/\\n/g, " ") ?? `${brand.name} brings you ${slot.theme}.`,
      hashtags,
      visual_direction: visualMatch?.[1] ?? "",
      audio_suggestion: audioMatch?.[1] ?? "",
      call_to_action: ctaMatch?.[1] ?? "",
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

        // Persist hook (non-fatal)
        let hookId: string | null = null
        if (generated.hook) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: hookData } = await (supabase.from("hooks") as any)
              .insert({
                brand_id: brandId,
                hook_text: generated.hook,
                hook_type: "bold_statement",
                generation_prompt: `fastlane day:${slot.day} platform:${slot.platform}`,
                model_used: MODELS.extraction,
                is_saved: true,
              })
              .select("id")
              .single() as { data: { id: string } | null }
            hookId = hookData?.id ?? null
          } catch {
            // non-fatal
          }
        }

        // Persist caption (non-fatal)
        let captionId: string | null = null
        if (generated.caption) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: captionData } = await (supabase.from("captions") as any)
              .insert({
                brand_id: brandId,
                hook_id: hookId,
                caption_text: generated.caption,
                hashtags: generated.hashtags ?? [],
                cta: generated.call_to_action || null,
                character_count: generated.caption.length,
                platform: slot.platform,
                model_used: MODELS.extraction,
                is_saved: true,
              })
              .select("id")
              .single() as { data: { id: string } | null }
            captionId = captionData?.id ?? null
          } catch {
            // non-fatal
          }
        }

        // Insert calendar entry with full generated content
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: insertErr } = await (supabase.from("calendar_entries") as any).insert({
          brand_id: brandId,
          title: generated.title || slot.theme,
          scheduled_date: scheduledDate,
          platform: slot.platform as Platform,
          content_type: slot.content_type === "reel_script" ? "reel"
            : slot.content_type === "carousel" ? "carousel"
            : "post",
          status: "content_ready",
          hook_text: generated.hook || null,
          caption_text: generated.caption || null,
          hashtags: generated.hashtags ?? [],
          visual_direction: generated.visual_direction || null,
          audio_suggestion: generated.audio_suggestion || null,
          notes: generated.call_to_action || null,
          hook_id: hookId,
          caption_id: captionId,
          is_ready: true,
          color: slot.priority === "high" ? "#6366f1"
            : slot.priority === "medium" ? "#8b5cf6"
            : "#a78bfa",
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
