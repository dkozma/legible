// Widths of the Review's side panels, remembered per machine. They live in
// the renderer's localStorage: a convenience like a window size, saved when a
// resize ends, and never worth a Settings write (which reconfigures agents).

export type PanelKey = "left" | "right"
export type Panels = Record<PanelKey, number>

export const PANEL_LIMITS: Record<
  PanelKey,
  { default: number; min: number; max: number }
> = {
  left: { default: 296, min: 200, max: 560 },
  right: { default: 360, min: 280, max: 720 },
}

/** The diff keeps at least this much width. */
export const CENTER_MIN = 420

const STORAGE_KEY = "legible.panels.v1"

export const DEFAULT_PANELS: Panels = {
  left: PANEL_LIMITS.left.default,
  right: PANEL_LIMITS.right.default,
}

/** A width within the panel's limits and, given `room`, leaving the diff its minimum. */
export function clampPanel(
  key: PanelKey,
  px: number,
  room = Number.POSITIVE_INFINITY,
): number {
  const { min, max } = PANEL_LIMITS[key]
  return Math.round(Math.max(min, Math.min(max, room, px)))
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">

/** Remembered widths; defaults for anything missing or unreadable. */
export function loadPanels(storage: Storage | null): Panels {
  try {
    const raw = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "null") as unknown
    if (!raw || typeof raw !== "object") return { ...DEFAULT_PANELS }
    const read = (key: PanelKey) => {
      const v = (raw as Record<string, unknown>)[key]
      return typeof v === "number" && Number.isFinite(v)
        ? clampPanel(key, v)
        : PANEL_LIMITS[key].default
    }
    return { left: read("left"), right: read("right") }
  } catch {
    return { ...DEFAULT_PANELS }
  }
}

export function savePanels(storage: Storage | null, panels: Panels) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(panels))
  } catch {
    // Private mode or storage full: widths last until the window closes.
  }
}

/** The renderer's localStorage, or null where there is none (tests, prototype). */
export function panelStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage
  } catch {
    return null
  }
}
