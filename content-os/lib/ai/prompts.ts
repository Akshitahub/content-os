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

// ─── Reel script ──────────────────────────────────────────────────────────

export function buildReelScriptSystemPrompt(): string {
  return `You are a short-form video strategist and scriptwriter for Indian D2C brands on Instagram and TikTok.
You write tight, visual reel scripts that feel native to the platform — not like TV ads.
Each script has a punchy hook, 3–5 scenes that flow naturally, and an Instagram caption.
Scenes are precise: you specify exactly what the viewer sees and what they hear or read.
Always respond with valid JSON only. No markdown, no explanation.`
}

export function buildReelScriptUserPrompt(
  brand: BrandRow,
  options: {
    additionalContext?: string
    product?: ProductRow | null
  }
): string {
  const brandContext = buildBrandContext(brand, options.product)
  const extraContext = options.additionalContext ? `Additional context: ${options.additionalContext}` : ""

  return `${brandContext}
${extraContext}

Write a reel script for the above brand${options.product ? ` promoting "${options.product.name}"` : ""}.

Requirements:
- Total reel duration: 15–30 seconds
- 3–5 scenes (for 15s use 3 scenes, for 30s use 4–5)
- Each scene duration should be realistic (3–8 seconds each)
- hook: a single scroll-stopping opening line (shown as text or spoken)
- Each scene: visual_direction (what the camera shows), voiceover_or_text_overlay (what is heard or read on screen)
- caption + 5–10 hashtags for the Instagram post

Respond with this exact JSON:
{
  "hook": "opening hook line",
  "scenes": [
    {
      "visual_direction": "what the viewer sees",
      "voiceover_or_text_overlay": "spoken words or on-screen text",
      "duration_seconds": 6
    }
  ],
  "caption": "instagram caption without hashtags",
  "hashtags": ["hashtag1", "hashtag2"]
}`
}

// ─── Story ────────────────────────────────────────────────────────────────

export function buildStorySystemPrompt(): string {
  return `You are a social media creative for Indian D2C brands on Instagram Stories.
Stories are vertical, ephemeral, and personal — they feel like a direct message, not a broadcast.
You write punchy text overlays (under 100 characters) and suggest the most fitting native sticker.
Always respond with valid JSON only. No markdown, no explanation.`
}

export function buildStoryUserPrompt(
  brand: BrandRow,
  options: {
    additionalContext?: string
    product?: ProductRow | null
  }
): string {
  const brandContext = buildBrandContext(brand, options.product)
  const extraContext = options.additionalContext ? `Additional context: ${options.additionalContext}` : ""

  return `${brandContext}
${extraContext}

Write an Instagram Story for the above brand${options.product ? ` featuring "${options.product.name}"` : ""}.

Requirements:
- text: the on-screen text overlay — under 100 characters, punchy, speaks directly to the viewer
- sticker_suggestion: one Instagram native sticker that fits the content (e.g. "Poll: Yes/No", "Quiz", "Question box", "Countdown", "Emoji slider ❤️", "Link sticker")

Respond with this exact JSON:
{
  "text": "short text overlay",
  "sticker_suggestion": "sticker type and prompt"
}`
}

// ─── Carousel ─────────────────────────────────────────────────────────────

export function buildCarouselSystemPrompt(): string {
  return `You are a carousel content strategist for Indian D2C brands on Instagram.
You build swipeable carousels that educate, entertain, or convert — with a clear narrative arc.
Slide 1 is always the hook. The last slide is always the CTA.
Each slide headline is short and bold; body text adds the detail.
Always respond with valid JSON only. No markdown, no explanation.`
}

export function buildCarouselUserPrompt(
  brand: BrandRow,
  options: {
    additionalContext?: string
    product?: ProductRow | null
  }
): string {
  const brandContext = buildBrandContext(brand, options.product)
  const extraContext = options.additionalContext ? `Additional context: ${options.additionalContext}` : ""

  return `${brandContext}
${extraContext}

Create a carousel for the above brand${options.product ? ` about "${options.product.name}"` : ""}.

Requirements:
- 5–8 slides total
- Slide 1: hook/cover slide — bold promise or question
- Slides 2 to N-1: value slides — each makes one clear point
- Last slide: CTA slide — what to do next, clear action
- headline: under 60 characters, punchy
- body: 1–2 sentences expanding on the headline
- caption + 5–10 hashtags for the Instagram post

Respond with this exact JSON:
{
  "slides": [
    {
      "slide_number": 1,
      "headline": "slide headline",
      "body": "1-2 sentence body copy"
    }
  ],
  "caption": "instagram caption without hashtags",
  "hashtags": ["hashtag1", "hashtag2"]
}`
}

// ─── Blog post ────────────────────────────────────────────────────────────

