export type GraphErrorBody = {
  error?: {
    message?: string
    code?: number
    error_subcode?: number
  }
}

export type GraphErrorKind = "rate_limit" | "invalid_token" | "permission_error" | "other"

export interface InterpretedGraphError {
  kind: GraphErrorKind
  message: string
  retryable: boolean
}

// Meta rate-limit / throttling error codes — these should be retried on a
// later cron run, not treated as a permanent failure.
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613])
// Invalid/expired OAuth token.
const INVALID_TOKEN_CODE = 190
// Missing a required permission (e.g. token was granted before a scope was
// added to the OAuth request — the user needs to reconnect).
const PERMISSION_ERROR_CODE = 200

/**
 * Classifies a Meta Graph API error response into a shared set of kinds so
 * callers (Instagram/Facebook publish functions) can decide whether to
 * retry and how to phrase the user-facing message, without each
 * duplicating Meta's error-code parsing.
 */
export function interpretGraphError(body: GraphErrorBody): InterpretedGraphError {
  const err = body?.error
  const code = err?.code

  if (code !== undefined && RATE_LIMIT_CODES.has(code)) {
    return { kind: "rate_limit", message: "Meta API rate limit reached — will retry later.", retryable: true }
  }
  if (code === INVALID_TOKEN_CODE) {
    return { kind: "invalid_token", message: err?.message ?? "Access token is invalid or expired.", retryable: false }
  }
  if (code === PERMISSION_ERROR_CODE) {
    return { kind: "permission_error", message: err?.message ?? "Missing permission for this action.", retryable: false }
  }
  return { kind: "other", message: err?.message ?? "Meta Graph API error.", retryable: false }
}
