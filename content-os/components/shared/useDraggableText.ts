"use client"

import { useCallback, useRef, useState } from "react"

export interface TextPosition {
  /** 0-100, percentage of the slide's width -- the horizontal center of
   * the dragged text block. */
  x: number
  /** 0-100, percentage of the slide's height -- the vertical center of
   * the dragged text block. */
  y: number
}

interface UseDraggableTextOptions {
  /** The slide element the percentage is measured against -- must be the
   * same box whose dimensions the compositor treats as 0-100 (the full
   * phone-frame/slide card, not just its safe-zone interior), so a
   * position captured here maps 1:1 onto the real export canvas
   * regardless of the two rendering at completely different pixel sizes. */
  containerRef: React.RefObject<HTMLElement | null>
  /** The actual draggable text block (headline+subtext etc) -- its
   * rendered size at drag-start is used to tighten `bounds` so the
   * block's own edge can't be dragged past the container's edge.
   * Confirmed live: a static `bounds` alone lets a wide headline (nearly
   * the frame's full width, center-anchored) clip against the frame the
   * moment it's dragged even a little off x=50, since the anchor itself
   * staying in-bounds says nothing about where the block's actual left/
   * right edges end up. Optional -- omitted, `bounds` is used as-is. */
  measureRef?: React.RefObject<HTMLElement | null>
  position: TextPosition
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  onCommit: (position: TextPosition) => void
}

// Small fixed pixel margin (converted to a percentage of the container at
// drag-start) kept between the measured block's edge and the container's
// edge -- purely cosmetic breathing room, on top of the real anti-clip
// math below.
const EDGE_MARGIN_PX = 6

/**
 * Lightweight drag-to-reposition for a slide's text block — plain pointer
 * events, no drag library added (checked: neither StorySequence.tsx nor
 * CarouselBuilder.tsx nor their dependencies already pull one in, and this
 * is a simple single-axis-unconstrained, bounds-clamped drag, not worth a
 * new dependency for). Percentage-based rather than pixel-based so the
 * same stored position renders correctly at both the small editor preview
 * size and the real full-resolution export/compositor canvas — see
 * StorySlide.text_position_x/y and CarouselSlideRich.text_position_x/y,
 * the two places this ends up persisted.
 *
 * Only commits (calls onCommit, which feeds into each component's
 * existing autosave) once, on pointer-up — intermediate positions during
 * the drag itself are local-only state (the `current` returned below),
 * so dragging doesn't spam a save on every pointermove.
 */
export function useDraggableText({ containerRef, measureRef, position, bounds, onCommit }: UseDraggableTextOptions) {
  const [live, setLive] = useState<TextPosition | null>(null)
  const draggingRef = useRef(false)

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Not a click-to-edit target (that's the contentEditable text itself,
    // untouched) — this handler only ever lives on the dedicated drag
    // handle, so it's safe to fully take over the gesture.
    e.preventDefault()
    e.stopPropagation()
    const container = containerRef.current
    if (!container) return
    draggingRef.current = true

    // Measured once at drag-start (the block's own text doesn't change
    // mid-drag) and tightens the outer `bounds` so the block's rendered
    // edges -- not just its center anchor -- stay clear of the frame.
    // Falls back to the plain outer bounds when there's nothing to
    // measure, or when the block is wide enough that no in-bounds center
    // point would keep both edges clear (an extreme long-text case) --
    // splits the difference around the bounds' own midpoint instead of
    // producing an inverted (min > max) range.
    const rect = container.getBoundingClientRect()
    const el = measureRef?.current
    let clampBounds = bounds
    if (el) {
      const halfWPct = ((el.offsetWidth / 2 + EDGE_MARGIN_PX) / rect.width) * 100
      const halfHPct = ((el.offsetHeight / 2 + EDGE_MARGIN_PX) / rect.height) * 100
      const dynMinX = Math.max(bounds.minX, halfWPct)
      const dynMaxX = Math.min(bounds.maxX, 100 - halfWPct)
      const dynMinY = Math.max(bounds.minY, halfHPct)
      const dynMaxY = Math.min(bounds.maxY, 100 - halfHPct)
      const midX = (bounds.minX + bounds.maxX) / 2
      const midY = (bounds.minY + bounds.maxY) / 2
      clampBounds = {
        minX: dynMinX <= dynMaxX ? dynMinX : midX,
        maxX: dynMinX <= dynMaxX ? dynMaxX : midX,
        minY: dynMinY <= dynMaxY ? dynMinY : midY,
        maxY: dynMinY <= dynMaxY ? dynMaxY : midY,
      }
    }
    const clamp = (x: number, y: number): TextPosition => ({
      x: Math.min(clampBounds.maxX, Math.max(clampBounds.minX, x)),
      y: Math.min(clampBounds.maxY, Math.max(clampBounds.minY, y)),
    })

    function toPercent(clientX: number, clientY: number): TextPosition {
      const r = container!.getBoundingClientRect()
      return clamp(
        ((clientX - r.left) / r.width) * 100,
        ((clientY - r.top) / r.height) * 100
      )
    }

    setLive(toPercent(e.clientX, e.clientY))

    function onMove(ev: PointerEvent) {
      if (!draggingRef.current) return
      setLive(toPercent(ev.clientX, ev.clientY))
    }
    function onUp(ev: PointerEvent) {
      if (!draggingRef.current) return
      draggingRef.current = false
      const final = toPercent(ev.clientX, ev.clientY)
      setLive(null)
      onCommit(final)
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
    // Listened on window (not the handle itself) so the drag keeps
    // tracking correctly even once the pointer moves off the small
    // handle element mid-drag.
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }, [containerRef, measureRef, bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, onCommit])

  return { onPointerDown, current: live ?? position, isDragging: live !== null }
}
