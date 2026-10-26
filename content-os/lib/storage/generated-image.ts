import sharp from "sharp"

// Storage-bound encoding for AI-generated / composited images (never for a
// user's own uploaded originals). The image models and compositors emit
// ~2 MB PNGs; JPEG q85 + mozjpeg is a fraction of that and is still the
// format Instagram's publishing API requires (it doesn't accept WebP).
// PNG is kept only when the image has real transparency (logos, cutouts).

export type StorageImage = { buffer: Buffer; mimeType: string; ext: string }

const JPEG_QUALITY = 85

function extFor(mimeType: string): string {
  return mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg"
}

/**
 * Re-encodes a generated image buffer for upload. Non-image buffers and
 * images that are already JPEG pass through untouched (re-encoding a JPEG
 * only loses quality). Fail-soft: if sharp can't read the buffer, the
 * original bytes are uploaded as-is.
 */
export async function prepareGeneratedImage(buffer: Buffer, mimeType: string, logTag: string): Promise<StorageImage> {
  if (!mimeType.startsWith("image/") || mimeType.includes("jpeg") || mimeType.includes("jpg")) {
    return { buffer, mimeType, ext: extFor(mimeType) }
  }
  try {
    const image = sharp(buffer)
    const { hasAlpha } = await image.metadata()
    if (hasAlpha && !(await image.stats()).isOpaque) {
      console.log(`[storage-image] ${logTag}: kept ${mimeType} (has transparency), ${buffer.length} bytes`)
      return { buffer, mimeType, ext: extFor(mimeType) }
    }
    const jpeg = await image.flatten({ background: "#ffffff" }).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer()
    console.log(`[storage-image] ${logTag}: ${mimeType} ${buffer.length} -> image/jpeg ${jpeg.length} bytes`)
    return { buffer: jpeg, mimeType: "image/jpeg", ext: "jpg" }
  } catch (err) {
    console.error(`[storage-image] ${logTag}: re-encode failed, uploading original ${mimeType}:`, err)
    return { buffer, mimeType, ext: extFor(mimeType) }
  }
}
