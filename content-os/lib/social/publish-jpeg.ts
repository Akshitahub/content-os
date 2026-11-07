import sharp from "sharp"
import { uploadMediaToStorage } from "@/lib/storage/upload-media"
import { safeFetch } from "@/lib/web/safe-fetch"

/**
 * Instagram's API with Instagram Login accepts only JPEG images. Our hosted
 * renders are usually JPEG already (lib/storage/generated-image.ts), but a
 * PNG with real transparency, or a WebP upload, would fail at the container
 * step -- so anything that isn't JPEG is converted (quality 90, transparency
 * flattened onto white) and re-hosted under "publish-jpeg/".
 *
 * Server-only (sharp): reached only from the publish cron.
 */

const JPEG_MAGIC = [0xff, 0xd8, 0xff]
const isJpeg = (b: Buffer) => b.length > 3 && JPEG_MAGIC.every((v, i) => b[i] === v)

export type JpegUrlResult = { ok: true; url: string } | { ok: false; error: string }

/** `url` if it's already a JPEG, else a re-hosted JPEG copy of it. Never throws. */
export async function ensureJpegUrl(url: string, brandId: string): Promise<JpegUrlResult> {
  // Our storage names files by their type, so a .jpg / .jpeg path is a JPEG -- no download needed.
  try {
    if (/\.jpe?g$/i.test(new URL(url).pathname)) return { ok: true, url }
  } catch {
    return { ok: false, error: "Invalid image URL" }
  }

  let source: Buffer
  try {
    const { res, body } = await safeFetch(url, { maxBytes: 20 * 1024 * 1024, timeoutMs: 20_000, accept: (type) => !type || type.startsWith("image/") })
    if (!res.ok) return { ok: false, error: `Failed to fetch image (${res.status})` }
    source = body
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to fetch image" }
  }
  if (isJpeg(source)) return { ok: true, url }

  let jpeg: Buffer
  try {
    jpeg = await sharp(source).flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toBuffer()
  } catch (err) {
    return { ok: false, error: `Could not convert image to JPEG: ${err instanceof Error ? err.message : "unknown error"}` }
  }

  const uploaded = await uploadMediaToStorage({ kind: "buffer", buffer: jpeg, mimeType: "image/jpeg" }, `publish-jpeg/${brandId}`)
  if ("error" in uploaded) return { ok: false, error: uploaded.error }
  return { ok: true, url: uploaded.publicUrl }
}
