/**
 * Recovers a Supabase Storage object path from one of this app's own
 * public bucket URLs (the only kind ever stored back onto a row — see
 * uploadMediaToStorage) so it can be passed to `storage.from(bucket).remove()`.
 * Mirrors the identical helper already used by
 * app/api/v1/cron/cleanup-abandoned-drafts/route.ts for the same reason:
 * these rows only ever persist the full public_url, not a separate raw
 * path column, so deleting the underlying file requires parsing it back
 * out. Returns null for anything that isn't a real object URL in the
 * given bucket (external/third-party URLs, malformed input) rather than
 * guessing — callers should skip those, not attempt to remove them.
 */
export function extractStoragePath(publicUrl: string, bucket: string): string | null {
  const marker = `/storage/v1/object/public/${bucket}/`
  const idx = publicUrl.indexOf(marker)
  if (idx === -1) return null
  try {
    return decodeURIComponent(publicUrl.slice(idx + marker.length))
  } catch {
    return publicUrl.slice(idx + marker.length)
  }
}
