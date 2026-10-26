import { buildError, ErrorCodes, type ApiError } from "@/types/api"

// Drop-in replacement for `await res.json()` on generation endpoints.
//
// When a Vercel Function is killed (maxDuration hit) or crashes, the
// platform answers with a plain-text/HTML page ("An error occurred with
// your deployment ...") instead of our JSON -- and `res.json()` then
// throws "Unexpected token 'A', 'An error o'... is not valid JSON", which
// is exactly what users were seeing. This never throws on a non-JSON body:
// it returns a normal ApiError object instead, so each caller's existing
// `if (!res.ok || isApiError(json))` branch shows a readable message.
// Typed `any` on purpose, exactly like Response.json() itself, so it can
// replace `await res.json()` anywhere without touching the caller's types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readJsonResponse(res: Response): Promise<any> {
  const contentType = res.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    try {
      return await res.json()
    } catch {
      // Declared JSON but truncated/garbled (e.g. the connection was cut
      // mid-response) -- same handling as a non-JSON body below.
    }
  }
  return nonJsonError(res.status)
}

function nonJsonError(status: number): ApiError {
  // 504 = FUNCTION_INVOCATION_TIMEOUT / gateway timeout; Vercel also
  // returns its plain-text error page with other 5xx codes when a function
  // dies, which for these long AI calls is almost always the same cause.
  if (status === 504 || status === 408 || status >= 500 || status === 0) {
    return buildError(ErrorCodes.AI_GENERATION_FAILED, "Generation timed out, please try again.")
  }
  if (status === 413) {
    return buildError(ErrorCodes.VALIDATION_ERROR, "That upload is too large. Please try a smaller file.")
  }
  return buildError(ErrorCodes.INTERNAL_ERROR, "Something went wrong, please try again.")
}
