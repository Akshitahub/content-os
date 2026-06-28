const POWER_WORDS = [
  "you", "secret", "never", "always", "why", "how", "stop", "start",
  "free", "now", "today", "instantly", "proven", "revealed", "warning",
  "finally", "truth", "mistake", "wrong", "real", "honest", "shocking",
]

const EMOTIONAL_WORDS = [
  "amazing", "incredible", "terrifying", "devastating", "love", "hate",
  "obsessed", "brutal", "addicted", "beautiful", "ugly", "fear",
]

export function scoreHook(text: string): number {
  let score = 5
  const lower = text.toLowerCase()
  const len = text.length

  // Length: sweet spot 40-120 chars
  if (len < 20) score -= 2
  else if (len < 40) score -= 1
  else if (len <= 120) score += 1
  else if (len > 200) score -= 1

  // Power words (max +2)
  score += Math.min(POWER_WORDS.filter(w => lower.includes(w)).length, 2)

  // Question = engagement
  if (text.includes("?")) score += 1

  // Numbers = specificity/authority
  if (/\d/.test(text)) score += 1

  // Emotional intensity (+1 if any)
  if (EMOTIONAL_WORDS.some(w => lower.includes(w))) score += 1

  return Math.max(0, Math.min(10, score))
}

export function scoreLabel(score: number): string {
  if (score >= 8) return "Viral"
  if (score >= 6) return "Strong"
  if (score >= 4) return "Good"
  if (score >= 2) return "Fair"
  return "Weak"
}

export function scoreColor(score: number): string {
  if (score >= 8) return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
  if (score >= 6) return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
  if (score >= 4) return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
  return "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300"
}
