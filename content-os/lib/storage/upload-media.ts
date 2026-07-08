import { createAdminClient } from "@/lib/supabase/server"

const BUCKET = "published-media"

export type UploadMediaInput =
  | { kind: "buffer"; buffer: Buffer; mimeType: string }
  | { kind: "dataUrl"; dataUrl: string }
  | { kind: "remoteUrl"; url: string }

export type UploadMediaResult =
  | { publicUrl: string }
  | { error: string }

/**
 * Uploads image bytes (from a Buffer, a data: URL, or by fetching a remote
 * URL server-side) to the public "published-media" Supabase Storage bucket
 * and returns a permanent, app-controlled public HTTPS URL. Instagram's
 * Graph API requires a publicly fetchable HTTPS URL — it cannot accept
 * data: URLs or rely on third-party hosts staying reachable.
 */
export async function uploadMediaToStorage(
  input: UploadMediaInput,
  pathPrefix: string
): Promise<UploadMediaResult> {
  try {
    let buffer: Buffer
    let mimeType: string

    if (input.kind === "buffer") {
      buffer = input.buffer
      mimeType = input.mimeType
    } else if (input.kind === "dataUrl") {
      const match = input.dataUrl.match(/^data:([^;]+);base64,(.+)$/)
      if (!match) return { error: "Invalid data URL." }
      mimeType = match[1]
      buffer = Buffer.from(match[2], "base64")
    } else {
      // Exponential backoff on 429s: 1s, 2s, 4s, 8s over up to 4 retries —
      // widened from 3 retries (500ms-4s) after production testing still
      // showed most scenes failing with 429s under the shorter backoff.
      const backoffDelaysMs = [1000, 2000, 4000, 8000]
      const maxRetries = 4
      let res: Response
      let attempt = 0
      for (;;) {
        try {
          res = await fetch(input.url)
        } catch (err) {
          return { error: err instanceof Error ? err.message : "Failed to fetch source image." }
        }
        if (res.status !== 429 || attempt >= maxRetries) break
        const delay = backoffDelaysMs[attempt] ?? backoffDelaysMs[backoffDelaysMs.length - 1]
        console.log(`[upload-media] Remote fetch rate limited (429), retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`)
        await new Promise((resolve) => setTimeout(resolve, delay))
        attempt++
      }
      if (!res.ok) return { error: `Failed to fetch source image (${res.status}).` }
      mimeType = res.headers.get("content-type") ?? "image/jpeg"
      buffer = Buffer.from(await res.arrayBuffer())
    }

    const ext = mimeType.includes("png") ? "png"
      : mimeType.includes("wav") ? "wav"
      : mimeType.includes("mp4") ? "mp4"
      : mimeType.includes("mp3") || mimeType.includes("mpeg") ? "mp3"
      : mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg"
      : "bin"
    const path = `${pathPrefix}/${Date.now()}-${crypto.randomUUID()}.${ext}`

    const admin = await createAdminClient()
    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: mimeType, upsert: false })

    if (uploadError) {
      return { error: uploadError.message }
    }

    const { data } = admin.storage.from(BUCKET).getPublicUrl(path)
    return { publicUrl: data.publicUrl }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Upload failed." }
  }
}
