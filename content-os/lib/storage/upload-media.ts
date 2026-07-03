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
      let res: Response
      try {
        res = await fetch(input.url)
      } catch (err) {
        return { error: err instanceof Error ? err.message : "Failed to fetch source image." }
      }
      if (!res.ok) return { error: `Failed to fetch source image (${res.status}).` }
      mimeType = res.headers.get("content-type") ?? "image/jpeg"
      buffer = Buffer.from(await res.arrayBuffer())
    }

    const ext = mimeType.includes("png") ? "png" : "jpg"
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
