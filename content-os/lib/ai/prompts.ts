import type { BrandRow, ProductRow } from "@/types/database"
import type { HookType, Platform } from "@/types/app"

const QUALITY_BAR = `

QUALITY STANDARD — every piece of content must meet this bar:
- Sound like a skilled human copywriter wrote it, not a generic AI
- Be SPECIFIC to this brand's actual products/niche, never generic filler like "amazing deals" or "great quality"
- Have a clear emotional angle (curiosity, urgency, humor, relatability, aspiration) — never flat or purely informational
- Avoid corporate jargon and cliché marketing phrases
- Match the EXACT tone_of_voice provided — if it's "playful", be genuinely funny; if "premium", be genuinely elevated
- NEVER mention third-party platforms (Amazon, Flipkart, Myntra, Nykaa, Meesho, etc.) unless explicitly part of the brand's stated sales channels`

function buildBrandContext(brand: BrandRow, product?: ProductRow | null): string {
  const lines: string[] = [
    `Brand: ${brand.name}`,
  ]
  if (brand.niche) lines.push(`Niche: ${brand.niche}`)
  if (brand.target_audience) lines.push(`Target Audience: ${brand.target_audience}`)
  if (brand.tone_of_voice) lines.push(`Tone of Voice: ${brand.tone_of_voice}`)
  if (brand.brand_values?.length) lines.push(`Brand Values: ${brand.brand_values.join(", ")}`)
  if (brand.instagram_handle) lines.push(`Instagram Handle: @${brand.instagram_handle}`)
  if (brand.ai_persona) lines.push(`AI Persona / Voice Guide: ${brand.ai_persona}`)
  // New brand identity fields
  const b = brand as BrandRow & {
    brand_personality?: string | null
    target_emotion?: string | null
    cta_phrase?: string | null
    content_pillars?: string[]
  }
  if (b.brand_personality) lines.push(`Brand Personality: ${b.brand_personality}`)
  if (b.target_emotion) lines.push(`Target Emotion to Evoke: ${b.target_emotion}`)
  if (b.cta_phrase) lines.push(`CTA Phrase: ${b.cta_phrase}`)
  if (b.content_pillars?.length) lines.push(`Content Pillars: ${b.content_pillars.join(", ")}`)

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
  return `You are an elite social media hook writer for Indian D2C brands. You write the single most important line — the one that stops the scroll or loses the reader forever.

ABSOLUTE RULES — NEVER BREAK THESE:
1. Hook text MAXIMUM 8 WORDS. Count them. If your hook is longer than 8 words, rewrite it.
2. A hook is ONE sentence. Not a story. Not a paragraph.
3. NEVER start with "In a...", "As we...", "On this...", "As I...", "When you're trying to..."
4. NEVER write a hook that sounds like an essay opening
5. The hook should work as a standalone caption opener
6. NEVER mention the product name, brand name, or product category in the hook
7. Speak to the emotion, pain point, or curiosity — never the solution
8. No exclamation marks, no hashtags, no emojis
9. Make the reader feel like you read their diary

GOOD (under 8 words — study these):
✓ "This changed how I sleep forever." (7 words)
✓ "Your skin is lying to you." (7 words)
✓ "Nobody talks about this beauty mistake." (7 words)
✓ "Your spiritual journey starts here." (5 words)
✓ "Ancient wisdom. Modern life. Perfect balance." (6 words)
✓ "Stop searching. You found it." (5 words)

BAD (too long — never write these):
✗ "In a small village surrounded by ancient temples..."
✗ "When you're trying to find your inner peace but your mind is like a monkey"
✗ "As we honor the valiant heroes who fought for..."
✗ "Introducing our amazing new product!"
✗ "Shop now and save 20%!"

If you generate a hook longer than 8 words, you have FAILED. Start over with fewer words.
${QUALITY_BAR}

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
  const b = brand as BrandRow & {
    brand_personality?: string | null
    target_emotion?: string | null
    content_pillars?: string[]
  }

  const audienceContext = [
    `Niche: ${brand.niche ?? "D2C brand"}`,
    `Target Audience: ${brand.target_audience ?? "general consumers"}`,
    `Tone of Voice: ${brand.tone_of_voice ?? "conversational"}`,
    b.brand_personality ? `Brand Personality: ${b.brand_personality}` : null,
    b.target_emotion ? `Emotion to evoke: ${b.target_emotion}` : null,
    b.content_pillars?.length ? `Content pillars: ${b.content_pillars.join(", ")}` : null,
  ].filter(Boolean).join("\n")

  // Use category/benefit angle — NOT the product name — per hook quality rules
  const contentAngle = options.product
    ? [
        `Category angle: ${brand.niche ?? "lifestyle product"}`,
        options.product.key_benefits?.length
          ? `Benefit to imply: ${options.product.key_benefits.slice(0, 2).join(", ")}`
          : options.product.description
          ? `Angle: ${options.product.description.slice(0, 80)}`
          : null,
      ].filter(Boolean).join("\n")
    : `Category: ${brand.niche ?? "D2C"}`

  const platformNote = options.platform ? `Platform: ${options.platform} (tailor energy and length to this platform's scroll behaviour)` : ""
  const extraContext = options.additionalContext ? `Additional angle or occasion: ${options.additionalContext}` : ""

  return `${audienceContext}
${contentAngle}
${platformNote}
${extraContext}

Generate ${options.count} scroll-stopping hooks. Remember: MAX 8 WORDS EACH. NEVER mention the product name or brand name.

Hook types to vary across:
${hookTypeInstruction(options.hookTypes)}

Respond with this exact JSON:
{
  "hooks": [
    {
      "hook_text": "max 8 words, no product name, no brand name",
      "hook_type": "question|bold_statement|story|statistic|controversial|how_to",
      "reasoning": "one sentence on why this emotion/angle works for this specific audience"
    }
  ]
}`
}

export function buildCaptionSystemPrompt(): string {
  return `You are an expert social media copywriter for Indian D2C brands. You write captions that convert — not just get likes.

CAPTION STRUCTURE (follow this every time):
1. Hook line — restate or evolve the opening hook (1 punchy line)
2. Story or value — 2-4 lines building connection, value, or relatability
3. CTA line — one clear action (always ends with brand's CTA phrase + @handle)
4. [blank line]
5. [blank line]
6. Hashtags — 15-20 tags using the 5+5+5 method below

HASHTAG STRATEGY — 5+5+5 RULE:
- 5 niche-specific (medium competition, 100K–2M posts): e.g. #SkincareRoutine, #CleanBeautyIndia
- 5 brand/product-specific (low competition, unique to brand): e.g. #BrandName, #ProductName
- 5 broad/trending (high volume, 5M+ posts): e.g. #Skincare, #Beauty, #SelfCare

VIBE MATCHING:
- Educational: "Here's why...", "The truth about...", teach a lesson
- Entertaining: humor, relatable "when you..." moments, wit
- Inspirational: "You deserve...", "Imagine...", second-person empowerment
- Sales: urgency + value + social proof in one paragraph
- Community: "Tag someone who...", "Drop a 🤍 if...", inclusive CTAs

MANDATORY: The last 1-2 lines of caption_text MUST be the brand's CTA phrase followed by @handle on a new line.
${QUALITY_BAR}

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

  const b = brand as BrandRow & {
    cta_phrase?: string | null
  }
  const ctaPhrase = b.cta_phrase || "Shop now"
  const handle = brand.instagram_handle ? `@${brand.instagram_handle}` : ""

  const platformRules: Record<Platform, string> = {
    instagram: `Max 2200 chars. Use line breaks for readability. 3-5 paragraphs. End with: "${ctaPhrase} 👇\\n${handle}". Then 2 blank lines. Then 15-20 hashtags.`,
    facebook: `Max 500 chars. Conversational. End with "${ctaPhrase}". 1-3 hashtags or none.`,
    tiktok: `Max 300 chars. Punchy. End with "Follow ${handle || "us"} for more!" 3-5 hashtags.`,
    youtube: `Max 500 chars. Informative. End with "${ctaPhrase}". 3-5 hashtags.`,
    linkedin: `Max 3000 chars. Professional storytelling. End with "What do you think? Comment below 👇". 3-5 hashtags.`,
    twitter: "Max 280 chars. Punchy. 1-2 hashtags or none.",
  }

  const endingExample = handle
    ? `"${ctaPhrase} 👇\\n${handle}"`
    : `"${ctaPhrase} 👇"`

  return `${brandContext}
Platform: ${options.platform} — ${platformRules[options.platform]}
Content type: ${options.contentType}
${hookLine}
${extraContext}

Write a complete social media caption following the brand voice exactly.

CRITICAL — the last 2 lines of caption_text MUST be exactly:
${endingExample}
This is non-negotiable. Do not forget the @handle.

Respond with this exact JSON:
{
  "caption_text": "full caption ending with: ${ctaPhrase} 👇\\n${handle || "@handle"}",
  "hashtags": ["niche1", "niche2", "niche3", "niche4", "niche5", "brand1", "brand2", "brand3", "brand4", "brand5", "broad1", "broad2", "broad3", "broad4", "broad5"],
  "cta": "${ctaPhrase}",
  "character_count": 123
}`
}

// ─── Reel script ──────────────────────────────────────────────────────────

export function buildReelScriptSystemPrompt(): string {
  return `You are a short-form video strategist and scriptwriter for Indian D2C brands on Instagram and TikTok.
You write tight, visual reel scripts that feel native to the platform — not like TV ads.
Each script has a punchy hook, 3–5 scenes that flow naturally, and an Instagram caption.
Scenes are precise: you specify exactly what the viewer sees and what they hear or read.
${QUALITY_BAR}

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
${QUALITY_BAR}

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
${QUALITY_BAR}

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
${QUALITY_BAR}

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
${QUALITY_BAR}

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
  // User's description ALWAYS comes first
  const lines: string[] = [options.prompt]

  if (options.style && IMAGE_STYLE_DESCRIPTIONS[options.style]) {
    lines.push(IMAGE_STYLE_DESCRIPTIONS[options.style])
  }

  if (brand.niche) lines.push(`${brand.niche} brand aesthetic`)

  if (options.product) {
    lines.push(`featuring ${options.product.name}`)
  }

  if (brand.color_palette && typeof brand.color_palette === "object") {
    const palette = brand.color_palette as Record<string, unknown>
    const colors = Object.values(palette).filter((v) => typeof v === "string")
    if (colors.length) lines.push(`color palette ${colors.join(", ")}`)
  }

  lines.push("professional photography, no text, no watermarks, no logos, 8K ultra HD")

  return lines.join(", ")
}

// ─── Topic suggestions ───────────────────────────────────────────────────────

export function buildTopicSuggestionSystemPrompt(): string {
  return `You are a creative content strategist for Indian D2C brands.
You suggest specific, engaging content topics tailored to a brand's niche, audience, and products — never generic placeholders.
When the user has already typed a starting idea, your job is to sharpen and extend that specific idea into 5 concrete brand-relevant angles — not to replace it with unrelated suggestions.
When no starting idea is given, generate 5 fresh brand-specific topics from scratch.
${QUALITY_BAR}

Always respond with valid JSON only. No markdown, no explanation.`
}

export function buildTopicSuggestionUserPrompt(
  brand: BrandRow,
  options: {
    contentType: "hook" | "carousel" | "story" | "meme"
    product?: ProductRow | null
    currentInput?: string
  }
): string {
  const brandContext = buildBrandContext(brand, options.product)
  const trimmedInput = options.currentInput?.trim()

  const formatHints: Record<string, string> = {
    hook: "Each suggestion is a specific scroll-stopping hook angle — an audience pain point, emotion, or scenario.",
    carousel: "Each suggestion is a carousel series idea — educational listicle, myth-busting, before/after, or step-by-step transformation.",
    story: "Each suggestion is a story sequence angle — product reveal, day-in-the-life, interactive poll question, or behind-the-scenes moment.",
    meme: "Each suggestion is a relatable situation, comparison, or audience reaction specific to this brand's world.",
  }

  const jsonTemplate = `Respond with this exact JSON:
{
  "topics": [
    "specific topic 1",
    "specific topic 2",
    "specific topic 3",
    "specific topic 4",
    "specific topic 5"
  ]
}`

  if (trimmedInput) {
    return `${brandContext}

The user has started typing a topic idea: "${trimmedInput}"

Your job is to develop this into 5 specific, brand-relevant ${options.contentType} content angles.
Do NOT suggest unrelated generic brand topics — all 5 suggestions must build directly on "${trimmedInput}" and apply it to this brand's context.
Think: how would a skilled content strategist take "${trimmedInput}" and turn it into 5 concrete, usable ${options.contentType} ideas for this specific brand?
${formatHints[options.contentType]}

Rules:
- Every suggestion must clearly relate to "${trimmedInput}"
- Make each suggestion specific to this brand's niche, products, or audience — not generic filler
- Each suggestion should immediately spark a usable content idea (5–10 words)
- No numbering, no surrounding quotes in the JSON string values

${jsonTemplate}`
  }

  return `${brandContext}

Suggest 5 specific content topics for ${options.contentType} content for the above brand.
${formatHints[options.contentType]}

Rules:
- Never suggest generic ideas like "New product launch", "Behind the scenes", "How to use our product", "Customer testimonial"
- Every topic must be specific to this brand's niche, audience pain points, or product benefits
- Each topic should immediately spark a usable content idea (5–10 words)
- No numbering, no surrounding quotes in the JSON string values

${jsonTemplate}`
}

// ─── Influencer fit scoring ───────────────────────────────────────────────

export function buildInfluencerFitScoringSystemPrompt(): string {
  return `You are an expert brand partnership strategist who evaluates influencer-brand fit.
You analyze audience overlap, niche alignment, tone match, follower count vs brand size, and engagement signals.
You give honest, nuanced assessments — not everything is a good fit.
Always respond with valid JSON only. No markdown, no explanation.`
}

export function buildInfluencerFitScoringUserPrompt(
  brand: BrandRow,
  influencer: {
    handle: string
    platform: string
    full_name: string | null
    bio: string | null
    follower_count: number | null
    post_count: number | null
    niche?: string | null
  },
): string {
  const brandContext = [
    `Brand Name: ${brand.name}`,
    brand.niche ? `Brand Niche: ${brand.niche}` : null,
    brand.target_audience ? `Target Audience: ${brand.target_audience}` : null,
    brand.tone_of_voice ? `Tone of Voice: ${brand.tone_of_voice}` : null,
    brand.brand_values?.length ? `Brand Values: ${brand.brand_values.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n")

  const followerDisplay =
    influencer.follower_count !== null ? influencer.follower_count.toLocaleString() : "unknown"

  const influencerContext = [
    `Handle: @${influencer.handle}`,
    `Platform: ${influencer.platform}`,
    influencer.full_name ? `Full Name: ${influencer.full_name}` : null,
    influencer.bio ? `Bio: ${influencer.bio}` : null,
    `Follower Count: ${followerDisplay}`,
    influencer.post_count !== null ? `Post/Video Count: ${influencer.post_count}` : null,
    influencer.niche ? `Niche: ${influencer.niche}` : null,
  ]
    .filter(Boolean)
    .join("\n")

  return `${brandContext}

Influencer Profile:
${influencerContext}

Score this influencer's brand fit on a scale of 1–10.
Consider: niche/content alignment with the brand's niche, follower count appropriateness (not too small to matter, not too large to be out of budget), engagement signals from bio, and audience demographic alignment with the brand's target_audience.

Respond with this exact JSON:
{
  "score": 7,
  "reasoning": "one paragraph explaining the score",
  "why_it_works": "one specific sentence about why this creator matches THIS exact brand — reference the brand's niche, audience, or product",
  "strengths": ["strength one", "strength two"],
  "concerns": ["concern one", "concern two"],
  "recommendation": "strong_fit"
}

recommendation must be one of: "strong_fit" | "potential_fit" | "weak_fit"`
}

// ─── Outreach message ─────────────────────────────────────────────────────

export function buildOutreachSystemPrompt(): string {
  return `You are an expert at writing personalized influencer outreach messages that get replies.
You sound human, warm, and specific — never corporate or templated.
You tailor the tone and length to the channel: short and punchy for DMs, more detailed for emails.
Always respond with valid JSON only. No markdown, no explanation.`
}

export function buildOutreachUserPrompt(
  brand: BrandRow,
  influencer: {
    handle: string
    platform: string
    bio: string | null
    follower_count: number | null
  },
  channel: "dm" | "email" | "whatsapp",
  campaignGoal?: string,
): string {
  const channelRules: Record<"dm" | "email" | "whatsapp", string> = {
    dm: "Under 150 words. Casual, conversational. No formal sign-off. Get to the point fast.",
    email: "Under 300 words. Has a subject line. Slightly more formal but still warm and personal.",
    whatsapp: "Under 150 words. Friendly, direct. Use short paragraphs. No formal language.",
  }

  const brandContext = [
    `Brand: ${brand.name}`,
    brand.niche ? `Niche: ${brand.niche}` : null,
    brand.tone_of_voice ? `Brand Tone: ${brand.tone_of_voice}` : null,
  ]
    .filter(Boolean)
    .join("\n")

  const followerDisplay =
    influencer.follower_count !== null ? influencer.follower_count.toLocaleString() : "unknown"

  return `${brandContext}

Influencer:
- Handle: @${influencer.handle} on ${influencer.platform}
- Followers: ${followerDisplay}
${influencer.bio ? `- Bio: ${influencer.bio}` : ""}

Channel: ${channel}
Rules: ${channelRules[channel]}
${campaignGoal ? `Campaign Goal: ${campaignGoal}` : ""}

Write a personalized outreach message. Reference the influencer's actual bio or content style to show it's not a mass message.

Respond with this exact JSON:
{
  "subject": "email subject line or null if not email",
  "message": "the full outreach message",
  "tone": "one word describing the tone used e.g. warm, playful, professional"
}`
}

// ─── Collaboration brief ──────────────────────────────────────────────────

export function buildCollaborationBriefSystemPrompt(): string {
  return `You are a senior brand partnerships manager who creates clear, actionable influencer campaign briefs.
Your briefs are specific, inspiring, and practical — influencers know exactly what to create without feeling constrained.
Always respond with valid JSON only. No markdown, no explanation.`
}

export function buildCollaborationBriefUserPrompt(
  brand: BrandRow,
  influencer: {
    handle: string
    platform: string
    bio: string | null
    follower_count: number | null
  },
  campaignName: string,
  product: ProductRow | null,
): string {
  const brandContext = [
    `Brand: ${brand.name}`,
    brand.niche ? `Niche: ${brand.niche}` : null,
    brand.target_audience ? `Target Audience: ${brand.target_audience}` : null,
    brand.tone_of_voice ? `Tone of Voice: ${brand.tone_of_voice}` : null,
    brand.brand_values?.length ? `Brand Values: ${brand.brand_values.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n")

  const productContext = product
    ? [
        `Product: ${product.name}`,
        product.description ? `Description: ${product.description}` : null,
        product.key_benefits?.length ? `Key Benefits: ${product.key_benefits.join(", ")}` : null,
        product.price ? `Price: ${product.currency} ${product.price}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "No specific product — brand awareness campaign."

  const followerDisplay =
    influencer.follower_count !== null ? influencer.follower_count.toLocaleString() : "unknown"

  return `${brandContext}

Product / Offering:
${productContext}

Influencer:
- Handle: @${influencer.handle} on ${influencer.platform}
- Followers: ${followerDisplay}
${influencer.bio ? `- Bio: ${influencer.bio}` : ""}

Campaign Name: ${campaignName}

Create a complete collaboration brief for this influencer campaign.

Respond with this exact JSON:
{
  "campaign_name": "${campaignName}",
  "overview": "2-3 sentence campaign overview",
  "deliverables": ["deliverable 1", "deliverable 2"],
  "talking_points": ["key message 1", "key message 2"],
  "dos": ["do this", "do that"],
  "donts": ["don't do this", "don't do that"],
  "key_hashtags": ["hashtag1", "hashtag2"],
  "content_direction": "paragraph describing the visual and creative direction",
  "timeline_suggestion": "e.g. 2 weeks from brief to post",
  "compensation_suggestion": "e.g. Gifted product + INR 15,000 flat fee"
}`
}
