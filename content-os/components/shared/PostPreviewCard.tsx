"use client"

import { useMemo } from "react"

export type PreviewSize = "sm" | "md" | "lg" | "xl"
export type PreviewTemplate = 1 | 2 | 3 | 4 | 5 | 6

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
