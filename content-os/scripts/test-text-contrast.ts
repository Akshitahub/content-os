/**
 * Dev-only check for lib/image/text-contrast.ts (no test runner in this
 * repo -- same pattern as scripts/test-fact-guard.ts). Builds a white, a
 * black and a noisy buffer and asserts the text_style each one gets.
 *
 *   npx tsx scripts/test-text-contrast.ts
 */
import sharp from "sharp"
import { computeTextStyle, achievedContrast, regionLuminance } from "@/lib/image/text-contrast"

if (process.env.NODE_ENV === "production") {
  console.error("[test-text-contrast] refusing to run with NODE_ENV=production -- this is a dev-only check.")
  process.exit(1)
}

const FULL = { x: 0, y: 0, w: 1, h: 1 }
let failures = 0
function check(name: string, ok: boolean, detail: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`, JSON.stringify(detail))
  if (!ok) failures++
}

const solid = (v: number) => sharp({ create: { width: 200, height: 200, channels: 3, background: { r: v, g: v, b: v } } }).png().toBuffer()

async function noisy(): Promise<Buffer> {
  // Deterministic pseudo-random black/white speckle.
  const size = 200
  const raw = Buffer.alloc(size * size * 3)
  let seed = 7
  for (let i = 0; i < size * size; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    const v = (seed >> 16) & 1 ? 255 : 0
    raw[i * 3] = raw[i * 3 + 1] = raw[i * 3 + 2] = v
  }
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer()
}

async function main() {
  const white = await computeTextStyle(await solid(255), FULL)
  check("white -> dark text, no scrim", white.text_color === "dark" && white.scrim_opacity === 0 && !white.needs_backing, white)

  const black = await computeTextStyle(await solid(0), FULL)
  check("black -> light text, no scrim", black.text_color === "light" && black.scrim_opacity === 0 && !black.needs_backing, black)

  const whiteLight = await computeTextStyle(await solid(255), FULL, { preferLight: true })
  check("white + preferLight -> light text, capped scrim + backing", whiteLight.text_color === "light" && whiteLight.scrim_opacity === 0.75 && whiteLight.needs_backing, whiteLight)

  const midBuf = await solid(150)
  const mid = await computeTextStyle(midBuf, FULL)
  const midL = (await regionLuminance(midBuf, FULL)).mean
  check("mid grey -> body contrast >= 4.5", achievedContrast(mid, midL) >= 4.49, { ...mid, contrast: achievedContrast(mid, midL) })

  const noise = await computeTextStyle(await noisy(), FULL)
  check("noise -> needs backing", noise.needs_backing, noise)

  const again = await computeTextStyle(await noisy(), FULL)
  check("deterministic", JSON.stringify(again) === JSON.stringify(noise), again)

  // Region: left half black, right half white -- only the region matters.
  const split = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite([{ input: await sharp({ create: { width: 100, height: 200, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer(), left: 100, top: 0 }])
    .png().toBuffer()
  const rightHalf = await computeTextStyle(split, { x: 0.55, y: 0, w: 0.45, h: 1 })
  check("region is respected", rightHalf.text_color === "dark", rightHalf)

  if (failures) {
    console.error(`${failures} check(s) failed`)
    process.exit(1)
  }
  console.log("all text-contrast checks passed")
}
main()
