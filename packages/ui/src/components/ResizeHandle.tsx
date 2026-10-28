// A draggable edge that resizes the panel beside it: drag it, or focus it
// and use the arrow keys (⇧ for bigger steps, Home/End for the limits).
// Double-click restores the default width.

import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react"

import { cn } from "./ui"

export function ResizeHandle({
  label,
  edge,
  value,
  min,
  max,
  defaultValue,
  onResize,
  onCommit,
}: {
  label: string
  /** Which edge of its panel the handle is on: dragging away from the panel widens it. */
  edge: "right" | "left"
  value: number
  min: number
  max: number
  defaultValue: number
  /** While resizing. */
  onResize: (px: number) => void
  /** When a resize ends: remember it. */
  onCommit: (px: number) => void
}) {
  const drag = useRef<{ x: number; start: number; last: number } | null>(null)
  const [active, setActive] = useState(false)
  const sign = edge === "right" ? 1 : -1
  const clamp = (px: number) => Math.round(Math.max(min, Math.min(max, px)))

  const end = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    setActive(false)
    e.currentTarget.releasePointerCapture(e.pointerId)
    document.body.style.removeProperty("cursor")
    document.body.style.removeProperty("user-select")
    onCommit(d.last)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16
    let next: number | null = null
    if (e.key === "ArrowRight") next = value + step * sign
    else if (e.key === "ArrowLeft") next = value - step * sign
    else if (e.key === "Home") next = min
    else if (e.key === "End") next = max
    if (next === null) return
    e.preventDefault()
    // Keys mustn't reach the diff's j/k/n/p shortcuts.
    e.stopPropagation()
    onCommit(clamp(next))
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={`${label} (double-click to reset)`}
      data-testid={`resize-${edge === "right" ? "left-panel" : "right-panel"}`}
      className={cn(
        "absolute top-0 bottom-0 z-20 w-1.5 cursor-col-resize app-no-drag outline-none hover:bg-ring/60 focus-visible:bg-ring",
        edge === "right" ? "-right-[3px]" : "-left-[3px]",
        active && "bg-ring",
      )}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, start: value, last: value }
        setActive(true)
        document.body.style.cursor = "col-resize"
        document.body.style.userSelect = "none"
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        d.last = clamp(d.start + (e.clientX - d.x) * sign)
        onResize(d.last)
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => onCommit(clamp(defaultValue))}
      onKeyDown={onKeyDown}
    />
  )
}
