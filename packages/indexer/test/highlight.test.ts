import { TOKEN_SCOPES } from "@legible/domain"
import { describe, expect, it } from "vitest"

import { scopeForCapture } from "../src/highlight"
import { Parsing } from "../src/parse"

const parsing = new Parsing()

/** The scope names covering each line's text, as "text:scope" spans. */
async function spans(language: string, src: string) {
  const lines = src.split("\n")
  const { tokens } = await parsing.parse({ oid: null, language, lines })
  return lines.map((l, i) => {
    const t = tokens?.[i] ?? []
    const out: string[] = []
    for (let k = 0; k < t.length; k += 3)
      out.push(
        `${l.slice(t[k], (t[k] ?? 0) + (t[k + 1] ?? 0))}:${TOKEN_SCOPES[t[k + 2] ?? -1]}`,
      )
    return out
  })
}

describe("tree-sitter highlighting", () => {
  it("maps captures to the renderer's scopes", () => {
    expect(scopeForCapture("keyword.return")).toBe(
      TOKEN_SCOPES.indexOf("keyword"),
    )
    expect(scopeForCapture("function.method")).toBe(
      TOKEN_SCOPES.indexOf("function"),
    )
    expect(scopeForCapture("constructor")).toBe(TOKEN_SCOPES.indexOf("type"))
    expect(scopeForCapture("variable.builtin")).toBe(
      TOKEN_SCOPES.indexOf("keyword"),
    )
    expect(scopeForCapture("none")).toBe(-1)
    expect(scopeForCapture("spell")).toBeNull()
    expect(scopeForCapture("toString")).toBeNull()
  })

  it("highlights TypeScript, splitting multi-line strings per line", async () => {
    const s = await spans(
      "typescript",
      "export function f(n: number) {\n  return `a\n  ${n}` // c\n}",
    )
    expect(s[0]).toEqual(
      expect.arrayContaining([
        "export:keyword",
        "function:keyword",
        "f:function",
        "number:type",
      ]),
    )
    expect(s[1]).toEqual(
      expect.arrayContaining(["return:keyword", "`a:string"]),
    )
    expect(s[2]).toEqual(expect.arrayContaining(["// c:comment"]))
    expect(s[2]?.[0]).toBe("  :string") // the template continues from column 0
  })

  it("highlights Python, Go and Rust", async () => {
    expect((await spans("python", "def f():\n    return 'x'"))[1]).toEqual([
      "return:keyword",
      "'x':string",
    ])
    expect((await spans("go", "func main() {}"))[0]).toEqual(
      expect.arrayContaining(["func:keyword", "main:function"]),
    )
    expect((await spans("rust", "fn main() { let x = 1; }"))[0]).toEqual(
      expect.arrayContaining([
        "fn:keyword",
        "main:function",
        "let:keyword",
        "1:constant",
      ]),
    )
  })

  it("falls back to Lezer for languages without a bundled grammar", async () => {
    const p = await parsing.parse({
      oid: null,
      language: "kotlin",
      lines: ['val s = "x"'],
    })
    expect(p.tier).toBe("text")
    expect(p.tokens?.[0]?.length).toBeGreaterThan(0)
  })
})
