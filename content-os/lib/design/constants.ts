export const PLATFORM_COLORS: Record<string, { bg: string; text: string; hex: string }> = {
  instagram: { bg: "bg-pink-100", text: "text-pink-700", hex: "#e1306c" },
  tiktok:    { bg: "bg-zinc-900", text: "text-white",    hex: "#000000" },
  facebook:  { bg: "bg-blue-100", text: "text-blue-700", hex: "#1877f2" },
  youtube:   { bg: "bg-red-100",  text: "text-red-700",  hex: "#ff0000" },
  linkedin:  { bg: "bg-blue-50",  text: "text-blue-800", hex: "#0a66c2" },
  twitter:   { bg: "bg-sky-100",  text: "text-sky-700",  hex: "#1da1f2" },
}

export const HOOK_TYPE_COLORS: Record<string, string> = {
  question:     "bg-blue-100 text-blue-700",
  bold_statement: "bg-orange-100 text-orange-700",
  story:        "bg-purple-100 text-purple-700",
  statistic:    "bg-green-100 text-green-700",
  controversial: "bg-red-100 text-red-700",
  how_to:       "bg-teal-100 text-teal-700",
}

export const STATUS_COLORS: Record<string, string> = {
  planned:       "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  content_ready: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  scheduled:     "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  published:     "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  missed:        "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
}

export const TEMPLATE_NAMES: Record<number, string> = {
  1: "Bold Dark",
  2: "Gradient Burst",
  3: "Split Editorial",
  4: "Minimal Light",
  5: "Cinematic Dark",
  6: "Neon Urban",
  7: "Product Spotlight",
  8: "Quote Card",
  9: "Stat Callout",
  10: "Before/After",
  11: "Polaroid",
  12: "Magazine",
}
