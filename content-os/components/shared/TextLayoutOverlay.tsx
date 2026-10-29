"use client"

import type { FontId } from "@/lib/design/fonts"
import { previewFamilies } from "@/lib/design/preview-fonts"
import type { LayoutPrim } from "@/lib/design/text-layouts"
import { layoutPrimsToSvg } from "@/lib/design/text-layout-render"

/**
 * A layout plan's primitives as an SVG over a preview frame -- the same
 * markup the server compositors rasterize (lib/design/text-layout-render.ts),
 * scaled to the frame through its viewBox, so the preview matches the
 * exported image line for line.
 */
export function TextLayoutOverlay({ prims, width, height, fonts, className = "" }: {
  prims: LayoutPrim[]
  width: number
  height: number
  fonts: { heading: FontId; body: FontId }
  className?: string
}) {
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid slice"
      className={`pointer-events-none absolute inset-0 z-10 h-full w-full ${className}`}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: layoutPrimsToSvg(prims, previewFamilies(fonts)) }}
    />
  )
}
