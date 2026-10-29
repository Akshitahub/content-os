/**
 * The two ways a LayoutPlan (lib/design/text-layouts.ts) is drawn -- SVG
 * markup (server compositors via resvg, and the builder previews in the
 * browser) and canvas calls (FullPost's overlay export, Ad Maker). Both read
 * the same primitives, so they agree on every line and position. Pure.
 */
import type { LayoutPrim } from "./text-layouts"

/** CSS/SVG font-family values for the heading and body roles. */
export interface LayoutFamilies {
  heading: string
  body: string
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;")
}

const round = (n: number) => Math.round(n * 10) / 10

/** SVG elements (no <svg> wrapper) for a plan's primitives. */
export function layoutPrimsToSvg(prims: LayoutPrim[], families: LayoutFamilies): string {
  return prims.map((p) => {
    switch (p.kind) {
      case "rect":
        return `<rect x="${round(p.x)}" y="${round(p.y)}" width="${round(p.w)}" height="${round(p.h)}" rx="${round(p.r)}" fill="${p.fill}"/>`
      case "line":
        return `<line x1="${round(p.x1)}" y1="${round(p.y1)}" x2="${round(p.x2)}" y2="${round(p.y2)}" stroke="${p.stroke}" stroke-width="${round(p.width)}" stroke-linecap="round"/>`
      case "circle":
        return `<circle cx="${round(p.cx)}" cy="${round(p.cy)}" r="${round(p.r)}" fill="${p.fill}"/>`
      case "text": {
        const family = escapeAttr(p.font === "heading" ? families.heading : families.body)
        const attrs = [
          `x="${round(p.x)}"`, `y="${round(p.y)}"`, `text-anchor="${p.anchor}"`, `font-family="${family}"`,
          `font-size="${round(p.size)}"`, `font-weight="${p.weight}"`,
          p.italic ? `font-style="italic"` : "",
          p.spacing ? `letter-spacing="${round(p.spacing)}"` : "",
        ].filter(Boolean).join(" ")
        // xml:space keeps the spaces at run boundaries (a highlight run starts or ends mid-line).
        return `<text ${attrs} xml:space="preserve">${p.runs.map((r) => `<tspan fill="${r.color}">${escapeXml(r.text)}</tspan>`).join("")}</text>`
      }
    }
  }).join("")
}

/** Draws a plan's primitives on a canvas the size the plan was made for. */
export function drawLayoutPrims(ctx: CanvasRenderingContext2D, prims: LayoutPrim[], families: LayoutFamilies): void {
  ctx.save()
  ctx.textBaseline = "alphabetic"
  ctx.shadowBlur = 0
  for (const p of prims) {
    if (p.kind === "rect") {
      ctx.fillStyle = p.fill
      ctx.beginPath()
      if (p.r > 0) ctx.roundRect(p.x, p.y, p.w, p.h, p.r)
      else ctx.rect(p.x, p.y, p.w, p.h)
      ctx.fill()
    } else if (p.kind === "line") {
      ctx.strokeStyle = p.stroke
      ctx.lineWidth = p.width
      ctx.lineCap = "round"
      ctx.beginPath()
      ctx.moveTo(p.x1, p.y1)
      ctx.lineTo(p.x2, p.y2)
      ctx.stroke()
    } else if (p.kind === "circle") {
      ctx.fillStyle = p.fill
      ctx.beginPath()
      ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2)
      ctx.fill()
    } else {
      const family = p.font === "heading" ? families.heading : families.body
      ctx.font = `${p.italic ? "italic " : ""}${p.weight} ${p.size}px ${family}`
      ;(ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${p.spacing ?? 0}px`
      ctx.textAlign = "left"
      const widths = p.runs.map((r) => ctx.measureText(r.text).width)
      const total = widths.reduce((a, b) => a + b, 0)
      let x = p.anchor === "middle" ? p.x - total / 2 : p.anchor === "end" ? p.x - total : p.x
      p.runs.forEach((r, i) => {
        ctx.fillStyle = r.color
        ctx.fillText(r.text, x, p.y)
        x += widths[i]!
      })
    }
  }
  ;(ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "0px"
  ctx.restore()
}
