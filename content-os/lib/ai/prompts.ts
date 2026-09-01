import type { BrandRow, ProductRow } from "@/types/database"
import type { HookType, Platform } from "@/types/app"

export const QUALITY_BAR = `

QUALITY STANDARD — every piece of content must meet this bar:
- Sound like a skilled human copywriter wrote it, not a generic AI
- Be SPECIFIC to this brand's actual products/niche, never generic filler like "amazing deals" or "great quality"
- Have a clear emotional angle (curiosity, urgency, humor, relatability, aspiration) — never flat or purely informational
- Avoid generic AI-sounding phrases and clichés (e.g. "in today's fast-paced world", "unlock the power of", "elevate your", "game-changer", "look no further", "take it to the next level") — write like a real person who knows this specific brand, not generic marketing copy
- Do not use em dashes (—); use commas, periods, or natural sentence breaks instead
- Match the EXACT tone_of_voice provided — if it's "playful", be genuinely funny; if "premium", be genuinely elevated
- NEVER mention third-party platforms (Amazon, Flipkart, Myntra, Nykaa, Meesho, etc.) unless explicitly part of the brand's stated sales channels
- NEVER name, quote, or imply endorsement, association, or a personal opinion from any real, identifiable person (celebrities, influencers, public figures) — even if such a name appears in the brand's own input fields (e.g. "campaign angle" or "additional context"). If a real name appears in an input, treat it only as a loose style/vibe cue (e.g. "glamorous, red-carpet energy") and never as a literal claim like "X's favorite" or "loved by X" — that fabricates a false endorsement and is a real legal risk for the brand`

