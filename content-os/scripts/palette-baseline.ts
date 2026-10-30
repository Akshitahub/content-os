// Dev-only render of every compositor from one brand's 4-role palette
// (lib/design/color-themes.ts resolveBrandPalette) -- the post templates,
// the Hard Truth Checklist card, the plain (Autopilot) and rich carousel
// renderers and the story renderer, including the brand background presets
// and an old preset id mapped onto them. No model calls, nothing charged,
// nothing written to the DB: it reads the brand row and draws.
//
//   npx tsx scripts/palette-baseline.ts --brand <brandId> [--photo <path.png>] [--label palette]
//
// --photo: the background for the photo templates / slides; defaults to the
// brand's most recent scripts/output/post-runs/*/image.png, else a flat
// mid-grey stand-in.
//
// Output: scripts/output/palette-runs/<label>-<brand>-<timestamp>/
// (palette.json, post-*.png, checklist.png, carousel-*.png, story-*.png).
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
import type { BrandRow } from "@/types/database"

function loadEnvLocal(): void {
  const envPath = join(process.cwd(), ".env.local")
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let value = trimmed.slice(eqIdx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (!(key in process.env)) process.env[key] = value
  }
}
loadEnvLocal()

if (process.env.NODE_ENV === "production") {
  console.error("[palette-baseline] refusing to run with NODE_ENV=production -- this is a dev-only harness.")
  process.exit(1)
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 ? process.argv[i + 1] : undefined
}

const brandId = arg("brand")
if (!brandId) {
  console.error("usage: npx tsx scripts/palette-baseline.ts --brand <brandId> [--photo <path.png>] [--label palette]")
  process.exit(1)
}
const label = arg("label") ?? "palette"

/** The newest post-run image.png generated for this brand, if any. */
function latestBrandPhoto(id: string): string | null {
  const root = join(process.cwd(), "scripts/output/post-runs")
  if (!existsSync(root)) return null
  const runs = readdirSync(root)
    .map((d) => join(root, d))
    .filter((d) => existsSync(join(d, "image.png")) && existsSync(join(d, "run.json")))
    .filter((d) => readFileSync(join(d, "run.json"), "utf-8").includes(id))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  return runs[0] ? join(runs[0], "image.png") : null
}

