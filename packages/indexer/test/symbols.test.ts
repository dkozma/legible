import { diffLines } from "@legible/diff"
import type { DiffChunk } from "@legible/domain"
import { describe, expect, it } from "vitest"

import { splitAtSymbols } from "../src/fragments"
import { Parsing } from "../src/parse"
import { matchSymbols, toCodeSymbols } from "../src/symbols"

const parsing = new Parsing()

async function symbols(language: string, base: string, head: string) {
  const b = base.split("\n")
  const h = head.split("\n")
  const [pb, ph] = await Promise.all([
    parsing.parse({ oid: null, language, lines: b }),
    parsing.parse({ oid: null, language, lines: h }),
  ])
  const bs = toCodeSymbols("base", "a", language, pb.outline!.symbols)
  const hs = toCodeSymbols("head", "a", language, ph.outline!.symbols)
  matchSymbols(bs, hs, b, h)
  return { b, h, bs, hs }
}

const changes = (chunks: DiffChunk[]) =>
  chunks
    .filter((c) => c.kind === "change")
    .map((c) => [c.baseStart, c.baseEnd, c.headStart, c.headEnd])

describe("Base ↔ Head matching", () => {
  it("matches by qualified name and tells modified from unchanged", async () => {
    const { bs, hs } = await symbols(
      "typescript",
      "function a() {\n  return 1\n}\nfunction b() {\n  return 2\n}\nfunction gone() {}\n",
      "function a() {\n  return 1\n}\nfunction b() {\n  return 3\n}\nfunction fresh() {}\n",
    )
    expect(hs.map((s) => `${s.name}:${s.change}`)).toEqual([
      "a:unchanged",
      "b:modified",
      "fresh:added",
    ])
    expect(bs.find((s) => s.name === "gone")?.change).toBe("removed")
    expect(hs[0]!.counterpartId).toBe(bs[0]!.id)
  })

  it("detects a rename by signature and body", async () => {
    const body =
      "  const x = order.total\n  const y = x * 2\n  log(y)\n  return y\n"
    const { bs, hs } = await symbols(
      "typescript",
      `function refundTotal(order: Order): number {\n${body}}\n`,
      `function computeRefund(order: Order): number {\n${body}}\n`,
    )
    expect(hs[0]).toMatchObject({
      name: "computeRefund",
      change: "renamed",
      counterpartId: bs[0]!.id,
    })
  })

  it("matches methods within their class", async () => {
    const { hs } = await symbols(
      "python",
      "class A:\n    def run(self):\n        pass\n",
      "class A:\n    def run(self):\n        return 1\n",
    )
    expect(hs.map((s) => `${s.qualifiedName}:${s.change}`)).toEqual([
      "A:modified",
      "A.run:modified",
    ])
  })
})

describe("Fragments split at Symbol boundaries", () => {
  it("splits one hunk spanning two functions", async () => {
    const { b, h, bs, hs } = await symbols(
      "typescript",
      "function a() {\n  one()\n}\nfunction b() {\n  two()\n}\n",
      "function a() {\n  uno()\n}\nfunction b() {\n  dos()\n}\n",
    )
    // Lines 2–4 changed in one chunk only if the diff merges them; force one chunk across both functions.
    const chunk: DiffChunk = {
      kind: "change",
      baseStart: 1,
      baseEnd: 5,
      headStart: 1,
      headEnd: 5,
    }
    const chunks: DiffChunk[] = [
      { kind: "equal", baseStart: 0, baseEnd: 1, headStart: 0, headEnd: 1 },
      chunk,
      {
        kind: "equal",
        baseStart: 5,
        baseEnd: b.length,
        headStart: 5,
        headEnd: h.length,
      },
    ]
    expect(changes(splitAtSymbols(chunks, bs, hs, b, h))).toEqual([
      [1, 3, 1, 3],
      [3, 5, 3, 5],
    ])
  })

  it("gives each added function its own Fragment, with its doc comment", async () => {
    const base = "export const a = 1\n"
    const head =
      "export const a = 1\n\n/** One. */\nfunction one() {}\n\n/** Two. */\nfunction two() {}\n"
    const { b, h, bs, hs } = await symbols("typescript", base, head)
    const split = splitAtSymbols(diffLines(b, h), bs, hs, b, h)
    // The blank line before each function goes with it.
    expect(changes(split)).toEqual([
      [2, 2, 2, 4],
      [2, 2, 4, 8],
    ])
  })

  it("keeps a change inside one function whole, nested callbacks included", async () => {
    const { b, h, bs, hs } = await symbols(
      "typescript",
      "function a() {\n  const f = () => 1\n  run(f)\n}\n",
      "function a() {\n  const f = () => 2\n  run(f, 1)\n}\n",
    )
    const split = splitAtSymbols(diffLines(b, h), bs, hs, b, h)
    expect(changes(split)).toEqual([[1, 3, 1, 3]])
  })

  it("keeps a blank line and doc comment inside a class with the next method", async () => {
    const { b, h, bs, hs } = await symbols(
      "typescript",
      "class A {\n  x() {}\n  y() {\n    return 1\n  }\n}",
      "class A {\n  x() {}\n\n  /** New. */\n  n() {}\n  y() {\n    return 2\n  }\n}",
    )
    const split = splitAtSymbols(diffLines(b, h), bs, hs, b, h)
    // Lines 2–4 (blank, doc, n) are one Fragment; y's change is another.
    expect(changes(split)).toEqual([
      [2, 2, 2, 5],
      [3, 4, 6, 7],
    ])
  })

  it("covers every changed line exactly once, in order", async () => {
    const { b, h, bs, hs } = await symbols(
      "go",
      "package x\n\nfunc A() {\n\ta()\n}\n\nfunc B() {\n\tb()\n}\n",
      "package x\n\nfunc C() {}\n\nfunc A() {\n\taa()\n}\n\nfunc B() {\n\tbb()\n}\n",
    )
    const original = diffLines(b, h)
    const split = splitAtSymbols(original, bs, hs, b, h)
    let bi = 0
    let hi = 0
    for (const c of split) {
      expect(c.baseStart).toBe(bi)
      expect(c.headStart).toBe(hi)
      bi = c.baseEnd
      hi = c.headEnd
    }
    expect([bi, hi]).toEqual([b.length, h.length])
  })
})
