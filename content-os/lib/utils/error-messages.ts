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
  return "Something went wrong. Please try again in a moment."
}
