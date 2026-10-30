/**
 * Brand palette roles: every text / background pair the compositors draw
 * from resolveBrandPalette clears WCAG AA (4.5:1 body, 3:1 large text and
 * graphics). Pure -- no network, no images.
 *
 *   npx tsx scripts/test-brand-palette.ts
 */
import { BRAND_PRESET_IDS, brandPreset, paletteFromColors, paletteRoles, resolveBrandPalette, type BrandPalette } from "@/lib/design/color-themes"
import { hexContrast, hexLuminance, mixHex, tintedScrimOpacity } from "@/lib/image/text-contrast"

const cases: { name: string; palette: BrandPalette }[] = [
  { name: "neutral (no colours)", palette: resolveBrandPalette({ primary_color: null, color_palette: null }) },
  { name: "yellow brand", palette: resolveBrandPalette({ primary_color: "#ffd60a", color_palette: null }) },
  { name: "navy + coral", palette: resolveBrandPalette({ primary_color: "#1d3557", color_palette: { secondary: "#e76f51" } }) },
  { name: "mint", palette: resolveBrandPalette({ primary_color: "#98f5e1", color_palette: null }) },
  { name: "red", palette: paletteFromColors("#e63946") },
  { name: "black brand", palette: paletteFromColors("#000000") },
  { name: "white brand", palette: paletteFromColors("#ffffff") },
  {
    name: "art direction (SNITCH)",
    palette: resolveBrandPalette({ primary_color: null, color_palette: null, brand_brain: { art_direction: { palette: { deep: "#1f2419", base: "#f3f1e8", accent: "#6b704c", pop: "#ff6b2c" } } } }),
  },
  {
    name: "art direction (low-contrast deep/base)",
    palette: resolveBrandPalette({ primary_color: null, color_palette: null, brand_brain: { art_direction: { palette: { deep: "#777777", base: "#999999", accent: "#ffcc00", pop: "#ffee88" } } } }),
  },
]

let failures = 0
function check(label: string, ratio: number, min: number) {
  const ok = ratio >= min - 1e-9
  if (!ok) failures++
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}: ${ratio.toFixed(2)} (>= ${min})`)
}

for (const c of cases) {
  const p = c.palette
  const r = paletteRoles(p)
  console.log(`\n${c.name}  deep ${p.deep} base ${p.base} accent ${p.accent} pop ${p.pop} (${p.source})`)
  check("ink on base", hexContrast(r.ink, p.base), 4.5)
  check("muted ink on base", hexContrast(r.inkMuted, p.base), 4.5)
  check("band text on band", hexContrast(r.bandText, r.band), 4.5)
  check("ink over the pop stripe", hexContrast(r.ink, mixHex(p.base, p.pop, r.stripeOpacity)), 4.5)
  check("wrong mark on base", hexContrast(r.wrong, p.base), 3)
  check("right mark on base", hexContrast(r.right, p.base), 3)
  check("on-image text over a full deep scrim", hexContrast(r.onImage, r.scrim), 4.5)
  for (const id of BRAND_PRESET_IDS) {
    const preset = brandPreset(id, p)
    const worstText = Math.min(...preset.stops.map((s) => hexContrast(preset.text, s)))
    const worstSub = Math.min(...preset.stops.map((s) => hexContrast(preset.sub, s)))
    check(`${id} text`, worstText, 4.5)
    check(`${id} sub`, worstSub, 4.5)
  }
}

// A deep-tinted scrim keeps white body text at 4.5:1 wherever the black
// scrim it replaces did (backgrounds of luminance L, black opacity a).
console.log("\ntinted scrims")
const MAX_BG = 1.05 / 4.5 - 0.05
for (const c of cases) {
  const tint = paletteRoles(c.palette).scrim
  const tintL = hexLuminance(tint)
  for (let L = 0; L <= 1.0001; L += 0.05) {
    for (const a of [0.2, 0.25, 0.3, 0.35, 0.45, 0.55, 0.75]) {
      if (L * (1 - a) > MAX_BG) continue
      const t = tintedScrimOpacity(a, tint, "light")
      const tinted = L * (1 - t) + tintL * t
      if (tinted > MAX_BG + 1e-9) { failures++; console.log(`  FAIL ${c.name}: L=${L.toFixed(2)} a=${a} -> ${tinted.toFixed(3)} > ${MAX_BG.toFixed(3)}`) }
    }
  }
}

console.log(failures ? `\n${failures} FAILED` : "\nall pairs pass")
process.exit(failures ? 1 : 0)
