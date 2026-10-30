/**
 * The remove.bg call behind app/api/v1/ai/remove-background (the user-facing
 * route, which charges its own credit) and the annotated_product post
 * template (part of the post's own generation). Returns the cut-out PNG.
 */

export class RemoveBackgroundError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message)
    this.name = "RemoveBackgroundError"
  }
}

export function isRemoveBackgroundConfigured(): boolean {
  return !!process.env.REMOVE_BG_API_KEY
}

export async function removeBackground(image: Blob, opts: { timeoutMs?: number } = {}): Promise<Buffer> {
  const apiKey = process.env.REMOVE_BG_API_KEY
  if (!apiKey) throw new RemoveBackgroundError("Background removal is not configured. Add REMOVE_BG_API_KEY to your environment.")

  const form = new FormData()
  form.append("image_file", image)
  form.append("size", "auto")

  const response = await fetch("https://api.remove.bg/v1.0/removebg", {
    method: "POST",
    headers: { "X-Api-Key": apiKey },
    body: form,
    signal: opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined,
  })
  if (!response.ok) {
    const text = await response.text()
    console.error("[remove-background] remove.bg error:", response.status, text)
    throw new RemoveBackgroundError(
      response.status === 402 ? "Remove.bg free tier limit reached. Get a free API key at remove.bg" : `Background removal failed (${response.status})`,
      response.status,
    )
  }
  return Buffer.from(await response.arrayBuffer())
}