export function buildBlogPostSystemPrompt(): string {
  return `You are an SEO content writer for Indian D2C brand blogs.
You write helpful, scannable posts that rank and convert — not fluffy filler content.
Posts are written in the brand's tone, reference the Indian consumer context where relevant, and end with a natural product CTA.
Target 400–600 words. Use paragraph breaks (\\n\\n) for readability. No headers or markdown inside the body — plain prose only.
Always respond with valid JSON only. No markdown, no explanation.`
}

export function buildBlogPostUserPrompt(
  brand: BrandRow,
  options: {
    additionalContext?: string
    product?: ProductRow | null
  }
): string {
  const brandContext = buildBrandContext(brand, options.product)
  const extraContext = options.additionalContext ? `Topic or angle: ${options.additionalContext}` : ""

  return `${brandContext}
${extraContext}

Write a blog post for the above brand${options.product ? ` that naturally features "${options.product.name}"` : ""}.

Requirements:
- title: SEO-friendly, compelling, under 70 characters
- body: 400–600 words of plain prose with \\n\\n between paragraphs. No markdown headers. End with a natural call to action mentioning the product or brand.
- meta_description: 140–160 characters, includes the primary keyword, written for search results

Respond with this exact JSON:
{
  "title": "post title",
  "body": "full post body with paragraph breaks as \\n\\n",
  "meta_description": "SEO meta description under 160 chars"
}`
}

// ─── Ad copy ─────────────────────────────────────────────────────────────

export function buildAdCopySystemPrompt(): string {
  return `You are a performance copywriter specialising in Meta (Facebook/Instagram) ads for Indian D2C brands.
You write ad copy that stops the scroll and drives action — not brand awareness fluff.
You follow Meta's character limits: headline ≤40 characters, primary text ≤125 characters recommended.
Your copy is specific, benefit-led, and speaks the customer's language.
Always respond with valid JSON only. No markdown, no explanation.`
}

export function buildAdCopyUserPrompt(
  brand: BrandRow,
  options: {
    additionalContext?: string
    product?: ProductRow | null
  }
): string {
  const brandContext = buildBrandContext(brand, options.product)
  const extraContext = options.additionalContext ? `Campaign angle: ${options.additionalContext}` : ""

  return `${brandContext}
${extraContext}

Write Meta ad copy for the above brand${options.product ? ` promoting "${options.product.name}"` : ""}.

Character limit rules (STRICT):
- headline: MUST be 40 characters or fewer
- primary_text: aim for ≤125 characters (this is the main feed text above the image)
- description: 1 sentence, shown below the headline in some placements
- cta_button: one of the standard Meta CTA options (e.g. "Shop Now", "Learn More", "Order Now", "Get Offer", "Book Now", "Sign Up")

Respond with this exact JSON:
{
  "headline": "≤40 char headline",
  "primary_text": "hook-led ad body, ideally ≤125 chars",
  "description": "one supporting sentence",
  "cta_button": "Shop Now"
}`
}

// ─── Image (unchanged) ────────────────────────────────────────────────────

const IMAGE_STYLE_DESCRIPTIONS: Record<string, string> = {
  product_photography: "clean, professional product photography, studio lighting, sharp focus on the product, commercial e-commerce style",
  lifestyle: "lifestyle photography showing the product naturally in use, warm natural lighting, relatable real-world setting",
  flat_lay: "top-down flat lay composition, neatly arranged props, soft even lighting, Instagram-aesthetic",
  minimal_studio: "minimal studio background, single accent color, lots of negative space, premium minimalist aesthetic",
  festive: "festive Indian seasonal styling (diyas, marigold, warm gold tones), celebratory and culturally rich mood",
  ugc_style: "authentic user-generated-content look, handheld phone photography feel, candid and unpolished but appealing",
}

export function buildImagePrompt(
  brand: BrandRow,
  options: {
    prompt: string
    style?: string
    product?: ProductRow | null
  }
): string {
  const lines: string[] = []

  if (options.product) {
    lines.push(`Product: ${options.product.name}.`)
    if (options.product.description) lines.push(options.product.description)
  }

  lines.push(options.prompt)

  if (options.style && IMAGE_STYLE_DESCRIPTIONS[options.style]) {
    lines.push(`Visual style: ${IMAGE_STYLE_DESCRIPTIONS[options.style]}.`)
  }

  if (brand.color_palette && typeof brand.color_palette === "object") {
    const palette = brand.color_palette as Record<string, unknown>
    const colors = Object.values(palette).filter((v) => typeof v === "string")
    if (colors.length) lines.push(`Brand color palette to favor where natural: ${colors.join(", ")}.`)
  }

  lines.push("No text, no logos, no watermarks in the image. High quality, social-media ready.")

  return lines.join(" ")
}
