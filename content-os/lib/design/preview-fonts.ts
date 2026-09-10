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
