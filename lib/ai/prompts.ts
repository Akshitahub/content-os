import type { BrandRow, ProductRow } from "@/types/database"
import type { HookType, Platform } from "@/types/app"

function buildBrandContext(brand: BrandRow, product?: ProductRow | null): string {
  const lines: string[] = [
    `Brand: ${brand.name}`,
  ]
  if (brand.niche) lines.push(`Niche: ${brand.niche}`)
  if (brand.target_audience) lines.push(`Target Audience: ${brand.target_audience}`)
  if (brand.tone_of_voice) lines.push(`Tone of Voice: ${brand.tone_of_voice}`)
  if (brand.brand_values?.length) lines.push(`Brand Values: ${brand.brand_values.join(", ")}`)
  if (brand.instagram_handle) lines.push(`Instagram: @${brand.instagram_handle}`)
  if (brand.ai_persona) lines.push(`AI Persona / Voice Guide: ${brand.ai_persona}`)

  if (product) {
    lines.push(`\nProduct being promoted: ${product.name}`)
    if (product.description) lines.push(`Product Description: ${product.description}`)
    if (product.key_benefits?.length) lines.push(`Key Benefits: ${product.key_benefits.join(", ")}`)
    if (product.target_customer) lines.push(`Product Target Customer: ${product.target_customer}`)
    if (product.price) lines.push(`Price: ${product.currency} ${product.price}`)
    if (product.ingredients) lines.push(`Ingredients/Materials: ${product.ingredients}`)
  }

  return lines.join("\n")
}

function hookTypeInstruction(types: HookType[]): string {
  const descriptions: Record<HookType, string> = {
    question: "Start with a compelling question that stops the scroll",
    bold_statement: "Make a bold, attention-grabbing claim",
    story: "Open with a relatable story or scenario",
    statistic: "Lead with a surprising or powerful statistic",
    controversial: "Make a thought-provoking or contrarian statement",
    how_to: "Promise a specific transformation or skill",
  }
  return types.map((t) => `- ${t}: ${descriptions[t]}`).join("\n")
}

export function buildHookSystemPrompt(): string {
  return `You are an elite social media content strategist specializing in viral hooks for Indian D2C brands. 
You write scroll-stopping opening lines that make people stop, read, and engage.
Your hooks are conversational, specific, and feel human — never generic or salesy.
You understand the Indian consumer mindset, cultural references, and social media behavior.
Always respond with valid JSON only. No markdown, no explanation.`
}

export function buildHookUserPrompt(
  brand: BrandRow,
  options: {
    hookTypes: HookType[]
    count: number
    platform?: Platform
    additionalContext?: string
    product?: ProductRow | null
  }
): string {
  const brandContext = buildBrandContext(brand, options.product)
  const platformNote = options.platform ? `Platform: ${options.platform} (optimize length and style for this platform)` : ""
  const extraContext = options.additionalContext ? `Additional context: ${options.additionalContext}` : ""

  return `${brandContext}
${platformNote}
${extraContext}

Generate ${options.count} high-converting social media hooks for the above brand${options.product ? ` promoting "${options.product.name}"` : ""}.

Hook types to use (vary across them):
${hookTypeInstruction(options.hookTypes)}

Rules:
- Each hook must be under 150 characters
- Sound like a real person, not a brand
- Be specific, not generic
- No emojis unless the brand uses them
- No hashtags
- Make the reader feel something — curiosity, FOMO, recognition, or surprise

Respond with this exact JSON:
{
  "hooks": [
    {
      "hook_text": "the hook line",
      "hook_type": "one of: question|bold_statement|story|statistic|controversial|how_to",
      "reasoning": "one sentence on why this works"
    }
  ]
}`
}

export function buildCaptionSystemPrompt(): string {
  return `You are an expert social media copywriter for Indian D2C brands.
You write captions that convert — not just get likes. 
Your writing is conversational, authentic, and platform-native.
You understand the balance between storytelling and selling.
Always respond with valid JSON only. No markdown, no explanation.`
}

export function buildCaptionUserPrompt(
  brand: BrandRow,
  options: {
    hookText?: string
    platform: Platform
    contentType: string
    additionalContext?: string
    product?: ProductRow | null
  }
): string {
  const brandContext = buildBrandContext(brand, options.product)
  const hookLine = options.hookText ? `Opening hook to use: "${options.hookText}"` : "Create your own strong opening"
  const extraContext = options.additionalContext ? `Additional context: ${options.additionalContext}` : ""

  const platformRules: Record<Platform, string> = {
    instagram: "Max 2200 chars. Use line breaks for readability. 3-5 paragraphs. 5-15 hashtags at the end.",
    facebook: "Max 500 chars. Conversational. 1-3 hashtags or none.",
    tiktok: "Max 300 chars. Punchy, youthful, trend-aware. 3-5 hashtags.",
    youtube: "Max 500 chars. Informative. 3-5 hashtags.",
    linkedin: "Max 3000 chars. Professional storytelling. 3-5 hashtags.",
    twitter: "Max 280 chars. Punchy. 1-2 hashtags or none.",
  }

  return `${brandContext}
Platform: ${options.platform} — ${platformRules[options.platform]}
Content type: ${options.contentType}
${hookLine}
${extraContext}

Write a complete social media caption following the brand voice exactly.

Respond with this exact JSON:
{
  "caption_text": "the full caption without hashtags",
  "hashtags": ["hashtag1", "hashtag2"],
  "cta": "the call to action line",
  "character_count": 123
}`
}
