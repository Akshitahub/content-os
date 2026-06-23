import type { BrandRow, ProductRow } from "@/types/database"
import type { AspectRatio, ImageStyle } from "@/types/app"
import { buildImagePrompt } from "./prompts"

export class ImageGenerationError extends Error {}

export async function generateImage(
  brand: BrandRow,
  options: {
    prompt: string
    style?: ImageStyle
    aspectRatio: AspectRatio
    product?: ProductRow | null
  }
): Promise<{ buffer: Buffer; mimeType: string; fullPrompt: string }> {
  const fullPrompt = buildImagePrompt(brand, {
    prompt: options.prompt,
    style: options.style,
    product: options.product,
  })

  const encodedPrompt = encodeURIComponent(fullPrompt)
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true&model=flux`

  let res: Response
  try {
    res = await fetch(url)
  } catch (err) {
    throw new ImageGenerationError(
      err instanceof Error ? err.message : "Image generation request failed."
    )
  }

  if (!res.ok) {
    throw new ImageGenerationError(`Pollinations API error (${res.status})`)
  }

  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    mimeType: "image/jpeg",
    fullPrompt,
  }
}
