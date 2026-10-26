// A Structural proof must never hide a behavioral change. Cases from M1's
// token-based proofs (and their review) plus AST-specific ones.
import { diffLines, languageForPath, splitLines } from "@legible/diff"
import { describe, expect, it } from "vitest"

import { Parsing } from "../src/parse"
import { proveChunks } from "../src/proofs"

const parsing = new Parsing()

async function proofs(path: string, base: string[], head: string[]) {
  const chunks = diffLines(base, head)
  const all = await proveChunks(parsing, {
    language: languageForPath(path),
    baseLines: base,
    headLines: head,
    chunks,
  })
  return all.filter((_, i) => chunks[i]?.kind === "change")
}
const src = (path: string, base: string, head: string) =>
  proofs(path, splitLines(base), splitLines(head))

const none = (p: (string | null)[]) =>
  expect(p.every((x) => x === null)).toBe(true)

describe("no false Structural proofs", () => {
  it("whitespace inside strings and template literals", async () => {
    none(
      await proofs(
        "a.ts",
        ["const s = `${a}", "${b}`;"],
        ["const s = `${a}", "", "${b}`;"],
      ),
    )
    none(
      await proofs(
        "a.ts",
        ["const q = sql`", "  FROM ${t}", "  WHERE x`;"],
        ["const q = sql`", "  FROM ${t}", "", "  WHERE x`;"],
      ),
    )
    none(
      await proofs(
        "a.ts",
        ["const s = `x\\n", "", "y`;"],
        ["const s = `x\\n", "y`;"],
      ),
    )
    none(
      await src("a.ts", "const s = `\n  a\n`;\n", "const s = `\n    a\n`;\n"),
    )
    none(await src("a.ts", 'const s = "a  b";\n', 'const s = "a b";\n'))
    none(await src("a.py", 's = """\n  a\n"""\n', 's = """\na\n"""\n'))
    none(await src("a.go", "var s = `\n  a\n`\n", "var s = `\na\n`\n"))
  })

  it("a lone brace that changes nesting while other code moves", async () => {
    const base = [
      "function f() {",
      "  one();",
      "  two();",
      "  three();",
      "}",
      "if (x) {",
      "  a();",
      "}",
      "b();",
    ]
    const head = [
      "function g() {}",
      "if (x) {",
      "  a();",
      "  b();",
      "}",
      "function f() {",
      "  one();",
      "  two();",
      "  three();",
      "}",
    ]
    none(await proofs("a.ts", base, head))
  })

  it("languages without a sound AST proof", async () => {
    none(
      await proofs(
        "a.kt",
        ['val s = """', "a", 'b"""'],
        ['val s = """', "a", "", 'b"""'],
      ),
    )
    none(await src("build.sh", "a = b\n", "a=b\n"))
    none(
      await src("x.css", ".a { margin: 0 -1px; }\n", ".a { margin: 0-1px; }\n"),
    )
    none(
      await proofs(
        "a.md",
        ["line one", "line two"],
        ["line one", "", "line two"],
      ),
    )
    none(
      await proofs(
        "a.html",
        ["<pre>", "    code", "</pre>"],
        ["<pre>", "code", "</pre>"],
      ),
    )
    none(
      await proofs(
        "a.rb",
        ["x = <<EOS", "  text", "EOS"],
        ["x = <<EOS", "text", "EOS"],
      ),
    )
    none(
      await proofs(
        "a.yaml",
        ["a: |", "  one", "  two"],
        ["a: |", "  one", "", "  two"],
      ),
    )
  })

  it("code moved out of a conditional", async () => {
    none(
      await proofs(
        "a.ts",
        ["if (cond) {", "  a();", "  b();", "  c();", "}"],
        ["if (cond) {", "}", "a();", "b();", "c();"],
      ),
    )
  })

  it("re-indentation in Python", async () => {
    none(
      await src("a.py", "if a:\n    x()\ny()\n", "if a:\n    x()\n    y()\n"),
    )
  })

  it("operator merges and automatic semicolons", async () => {
    none(await src("a.ts", "const x = a - -b;\n", "const x = a--b;\n"))
    none(
      await src(
        "a.ts",
        "function f() {\n  return\n  x\n}\n",
        "function f() {\n  return x\n}\n",
      ),
    )
  })

  it("preprocessor spacing in C", async () => {
    none(
      await proofs(
        "a.c",
        ["#define X(a) a", "#define Y (a) a"],
        ["#define X(a) a", "#define Y(a) a"],
      ),
    )
    none(
      await proofs(
        "a.c",
        ["#define X 1 \\", "  + 2"],
        ["#define X 1 \\ ", "  + 2"],
      ),
    )
  })

  it("whitespace between JSX elements", async () => {
    none(
      await src(
        "a.tsx",
        "const a = <p><b>x</b> <i>y</i></p>\n",
        "const a = <p><b>x</b><i>y</i></p>\n",
      ),
    )
  })

  it("files that don't parse", async () => {
    none(
      await src(
        "a.ts",
        "function f( {\nreturn 1\n",
        "function f( {\n  return 1\n",
      ),
    )
  })
})

describe("real Structural proofs", () => {
  it("re-indented TypeScript is whitespace", async () => {
    expect(
      await proofs(
        "a.ts",
        ["function f() {", "return 1;", "}"],
        ["function f() {", "  return 1;", "}"],
      ),
    ).toEqual(["whitespace"])
  })

  it("operator spacing and re-wrapped arguments are formatting", async () => {
    expect(await src("a.ts", "const x = a+b;\n", "const x = a + b;\n")).toEqual(
      ["formatting"],
    )
    expect(
      await src(
        "a.go",
        "func f() {\n\tg(a,\n\t\tb)\n}\n",
        "func f() {\n\tg(a, b)\n}\n",
      ),
    ).toEqual(["formatting"])
  })

  it("re-indented comments", async () => {
    expect(
      await src(
        "a.ts",
        "/**\n * Doc\n */\nfunction f() {}\n",
        "  /**\n   * Doc\n   */\nfunction f() {}\n",
      ),
    ).toEqual(["whitespace"])
  })

  it("CRLF → LF in code", async () => {
    expect(
      await proofs(
        "a.ts",
        ["const a = 1;\r", "const b = 2;\r"],
        ["const a = 1;", "const b = 2;"],
      ),
    ).toEqual(["whitespace"])
  })

  it("Python spacing inside a line", async () => {
    expect(await src("a.py", "x = f(a,b)\n", "x = f(a, b)\n")).toEqual([
      "formatting",
    ])
  })
})
