import { describe, expect, it } from "vitest"

import {
  clampPanel,
  DEFAULT_PANELS,
  loadPanels,
  PANEL_LIMITS,
  savePanels,
} from "../src/panels"

function memory(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v
    },
  }
}

describe("panel widths", () => {
  it("default when nothing is remembered or it can't be read", () => {
    expect(loadPanels(null)).toEqual(DEFAULT_PANELS)
    expect(loadPanels(memory())).toEqual(DEFAULT_PANELS)
    expect(loadPanels(memory({ "legible.panels.v1": "{not json" }))).toEqual(
      DEFAULT_PANELS,
    )
    expect(
      loadPanels(
        memory({ "legible.panels.v1": JSON.stringify({ left: "wide" }) }),
      ),
    ).toEqual(DEFAULT_PANELS)
    const throwing = {
      getItem: () => {
        throw new Error("denied")
      },
      setItem: () => {
        throw new Error("denied")
      },
    }
    expect(loadPanels(throwing)).toEqual(DEFAULT_PANELS)
    expect(() => savePanels(throwing, DEFAULT_PANELS)).not.toThrow()
  })

  it("come back as saved, within limits", () => {
    const store = memory()
    savePanels(store, { left: 410, right: 300 })
    expect(loadPanels(store)).toEqual({ left: 410, right: 300 })
    savePanels(store, { left: 5000, right: 1 })
    expect(loadPanels(store)).toEqual({
      left: PANEL_LIMITS.left.max,
      right: PANEL_LIMITS.right.min,
    })
  })

  it("leave the diff room", () => {
    expect(clampPanel("left", 500)).toBe(500)
    expect(clampPanel("left", 500, 350)).toBe(350)
    // Never below the minimum, even in a tiny window.
    expect(clampPanel("right", 500, 100)).toBe(PANEL_LIMITS.right.min)
    expect(clampPanel("left", 233.6)).toBe(234)
  })
})
