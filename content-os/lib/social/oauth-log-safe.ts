/**
 * Strips any token-shaped field before an OAuth token-exchange response
 * body is logged. These routes only log the raw provider response on a
 * failed exchange, but "failed" is judged by a missing access_token, not
 * by the full absence of one — a malformed or partial response could still
 * echo back a token (or a refresh_token) alongside an error, and that must
 * never land in server logs verbatim. Recurses into nested objects/arrays
 * since some responses (e.g. Meta's Page listing) nest an access_token per
 * item rather than at the top level.
 */
export function redactTokenFields(body: unknown): unknown {
  if (Array.isArray(body)) return body.map(redactTokenFields)
  if (!body || typeof body !== "object") return body

  const redacted: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    redacted[key] = /token/i.test(key) ? "[REDACTED]" : redactTokenFields(value)
  }
  return redacted
}
