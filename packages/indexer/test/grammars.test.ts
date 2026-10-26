import { describe, expect, it } from "vitest"

import { Grammars } from "../src/grammars"
import { GRAMMARS, languageTier } from "../src/manifest"

const grammars = new Grammars()

describe("grammar manifest", () => {
  // CI loads every bundled grammar, so an ABI or query mismatch fails here, not in the app.
  it.each(Object.keys(GRAMMARS))(
    "loads %s and compiles its queries",
    async (lang) => {
      const g = await grammars.get(lang)
      expect(g).not.toBeNull()
      const spec = GRAMMARS[lang]!
      expect(g!.highlights !== null).toBe(spec.highlights.length > 0)
      expect(g!.tags !== null).toBe(spec.tags.length + spec.legible.length > 0)
      const tree = grammars.parser(g!).parse("")
      expect(tree).not.toBeNull()
      tree?.delete()
    },
  )

  it("derives Language Tiers", () => {
    expect(languageTier("typescript")).toBe("full")
    expect(languageTier("go")).toBe("full")
    expect(languageTier("yaml")).toBe("structural")
    expect(languageTier("markdown")).toBe("text")
    expect(languageTier(null)).toBe("text")
  })

  it("has at least 5 Full-tier languages", () => {
    const full = Object.keys(GRAMMARS).filter((l) => languageTier(l) === "full")
    expect(full.length).toBeGreaterThanOrEqual(5)
  })
})