export function buildBrandContext(brand: BrandRow, product?: ProductRow | null): string {
  const lines: string[] = [
    `Brand: ${brand.name}`,
  ]
  if (brand.description) lines.push(`Brand Description: ${brand.description}`)
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

/**
 * Injects the brand's own past highly-rated content as few-shot examples.
 * Returns an empty string when there's nothing to show — never fabricates
 * a style pattern for a brand with no rating history yet.
 */
export function buildPastExamplesBlock(examples: string[], label: string): string {
  if (examples.length === 0) return ""
  return `\n\nHere are examples of ${label} this brand's user has previously rated highly — match this style and quality bar where relevant:\n${examples.map((e, i) => `${i + 1}. ${e}`).join("\n\n")}`
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

// Opt-in extra output field for the Create → Full Post flow only — grounds
// the post's AI-generated image in the same specific message as the
// caption, rather than a generic brand-vibe photo generated independently.
// Standalone caption generation (the Captions/Content tabs) never sets
// this, so their JSON contract is unchanged.
const IMAGE_PROMPT_INSTRUCTION = `
IMAGE PROMPT: Also produce an "image_prompt" — a vivid, CONCRETE visual scene description for an AI image generator. It must be grounded in THIS brand's actual niche/industry and product category from the brand context above, and in this specific post's message/topic — never a generic, brand-agnostic scene that could belong to any company.
- Name the actual kind of product or scene the niche implies, not an abstraction: a skincare brand → the actual skincare product/routine/texture, not "a product"; a food or beverage brand → the actual dish, drink, or ingredient, not generic packaging on a white background; an apparel brand → the actual garment being worn or styled, not a mannequin in a void.
- If there's a specific offer, event, or theme in this post (e.g. "weekend flash sale," "new packaging launch"), the scene must visually reflect that, not just show the brand/product in the abstract.
- Avoid vague filler words ("amazing," "great quality," "high quality," "beautiful") — describe what's actually visible instead.
- Avoid generic corporate stock-photo compositions (laptops on a desk, empty office interiors, generic handshake or boardroom meeting scenes) UNLESS this brand's niche is genuinely tech/software/SaaS.
- It must NOT describe any text, caption, or words appearing in the image itself (text is added separately) — as a soft compositional hint, leave the lower third of the frame visually simpler/less busy, since text will be overlaid there, but do not rely on this for actual text placement.`

// Readable labels for BrandRow.vibe (a free-text column, same values as
// app/onboarding/brand-profile/page.tsx's VIBE_LABELS) — used to surface
// the brand's own stated vibe directly in the caption system prompt
// instead of leaving VIBE MATCHING to be inferred from tone_of_voice alone
// (see docs/research/captions-generation-audit.md §3 — vibe was the single
// most actionable unused brand field).
export const CAPTION_VIBE_LABELS: Record<string, string> = {
  fun_playful: "Fun & Playful",
  clean_minimal: "Clean & Minimal",
  bold_dramatic: "Bold & Dramatic",
  warm_cozy: "Warm & Cozy",
  professional: "Professional",
  trendy_genz: "Trendy & Gen Z",
}

// Hard character caps per platform — single source of truth shared between
// the prompt text below (platformRules) and captions-generator.ts's
// post-generation validation, so the two can never drift apart.
export const PLATFORM_CHAR_LIMITS: Record<Platform, number> = {
  instagram: 2200,
  facebook: 500,
  tiktok: 300,
  youtube: 500,
  linkedin: 3000,
  twitter: 280,
}

export function buildCaptionSystemPrompt(vibe?: string | null, includeImagePrompt = false): string {
  const vibeLabel = vibe ? CAPTION_VIBE_LABELS[vibe] ?? vibe : null

  return `You are an expert social media copywriter for Indian D2C brands. You write captions that convert — not just get likes.

CAPTION STRUCTURE (follow this every time):
1. Hook line — restate or evolve the opening hook (1 punchy line), SPECIFIC to this brand/topic — never a generic template opener

GOOD hook lines (study these):
✓ "Your skin is lying to you."
✓ "Nobody talks about this beauty mistake."
✓ "Stop searching. You found it."

BAD hook lines (never write these):
✗ "Are you tired of dull skin?"
✗ "Introducing our newest collection!"
✗ "Shop now and save 20%!"

2. Story or value — 2-4 lines building connection, value, or relatability
3. CTA line — one clear action (always ends with brand's CTA phrase + @handle)

CAPTION LENGTH: Default to short-to-medium — keep the hook line under ~150 characters and the overall caption tight (a few short lines), unless the additional context signals a storytelling, educational, or narrative angle, in which case the story/value section above can extend further.

Hashtags are NEVER part of caption_text — they belong ONLY in the separate "hashtags" JSON field described below. Do not append, embed, or repeat any hashtag anywhere inside caption_text.

NEVER OPEN A CAPTION WITH:
- "Are you tired of..."
- "Introducing..."
- "In today's fast-paced world..."
- "Let's talk about..."
These read as generic AI filler, not a real hook.

HASHTAG STRATEGY — 5+5+5 RULE (for the separate "hashtags" field, exactly 15-20 tags total):
- 5 niche-specific (medium competition, 100K–2M posts): e.g. #SkincareRoutine, #CleanBeautyIndia
- 5 brand/product-specific (low competition, unique to brand): e.g. #BrandName, #ProductName
- 5 broad/trending (high volume, 5M+ posts): e.g. #Skincare, #Beauty, #SelfCare

VIBE MATCHING:${vibeLabel ? `\nThis brand's stated vibe is "${vibeLabel}" — use it together with the tone_of_voice above to decide which style below to lean into most (a brand can blend more than one, but the stated vibe should be the dominant signal, not a guess).` : ""}
- Educational: "Here's why...", "The truth about...", teach a lesson
- Entertaining: humor, relatable "when you..." moments, wit
- Inspirational: "You deserve...", "Imagine...", second-person empowerment
- Sales: urgency + value + social proof in one paragraph
- Community: "Tag someone who...", "Drop a 🤍 if...", inclusive CTAs

MANDATORY: The last 1-2 lines of caption_text MUST be the brand's CTA phrase followed by @handle on a new line.
${includeImagePrompt ? IMAGE_PROMPT_INSTRUCTION : ""}
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
    pastExamples?: string[]
    includeImagePrompt?: boolean
  }
): string {
  const brandContext = buildBrandContext(brand, options.product)
  const hookLine = options.hookText ? `Opening hook to use: "${options.hookText}"` : "Create your own strong opening"
  const extraContext = options.additionalContext ? `Additional context: ${options.additionalContext}` : ""
  const pastExamplesBlock = buildPastExamplesBlock(options.pastExamples ?? [], "captions")

  const b = brand as BrandRow & {
    cta_phrase?: string | null
  }
  const ctaPhrase = b.cta_phrase || "Shop now"
  const handle = brand.instagram_handle ? `@${brand.instagram_handle}` : ""

  // Hashtag counts/placement are intentionally NOT mentioned per-platform
  // here — the system prompt's HASHTAG STRATEGY section is the single,
  // global rule (always 15-20, always in the separate "hashtags" field)
  // regardless of platform. Per-platform text used to also state a
  // different, contradicting hashtag count (e.g. "1-2 or none" for
  // Twitter) — that directly conflicted with the global rule and the
  // validation in captions-generator.ts now enforces, so it's gone.
  const platformRules: Record<Platform, string> = {
    instagram: `Max ${PLATFORM_CHAR_LIMITS.instagram} chars. Use line breaks for readability. 3-5 paragraphs. End with: "${ctaPhrase} 👇\\n${handle}".`,
    facebook: `Max ${PLATFORM_CHAR_LIMITS.facebook} chars. Conversational. End with "${ctaPhrase}".`,
    tiktok: `Max ${PLATFORM_CHAR_LIMITS.tiktok} chars. Punchy. End with "Follow ${handle || "us"} for more!"`,
    youtube: `Max ${PLATFORM_CHAR_LIMITS.youtube} chars. Informative. End with "${ctaPhrase}".`,
    linkedin: `Max ${PLATFORM_CHAR_LIMITS.linkedin} chars. Professional storytelling. End with "What do you think? Comment below 👇".`,
    twitter: `Max ${PLATFORM_CHAR_LIMITS.twitter} chars. Punchy.`,
  }

  const endingExample = handle
    ? `"${ctaPhrase} 👇\\n${handle}"`
    : `"${ctaPhrase} 👇"`

  const imagePromptField = options.includeImagePrompt
    ? `,\n  "image_prompt": "vivid scene description grounded in this post's specific message/topic above, no text or words in the image, lower third kept visually simpler for text overlay"`
    : ""

  const vibeLine = brand.vibe ? `Brand Vibe: ${CAPTION_VIBE_LABELS[brand.vibe] ?? brand.vibe}` : ""

  return `${brandContext}${vibeLine ? `\n${vibeLine}` : ""}${pastExamplesBlock}
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
  "cta": "${ctaPhrase}"${imagePromptField}
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
    pastExamples?: string[]
  }
): string {
  const brandContext = buildBrandContext(brand, options.product)
  const extraContext = options.additionalContext ? `Additional context: ${options.additionalContext}` : ""
  const pastExamplesBlock = buildPastExamplesBlock(options.pastExamples ?? [], "reel scripts")

  return `${brandContext}${pastExamplesBlock}
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
    pastExamples?: string[]
  }
): string {
  const brandContext = buildBrandContext(brand, options.product)
  const extraContext = options.additionalContext ? `Additional context: ${options.additionalContext}` : ""
  const pastExamplesBlock = buildPastExamplesBlock(options.pastExamples ?? [], "stories")

  return `${brandContext}${pastExamplesBlock}
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

export function buildCarouselSystemPrompt(vibe?: string | null): string {
  const vibeLabel = vibe ? CAPTION_VIBE_LABELS[vibe] ?? vibe : null

  return `You are a carousel content strategist for Indian D2C brands on Instagram.
You build swipeable carousels that educate, entertain, or convert — with a clear narrative arc.
Slide 1 is always the hook. The last slide is always the CTA.
Each slide headline is short and bold; body text adds the detail.

SLIDE TEXT FORMATS — vary the structure slide-by-slide instead of every
slide defaulting to the same "punchy claim + supporting detail" shape for
"headline"/"body" — don't force every sequence through the same rotation,
and don't use the same format twice in a row:
- Direct statement — "headline" states the value prop or fact outright,
  "body" adds one or two supporting details. (The default shape — use it,
  but not for every slide.)
- Question — "headline" poses a real question the viewer would ask
  themselves, "body" teases or answers it.
- Stat / number callout — "headline" leads with a striking number or
  statistic, "body" explains what it means.
- Contrast — "headline" names a before/after or old-way/new-way shift,
  "body" is the other half of the contrast.

NEVER OPEN A SLIDE HEADLINE WITH:
- "Are you tired of..."
- "Introducing..."
- "In today's fast-paced world..."
- "Let's talk about..."
These read as generic AI filler, not a real hook.

VIBE MATCHING:${vibeLabel ? `\nThis brand's stated vibe is "${vibeLabel}" — use it together with the tone_of_voice above to decide which style below to lean into most (a brand can blend more than one, but the stated vibe should be the dominant signal, not a guess).` : ""}
- Educational: "Here's why...", "The truth about...", teach a lesson
- Entertaining: humor, relatable "when you..." moments, wit
- Inspirational: "You deserve...", "Imagine...", second-person empowerment
- Sales: urgency + value + social proof in one paragraph
- Community: "Tag someone who...", "Drop a 🤍 if...", inclusive CTAs
${QUALITY_BAR}

Always respond with valid JSON only. No markdown, no explanation.`
}

export function buildCarouselUserPrompt(
  brand: BrandRow,
  options: {
    additionalContext?: string
    product?: ProductRow | null
    pastExamples?: string[]
  }
): string {
  const brandContext = buildBrandContext(brand, options.product)
  const extraContext = options.additionalContext ? `Additional context: ${options.additionalContext}` : ""
  const pastExamplesBlock = buildPastExamplesBlock(options.pastExamples ?? [], "carousels")
  const vibeLine = brand.vibe ? `Brand Vibe: ${CAPTION_VIBE_LABELS[brand.vibe] ?? brand.vibe}` : ""

  return `${brandContext}${vibeLine ? `\n${vibeLine}` : ""}${pastExamplesBlock}
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

// ─── Blog post — dedicated long-form article generator (Create tab) ───────
// Distinct from buildBlogPostSystemPrompt/buildBlogPostUserPrompt above,
// which power the generic content-generator.ts "blog_post" format (short,
// plain-prose, optional topic). This pair backs the dedicated Blog Post
// card instead: a required user topic, structured subheadings, and
// suggested tags — a genuinely different content shape, so it gets its own
// builders rather than overloading the generic ones.

export function buildBlogArticleSystemPrompt(): string {
  return `You are an SEO content writer for Indian D2C brand blogs.
You write helpful, well-structured long-form articles that rank and convert — not fluffy filler content or keyword-stuffed spam.
Articles are written in the brand's tone, reference the Indian consumer context where relevant, and end with a natural conclusion — never fake urgency ("only 2 left!", "offer ends tonight") or invented statistics/claims about the brand or its products.
Structure: an intro paragraph, 2-4 subheadings each with real substance underneath, and a conclusion paragraph. Use natural keyword usage relevant to the brand's niche — never keyword-stuffed.
${QUALITY_BAR}

Always respond with valid JSON only. No markdown, no explanation.`
}

export function buildBlogArticleUserPrompt(
  brand: BrandRow,
  options: {
    userPrompt: string
    product?: ProductRow | null
    pastExamples?: string[]
    /** Target total body word count — the model has no other length
     * anchor otherwise, which was producing inconsistent (sometimes thin,
     * sometimes bloated) articles. Distributed across however many
     * subheadings the article actually needs, not a per-section split. */
    wordLimit: number
  }
): string {
  const brandContext = buildBrandContext(brand, options.product)
  const pastExamplesBlock = buildPastExamplesBlock(options.pastExamples ?? [], "blog posts")

  return `${brandContext}${pastExamplesBlock}

Topic requested by the brand's user: "${options.userPrompt}"

Write a full SEO-friendly blog article for the above brand on this topic${options.product ? `, naturally featuring "${options.product.name}" where relevant` : ""}. Stay faithful to the requested topic — do not drift to an unrelated angle.

Requirements:
- title: SEO-friendly, compelling, under 70 characters
- body: intro paragraph, then 2-4 subheadings each followed by 1-3 paragraphs of real substance, then a conclusion paragraph. Format subheadings as a line of their own (no markdown # symbols), with \\n\\n separating paragraphs and subheadings. Target approximately ${options.wordLimit} words total for the body — stay within roughly 15% of this target, don't pad with filler to hit it and don't cut real substance short to stay under it.
- meta_description: 140-160 characters, includes the primary keyword, written for search results
- suggested_tags: 4-6 short topic/category tags for this post (no # symbol)

Respond with this exact JSON:
{
  "title": "post title",
  "body": "full article body with subheadings and \\n\\n paragraph breaks",
  "meta_description": "SEO meta description under 160 chars",
  "suggested_tags": ["tag1", "tag2"]
}`
}

// ─── Ad copy ─────────────────────────────────────────────────────────────

export function buildAdCopySystemPrompt(vibe?: string | null): string {
  const vibeLabel = vibe ? CAPTION_VIBE_LABELS[vibe] ?? vibe : null

  return `You are a performance copywriter specialising in Meta (Facebook/Instagram) ads for Indian D2C brands.
You write ad copy that stops the scroll and drives action — not brand awareness fluff.
You follow Meta's character limits: headline ≤40 characters, primary text ≤125 characters recommended.
Your copy is specific, benefit-led, and speaks the customer's language.

NEVER OPEN WITH:
- "Are you tired of..."
- "Introducing..."
- "In today's fast-paced world..."
- "Let's talk about..."
These read as generic AI filler, not a real hook.

AD ANGLE VARIETY: Vary the angle across generations for the same brand instead of defaulting to the same shape every time:
- Direct benefit-led — headline/primary_text states the core benefit or outcome outright
- Question/pain-point-led — opens on a real question or frustration the customer already has
- Stat or number-led — leads with a striking number, result, or statistic
- Social-proof-led — leans on reviews, results, or "why customers choose us"

VIBE MATCHING:${vibeLabel ? `\nThis brand's stated vibe is "${vibeLabel}" — use it together with the tone_of_voice above to decide which style below to lean into most (a brand can blend more than one, but the stated vibe should be the dominant signal, not a guess).` : ""}
- Educational: "Here's why...", "The truth about...", teach a lesson
- Entertaining: humor, relatable "when you..." moments, wit
- Inspirational: "You deserve...", "Imagine...", second-person empowerment
- Sales: urgency + value + social proof in one paragraph
- Community: "Tag someone who...", "Drop a 🤍 if...", inclusive CTAs
${QUALITY_BAR}

Always respond with valid JSON only. No markdown, no explanation.`
}

export function buildAdCopyUserPrompt(
  brand: BrandRow,
  options: {
    additionalContext?: string
    product?: ProductRow | null
    pastExamples?: string[]
  }
): string {
  const brandContext = buildBrandContext(brand, options.product)
  const extraContext = options.additionalContext ? `Campaign angle: ${options.additionalContext}` : ""
  const pastExamplesBlock = buildPastExamplesBlock(options.pastExamples ?? [], "ad copies")
  const vibeLine = brand.vibe ? `Brand Vibe: ${CAPTION_VIBE_LABELS[brand.vibe] ?? brand.vibe}` : ""

  return `${brandContext}${vibeLine ? `\n${vibeLine}` : ""}${pastExamplesBlock}
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

// Shared across every AI image prompt built in this codebase (the
// standalone Images tab here) — no-text/no-watermark rules matter
// regardless of which flow is asking. Anatomy clause rewritten from vague
// "anatomically correct... correct number of fingers and limbs" to
// specific counting language — diffusion models respond far more reliably
// to concrete counts ("exactly two arms and two hands per person, five
// fingers per hand") than generic correctness phrasing, which reportedly
// wasn't enough to reliably prevent extra-limb anomalies (e.g. a woman
// with three hands). Also adds general surface-cleanliness language this
// boilerplate previously lacked entirely. Mirrors the same strengthening
// applied to lib/ai/post-image-pipeline.ts's own
// POST_IMAGE_QUALITY_AND_NEGATIVE_GUARD.
export const IMAGE_QUALITY_SAFETY_BOILERPLATE = "professional photography, no text, no watermarks, no logos, no illegible text or symbols, no social media UI elements, no usernames or @handles, no URLs or website addresses, no 'link in bio' or similar caption-style text, no fake app interface elements, if any people are shown: exactly two arms and two hands per person, five fingers per hand, no extra or duplicated limbs, no merged or fused body parts, no distorted or extra fingers, anatomically normal human proportions, natural hand positioning, no blemishes, no visual artifacts, no compression artifacts, no random marks or smudges, no color banding, clean unmarked surface, 8K ultra HD, sharp focus"

export function buildImagePrompt(
  brand: BrandRow,
  options: {
    prompt: string
    style?: string
    product?: ProductRow | null
    /** Shorter retry-prompt variant for lib/ai/image-generator.ts's
     * fallback attempt (mirrors post-image-pipeline.ts's simplifyPrompt
     * pattern: shorten to the core clause, re-add the fixed style/safety
     * framing, drop the more specific product-name/color-palette detail)
     * -- built locally here rather than reusing simplifyPrompt directly,
     * since that one bakes in Post's own PHOTOGRAPHY_STYLE ("shot on a
     * full-frame DSLR..."), which actively conflicts with some of this
     * tab's own style choices (e.g. ugc_style explicitly wants a
     * "handheld phone photography feel"). */
    simplified?: boolean
  }
): string {
  // User's description ALWAYS comes first (shortened to its core clause
  // in simplified mode, same shortening rule as simplifyPrompt).
  const promptCore = options.simplified
    ? (options.prompt.split(",")[0]?.trim() || options.prompt.slice(0, 150))
    : options.prompt
  const lines: string[] = [promptCore]

  if (options.style && IMAGE_STYLE_DESCRIPTIONS[options.style]) {
    lines.push(IMAGE_STYLE_DESCRIPTIONS[options.style])
  }

  if (brand.niche) lines.push(`${brand.niche} brand aesthetic`)

  if (!options.simplified && options.product) {
    lines.push(`featuring ${options.product.name}`)
  }

  if (!options.simplified && brand.color_palette && typeof brand.color_palette === "object") {
    const palette = brand.color_palette as Record<string, unknown>
    const colors = Object.values(palette).filter((v) => typeof v === "string")
    if (colors.length) lines.push(`color palette ${colors.join(", ")}`)
  }

  lines.push(IMAGE_QUALITY_SAFETY_BOILERPLATE)
  // The single most effective lever against anatomy anomalies: a shot with
  // no people in it can't have an extra-limb problem at all. Strengthened
  // from the previous "prefer clear product framing... over close-up human
  // hand or body detail" (which only nudged away from close-ups, not
  // people generally) to bias toward excluding people entirely unless the
  // scene genuinely needs one. Mirrors
  // lib/ai/post-image-pipeline.ts's NO_PEOPLE_BY_DEFAULT_GUARD.
  lines.push("prefer product-only or environmental/lifestyle framing with no visible people, unless the product or scene specifically requires a person (e.g. an apparel item worn on a body, a hand actively demonstrating product use) — when a person isn't genuinely needed, exclude people from the frame entirely rather than including one incidentally")

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
