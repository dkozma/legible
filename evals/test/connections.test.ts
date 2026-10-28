// The Connections eval without a SCIP indexer: decoding a hand-encoded SCIP
// index, and scoring a small repository with the probe's patterns A–C
// against hand-written SCIP occurrences.

import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { GitRepo } from "@legible/git"
import { buildChangeSet, CodeIndex, Parsing } from "@legible/indexer"
import { Root } from "protobufjs"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { examples } from "../src/connections/report"
import { symbolPositions } from "../src/connections/run"
import { isLocalSymbol, loadScip, toUtf16 } from "../src/connections/scip"
import {
  type ChangeSetScore,
  scoreChangeSet,
  type SiteScore,
  type UsedBySite,
} from "../src/connections/score"

const root = new Root()
root.loadSync(join(__dirname, "../scip/scip.proto"), { keepCase: true })
const IndexType = root.lookupType("scip.Index")

interface Occ {
  /** Typed range when true, the old `range` field otherwise. */
  typed?: boolean
  range: [number, number, number]
  symbol: string
  roles?: number
}

function encode(
  documents: {
    path: string
    encoding?: number
    occurrences: Occ[]
    relationships?: [string, string][]
  }[],
): Uint8Array {
  const message = IndexType.fromObject({
    metadata: { tool_info: { name: "hand", version: "1" } },
    documents: documents.map((d) => ({
      relative_path: d.path,
      position_encoding: d.encoding ?? 0,
      occurrences: d.occurrences.map((o) => ({
        ...(o.typed
          ? {
              single_line_range: {
                line: o.range[0],
                start_character: o.range[1],
                end_character: o.range[2],
              },
            }
          : { range: o.range }),
        symbol: o.symbol,
        symbol_roles: o.roles ?? 0,
      })),
      symbols: (d.relationships ?? []).map(([symbol, other]) => ({
        symbol,
        relationships: [{ symbol: other, is_implementation: true }],
      })),
    })),
  })
  return IndexType.encode(message).finish()
}

describe("reading SCIP", () => {
  it("converts UTF-8 and UTF-32 columns to UTF-16", () => {
    expect(toUtf16("const café = 1; café", 17, 1)).toBe(16)
    expect(toUtf16("a😀b", 5, 1)).toBe(3)
    expect(toUtf16("a😀b", 2, 3)).toBe(3)
    expect(toUtf16("a😀b", 3, 2)).toBe(3)
  })

  it("decodes typed and old ranges, definitions, relationships and locals", async () => {
    const text = "const café = 1; café"
    const scip = await loadScip(
      encode([
        {
          path: "src/a.ts",
          encoding: 1,
          occurrences: [
            { typed: true, range: [0, 6, 11], symbol: "s a/café.", roles: 1 },
            { range: [0, 17, 22], symbol: "s a/café." },
            { range: [1, 0, 3], symbol: "local 1", roles: 1 },
            { range: [1, 9, 34], symbol: "s a/Order#`<constructor>`()." },
          ],
          relationships: [["s a/Order#save().", "s a/Saver#save()."]],
        },
        {
          path: "src/b.ts",
          occurrences: [
            { typed: true, range: [2, 4, 9], symbol: "local 1", roles: 1 },
          ],
        },
      ]),
      async (path) => (path === "src/a.ts" ? `${text}\nlet x` : null),
    )
    expect(scip.tool).toBe("hand@1")
    expect(scip.at("src/a.ts", 0, 16)).toMatchObject([
      { symbol: "s a/café.", roles: 0, endCol: 20 },
    ])
    expect(scip.definitions.get("s a/café.")).toEqual([
      { path: "src/a.ts", line: 0, col: 6 },
    ])
    expect(scip.references("s a/café.")).toEqual([
      { path: "src/a.ts", line: 0, col: 16 },
    ])
    // Locals are numbered per document.
    expect(scip.definedAt("src/a.ts", 1, 0)).toEqual(["local 1 in src/a.ts"])
    expect(scip.definedAt("src/b.ts", 2, 4)).toEqual(["local 1 in src/b.ts"])
    expect(isLocalSymbol("local 1 in src/b.ts")).toBe(true)
    expect(isLocalSymbol("s a/render().(format)")).toBe(true)
    expect(isLocalSymbol("s a/render().")).toBe(false)
    expect([...(scip.related.get("s a/Saver#save().") ?? [])]).toEqual([
      "s a/Order#save().",
    ])
    expect(
      scip.related.get("s a/Order#`<constructor>`().")?.has("s a/Order#"),
    ).toBe(true)
  })
})

