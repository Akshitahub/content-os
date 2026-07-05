export function getFriendlyError(error: unknown): string {
  const msg = error instanceof Error
    ? error.message
    : String(error)

  if (msg.includes("rate limit") || msg.includes("429")) {
    return "Our AI is taking a quick break 😅 Try again in 30 seconds."
  }
  if (msg.includes("GROQ_API_KEY")) {
    return "Configuration issue. Please contact support."
  }
  if (msg.includes("USAGE_LIMIT_EXCEEDED")) {
    return "You've used all your credits for this month. Upgrade to keep creating! 🚀"
  }
  if (msg.includes("BRAND_NOT_FOUND")) {
    return "Brand not found. Please select a brand from the sidebar."
  }
  if (msg.includes("network") || msg.includes("fetch")) {
    return "Connection issue. Check your internet and try again."
  }
  if (msg.includes("timeout")) {
    return "This took too long. Please try again."
  }
  if (msg.includes("AI_GENERATION_FAILED") || msg.includes("invalid JSON") || msg.includes("Invalid JSON")) {
    return "Our AI had a hiccup generating this. Just hit try again — it usually works on the second attempt."
  }

  // Doesn't match any known raw-error pattern above and doesn't look like a
  // raw technical error (stack trace, JS built-in error name) — this is
  // likely already a clean, specific message from one of our own API
  // routes (e.g. "Couldn't generate the meme image. Please try again."),
  // so pass it through instead of masking it with the generic fallback.
  const looksLikeRawError = /^(TypeError|ReferenceError|SyntaxError|RangeError|EvalError|URIError):/.test(msg) || /\bat\s+.+:\d+:\d+/.test(msg)
  if (msg.trim() && !looksLikeRawError) {
    return msg
  }

  return "Something went wrong. Please try again in a moment."
}
