import { execFileSync } from "node:child_process"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { nextVersion } from "../scripts/version.mjs"

const day = (iso: string) => new Date(`${iso}T12:00:00Z`)

describe("release versions", () => {
  it("joins month and day without leading zeros", () => {
    expect(nextVersion(day("2026-10-25"), [])).toBe("2026.1025.1")
    expect(nextVersion(day("2027-01-05"), [])).toBe("2027.105.1")
    expect(nextVersion(day("2026-12-31"), [])).toBe("2026.1231.1")
  })

  it("counts releases already made that day", () => {
    const tags = ["v2026.1025.1", "v2026.1025.2", "v2026.1024.7", "v0.1.0"]
    expect(nextVersion(day("2026-10-25"), tags)).toBe("2026.1025.3")
    expect(nextVersion(day("2026-10-26"), tags)).toBe("2026.1026.1")
  })

  it("sorts in release order under semver", () => {
    const order = [
      "2026.1025.1",
      "2026.1025.2",
      "2026.1026.1",
      "2026.1231.9",
      "2027.105.1",
    ]
    const key = (v: string) => v.split(".").map(Number)
    const sorted = order.toSorted((a, b) => {
      const [x, y] = [key(a), key(b)]
      for (let i = 0; i < 3; i++)
        if (x[i] !== y[i]) return (x[i] as number) - (y[i] as number)
      return 0
    })
    expect(sorted).toEqual(order)
  })

  it("reads tags from stdin when run as a script", () => {
    const out = execFileSync(
      "node",
      [resolve(__dirname, "../scripts/version.mjs")],
      { input: "v1999.101.1\n", encoding: "utf8" },
    )
    expect(out.trim()).toMatch(/^\d{4}\.[1-9]\d{2,3}\.1$/)
  })
})