// ---- Scoring ------------------------------------------------------------------

const BASE: Record<string, string> = {
  "src/fmt.ts":
    "export function format(n: number): string {\n  return String(n)\n}\n",
  "src/card.ts":
    "export class Card {\n  charge(cents: number) {\n    return cents\n  }\n}\n",
  "src/order.ts": "export class Order {\n  save() {\n    return 1\n  }\n}\n",
  "src/user.ts":
    'import type { Repo } from "orm"\n\nexport function persist(u: Repo) {\n  return u.save()\n}\n',
  "src/render.ts": "export const unused = 1\n",
}

const HEAD: Record<string, string> = {
  ...BASE,
  "src/order.ts": "export class Order {\n  save() {\n    return 2\n  }\n}\n",
  "src/render.ts": [
    'import type { Stripe } from "stripe"',
    'import { format } from "./fmt"',
    "",
    "export function total(xs: number[]): number {",
    "  return xs.length",
    "}",
    "",
    "export function render(n: number, format: string): string {",
    "  const total = n * 2",
    "  return format + total",
    "}",
    "",
    "export function bill(client: Stripe) {",
    "  return client.charge(5)",
    "}",
    "",
    "export function shown(n: number) {",
    "  return format(n) + total([n])",
    "}",
    "",
  ].join("\n"),
}

/** The position of the nth whole-word `word` in a file's text. */
function where(
  files: Record<string, string>,
  path: string,
  word: string,
  nth = 0,
): [number, number, number] {
  const lines = (files[path] as string).split("\n")
  let seen = 0
  for (let i = 0; i < lines.length; i++) {
    const re = new RegExp(`\\b${word}\\b`, "g")
    for (const m of (lines[i] as string).matchAll(re)) {
      if (seen++ === nth) return [i, m.index, m.index + word.length]
    }
  }
  throw new Error(`no ${word} #${nth} in ${path}`)
}

const F = "s npm app 1 src/`fmt.ts`/format()."
const ORDER_SAVE = "s npm app 1 src/`order.ts`/Order#save()."
const CARD_CHARGE = "s npm app 1 src/`card.ts`/Card#charge()."
const TOTAL = "s npm app 1 src/`render.ts`/total()."
const FORMAT_PARAM = "s npm app 1 src/`render.ts`/render().(format)"

/** What a type checker would say about the uses the test cares about. */
function scipOf(files: Record<string, string>, head: boolean) {
  const at = (
    path: string,
    word: string,
    nth: number,
    symbol: string,
    roles = 0,
  ) => ({
    path,
    occ: { range: where(files, path, word, nth), symbol, roles, typed: true },
  })
  const all = [
    at("src/fmt.ts", "format", 0, F, 1),
    at("src/card.ts", "charge", 0, CARD_CHARGE, 1),
    at("src/order.ts", "save", 0, ORDER_SAVE, 1),
    // C: `u` is an external ORM object; its save() isn't Order.save.
    at("src/user.ts", "save", 0, "s npm orm 1 Repo#save()."),
    ...(head
      ? [
          at("src/render.ts", "format", 0, F),
          at("src/render.ts", "total", 0, TOTAL, 1),
          // A: a parameter and a local with the names of an import and a function.
          at("src/render.ts", "format", 1, FORMAT_PARAM, 1),
          at("src/render.ts", "total", 1, "local 1", 1),
          at("src/render.ts", "format", 2, FORMAT_PARAM),
          at("src/render.ts", "total", 2, "local 1"),
          // B: a method of an external SDK type.
          at("src/render.ts", "charge", 0, "s npm stripe 1 Stripe#charge()."),
          // Plain uses that resolve.
          at("src/render.ts", "format", 3, F),
          at("src/render.ts", "total", 3, TOTAL),
        ]
      : []),
  ]
  const docs = new Map<string, Occ[]>()
  for (const { path, occ } of all) {
    const list = docs.get(path) ?? []
    list.push(occ)
    docs.set(path, list)
  }
  return loadScip(
    encode([...docs].map(([path, occurrences]) => ({ path, occurrences }))),
  )
}

