import type { BrandRow, ProductRow } from "@/types/database"
import type { AspectRatio, ImageStyle } from "@/types/app"
import { buildImagePrompt } from "./prompts"

const MODEL = "imagen-4.0-generate-001"
const API_BASE = "https://generativelanguage.googleapis.com/v1beta"

// Imagen supports: 1:1, 3:4, 4:3, 9:16, 16:9 — map our values accordingly
const ASPECT_MAP: Record<AspectRatio, string> = {
  "1:1":  "1:1",
  "4:5":  "3:4",  // nearest portrait ratio Imagen offers
  "9:16": "9:16",
  "16:9": "16:9",
}

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
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new ImageGenerationError("GEMINI_API_KEY is not configured on the server.")
  }

  const fullPrompt = buildImagePrompt(brand, {
    prompt: options.prompt,
    style: options.style,
    product: options.product,
  })

  const url = `${API_BASE}/models/${MODEL}:predict?key=${apiKey}`

  let res: Response
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt: fullPrompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio: ASPECT_MAP[options.aspectRatio],
        },
      }),
    })
  } catch (err) {
    throw new ImageGenerationError(
      err instanceof Error ? err.message : "Image generation request failed."
    )
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => "")
    throw new ImageGenerationError(`Imagen API error (${res.status}): ${errBody}`)
  }

  let json: { predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }> }
  try {
    json = await res.json() as typeof json
  } catch {
    throw new ImageGenerationError("Imagen API returned non-JSON response.")
  }

  const prediction = json.predictions?.[0]
  if (!prediction?.bytesBase64Encoded) {
    throw new ImageGenerationError("Imagen returned no image data. Try a different prompt.")
  }

  return {
    buffer: Buffer.from(prediction.bytesBase64Encoded, "base64"),
    mimeType: prediction.mimeType ?? "image/png",
    fullPrompt,
  }
}
