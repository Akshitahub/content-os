import { MODELS, getGroqClient } from "./models"
import { generateCarouselHtml } from "@/lib/design/post-card-generator"
import { getUpcomingOccasions } from "@/lib/data/indian-occasions"
import type { BrandRow, ProductRow } from "@/types/database"
import type { ContentStrategy, ContentSlot, FastlaneResult, Platform } from "@/types/app"
import type { SupabaseClient } from "@supabase/supabase-js"

const CONTENT_MIX = [
  { pillar: "product", format: "carousel" as const, count: 5, description: "Showcase products, features, and benefits" },
  { pillar: "behind_scenes", format: "reel_script" as const, count: 4, description: "Behind the scenes, team, how it's made" },
  { pillar: "educational", format: "carousel" as const, count: 4, description: "Tips, how-to, industry insights" },
  { pillar: "humor_meme", format: "hooks" as const, count: 3, description: "Relatable humor, meme-style content" },
  { pillar: "occasion", format: "hooks" as const, count: 4, description: "Occasion and trending moment content" },
  { pillar: "testimonial", format: "hooks" as const, count: 3, description: "Customer stories, reviews, social proof" },
  { pillar: "announcement", format: "hooks" as const, count: 3, description: "New launches, offers, announcements" },
  { pillar: "inspiration", format: "hooks" as const, count: 2, description: "Quotes, motivation, brand values" },
  { pillar: "founder_story", format: "reel_script" as const, count: 2, description: "Founder journey, brand origin story" },
]

