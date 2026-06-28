export type ImageFormat = "square" | "portrait" | "story" | "landscape"

export interface ImageRequest {
  format: ImageFormat
  vibe?: string
  brand: {
    name: string
    niche?: string | null
    primary_color?: string | null
    vibe?: string | null
  }
  product?: {
    name: string
    description?: string | null
    image_url?: string
  }
  custom_prompt?: string
  seed?: number
}

export interface ImageResult {
  url: string
  variations: string[]
}

const VIBE_STYLES: Record<string, string> = {
  fun_playful: "bright colorful photography, vibrant, fun energy, joyful",
  clean_minimal: "minimal white studio photography, clean aesthetic, elegant, simple",
  bold_dramatic: "dark dramatic photography, high contrast, moody, powerful editorial",
  warm_cozy: "warm golden hour photography, cozy lifestyle, inviting, soft light",
  professional: "professional corporate photography, clean business aesthetic, credible",
  trendy_genz: "trendy aesthetic photography, gen z vibes, editorial fresh, colourful",
}

const FORMAT_DIMS: Record<ImageFormat, string> = {
  square: "width=1080&height=1080",
  portrait: "width=1080&height=1350",
  story: "width=1080&height=1920",
  landscape: "width=1920&height=1080",
}

function buildPrompt(request: ImageRequest): string {
  if (request.custom_prompt) {
    return `${request.custom_prompt}, no text, no watermarks, no people, professional, 8K ultra HD`
  }

  const vibeKey = request.vibe ?? request.brand.vibe ?? "fun_playful"
  const vibeStyle = VIBE_STYLES[vibeKey] ?? VIBE_STYLES.fun_playful
  const niche = request.brand.niche ?? "lifestyle brand"
  const productCtx = request.product
    ? `${request.product.name}${request.product.description ? `, ${request.product.description.slice(0, 80)}` : ""},`
    : ""

  return `${productCtx} ${vibeStyle}, ${niche}, no people, no text, no watermarks, photorealistic, 8K ultra HD`
}

export function generateImage(request: ImageRequest): ImageResult {
  const prompt = buildPrompt(request)
  const dims = FORMAT_DIMS[request.format]
  const encoded = encodeURIComponent(prompt)

  const baseSeed = request.seed ?? Math.floor(Math.random() * 99999)
  const seeds = [baseSeed, baseSeed + 1, baseSeed + 2]

  const variations = seeds.map(
    s => `https://image.pollinations.ai/prompt/${encoded}?${dims}&seed=${s}&nologo=true&model=flux&enhance=true`
  )

  return { url: variations[0]!, variations }
}
