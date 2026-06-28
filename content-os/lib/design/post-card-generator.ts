import type { BrandRow } from "@/types/database"
import type { GeneratedHook, ContentFormat, Platform, CarouselContent } from "@/types/app"

function getNicheColors(niche: string | null | undefined): [string, string] {
  const n = (niche ?? "").toLowerCase()
  if (n.includes("beauty") || n.includes("skin") || n.includes("makeup")) return ["#ec4899", "#f9a8d4"]
  if (n.includes("fitness") || n.includes("health") || n.includes("gym") || n.includes("yoga")) return ["#10b981", "#6ee7b7"]
  if (n.includes("food") || n.includes("recipe") || n.includes("cook")) return ["#f59e0b", "#fcd34d"]
  if (n.includes("fashion") || n.includes("style") || n.includes("cloth")) return ["#8b5cf6", "#c4b5fd"]
  if (n.includes("tech") || n.includes("gadget") || n.includes("software")) return ["#3b82f6", "#93c5fd"]
  if (n.includes("home") || n.includes("decor") || n.includes("interior")) return ["#14b8a6", "#5eead4"]
  if (n.includes("travel") || n.includes("adventure")) return ["#0ea5e9", "#7dd3fc"]
  if (n.includes("finance") || n.includes("money") || n.includes("invest")) return ["#22c55e", "#86efac"]
  if (n.includes("education") || n.includes("learn")) return ["#6366f1", "#a5b4fc"]
  return ["#6366f1", "#818cf8"]
}

function getPrimaryColor(brand: BrandRow): string {
  const palette = brand.color_palette as Record<string, unknown> | null
  if (palette) {
    const colors = Object.values(palette).filter((v): v is string => typeof v === "string")
    if (colors[0]) return colors[0]
  }
  return getNicheColors(brand.niche)[0]
}

function getSecondaryColor(brand: BrandRow): string {
  const palette = brand.color_palette as Record<string, unknown> | null
  if (palette) {
    const colors = Object.values(palette).filter((v): v is string => typeof v === "string")
    if (colors[1]) return colors[1]
    if (colors[0]) return colors[0]
  }
  return getNicheColors(brand.niche)[1]
}

function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

// Template 1: Bold Quote — full gradient, huge white text
function template1BoldQuote(brand: BrandRow, hook: string): string {
  const primary = getPrimaryColor(brand)
  const secondary = getSecondaryColor(brand)
  const hookText = esc(hook)
  const brandName = esc(brand.name)
  const len = hook.length
  const fontSize = len < 60 ? 80 : len < 110 ? 64 : 52

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@700;800;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1080px;height:1080px;overflow:hidden;font-family:'Poppins',sans-serif}
body{background:linear-gradient(135deg,${primary} 0%,${secondary} 100%);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:90px;position:relative}
.hook{font-size:${fontSize}px;font-weight:900;color:#fff;text-align:center;line-height:1.2;text-shadow:0 4px 32px rgba(0,0,0,0.25);letter-spacing:-0.025em}
.deco{width:80px;height:8px;background:rgba(255,255,255,0.4);border-radius:4px;margin:40px auto 0}
.brand{position:absolute;bottom:52px;left:0;right:0;text-align:center;font-size:24px;font-weight:700;color:rgba(255,255,255,0.6);letter-spacing:0.14em;text-transform:uppercase}
.corner{position:absolute;top:0;right:0;width:0;height:0;border-style:solid;border-width:0 140px 140px 0;border-color:transparent rgba(255,255,255,0.08) transparent transparent}
</style>
</head>
<body>
<p class="hook">${hookText}</p>
<div class="deco"></div>
<p class="brand">${brandName}</p>
<div class="corner"></div>
</body>
</html>`
}

// Template 2: Split Layout — gradient left panel, white right content
function template2SplitLayout(brand: BrandRow, hook: string): string {
  const primary = getPrimaryColor(brand)
  const secondary = getSecondaryColor(brand)
  const hookText = esc(hook)
  const brandName = esc(brand.name)
  const len = hook.length
  const fontSize = len < 60 ? 72 : len < 110 ? 56 : 42

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@700;800;900&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1080px;height:1080px;overflow:hidden;font-family:'Poppins',sans-serif}
body{display:flex}
.left{width:420px;height:1080px;background:linear-gradient(180deg,${primary} 0%,${secondary} 100%);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 50px;position:relative;flex-shrink:0}
.brand-vert{font-size:18px;font-weight:700;color:rgba(255,255,255,0.5);letter-spacing:0.16em;text-transform:uppercase;writing-mode:vertical-rl;text-orientation:mixed;position:absolute;left:28px;top:50%;transform:translateY(-50%) rotate(180deg)}
.divider{width:4px;height:80px;background:rgba(255,255,255,0.35);border-radius:2px;margin-bottom:32px}
.label{font-size:14px;font-weight:700;color:rgba(255,255,255,0.5);letter-spacing:0.22em;text-transform:uppercase}
.right{flex:1;height:1080px;background:#fff;display:flex;flex-direction:column;justify-content:center;padding:80px 70px}
.hook{font-size:${fontSize}px;font-weight:900;color:#111;line-height:1.18;letter-spacing:-0.025em}
.accent{width:60px;height:6px;background:${primary};border-radius:3px;margin-top:40px}
.tagline{margin-top:28px;font-size:22px;font-family:'Inter',sans-serif;font-weight:400;color:#777;line-height:1.5}
</style>
</head>
<body>
<div class="left">
  <span class="brand-vert">${brandName}</span>
  <div class="divider"></div>
  <p class="label">Read this</p>
</div>
<div class="right">
  <p class="hook">${hookText}</p>
  <div class="accent"></div>
  <p class="tagline">${brandName}</p>
</div>
</body>
</html>`
}