async function main() {
  const sharp = (await import("sharp")).default
  const { resolveBrandPalette, resolveColorThemes, paletteRoles, BRAND_PRESET_IDS } = await import("@/lib/design/color-themes")
  const { compositePostImageWithWarnings, compositeHardTruthChecklistWithWarnings } = await import("@/lib/image/post-compositor")
  const { renderCarouselSlides, renderRichCarouselSlides } = await import("@/lib/image/carousel-compositor")
  const { renderStorySlides } = await import("@/lib/image/story-compositor")
  const { resolveTypography } = await import("@/lib/design/fonts")

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const { data: brand, error } = await supabase.from("brands").select("*").eq("id", brandId!).single<BrandRow>()
  if (error || !brand) throw new Error(`brand ${brandId} not found: ${error?.message}`)

  const palette = resolveBrandPalette(brand)
  const theme = resolveColorThemes(brand)[0]!
  const typography = resolveTypography(brand, {})
  const out = join(process.cwd(), "scripts/output/palette-runs", `${label}-${brand.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${new Date().toISOString().replace(/[:.]/g, "-")}`)
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, "palette.json"), JSON.stringify({ brand: brand.name, palette, roles: paletteRoles(palette), heading: typography.heading, body: typography.body }, null, 2))
  console.log(`[palette-baseline] ${brand.name}: deep ${palette.deep} base ${palette.base} accent ${palette.accent} pop ${palette.pop} (${palette.source})`)

  const photoPath = arg("photo") ?? latestBrandPhoto(brand.id)
  const photo = photoPath && existsSync(photoPath)
    ? await sharp(readFileSync(photoPath)).png().toBuffer()
    : await sharp({ create: { width: 1080, height: 1350, channels: 3, background: { r: 128, g: 128, b: 128 } } }).png().toBuffer()
  const photoUrl = `data:image/png;base64,${photo.toString("base64")}`
  console.log(`[palette-baseline] photo: ${photoPath ?? "(grey stand-in)"}`)
  const files: string[] = []
  const save = (name: string, buf: Buffer) => { writeFileSync(join(out, name), buf); files.push(name) }

  // ── Posts: the four photo templates, two layouts, and the checklist card.
  const caption = "Your shelf deserves better than beige"
  for (const template of ["bold_statement", "product_focus", "quote_card", "minimal"] as const) {
    const { buffer } = await compositePostImageWithWarnings(photo, { template, colorTheme: theme, captionText: caption, logoUrl: null, fontId: typography.heading })
    save(`post-${template}.png`, buffer)
  }
  for (const textLayout of ["bottom_card", "split_panel", "editorial"] as const) {
    const { buffer } = await compositePostImageWithWarnings(photo, {
      template: "bold_statement", colorTheme: theme, captionText: caption, logoUrl: null, fontId: typography.heading, bodyFontId: typography.body,
      textLayout, kicker: "Monsoon edit", highlight: "better than beige",
    })
    save(`post-layout-${textLayout}.png`, buffer)
  }
  const checklist = await compositeHardTruthChecklistWithWarnings({
    colorTheme: theme, logoUrl: null, fontId: typography.heading,
    headline: "Most office wardrobes fail in the monsoon", highlightedPhrase: "wardrobes fail",
    wrongItems: ["Heavy denim that never dries", "Light colours that show every splash"],
    rightItems: ["Quick-dry cotton blends", "Darker tones that hide the commute"],
    closingLine: "Dress for the weather you actually get.",
  })
  save("checklist.png", checklist.buffer)

  // ── Carousel: the plain (Autopilot) renderer, with and without auto layouts.
  const plainSlides = [
    { slide_number: 1, headline: "cover", body: "" },
    { slide_number: 2, headline: "Pick fabrics that breathe", body: "Cotton-linen blends dry fast and keep their shape through a damp commute." },
    { slide_number: 3, headline: "Go one shade darker", body: "Olive, navy and charcoal hide splashes better than stone or khaki.", kicker: "Step two", highlight: "one shade darker" },
    { slide_number: 4, headline: "Shop the monsoon edit", body: "Link in bio." },
  ]
  for (const auto of [false, true]) {
    const rendered = await renderCarouselSlides({ brand, coverHook: "Monsoon-proof your workwear", slides: plainSlides, fontId: typography.heading, autoLayouts: auto })
    rendered.forEach((r, i) => save(`carousel-plain${auto ? "-layout" : ""}-${i + 1}.png`, r.png))
  }

  // ── Carousel: the rich renderer -- each brand preset, an old preset id
  // (mapped onto its brand preset), and a photo slide with bullet dots.
  const richBase = { font_id: typography.heading, body_font_id: typography.body, palette }
  const rich = [
    ...BRAND_PRESET_IDS.map((id) => ({ ...richBase, type: "content" as const, headline: id.replace("_", " "), points: ["Breathable cotton blends", "Darker, splash-proof tones"], background_style: id })),
    { ...richBase, type: "cover" as const, headline: "Old id: gradient_violet", subtext: "Saved before palettes -- now brand_deep", background_style: "gradient_violet" },
    { ...richBase, type: "content" as const, headline: "On a photo", points: ["Deep-tinted scrim", "Pop bullet dots"], background_style: "brand_deep", image_url: photoUrl },
  ]
  ;(await renderRichCarouselSlides(brand.name, rich)).forEach((r, i) => save(`carousel-rich-${i + 1}.png`, r.png))

  // ── Stories: each brand preset, the checklist frames, a photo frame.
  const storyBase = { text_position: "center" as const, has_poll: false, font_id: typography.heading, body_font_id: typography.body, palette }
  const story = [
    ...BRAND_PRESET_IDS.map((id) => ({ ...storyBase, type: "buildup" as const, text: id.replace("_", " "), subtext: "Built from the brand palette", background: id })),
    { ...storyBase, type: "hook" as const, text: "Most office wardrobes fail in the monsoon", subtext: "", background: "brand_light", checklist_highlighted_phrase: "fail in the monsoon" },
    { ...storyBase, type: "reveal" as const, text: "Heavy denim", subtext: "Quick-dry blends", background: "brand_light", checklist_wrong_item: "Heavy denim that never dries", checklist_right_item: "Quick-dry cotton blends" },
    { ...storyBase, type: "cta" as const, text: "Shop the monsoon edit", subtext: "Link in bio", background: "brand_deep", background_image_url: photoUrl },
  ]
  ;(await renderStorySlides(story)).forEach((r, i) => save(`story-${i + 1}.png`, r.png))

  console.log(`[palette-baseline] ${files.length} images -> ${out}`)
}

main().catch((err) => {
  console.error("[palette-baseline] failed:", err)
  process.exit(1)
})
