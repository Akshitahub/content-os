"use client"

import { useMemo } from "react"

export type PreviewSize = "sm" | "md" | "lg" | "xl"
export type PreviewTemplate = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12

const SIZE_PX: Record<PreviewSize, number> = { sm: 160, md: 280, lg: 400, xl: 540 }

interface PostPreviewCardProps {
  hookText: string
  brandName: string
  primaryColor?: string
  secondaryColor?: string
  template?: PreviewTemplate
  size?: PreviewSize
  /** Custom pixel size (overrides size prop) */
  px?: number
  className?: string
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

const GF = "https://fonts.googleapis.com/css2?family="
const BASE_STYLE = `*{margin:0;padding:0;box-sizing:border-box}html,body{width:1080px;height:1080px;overflow:hidden}`

export function generatePreviewHtml(
  hookText: string,
  brandName: string,
  primary: string,
  secondary: string,
  template: PreviewTemplate,
): string {
  const h = esc(hookText)
  const b = esc(brandName)
  const len = hookText.length

  switch (template) {
    case 1: {
      // Bold Dark — dark gradient, huge white text
      const fs = len < 60 ? 80 : len < 110 ? 64 : 52
      return `<html><head><meta charset="UTF-8"><link href="${GF}Poppins:wght@700;800;900&display=swap" rel="stylesheet"><style>${BASE_STYLE}body{font-family:'Poppins',sans-serif;background:linear-gradient(135deg,${primary} 0%,${secondary} 100%);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:90px;position:relative}.h{font-size:${fs}px;font-weight:900;color:#fff;text-align:center;line-height:1.2;text-shadow:0 4px 32px rgba(0,0,0,.25)}.deco{width:80px;height:8px;background:rgba(255,255,255,.35);border-radius:4px;margin:36px auto 0}.b{position:absolute;bottom:52px;inset-x:0;text-align:center;font-size:24px;font-weight:700;color:rgba(255,255,255,.55);letter-spacing:.14em;text-transform:uppercase}.corner{position:absolute;top:0;right:0;width:0;height:0;border-style:solid;border-width:0 140px 140px 0;border-color:transparent rgba(255,255,255,.08) transparent transparent}</style></head><body><p class="h">${h}</p><div class="deco"></div><p class="b">${b}</p><div class="corner"></div></body></html>`
    }
    case 2: {
      // Gradient Burst — dark bg with radial glow
      const fs = len < 60 ? 78 : len < 110 ? 62 : 50
      return `<html><head><meta charset="UTF-8"><link href="${GF}Poppins:wght@700;800;900&display=swap" rel="stylesheet"><style>${BASE_STYLE}body{font-family:'Poppins',sans-serif;background:#0f0f1a;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:90px;position:relative}.glow{position:absolute;width:700px;height:700px;background:radial-gradient(circle,${primary}44 0%,transparent 70%);top:50%;left:50%;transform:translate(-50%,-50%)}.h{font-size:${fs}px;font-weight:900;color:#fff;text-align:center;line-height:1.2;position:relative;z-index:1;text-shadow:0 0 60px ${primary}88}.line{width:60px;height:4px;background:${primary};border-radius:2px;margin:44px auto 0;position:relative;z-index:1}.b{position:absolute;bottom:52px;inset-x:0;text-align:center;font-size:22px;font-weight:700;color:rgba(255,255,255,.35);text-transform:uppercase;letter-spacing:.18em;z-index:1}.tag{position:absolute;top:52px;left:50%;transform:translateX(-50%);font-size:16px;font-weight:700;letter-spacing:.25em;text-transform:uppercase;color:${primary};z-index:1}</style></head><body><div class="glow"></div><p class="tag">✦ New Drop</p><p class="h">${h}</p><div class="line"></div><p class="b">${b}</p></body></html>`
    }
    case 3: {
      // Split Editorial — gradient left, white right
      const fs = len < 60 ? 72 : len < 110 ? 56 : 42
      return `<html><head><meta charset="UTF-8"><link href="${GF}Poppins:wght@700;800;900&display=swap" rel="stylesheet"><style>${BASE_STYLE}body{font-family:'Poppins',sans-serif;display:flex}.left{width:420px;height:1080px;background:linear-gradient(180deg,${primary} 0%,${secondary} 100%);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 50px;position:relative;flex-shrink:0}.lbl{font-size:14px;font-weight:700;color:rgba(255,255,255,.5);letter-spacing:.22em;text-transform:uppercase}.right{flex:1;height:1080px;background:#fff;display:flex;flex-direction:column;justify-content:center;padding:80px 70px}.h{font-size:${fs}px;font-weight:900;color:#111;line-height:1.18;letter-spacing:-.025em}.acc{width:60px;height:6px;background:${primary};border-radius:3px;margin-top:40px}.tag{margin-top:28px;font-size:22px;font-weight:400;color:#777;line-height:1.5}</style></head><body><div class="left"><p class="lbl">Read this</p></div><div class="right"><p class="h">${h}</p><div class="acc"></div><p class="tag">${b}</p></div></body></html>`
    }
    case 4: {
      // Minimal Light — serif, white bg, colored accents
      const fs = len < 60 ? 76 : len < 110 ? 60 : 48
      return `<html><head><meta charset="UTF-8"><link href="${GF}Playfair+Display:wght@700;800&display=swap&family=Inter:wght@400;600&display=swap" rel="stylesheet"><style>${BASE_STYLE}body{font-family:'Playfair Display',serif;background:#fafafa;display:flex;flex-direction:column;position:relative}.topbar{width:100%;height:14px;background:${primary}}.content{flex:1;display:flex;flex-direction:column;justify-content:center;padding:80px 110px}.qm{font-size:200px;font-weight:800;color:${primary};opacity:.1;line-height:.7;margin-bottom:20px}.h{font-size:${fs}px;font-weight:800;color:#111;line-height:1.25;letter-spacing:-.02em}.footer{display:flex;align-items:center;justify-content:space-between;padding:52px 110px;border-top:2px solid #f0f0f0}.brand{font-size:22px;font-weight:600;font-family:'Inter',sans-serif;color:${primary};text-transform:uppercase;letter-spacing:.04em}</style></head><body><div class="topbar"></div><div class="content"><div class="qm">"</div><p class="h">${h}</p></div><div class="footer"><p class="brand">${b}</p></div></body></html>`
    }
    case 5: {
      // Cinematic Dark — dark with accent corner brackets
      const fs = len < 60 ? 82 : len < 110 ? 66 : 52
      return `<html><head><meta charset="UTF-8"><link href="${GF}Poppins:wght@700;800;900&display=swap" rel="stylesheet"><style>${BASE_STYLE}body{font-family:'Poppins',sans-serif;background:linear-gradient(160deg,#0a0a0a,#1a1a2e,#0a0a0a);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:100px;position:relative}.h{font-size:${fs}px;font-weight:900;color:#fff;text-align:center;line-height:1.2;text-shadow:0 0 60px ${primary}66}.tl{position:absolute;top:40px;left:40px;width:60px;height:60px;border-top:3px solid ${primary};border-left:3px solid ${primary}}.br{position:absolute;bottom:40px;right:40px;width:60px;height:60px;border-bottom:3px solid ${primary};border-right:3px solid ${primary}}.b{position:absolute;bottom:56px;inset-x:0;text-align:center;font-size:22px;font-weight:700;color:rgba(255,255,255,.35);letter-spacing:.18em;text-transform:uppercase}</style></head><body><div class="tl"></div><div class="br"></div><p class="h">${h}</p><p class="b">${b}</p></body></html>`
    }
    case 6: {
      // Neon Urban — black bg with neon brand accents
      const fs = len < 60 ? 78 : len < 110 ? 62 : 50
      return `<html><head><meta charset="UTF-8"><link href="${GF}Poppins:wght@700;800;900&display=swap" rel="stylesheet"><style>${BASE_STYLE}body{font-family:'Poppins',sans-serif;background:#000;display:flex;flex-direction:column;position:relative;overflow:hidden}.stripe{width:100%;height:8px;background:linear-gradient(90deg,${primary},${secondary})}.content{flex:1;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;padding:90px}.badge{display:inline-flex;align-items:center;gap:8px;border:2px solid ${primary};color:${primary};font-size:16px;font-weight:700;padding:8px 20px;border-radius:4px;margin-bottom:40px;text-transform:uppercase;letter-spacing:.1em}.h{font-size:${fs}px;font-weight:900;color:#fff;line-height:1.2}.glow{position:absolute;top:-80px;right:-80px;width:400px;height:400px;background:radial-gradient(circle,${primary}22,transparent 70%)}.b{position:absolute;bottom:52px;left:90px;font-size:20px;font-weight:700;color:rgba(255,255,255,.35);letter-spacing:.12em;text-transform:uppercase}</style></head><body><div class="glow"></div><div class="stripe"></div><div class="content"><div class="badge">✦ Content</div><p class="h">${h}</p></div><p class="b">${b}</p></body></html>`
    }
    case 7: {
      // Product Spotlight — radial glow, pill tag, centered text
      const fs = len < 60 ? 76 : len < 110 ? 60 : 48
      return `<html><head><meta charset="UTF-8"><link href="${GF}Poppins:wght@700;800;900&display=swap" rel="stylesheet"><style>${BASE_STYLE}body{font-family:'Poppins',sans-serif;background:#fafafa;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:100px;position:relative;overflow:hidden}.glow{position:absolute;width:900px;height:900px;border-radius:50%;background:radial-gradient(circle,${primary}1a 0%,transparent 65%);top:50%;left:50%;transform:translate(-50%,-50%)}.ring{position:absolute;width:600px;height:600px;border-radius:50%;border:2px solid ${primary}22;top:50%;left:50%;transform:translate(-50%,-50%)}.tag{display:inline-block;background:${primary};color:#fff;font-size:16px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;padding:10px 28px;border-radius:40px;margin-bottom:44px;position:relative;z-index:1}.h{font-size:${fs}px;font-weight:900;color:#111;text-align:center;line-height:1.2;position:relative;z-index:1;letter-spacing:-.02em}.b{position:absolute;bottom:52px;inset-x:0;text-align:center;font-size:20px;font-weight:600;color:#bbb;letter-spacing:.12em;text-transform:uppercase;z-index:1}</style></head><body><div class="glow"></div><div class="ring"></div><div class="tag">✦ Spotlight</div><p class="h">${h}</p><p class="b">${b}</p></body></html>`
    }
    case 8: {
      // Quote Card — warm cream, italic serif, large quotation mark
      const fs = len < 60 ? 72 : len < 110 ? 56 : 44
      return `<html><head><meta charset="UTF-8"><link href="${GF}Playfair+Display:ital,wght@1,700;0,700&display=swap&family=Inter:wght@500&display=swap" rel="stylesheet"><style>${BASE_STYLE}body{font-family:'Playfair Display',serif;background:linear-gradient(160deg,#fdf6ec,#fef9f3);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px 100px;position:relative}.qmark{font-size:280px;font-weight:700;color:${primary};opacity:.12;line-height:.6;position:absolute;top:40px;left:60px;font-style:normal}.h{font-size:${fs}px;font-weight:700;font-style:italic;color:#2d2d2d;text-align:center;line-height:1.25;position:relative;z-index:1}.line{width:80px;height:3px;background:${primary};border-radius:2px;margin:44px auto 28px}.b{font-size:22px;font-weight:500;color:#999;font-family:'Inter',sans-serif;font-style:normal;text-transform:uppercase;letter-spacing:.1em;text-align:center}</style></head><body><div class="qmark">"</div><p class="h">${h}</p><div class="line"></div><p class="b">${b}</p></body></html>`
    }
    case 9: {
      // Stat Callout — dark, accent top bar, bold metric style
      const fs = len < 60 ? 74 : len < 110 ? 58 : 46
      return `<html><head><meta charset="UTF-8"><link href="${GF}Poppins:wght@700;800;900&display=swap" rel="stylesheet"><style>${BASE_STYLE}body{font-family:'Poppins',sans-serif;background:#0d0d0d;display:flex;flex-direction:column;position:relative}.top{height:16px;background:linear-gradient(90deg,${primary},${secondary})}.inner{flex:1;display:flex;flex-direction:column;justify-content:center;padding:80px 90px}.label{font-size:15px;font-weight:700;letter-spacing:.25em;text-transform:uppercase;color:${primary};margin-bottom:24px}.h{font-size:${fs}px;font-weight:900;color:#fff;line-height:1.15;letter-spacing:-.03em}.divider{width:100px;height:4px;background:${primary};border-radius:2px;margin:44px 0 36px}.b{font-size:20px;font-weight:700;color:#555;letter-spacing:.1em;text-transform:uppercase}</style></head><body><div class="top"></div><div class="inner"><p class="label">Key insight</p><p class="h">${h}</p><div class="divider"></div><p class="b">${b}</p></div></body></html>`
    }
    case 10: {
      // Before/After Split — gray left, brand color right
      const fs = len < 60 ? 60 : len < 110 ? 48 : 36
      return `<html><head><meta charset="UTF-8"><link href="${GF}Poppins:wght@700;800;900&display=swap" rel="stylesheet"><style>${BASE_STYLE}body{font-family:'Poppins',sans-serif;display:flex;flex-direction:column}.bars{display:flex;height:12px}.bar1{flex:1;background:#e5e7eb}.bar2{flex:1;background:${primary}}.main{flex:1;display:flex}.left{flex:1;background:#f3f4f6;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 50px}.right{flex:1;background:${primary};display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 50px;position:relative}.badge{font-size:13px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;padding:8px 20px;border-radius:4px;margin-bottom:28px}.lb{background:#e5e7eb;color:#6b7280}.rb{background:rgba(255,255,255,.2);color:#fff}.lt{font-size:${fs}px;font-weight:900;color:#9ca3af;text-align:center;line-height:1.2}.rt{font-size:${fs}px;font-weight:900;color:#fff;text-align:center;line-height:1.2}.b{position:absolute;bottom:28px;right:0;left:0;text-align:center;font-size:16px;color:rgba(255,255,255,.45);font-weight:700;letter-spacing:.1em;text-transform:uppercase}</style></head><body><div class="bars"><div class="bar1"></div><div class="bar2"></div></div><div class="main"><div class="left"><div class="badge lb">Before</div><p class="lt">The old way</p></div><div class="right"><div class="badge rb">After</div><p class="rt">${h}</p><p class="b">${b}</p></div></div></body></html>`
    }
    case 11: {
      // Polaroid Style — off-white bg, rotated card with brand gradient
      const fs = len < 60 ? 68 : len < 110 ? 54 : 42
      return `<html><head><meta charset="UTF-8"><link href="${GF}Poppins:wght@700;800;900&display=swap" rel="stylesheet"><style>${BASE_STYLE}body{font-family:'Poppins',sans-serif;background:#f0ebe3;display:flex;align-items:center;justify-content:center}.polaroid{background:#fff;padding:56px 56px 100px;box-shadow:0 20px 80px rgba(0,0,0,.18),0 4px 20px rgba(0,0,0,.08);transform:rotate(-1.5deg);width:860px}.inner{width:100%;aspect-ratio:1/1;background:linear-gradient(135deg,${primary},${secondary});display:flex;align-items:center;justify-content:center;padding:50px}.h{font-size:${fs}px;font-weight:900;color:#fff;text-align:center;line-height:1.2;text-shadow:0 2px 20px rgba(0,0,0,.18)}.caption{margin-top:32px;text-align:center;font-size:26px;font-weight:700;color:#333;letter-spacing:.03em}</style></head><body><div class="polaroid"><div class="inner"><p class="h">${h}</p></div><p class="caption">${b}</p></div></body></html>`
    }
    case 12: {
      // Magazine Editorial — clean white, Playfair Display serif
      const fs = len < 60 ? 80 : len < 110 ? 64 : 50
      return `<html><head><meta charset="UTF-8"><link href="${GF}Playfair+Display:wght@700;800&display=swap&family=Inter:wght@400;600;700&display=swap" rel="stylesheet"><style>${BASE_STYLE}body{font-family:'Inter',sans-serif;background:#fff;display:flex;flex-direction:column}.topbar{height:6px;background:#111}.header{padding:40px 80px 28px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between}.mag{font-size:15px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:${primary}}.issue{font-size:13px;color:#bbb;letter-spacing:.1em}.content{flex:1;display:flex;flex-direction:column;justify-content:center;padding:80px 80px 60px}.kicker{font-size:15px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:${primary};margin-bottom:28px}.h{font-size:${fs}px;font-weight:800;font-family:'Playfair Display',serif;color:#111;line-height:1.1;letter-spacing:-.02em;margin-bottom:48px}.byline{display:flex;align-items:center;gap:16px;border-top:2px solid #111;padding-top:28px}.dot{width:8px;height:8px;border-radius:50%;background:${primary}}.name{font-size:18px;font-weight:600;color:#444;letter-spacing:.04em}</style></head><body><div class="topbar"></div><div class="header"><span class="mag">${b}</span><span class="issue">Editorial</span></div><div class="content"><p class="kicker">✦ Must Read</p><p class="h">${h}</p><div class="byline"><div class="dot"></div><p class="name">${b}</p></div></div></body></html>`
    }
    default:
      return ""
  }
}

export function PostPreviewCard({
  hookText,
  brandName,
  primaryColor = "#6366f1",
  secondaryColor = "#818cf8",
  template = 1,
  size = "md",
  px: customPx,
  className = "",
}: PostPreviewCardProps) {
  const px = customPx ?? SIZE_PX[size]
  const scale = px / 1080

  const html = useMemo(
    () => generatePreviewHtml(hookText, brandName, primaryColor, secondaryColor, template),
    [hookText, brandName, primaryColor, secondaryColor, template],
  )

  return (
    <div
      className={`relative overflow-hidden rounded-lg ${className}`}
      style={{ width: px, height: px, flexShrink: 0 }}
    >
      <iframe
        srcDoc={html}
        sandbox="allow-same-origin"
        title="Post preview"
        scrolling="no"
        style={{
          width: 1080,
          height: 1080,
          border: "none",
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          pointerEvents: "none",
          display: "block",
        }}
      />
    </div>
  )
}
