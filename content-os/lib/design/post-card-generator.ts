import type { BrandRow } from "@/types/database"
import type { GeneratedHook, ContentFormat, Platform, CarouselContent } from "@/types/app"

function getPrimaryColor(brand: BrandRow): string {
  const palette = brand.color_palette as Record<string, unknown> | null
  if (!palette) return "#6366f1"
  const colors = Object.values(palette).filter((v): v is string => typeof v === "string")
  return colors[0] ?? "#6366f1"
}

function getSecondaryColor(brand: BrandRow): string {
  const palette = brand.color_palette as Record<string, unknown> | null
  if (!palette) return "#818cf8"
  const colors = Object.values(palette).filter((v): v is string => typeof v === "string")
  return colors[1] ?? colors[0] ?? "#818cf8"
}

function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function socialPostHtml(brand: BrandRow, hook: GeneratedHook): string {
  const primary = getPrimaryColor(brand)
  const secondary = getSecondaryColor(brand)
  const hookText = esc(hook.hook_text)
  const brandName = esc(brand.name)
  const len = hook.hook_text.length
  const fontSize = len < 60 ? 78 : len < 110 ? 64 : 52

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@700;800&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1080px;height:1080px;overflow:hidden;font-family:'Poppins',sans-serif}
body{
  background:linear-gradient(135deg,${primary} 0%,${secondary} 100%);
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:100px;position:relative;
}
.hook{
  font-size:${fontSize}px;font-weight:800;color:#fff;
  text-align:center;line-height:1.25;
  text-shadow:0 4px 28px rgba(0,0,0,0.22);
  letter-spacing:-0.02em;
}
.brand{
  position:absolute;bottom:60px;left:0;right:0;
  text-align:center;font-size:26px;font-weight:700;
  color:rgba(255,255,255,0.65);letter-spacing:0.1em;text-transform:uppercase;
}
.bar{
  position:absolute;bottom:0;left:0;right:0;height:6px;
  background:rgba(255,255,255,0.2);
}
</style>
</head>
<body>
<p class="hook">${hookText}</p>
<p class="brand">${brandName}</p>
<div class="bar"></div>
</body>
</html>`
}

function carouselHtml(brand: BrandRow, hook: GeneratedHook, contentData: unknown): string {
  const primary = getPrimaryColor(brand)
  const secondary = getSecondaryColor(brand)
  const brandName = esc(brand.name)
  const carousel = contentData as CarouselContent | null
  const rawSlides = Array.isArray(carousel?.slides) ? carousel!.slides : []
  const slides = rawSlides.slice(0, 4)

  const slideHtmls = slides.map((slide, i) => {
    const isCover = i === 0
    const bg = isCover
      ? `linear-gradient(135deg,${primary} 0%,${secondary} 100%)`
      : "#ffffff"
    const headlineColor = isCover ? "#fff" : primary
    const bodyColor = isCover ? "rgba(255,255,255,0.82)" : "#555"
    const brandColor = isCover ? "rgba(255,255,255,0.5)" : "#bbb"
    const numColor = isCover ? "rgba(255,255,255,0.4)" : "#ddd"

    return `<div class="slide" style="background:${bg}">
  <span class="num" style="color:${numColor}">${i + 1} / ${slides.length}</span>
  <p class="headline" style="color:${headlineColor}">${esc(slide.headline)}</p>
  <p class="body" style="color:${bodyColor}">${esc(slide.body)}</p>
  <p class="brand" style="color:${brandColor}">${brandName}</p>
</div>`
  })

  if (slides.length === 0) {
    return socialPostHtml(brand, hook)
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1080px;font-family:'Poppins',sans-serif}
.slide{
  width:1080px;height:1080px;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:100px;position:relative;
}
.num{
  position:absolute;top:48px;right:52px;
  font-size:22px;font-weight:700;letter-spacing:0.04em;
}
.headline{
  font-size:68px;font-weight:800;text-align:center;
  line-height:1.2;letter-spacing:-0.02em;
}
.body{
  margin-top:40px;font-size:34px;font-weight:400;
  text-align:center;line-height:1.55;max-width:840px;
}
.brand{
  position:absolute;bottom:56px;left:0;right:0;
  text-align:center;font-size:22px;font-weight:700;
  letter-spacing:0.1em;text-transform:uppercase;
}
</style>
</head>
<body>
${slideHtmls.join("\n")}
</body>
</html>`
}

export function generatePostCardHtml(
  brand: BrandRow,
  hook: GeneratedHook,
  format: ContentFormat,
  platform: Platform,
  contentData: unknown
): string | null {
  if (format === "social_post" && platform === "instagram") {
    return socialPostHtml(brand, hook)
  }
  if (format === "carousel") {
    return carouselHtml(brand, hook, contentData)
  }
  return null
}