function commit(dir: string, files: Record<string, string>, message: string) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  execFileSync("git", ["add", "-A"], { cwd: dir })
  execFileSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", message],
    { cwd: dir },
  )
}

describe("scoring against SCIP", () => {
  let dir: string
  let repo: GitRepo
  let score: ChangeSetScore
  let sites: SiteScore[]
  let usedBy: UsedBySite[]

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "legible-scip-"))
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir })
    commit(dir, BASE, "base")
    commit(dir, HEAD, "head")
    repo = await GitRepo.open(dir)
    const base = (await repo.resolveCommit("HEAD~1")) as string
    const head = (await repo.resolveCommit("HEAD")) as string
    const parsing = new Parsing()
    const built = await buildChangeSet(
      repo,
      parsing,
      { reviewId: "r", iterationId: "i" },
      base,
      head,
      { ignoreWhitespace: false, prefetch: false },
    )
    const index = new CodeIndex({
      repo,
      parsing,
      baseSha: base,
      headSha: head,
      files: built.indexed,
    })
    await index.ready
    const symbolsAt = symbolPositions(repo, parsing)
    const r = await scoreChangeSet({
      index,
      files: built.indexed,
      scip: { base: await scipOf(BASE, false), head: await scipOf(HEAD, true) },
      symbolsIn: (side, path) => symbolsAt(side === "base" ? base : head, path),
    })
    score = r.score
    sites = r.sites
    usedBy = r.usedBy
  })

  afterAll(() => {
    repo.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const site = (word: string, nth: number) => {
    const [line, col] = where(HEAD, "src/render.ts", word, nth)
    return sites.find(
      (s) =>
        s.side === "head" &&
        s.path === "src/render.ts" &&
        s.line === line + 1 &&
        s.col === col,
    )
  }

  it("counts Connections on a parameter and a local as pattern A", () => {
    expect(site("format", 2)).toMatchObject({
      scip: "local",
      ours: "resolved",
      correct: false,
    })
    expect(site("total", 2)).toMatchObject({
      scip: "local",
      ours: "resolved",
      correct: false,
    })
    expect(score.localsConnected.resolved).toBe(2)
    expect(
      examples(
        sites.map((s) => ({ ...s, sha: "x" })),
        [],
      ).locals,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringMatching(
            /^src\/render\.ts:10 format .*→ resolved src\/fmt\.ts:1 format vs SCIP local/,
          ),
        }),
      ]),
    )
  })

  it("scores a method on an external type guessed by name as a false likely (B)", () => {
    expect(site("charge", 0)).toMatchObject({
      scip: "external",
      ours: "likely",
      target: "src/card.ts:2 Card.charge",
      correct: false,
    })
    expect(score.byStatus.likely).toEqual({ sites: 1, correct: 0 })
  })

  it("scores an unrelated `u.save()` in Used by as a false positive (C)", () => {
    expect(usedBy).toContainEqual(
      expect.objectContaining({
        path: "src/user.ts",
        symbol: "Order.save",
        status: "likely",
        correct: false,
        scip: "Repo#save().",
      }),
    )
    // On Base and on Head: Order.save is changed on both sides.
    expect(score.usedBy.precision.likely).toEqual({ sites: 2, correct: 0 })
  })

  it("scores plain imports and same-file calls as correct", () => {
    expect(site("format", 3)).toMatchObject({ ours: "resolved", correct: true })
    expect(site("total", 3)).toMatchObject({ ours: "resolved", correct: true })
    expect(site("format", 0)).toMatchObject({ ours: "resolved", correct: true })
    expect(score.byStatus.resolved).toEqual({ sites: 5, correct: 3 })
  })

  it("leaves uses SCIP says nothing about unscored", () => {
    expect(site("xs", 1)).toMatchObject({ scip: "unknown" })
    expect(score.unknown).toBeGreaterThan(0)
    expect(score.recallIndexed.sites).toBe(score.recallAll.sites)
  })
})
