import { Anton, Inter, Playfair_Display, Quicksand, Caveat } from "next/font/google"
import type { FontId } from "./fonts"

const anton = Anton({ weight: "400", subsets: ["latin"] })
const inter = Inter({ weight: "700", subsets: ["latin"] })
const playfair = Playfair_Display({ weight: "700", subsets: ["latin"] })
const quicksand = Quicksand({ weight: "700", subsets: ["latin"] })
const caveat = Caveat({ weight: "700", subsets: ["latin"] })

// Client-side approximation of the same 5 curated faces the server-side
// compositor (lib/image/story-compositor.ts, carousel-compositor.ts) bakes
// into the real exported PNG — lets the in-editor preview actually show
// what font is selected instead of always rendering the browser default.
export const PREVIEW_FONT_CLASS: Record<FontId, string> = {
  anton: anton.className,
  inter: inter.className,
  playfair: playfair.className,
  quicksand: quicksand.className,
  caveat: caveat.className,
}

// The same faces as CSS font-family values plus the weight each one is
// loaded at -- for drawing on a <canvas> (lib/utils/post-overlay-export.ts),
// which can't use a className.
export const PREVIEW_FONT_FAMILY: Record<FontId, { family: string; weight: number }> = {
  anton: { family: anton.style.fontFamily, weight: 400 },
  inter: { family: inter.style.fontFamily, weight: 700 },
  playfair: { family: playfair.style.fontFamily, weight: 700 },
  quicksand: { family: quicksand.style.fontFamily, weight: 700 },
  caveat: { family: caveat.style.fontFamily, weight: 700 },
}