function sanitizeJsonString(raw: string): string {
  return raw
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .trim()
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generateWithRetry(groq: ReturnType<typeof getGroqClient>, params: any, retries = 1): Promise<any> {
  try {
    return await groq.chat.completions.create(params)
  } catch (err) {
    const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase()
    const isRateLimit = msg.includes("429") || msg.includes("rate_limit") || msg.includes("rate limit")
    if (retries > 0 && isRateLimit) {
      console.log("[fastlane] Rate limit hit, waiting 3000ms before retry...")
      await sleep(3000)
      return generateWithRetry(groq, params, retries - 1)
    }
    throw err
  }
}

async function generatePostImage(
  visual_direction: string,
  brand_name: string,
  platform: string,
): Promise<string | null> {
  try {
    const safeDirection = visual_direction.slice(0, 200)
    const prompt = `${safeDirection}, professional quality, ${brand_name}, ${platform} social media post, high quality`
    const encodedPrompt = encodeURIComponent(prompt)
    const seed = Math.floor(Math.random() * 100000)
    return `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1080&height=1080&seed=${seed}&nologo=true&model=flux`
  } catch {
    return null
  }
}

function buildStrategySystemPrompt(): string {
  return `You are a senior content strategist specializing in Indian D2C brands.
You create 30-day content calendars that drive engagement, build brand equity, and convert followers to buyers.
Consider platform-specific best practices, posting cadence, content variety, and seasonal relevance.
Always respond with valid JSON only. No markdown, no explanation outside the JSON.`
}

interface AutopilotParams {
  frequency?: string
  platforms?: string[]
  vibe?: string
  focusAreas?: string[]
}

function buildContentMix(focusAreas?: string[]): typeof CONTENT_MIX {
  if (!focusAreas?.length) return CONTENT_MIX
  // Weight selected focus areas more heavily
  const selected = CONTENT_MIX.filter(m => focusAreas.includes(m.pillar))
  const others = CONTENT_MIX.filter(m => !focusAreas.includes(m.pillar))
  if (!selected.length) return CONTENT_MIX
  // Redistribute: selected pillars get ~70% of slots, others get ~30%
  const total = 30
  const selectedTotal = Math.round(total * 0.7)
  const othersTotal = total - selectedTotal
  const perSelected = Math.floor(selectedTotal / selected.length)
  const perOthers = others.length ? Math.floor(othersTotal / others.length) : 0
  return [
    ...selected.map(m => ({ ...m, count: perSelected })),
    ...others.map(m => ({ ...m, count: perOthers })),
  ]
}

function buildStrategyUserPrompt(brand: BrandRow, products: ProductRow[], params?: AutopilotParams): string {
  const productNames = products.map(p => p.name).join(", ")
  const upcomingOccasions = getUpcomingOccasions(new Date(), 30)
  const occasionsNote = upcomingOccasions.length > 0
    ? `\nUpcoming occasions in next 30 days (plan slots around these):\n${upcomingOccasions.map(o => `- ${o.name} ${o.emoji} (${o.date}): ${o.content_angle} — vibe: ${o.vibe}`).join("\n")}`
    : ""

  const mix = buildContentMix(params?.focusAreas)

  const frequencyNote = params?.frequency
    ? `Posting frequency: ${params.frequency === "3x_week" ? "3 times/week (~13 posts/month)" : params.frequency === "5x_week" ? "5 times/week (~22 posts/month)" : "daily (30 posts/month)"}`
    : ""

  const vibeNote = params?.vibe ? `Overall content vibe preference: ${params.vibe}` : ""

  const platformPref = params?.platforms?.length
    ? `Preferred platforms: ${params.platforms.join(", ")} (weight these more heavily)`
    : "Vary platforms: 40% instagram, 20% tiktok, 15% linkedin, rest facebook/youtube/twitter"

  return `Create a 30-day content strategy for this brand.

Brand: ${brand.name}
Niche: ${brand.niche ?? "General"}
Audience: ${brand.target_audience ?? "General audience"}
Tone: ${brand.tone_of_voice ?? "Conversational"}
${productNames ? `Products: ${productNames}` : ""}
${frequencyNote}
${vibeNote}
${occasionsNote}

REQUIRED content mix — distribute these across 30 slots:
${mix.map(m => `- ${m.pillar} (${m.format}): ${m.count} slots`).join("\n")}

Return ONLY this JSON (no markdown, no explanation):
{
  "strategy_summary": "2-3 sentences on the strategy",
  "slots": [
    { "day": 1, "platform": "instagram", "content_type": "hooks", "theme": "Brand intro", "product_focus": null, "priority": "high", "content_pillar": "product" }
  ]
}

Rules:
- Exactly 30 slots, days 1-30
- content_type: "hooks" | "caption" | "reel_script" | "carousel" | "ad_copy"
- platform: "instagram" | "tiktok" | "youtube" | "facebook" | "linkedin" | "twitter"
- priority: "high" | "medium" | "low"
- product_focus: product name string or null
- content_pillar: one of ${CONTENT_MIX.map(m => m.pillar).join(" | ")}
- content_type must match the pillar format from the required mix
- DO NOT repeat the same content_pillar twice in a row
- For occasion slots: tie theme to a relevant upcoming occasion if any
- ${platformPref}`
}

interface CarouselSlide {
  slide_number: number
  headline: string
  body: string
}

interface SlotContent {
  title: string
  hook: string
  caption: string
  hashtags: string[]
  visual_direction: string
  audio_suggestion: string
  call_to_action: string
  slides?: CarouselSlide[]
}

function buildSlotContentPrompt(brand: BrandRow, slot: ContentSlot, product: ProductRow | null): string {
  const productCtx = product
    ? `\nProduct: ${product.name}${product.description ? ` - ${product.description}` : ""}`
    : ""
  const pillarCtx = slot.content_pillar ? `\nContent Pillar: ${slot.content_pillar}` : ""
  const pillarDescriptions: Record<string, string> = {
    product: "showcase the product's features and benefits compellingly",
    behind_scenes: "reveal what happens behind the brand — authentic and human",
    educational: "teach something genuinely useful to the audience",
    humor_meme: "be witty and relatable — make them laugh or nod",
    occasion: "tie the brand to this occasion naturally without being forced",
    testimonial: "share a customer success story or social proof angle",
    announcement: "build excitement around something new or upcoming",
    inspiration: "uplift and motivate — connect values to the audience's aspirations",
    founder_story: "share the brand's origin, mission, or founder journey",
  }
  const pillarInstruction = slot.content_pillar
    ? `This post should specifically: ${pillarDescriptions[slot.content_pillar] ?? "match the content pillar"}`
    : ""

  return `Create a complete ${slot.content_type} post for ${brand.name} on ${slot.platform}.
Brand niche: ${brand.niche ?? "D2C brand"}
Brand tone: ${brand.tone_of_voice ?? "conversational"}
Theme: ${slot.theme}${productCtx}${pillarCtx}
Day: ${slot.day} of 30${pillarInstruction ? `\n${pillarInstruction}` : ""}

IMPORTANT: This is slot ${slot.day}/30. Make it UNIQUE — different angle than typical posts for this brand.

Return this exact JSON:
{"title":"post title","hook":"attention-grabbing opening line that stops the scroll","caption":"full post caption (2-4 sentences, brand voice, ends with CTA)","hashtags":["hashtag1","hashtag2","hashtag3","hashtag4","hashtag5"],"visual_direction":"describe the ideal image/video for this post","audio_suggestion":"suggested background music mood or sound","call_to_action":"specific action you want the audience to take"}`
}

function buildCarouselSlotContentPrompt(brand: BrandRow, slot: ContentSlot, product: ProductRow | null): string {
  const productCtx = product
    ? `\nProduct: ${product.name}${product.description ? ` - ${product.description}` : ""}`
    : ""
  return `Create a 5-slide carousel post for ${brand.name} on ${slot.platform}.
Brand niche: ${brand.niche ?? "D2C brand"}
Brand tone: ${brand.tone_of_voice ?? "conversational"}
Theme: ${slot.theme}${productCtx}

Return this exact JSON (exactly 5 slides):
{"title":"carousel title","hook":"compelling cover headline","slides":[{"slide_number":1,"headline":"Cover headline","body":"Teaser of what readers will learn"},{"slide_number":2,"headline":"Point 1 title","body":"First key insight in 1-2 sentences"},{"slide_number":3,"headline":"Point 2 title","body":"Second key insight in 1-2 sentences"},{"slide_number":4,"headline":"Point 3 title","body":"Third key insight in 1-2 sentences"},{"slide_number":5,"headline":"Save this post!","body":"Call to action and follow for more"}],"hashtags":["hashtag1","hashtag2","hashtag3","hashtag4","hashtag5"],"visual_direction":"visual style for the carousel","audio_suggestion":"background music mood","call_to_action":"what you want the audience to do"}`
}

export async function generateContentStrategy(brand: BrandRow, products: ProductRow[], params?: AutopilotParams): Promise<ContentStrategy> {
  const groq = getGroqClient()
  const res = await generateWithRetry(groq, {
    model: MODELS.generation,
    temperature: 0.7,
    max_tokens: 8000,
    messages: [
      { role: "system", content: buildStrategySystemPrompt() },
      { role: "user", content: buildStrategyUserPrompt(brand, products, params) },
    ],
  })

  const raw: string = res.choices[0]?.message?.content ?? "{}"
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
  const groq = getGroqClient()
  const isCarousel = slot.content_type === "carousel"

  const res = await generateWithRetry(groq, {
    model: MODELS.generation,
    temperature: 0.8,
    max_tokens: isCarousel ? 600 : 400,
    messages: [
      {
        role: "system",
        content: "You are an expert social media content creator. Generate complete, ready-to-post content. Respond with valid JSON only. No markdown.",
      },
      {
        role: "user",
        content: isCarousel
          ? buildCarouselSlotContentPrompt(brand, slot, product)
          : buildSlotContentPrompt(brand, slot, product),
      },
    ],
  })

  const raw: string = res.choices[0]?.message?.content ?? ""
  const cleaned = sanitizeJsonString(raw)

  try {
    const parsed = JSON.parse(cleaned) as SlotContent
    if (isCarousel && parsed.slides !== undefined && !Array.isArray(parsed.slides)) {
      parsed.slides = []
    }
    return parsed
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
      slides: [],
    }
  }
}