// Template 3: Minimal Card — white background, serif font, colorful accent
function template3MinimalCard(brand: BrandRow, hook: string): string {
  const primary = getPrimaryColor(brand)
  const hookText = esc(hook)
  const brandName = esc(brand.name)
  const len = hook.length
  const fontSize = len < 60 ? 76 : len < 110 ? 60 : 48

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1080px;height:1080px;overflow:hidden;font-family:'Playfair Display',serif}
body{background:#fafafa;display:flex;flex-direction:column;position:relative}
.top-bar{width:100%;height:14px;background:${primary}}
.content{flex:1;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;padding:100px 110px}
.quote-mark{font-size:200px;font-weight:800;color:${primary};opacity:0.1;line-height:0.7;margin-bottom:20px}
.hook{font-size:${fontSize}px;font-weight:800;color:#111;line-height:1.25;letter-spacing:-0.02em}
.footer{display:flex;align-items:center;justify-content:space-between;padding:52px 110px;border-top:2px solid #f0f0f0}
.brand-name{font-size:22px;font-weight:600;font-family:'Inter',sans-serif;color:${primary};letter-spacing:0.04em;text-transform:uppercase}
.dots{display:flex;gap:8px;align-items:center}
.dot{width:10px;height:10px;border-radius:50%;background:${primary};opacity:0.2}
.dot.active{opacity:1;width:36px;border-radius:5px}
</style>
</head>
<body>
<div class="top-bar"></div>
<div class="content">
  <div class="quote-mark">"</div>
  <p class="hook">${hookText}</p>
</div>
<div class="footer">
  <p class="brand-name">${brandName}</p>
  <div class="dots">
    <div class="dot active"></div>
    <div class="dot"></div>
    <div class="dot"></div>
  </div>
</div>
</body>
</html>`
}

// Template 4: Story Style — dark background, glowing centered text
function template4StoryStyle(brand: BrandRow, hook: string): string {
  const primary = getPrimaryColor(brand)
  const hookText = esc(hook)
  const brandName = esc(brand.name)
  const len = hook.length
  const fontSize = len < 60 ? 82 : len < 110 ? 66 : 52

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@700;800;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1080px;height:1080px;overflow:hidden;font-family:'Poppins',sans-serif}
body{background:linear-gradient(160deg,#0f0f1a 0%,#1a1a2e 50%,#0f0f1a 100%);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:100px;position:relative}
.glow{position:absolute;width:600px;height:600px;background:radial-gradient(circle,${primary}33 0%,transparent 70%);top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:none}
.hook{font-size:${fontSize}px;font-weight:900;color:#fff;text-align:center;line-height:1.2;letter-spacing:-0.025em;position:relative;z-index:1;text-shadow:0 0 60px ${primary}88}
.line{width:60px;height:4px;background:${primary};border-radius:2px;margin:44px auto 0;position:relative;z-index:1}
.brand{position:absolute;bottom:56px;left:0;right:0;text-align:center;font-size:22px;font-weight:700;color:rgba(255,255,255,0.35);letter-spacing:0.18em;text-transform:uppercase;z-index:1}
.top-tag{position:absolute;top:52px;left:50%;transform:translateX(-50%);font-size:16px;font-weight:700;letter-spacing:0.25em;text-transform:uppercase;color:${primary};z-index:1}
</style>
</head>
<body>
<div class="glow"></div>
<p class="top-tag">✦ New Drop</p>
<p class="hook">${hookText}</p>
<div class="line"></div>
<p class="brand">${brandName}</p>
</body>
</html>`
}

// Template 5: Carousel Cover — gradient with swipe cue and slide dots
function template5CarouselCover(brand: BrandRow, hook: string, totalSlides: number): string {
  const primary = getPrimaryColor(brand)
  const secondary = getSecondaryColor(brand)
  const hookText = esc(hook)
  const brandName = esc(brand.name)
  const len = hook.length
  const fontSize = len < 60 ? 74 : len < 110 ? 58 : 44
  const extraDots = Math.min(Math.max(totalSlides - 1, 0), 4)

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1080px;height:1080px;overflow:hidden;font-family:'Poppins',sans-serif}
body{background:linear-gradient(145deg,${primary} 0%,${secondary} 100%);display:flex;flex-direction:column;padding:90px;position:relative}
.swipe{position:absolute;top:52px;right:52px;display:flex;align-items:center;gap:10px;font-size:18px;font-weight:600;color:rgba(255,255,255,0.6)}
.content{flex:1;display:flex;flex-direction:column;justify-content:center}
.series{font-size:18px;font-weight:600;color:rgba(255,255,255,0.55);letter-spacing:0.15em;text-transform:uppercase;margin-bottom:28px}
.hook{font-size:${fontSize}px;font-weight:900;color:#fff;line-height:1.18;letter-spacing:-0.025em;text-shadow:0 4px 24px rgba(0,0,0,0.15)}
.dots-row{display:flex;gap:10px;margin-top:52px;align-items:center}
.dot{width:12px;height:12px;border-radius:50%;background:rgba(255,255,255,0.35)}
.dot.active{background:#fff;width:36px;border-radius:6px}
.brand{font-size:22px;font-weight:700;color:rgba(255,255,255,0.5);letter-spacing:0.12em;text-transform:uppercase;margin-top:auto}
</style>
</head>
<body>
<div class="swipe"><span>Swipe</span><span>→</span></div>
<div class="content">
  <p class="series">📖 ${totalSlides}-Part Series</p>
  <p class="hook">${hookText}</p>
  <div class="dots-row">
    <div class="dot active"></div>
    ${Array(extraDots).fill('<div class="dot"></div>').join("")}
  </div>
</div>
<p class="brand">${brandName}</p>
</body>
</html>`
}

// Template 6: Announcement — bold colored header band, white body
function template6Announcement(brand: BrandRow, hook: string): string {
  const primary = getPrimaryColor(brand)
  const secondary = getSecondaryColor(brand)
  const hookText = esc(hook)
  const brandName = esc(brand.name)
  const len = hook.length
  const fontSize = len < 60 ? 72 : len < 110 ? 56 : 44

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800;900&family=Inter:wght@400;500&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1080px;height:1080px;overflow:hidden;font-family:'Poppins',sans-serif}
body{background:#ffffff;display:flex;flex-direction:column;position:relative}
.header-band{width:100%;padding:44px 90px;background:linear-gradient(90deg,${primary} 0%,${secondary} 100%);display:flex;align-items:center;justify-content:space-between}
.announcing{font-size:18px;font-weight:700;color:rgba(255,255,255,0.75);letter-spacing:0.2em;text-transform:uppercase}
.brand-header{font-size:20px;font-weight:700;color:rgba(255,255,255,0.75);letter-spacing:0.1em;text-transform:uppercase}
.content{flex:1;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;padding:80px 90px}
.badge{display:inline-flex;align-items:center;gap:8px;background:${primary}18;color:${primary};font-size:16px;font-weight:700;padding:10px 22px;border-radius:100px;margin-bottom:40px;border:2px solid ${primary}30}
.hook{font-size:${fontSize}px;font-weight:900;color:#111;line-height:1.2;letter-spacing:-0.025em}
.cta-row{margin-top:56px;display:flex;align-items:center;gap:24px}
.cta-btn{background:${primary};color:#fff;font-size:20px;font-weight:700;padding:18px 44px;border-radius:12px}
.cta-sub{font-size:18px;font-weight:500;color:#999;font-family:'Inter',sans-serif}
</style>
</head>
<body>
<div class="header-band">
  <p class="announcing">✨ Announcement</p>
  <p class="brand-header">${brandName}</p>
</div>
<div class="content">
  <div class="badge">🎯 Must Read</div>
  <p class="hook">${hookText}</p>
  <div class="cta-row">
    <div class="cta-btn">Learn more →</div>
    <p class="cta-sub">Swipe for details</p>
  </div>
</div>
</body>
</html>`
}

// Template 7: Meme Style — white bg, top/bottom text meme format
function template7MemeStyle(brand: BrandRow, hook: string): string {
  const primary = getPrimaryColor(brand)
  const hookText = esc(hook)
  const brandName = esc(brand.name)
  const words = hook.split(" ")
  const mid = Math.ceil(words.length / 2)
  const topText = esc(words.slice(0, mid).join(" "))
  const bottomText = esc(words.slice(mid).join(" "))

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><link href="https://fonts.googleapis.com/css2?family=Anton&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:1080px;height:1080px;overflow:hidden}body{background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:80px 60px;position:relative}.top-text{font-family:'Anton',sans-serif;font-size:96px;color:#000;text-align:center;text-transform:uppercase;letter-spacing:0.04em;-webkit-text-stroke:3px #000;line-height:1.1}.bottom-text{font-family:'Anton',sans-serif;font-size:96px;color:#000;text-align:center;text-transform:uppercase;letter-spacing:0.04em;-webkit-text-stroke:3px #000;line-height:1.1}.brand-wm{position:absolute;bottom:24px;right:36px;font-family:'Anton',sans-serif;font-size:18px;color:${primary};opacity:0.7;letter-spacing:0.1em;text-transform:uppercase}.accent-bar{position:absolute;top:0;left:0;right:0;height:10px;background:${primary}}</style></head><body><div class="accent-bar"></div><p class="top-text">${topText}</p><p class="bottom-text">${bottomText}</p><p class="brand-wm">${brandName}</p></body></html>`
}

// Template 8: Announcement — dark bg with color banner, confetti dots
function template8Announcement(brand: BrandRow, hook: string): string {
  const primary = getPrimaryColor(brand)
  const secondary = getSecondaryColor(brand)
  const hookText = esc(hook)
  const brandName = esc(brand.name)
  const len = hook.length
  const fontSize = len < 60 ? 74 : len < 110 ? 58 : 44

  const dots = Array.from({ length: 20 }, (_, i) => {
    const x = (i * 53) % 1080
    const y = (i * 97) % 1080
    const size = 8 + (i % 4) * 6
    return `<circle cx="${x}" cy="${y}" r="${size}" fill="${i % 2 === 0 ? primary : secondary}" opacity="0.15"/>`
  }).join("")

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@700;800;900&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:1080px;height:1080px;overflow:hidden;font-family:'Poppins',sans-serif}body{background:#0d0d0d;display:flex;flex-direction:column;position:relative}.banner{width:100%;padding:42px 80px;background:linear-gradient(90deg,${primary},${secondary});display:flex;align-items:center;justify-content:space-between}.banner-label{font-size:20px;font-weight:700;color:rgba(255,255,255,0.9);letter-spacing:0.2em;text-transform:uppercase}.brand-label{font-size:20px;font-weight:700;color:rgba(255,255,255,0.7);letter-spacing:0.1em;text-transform:uppercase}.content{flex:1;display:flex;align-items:center;justify-content:center;padding:80px;position:relative;z-index:1}.hook{font-size:${fontSize}px;font-weight:900;color:#fff;text-align:center;line-height:1.2;text-shadow:0 0 60px ${primary}44}.svg-bg{position:absolute;inset:0;width:100%;height:100%}</style></head><body><div class="banner"><p class="banner-label">🎉 NEW DROP</p><p class="brand-label">${brandName}</p></div><div class="content"><svg class="svg-bg" viewBox="0 0 1080 1080" preserveAspectRatio="xMidYMid slice">${dots}</svg><p class="hook">${hookText}</p></div></body></html>`
}

// Template 9: Quote Card — soft pastel gradient, elegant font, large quote mark
function template9QuoteCard(brand: BrandRow, hook: string): string {
  const primary = getPrimaryColor(brand)
  const hookText = esc(hook)
  const brandName = esc(brand.name)
  const len = hook.length
  const fontSize = len < 60 ? 72 : len < 110 ? 58 : 46

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;1,400&family=Inter:wght@400;500&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:1080px;height:1080px;overflow:hidden}body{background:linear-gradient(135deg,#fdf6ff 0%,#f0f4ff 50%,#fff5f5 100%);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:100px;position:relative}.qmark{font-family:'Playfair Display',serif;font-size:240px;color:${primary};opacity:0.12;line-height:0.7;position:absolute;top:60px;left:80px}.hook{font-family:'Playfair Display',serif;font-size:${fontSize}px;font-weight:700;color:#1a1a2e;text-align:center;line-height:1.3;letter-spacing:-0.01em;position:relative;z-index:1}.divider{width:80px;height:3px;background:${primary};border-radius:2px;margin:44px auto}.author{font-family:'Inter',sans-serif;font-size:22px;font-weight:500;color:${primary};text-align:center;letter-spacing:0.04em}.border-deco{position:absolute;top:40px;left:40px;right:40px;bottom:40px;border:2px solid ${primary};opacity:0.15;border-radius:12px}</style></head><body><div class="border-deco"></div><div class="qmark">"</div><p class="hook">${hookText}</p><div class="divider"></div><p class="author">— ${brandName}</p></body></html>`
}

// Template 10: Sale/Offer — urgent red/orange gradient, sale energy
function template10SaleOffer(brand: BrandRow, hook: string): string {
  const hookText = esc(hook)
  const brandName = esc(brand.name)
  const len = hook.length
  const fontSize = len < 60 ? 76 : len < 110 ? 60 : 48

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@700;800;900&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:1080px;height:1080px;overflow:hidden;font-family:'Poppins',sans-serif}body{background:linear-gradient(135deg,#c0392b 0%,#e74c3c 40%,#f39c12 100%);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:90px;position:relative}.sale-tag{position:absolute;top:60px;right:-20px;background:#fff;color:#c0392b;font-size:28px;font-weight:900;padding:18px 60px 18px 36px;text-transform:uppercase;letter-spacing:0.08em;transform:rotate(12deg);box-shadow:0 8px 32px rgba(0,0,0,0.2)}.hook{font-size:${fontSize}px;font-weight:900;color:#fff;text-align:center;line-height:1.2;text-shadow:0 4px 24px rgba(0,0,0,0.3)}.limited{margin-top:44px;font-size:24px;font-weight:700;color:rgba(255,255,255,0.8);letter-spacing:0.1em;text-transform:uppercase;border:2px dashed rgba(255,255,255,0.5);padding:12px 32px;border-radius:8px}.brand{position:absolute;bottom:52px;inset-x:0;text-align:center;font-size:22px;font-weight:700;color:rgba(255,255,255,0.6);letter-spacing:0.12em;text-transform:uppercase}</style></head><body><div class="sale-tag">SALE</div><p class="hook">${hookText}</p><p class="limited">⚡ Limited Time Only</p><p class="brand">${brandName}</p></body></html>`
}

// Template 11: Product Feature — clean white, colored accent border, benefit feel
function template11ProductFeature(brand: BrandRow, hook: string): string {
  const primary = getPrimaryColor(brand)
  const secondary = getSecondaryColor(brand)
  const hookText = esc(hook)
  const brandName = esc(brand.name)
  const len = hook.length
  const fontSize = len < 60 ? 68 : len < 110 ? 54 : 42

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800;900&family=Inter:wght@400;500&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:1080px;height:1080px;overflow:hidden;font-family:'Poppins',sans-serif}body{background:#fff;display:flex;flex-direction:row}.left-accent{width:16px;height:1080px;background:linear-gradient(180deg,${primary} 0%,${secondary} 100%);flex-shrink:0}.content{flex:1;display:flex;flex-direction:column;justify-content:center;padding:90px 80px}.tag{display:inline-flex;align-items:center;gap:8px;background:${primary}12;color:${primary};font-size:16px;font-weight:700;padding:10px 22px;border-radius:100px;margin-bottom:40px;border:1.5px solid ${primary}25;width:fit-content}.hook{font-size:${fontSize}px;font-weight:800;color:#111;line-height:1.2;letter-spacing:-0.02em}.benefits{margin-top:48px;display:flex;flex-direction:column;gap:16px}.benefit{display:flex;align-items:center;gap:14px}.dot-acc{width:10px;height:10px;border-radius:50%;background:${primary};flex-shrink:0}.benefit-text{font-family:'Inter',sans-serif;font-size:22px;color:#444}.brand-row{margin-top:auto;padding-top:40px;border-top:1.5px solid #f0f0f0;display:flex;align-items:center;justify-content:space-between}.brand-name{font-size:20px;font-weight:700;color:${primary};letter-spacing:0.06em;text-transform:uppercase}</style></head><body><div class="left-accent"></div><div class="content"><div class="tag">✦ Featured</div><p class="hook">${hookText}</p><div class="brand-row"><p class="brand-name">${brandName}</p></div></div></body></html>`
}

// Template 12: Reel Cover — bold vertical-friendly design with play icon
function template12ReelCover(brand: BrandRow, hook: string): string {
  const primary = getPrimaryColor(brand)
  const secondary = getSecondaryColor(brand)
  const hookText = esc(hook)
  const brandName = esc(brand.name)
  const len = hook.length
  const fontSize = len < 60 ? 82 : len < 110 ? 66 : 52

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@700;800;900&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:1080px;height:1080px;overflow:hidden;font-family:'Poppins',sans-serif}body{background:linear-gradient(180deg,#000 0%,${primary}cc 50%,${secondary}aa 100%);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:90px;position:relative}.hook{font-size:${fontSize}px;font-weight:900;color:#fff;text-align:center;line-height:1.2;text-shadow:0 4px 40px rgba(0,0,0,0.5)}.play-ring{width:100px;height:100px;border:4px solid rgba(255,255,255,0.5);border-radius:50%;display:flex;align-items:center;justify-content:center;margin-bottom:52px}.play-tri{width:0;height:0;border-style:solid;border-width:20px 0 20px 36px;border-color:transparent transparent transparent #fff;margin-left:8px}.watch-cta{position:absolute;bottom:100px;inset-x:0;text-align:center;font-size:22px;font-weight:700;color:rgba(255,255,255,0.7);letter-spacing:0.06em}.brand{position:absolute;bottom:52px;inset-x:0;text-align:center;font-size:20px;font-weight:700;color:rgba(255,255,255,0.4);letter-spacing:0.14em;text-transform:uppercase}.top-grad{position:absolute;top:0;inset-x:0;height:200px;background:linear-gradient(180deg,rgba(0,0,0,0.6),transparent)}</style></head><body><div class="top-grad"></div><div class="play-ring"><div class="play-tri"></div></div><p class="hook">${hookText}</p><p class="watch-cta">Watch till end ➔</p><p class="brand">${brandName}</p></body></html>`
}

function selectTemplate(
  format: ContentFormat,
  platform: Platform,
  hookLen: number,
  contentPillar?: string,
): 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 {
  // Content-pillar-based smart selection
  if (contentPillar) {
    if (contentPillar === "humor_meme") return 7
    if (contentPillar === "announcement") return 8
    if (contentPillar === "inspiration" || contentPillar === "testimonial") return 9
    if (contentPillar === "sale_offer") return 10
    if (contentPillar === "product") return 11
    if (contentPillar === "behind_scenes" || contentPillar === "founder_story") return 12
  }
  // Format/platform fallback
  if (format === "carousel") return 5
  if (format === "ad_copy") return 6
  if (format === "reel_script") return 12
  if (platform === "linkedin") return 2
  if (platform === "tiktok" || platform === "youtube") return 4
  if (hookLen < 50) return 3
  return 1
}

export function generatePostCardHtml(
  brand: BrandRow,
  hook: GeneratedHook,
  format: ContentFormat,
  platform: Platform,
  contentData: unknown,
  contentPillar?: string,
): string | null {
  const hookText = hook.hook_text
  const templateNum = selectTemplate(format, platform, hookText.length, contentPillar)

  if (templateNum === 5) {
    const carousel = contentData as CarouselContent | null
    const rawSlides = Array.isArray(carousel?.slides) ? carousel!.slides : []
    const slides = rawSlides.slice(0, 5)

    if (slides.length === 0) return template1BoldQuote(brand, hookText)

    const primary = getPrimaryColor(brand)
    const secondary = getSecondaryColor(brand)
    const brandName = esc(brand.name)

    const slideHtmls = slides.map((slide, i) => {
      const isCover = i === 0
      const isLast = i === slides.length - 1
      const bg = (isCover || isLast)
        ? `linear-gradient(135deg,${primary} 0%,${secondary} 100%)`
        : "#ffffff"
      const headlineColor = (isCover || isLast) ? "#fff" : primary
      const bodyColor = (isCover || isLast) ? "rgba(255,255,255,0.82)" : "#555"
      const brandColor = (isCover || isLast) ? "rgba(255,255,255,0.45)" : "#bbb"
      const numColor = (isCover || isLast) ? "rgba(255,255,255,0.4)" : "#ddd"
      return `<div class="slide" style="background:${bg}">
  <span class="num" style="color:${numColor}">${i + 1} / ${slides.length}</span>
  <p class="headline" style="color:${headlineColor}">${esc(slide.headline)}</p>
  <p class="body" style="color:${bodyColor}">${esc(slide.body)}</p>
  <p class="brand" style="color:${brandColor}">${brandName}</p>
</div>`
    })

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1080px;font-family:'Poppins',sans-serif}
.slide{width:1080px;height:1080px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:100px;position:relative}
.num{position:absolute;top:48px;right:52px;font-size:22px;font-weight:700;letter-spacing:0.04em}
.headline{font-size:68px;font-weight:800;text-align:center;line-height:1.2;letter-spacing:-0.02em}
.body{margin-top:40px;font-size:34px;font-weight:400;text-align:center;line-height:1.55;max-width:840px}
.brand{position:absolute;bottom:56px;left:0;right:0;text-align:center;font-size:22px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase}
</style>
</head>
<body>
${slideHtmls.join("\n")}
</body>
</html>`
  }

  switch (templateNum) {
    case 2: return template2SplitLayout(brand, hookText)
    case 3: return template3MinimalCard(brand, hookText)
    case 4: return template4StoryStyle(brand, hookText)
    case 6: return template6Announcement(brand, hookText)
    case 7: return template7MemeStyle(brand, hookText)
    case 8: return template8Announcement(brand, hookText)
    case 9: return template9QuoteCard(brand, hookText)
    case 10: return template10SaleOffer(brand, hookText)
    case 11: return template11ProductFeature(brand, hookText)
    case 12: return template12ReelCover(brand, hookText)
    default: return template1BoldQuote(brand, hookText)
  }
}

export interface CarouselSlide {
  slide_number: number
  headline: string
  body: string
}

export function generateCarouselHtml(
  brand: BrandRow,
  coverHook: string,
  slides: CarouselSlide[],
): string {
  if (slides.length === 0) return template1BoldQuote(brand, coverHook)

  const primary = getPrimaryColor(brand)
  const secondary = getSecondaryColor(brand)
  const brandName = esc(brand.name)
  const totalSlides = slides.length

  const slideHtmls = slides.map((slide, i) => {
    const isCover = i === 0
    const isLast = i === slides.length - 1
    const bg = (isCover || isLast)
      ? `linear-gradient(145deg,${primary} 0%,${secondary} 100%)`
      : "#ffffff"
    const headlineColor = (isCover || isLast) ? "#fff" : primary
    const bodyColor = (isCover || isLast) ? "rgba(255,255,255,0.82)" : "#555"
    const brandColor = (isCover || isLast) ? "rgba(255,255,255,0.45)" : "#ccc"
    const numColor = (isCover || isLast) ? "rgba(255,255,255,0.4)" : "#ddd"

    if (isCover) {
      return `<div class="slide cover" style="background:${bg}">
  <div class="swipe-tag">Swipe →</div>
  <span class="num" style="color:${numColor}">${slide.slide_number} / ${totalSlides}</span>
  <div class="cover-inner">
    <p class="series">📖 ${totalSlides}-Part Series</p>
    <p class="headline" style="color:${headlineColor};font-size:${coverHook.length < 60 ? 72 : coverHook.length < 110 ? 58 : 44}px">${esc(coverHook)}</p>
  </div>
  <p class="brand" style="color:${brandColor}">${brandName}</p>
</div>`
    }

    return `<div class="slide" style="background:${bg}">
  <span class="num" style="color:${numColor}">${slide.slide_number} / ${totalSlides}</span>
  <p class="headline" style="color:${headlineColor}">${esc(slide.headline)}</p>
  <p class="body" style="color:${bodyColor}">${esc(slide.body)}</p>
  <p class="brand" style="color:${brandColor}">${brandName}</p>
</div>`
  })

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1080px;font-family:'Poppins',sans-serif}
.slide{width:1080px;height:1080px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:100px;position:relative}
.cover{padding:90px}
.swipe-tag{position:absolute;top:52px;right:52px;font-size:18px;font-weight:600;color:rgba(255,255,255,0.55);letter-spacing:0.04em}
.cover-inner{flex:1;display:flex;flex-direction:column;justify-content:center}
.series{font-size:18px;font-weight:600;color:rgba(255,255,255,0.55);letter-spacing:0.15em;text-transform:uppercase;margin-bottom:28px}
.num{position:absolute;top:48px;right:52px;font-size:22px;font-weight:700;letter-spacing:0.04em}
.headline{font-size:68px;font-weight:800;text-align:center;line-height:1.2;letter-spacing:-0.02em}
.body{margin-top:40px;font-size:34px;font-weight:400;text-align:center;line-height:1.55;max-width:840px}
.brand{position:absolute;bottom:56px;left:0;right:0;text-align:center;font-size:22px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase}
</style>
</head>
<body>
${slideHtmls.join("\n")}
</body>
</html>`
}

// Keep backward-compat alias used in older code paths
function socialPostHtml(brand: BrandRow, hook: GeneratedHook): string {
  return template1BoldQuote(brand, hook.hook_text)
}

export { socialPostHtml, template5CarouselCover }
