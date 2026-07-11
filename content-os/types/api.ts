/**
 * Standardized API response shapes.
 * Every API route must use these — never deviate.
 */

export type ApiSuccess<T> = {
  data: T
  meta?: {
    total: number
    page: number
    limit: number
  }
}

export type ApiError = {
  error: {
    code: string
    message: string
    details?: string
    /** Safe to show/report to the user — greppable in server logs to find the full error, without exposing internals in the response itself. */
    correlationId: string
  }
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError

// Type guard
export function isApiError(response: unknown): response is ApiError {
  return (
    typeof response === "object" &&
    response !== null &&
    "error" in response
  )
}

// Standard error codes
export const ErrorCodes = {
  UNAUTHENTICATED: "UNAUTHENTICATED",
  UNAUTHORIZED: "UNAUTHORIZED",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  BRAND_NOT_FOUND: "BRAND_NOT_FOUND",
  PRODUCT_NOT_FOUND: "PRODUCT_NOT_FOUND",
  AI_GENERATION_FAILED: "AI_GENERATION_FAILED",
  USAGE_LIMIT_EXCEEDED: "USAGE_LIMIT_EXCEEDED",
} as const

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes]

// Helper to build error responses
export function buildError(
  code: ErrorCode,
  message: string,
  details?: string
): ApiError {
  // A short per-error ID, safe to return to the client and to ask a user
  // to quote in a support request — logged here (server-side only) so it
  // can be grepped against whatever richer, route-specific console.error
  // context was already logged immediately before this was called.
  const correlationId = crypto.randomUUID()
  console.error(`[${correlationId}] ${code}: ${message}`)

  return {
    error: {
      code,
      message,
      correlationId,
      ...(details && process.env.NODE_ENV === "development" ? { details } : {}),
    },
  }
}