export async function executeFastlane(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  brandId: string,
  params?: AutopilotParams,
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
    strategy = await generateContentStrategy(brand, productList, params)
  } catch (err) {
    console.error("[fastlane] generateContentStrategy failed:", err)
    throw new Error("Failed to generate content strategy")
  }

  const slots = strategy.slots.slice(0, 30)
  const slotsPlanned = slots.length
  let slotsGenerated = 0
  let calendarEntriesCreated = 0

  const batchSize = 3
  const baseDate = new Date()
  baseDate.setHours(0, 0, 0, 0)

  for (let i = 0; i < slots.length; i += batchSize) {
    if (i > 0) await sleep(1500)

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
                model_used: MODELS.generation,
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
                model_used: MODELS.generation,
                is_saved: true,
              })
              .select("id")
              .single() as { data: { id: string } | null }
            captionId = captionData?.id ?? null
          } catch {
            // non-fatal
          }
        }

        // Generate AI image (non-blocking — just constructs a Pollinations URL)
        let imageUrl: string | null = null
        try {
          imageUrl = await generatePostImage(
            generated.visual_direction || "professional product photography",
            brand.name,
            slot.platform,
          )
        } catch {
          // non-fatal
        }

        // Generate carousel HTML for carousel slots (non-blocking)
        let carouselHtmlStr: string | null = null
        const isCarousel = slot.content_type === "carousel"
        if (isCarousel && Array.isArray(generated.slides) && generated.slides.length > 0) {
          try {
            carouselHtmlStr = generateCarouselHtml(brand, generated.hook, generated.slides)
          } catch {
            // non-fatal
          }
        }

        // Build platform_specific_data JSONB
        const platformData: Record<string, string> = {}
        if (imageUrl) platformData.image_url = imageUrl
        if (carouselHtmlStr) platformData.carousel_html = carouselHtmlStr

        // Insert calendar entry with full generated content
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: insertErr } = await (supabase.from("calendar_entries") as any).insert({
          brand_id: brandId,
          title: generated.title || slot.theme,
          scheduled_date: scheduledDate,
          platform: slot.platform as Platform,
          content_type: isCarousel ? "carousel"
            : slot.content_type === "reel_script" ? "reel"
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
          platform_specific_data: platformData,
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
