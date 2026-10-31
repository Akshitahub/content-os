// Dev-only, fully offline check of lib/ai/story-frames.ts's rules -- no
// model calls, no network, no database. Run manually:
// `npx tsx scripts/test-story-frames.ts`. Exits non-zero if any case fails.
//
// NOT reachable in production: a standalone script, never served by
// Next.js. The NODE_ENV guard is defense-in-depth only, same as
// scripts/test-fact-guard.ts.
import { allowedMiddleFrames, finalizeStoryFrames, storyFrameContext } from "@/lib/ai/story-frames"
import type { BrandRow, ProductRow } from "@/types/database"

if (process.env.NODE_ENV === "production") {
  console.error("[test-story-frames] refusing to run with NODE_ENV=production -- this is a dev-only check.")
  process.exit(1)
}

const brand = { name: "Wick & Ember", niche: "candles", description: "Small-batch soy candles hand-poured in Pune", cta_phrase: "Shop now", brand_brain: null } as unknown as BrandRow
const product = { name: "Mogra Glow", description: "Soy wax candle with mogra oil and a cotton wick, 40 hour burn", price: 899, key_benefits: ["40 hour burn"] } as unknown as ProductRow

let failures = 0
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` -- got ${JSON.stringify(detail)}`}`)
  if (!ok) failures++
}

// No number, no product, no quote: only hook frames in the middle.
const plain = storyFrameContext(brand, null, "Bday sale")
check("no data -> only hook in the middle", JSON.stringify(allowedMiddleFrames(plain)) === JSON.stringify(["hook"]), allowedMiddleFrames(plain))

const rich = storyFrameContext(brand, product, `Bday sale, 30% off everything, a customer said "my room smells like home now"`)
check("number + product + quote -> all middle frames", JSON.stringify(allowedMiddleFrames(rich)) === JSON.stringify(["hook", "offer", "product", "proof"]), allowedMiddleFrames(rich))

// Order: hook first, cta last, whatever the model said.
const ordered = finalizeStoryFrames([{ frame: "cta", big_words: "a" }, { frame: "hook", big_words: "b" }, { frame: "hook", big_words: "c" }], plain)
check("first frame is hook, last is cta", ordered[0]!.frame === "hook" && ordered[2]!.frame === "cta", ordered.map((s) => s.frame))

// Word limits.
const longTopic = storyFrameContext(brand, null, "everything we're planning for our birthday week")
const long = finalizeStoryFrames([{ frame: "hook", big_words: "one two three four five", script_line: "a b c d e f g h i" }], longTopic)[0]!
check("big_words capped at 3 words", long.big_words === "one two three", long.big_words)
check("script_line capped at 6 words", long.script_line === "a b c d e f", long.script_line)

// The hook keeps a short topic's own words.
const synonym = finalizeStoryFrames([{ frame: "hook", big_words: "Birthday", script_line: "come celebrate" }, { frame: "cta", big_words: "y" }], plain)[0]!
check("short topic: hook says 'Bday sale', not just 'Birthday'", synonym.big_words === "Bday sale", synonym.big_words)
const kept = finalizeStoryFrames([{ frame: "hook", big_words: "Bday sale is on" }, { frame: "cta", big_words: "y" }], plain)[0]!
check("short topic: a hook already containing it is kept", kept.big_words === "Bday sale is", kept.big_words)

// Offer: the badge number must come from the topic / product.
const invented = finalizeStoryFrames([{ frame: "hook", big_words: "x" }, { frame: "offer", badge: "50% OFF", big_words: "All" }, { frame: "cta", big_words: "y" }], rich)
check("invented discount -> hook, badge dropped", invented[1]!.frame === "hook" && invented[1]!.badge === null, invented[1])
const real = finalizeStoryFrames([{ frame: "hook", big_words: "x" }, { frame: "offer", badge: "30% OFF", big_words: "All" }, { frame: "cta", big_words: "y" }], rich)
check("real discount -> offer kept", real[1]!.frame === "offer" && real[1]!.badge === "30% OFF", real[1])
const noNumberStory = finalizeStoryFrames([{ frame: "hook", big_words: "x" }, { frame: "offer", badge: "30% OFF", big_words: "All" }, { frame: "cta", big_words: "y" }], plain)
check("offer in a story with no numbers -> hook", noNumberStory[1]!.frame === "hook", noNumberStory[1]!.frame)

// The cta names a real offer.
const ctaOffer = finalizeStoryFrames([{ frame: "hook", big_words: "Bday sale" }, { frame: "offer", badge: "30% OFF", big_words: "All" }, { frame: "cta", big_words: "y", cta_label: "Grab yours" }], rich)
check("cta label gets the real offer: 'Grab yours at 30% off'", ctaOffer[2]!.cta_label === "Grab yours at 30% off", ctaOffer[2]!.cta_label)
const ctaHasIt = finalizeStoryFrames([{ frame: "hook", big_words: "Bday sale" }, { frame: "offer", badge: "30% OFF", big_words: "All" }, { frame: "cta", big_words: "y", cta_label: "Take 30% off now" }], rich)
check("cta label already naming the offer is kept", ctaHasIt[2]!.cta_label === "Take 30% off now", ctaHasIt[2]!.cta_label)

// Product: 2 grounded callouts or it's a hook.
const grounded = finalizeStoryFrames([{ frame: "hook", big_words: "x" }, { frame: "product", big_words: "Mogra Glow", callouts: ["soy wax", "40 hour burn"] }, { frame: "cta", big_words: "y" }], rich)
check("grounded callouts -> product kept", grounded[1]!.frame === "product" && (grounded[1]!.callouts as string[]).length === 2, grounded[1])
const ungrounded = finalizeStoryFrames([{ frame: "hook", big_words: "x" }, { frame: "product", big_words: "Glow", callouts: ["vegan leather", "free shipping"] }, { frame: "cta", big_words: "y" }], rich)
check("ungrounded callouts -> hook", ungrounded[1]!.frame === "hook", ungrounded[1])

// A downgraded frame keeps its own words -- never falls back to the topic while it has copy.
const noWords = finalizeStoryFrames([{ frame: "hook", big_words: "x" }, { frame: "product", callouts: ["vegan leather bag", "free shipping"] }, { frame: "cta", big_words: "y" }], plain)
check("downgraded product frame uses its own callout, not the topic", noWords[1]!.frame === "hook" && noWords[1]!.big_words === "vegan leather bag" && noWords[1]!.script_line === "free shipping", noWords[1])

// The product frame's label is the real product, not a made-up name.
const madeUpName = finalizeStoryFrames([{ frame: "hook", big_words: "x" }, { frame: "product", big_words: "Sundown Whisper", callouts: ["soy wax", "40 hour burn"] }, { frame: "cta", big_words: "y" }], rich)
check("invented product name -> the real product's name", madeUpName[1]!.big_words === "Mogra Glow", madeUpName[1]!.big_words)

// Proof: verbatim from the topic only.
const quoted = finalizeStoryFrames([{ frame: "hook", big_words: "x" }, { frame: "proof", quote: "my room smells like home now" }, { frame: "cta", big_words: "y" }], rich)
check("verbatim topic quote -> proof kept", quoted[1]!.frame === "proof" && quoted[1]!.quote === "my room smells like home now", quoted[1])
const madeUp = finalizeStoryFrames([{ frame: "hook", big_words: "x" }, { frame: "proof", quote: "best candles ever made" }, { frame: "cta", big_words: "y" }], rich)
check("invented review -> hook", madeUp[1]!.frame === "hook" && madeUp[1]!.quote === null, madeUp[1])

// Tape: the product frame, else the hook. Seeds stable across a second pass.
check("tape on the product frame", grounded[1]!.tape === true && grounded[0]!.tape === false, grounded.map((s) => s.tape))
check("tape on the hook without a product frame", ordered[0]!.tape === true, ordered.map((s) => s.tape))
const again = finalizeStoryFrames(grounded, rich)
check("finalize is idempotent (seeds and frames kept)", JSON.stringify(again.map((s) => [s.frame, s.seed])) === JSON.stringify(grounded.map((s) => [s.frame, s.seed])))

// Brand mark: the opening hook and the cta only.
check("brand mark on the first frame and the cta only", JSON.stringify(ordered.map((s) => s.brand_mark)) === JSON.stringify([true, false, true]), ordered.map((s) => s.brand_mark))

// Mirror: text / subtext carry the copy.
check("cta mirrors its button into subtext", String(ordered[2]!.subtext).startsWith("Shop now"), ordered[2]!.subtext)

console.log(`\n[test-story-frames] ${failures === 0 ? "all passed" : `${failures} failed`}`)
if (failures > 0) process.exit(1)
