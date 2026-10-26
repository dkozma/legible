import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import type { CodeSymbol, Connection, SymbolConnections } from "@legible/domain"
import { GitRepo } from "@legible/git"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { buildChangeSet } from "../src/changeSet"
import { CodeIndex } from "../src/connections"
import { Parsing } from "../src/parse"

let dir: string
let repo: GitRepo
let index: CodeIndex
const parsing = new Parsing()

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "legible-connections-"))
  execFileSync("node", [
    resolve(__dirname, "../../../fixtures/make-refund-repo.mjs"),
    dir,
  ])
  // The fixture leaves its last edits uncommitted; commit them to have a Head.
  execFileSync("git", ["add", "-A"], { cwd: dir })
  execFileSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "wip"],
    { cwd: dir },
  )
  repo = await GitRepo.open(dir)
  const base = await repo.mergeBase("main", "HEAD")
  const head = (await repo.resolveCommit("HEAD")) as string
  const built = await buildChangeSet(
    repo,
    parsing,
    { reviewId: "r", iterationId: "i" },
    base,
    head,
    {
      ignoreWhitespace: false,
      prefetch: false,
    },
  )
  index = new CodeIndex({
    repo,
    parsing,
    baseSha: base,
    headSha: head,
    files: built.indexed,
  })
  await index.ready
})

afterAll(() => {
  repo.close()
  rmSync(dir, { recursive: true, force: true })
})

const find = (path: string, qualifiedName: string): CodeSymbol => {
  for (const fileId of new Set(
    index["entries"].map((e) => e.fileId).filter(Boolean),
  ) as Set<string>) {
    const s = index
      .fileSymbols(fileId)
      .head.find((x) => x.path === path && x.qualifiedName === qualifiedName)
    if (s) return s
  }
  throw new Error(`no ${qualifiedName} in ${path}`)
}

function describeConn(
  all: SymbolConnections,
  c: Connection,
  direction: "uses" | "usedBy",
) {
  const other = direction === "uses" ? c.toId : c.fromId
  const s = other ? all.symbols[other] : null
  const target = s
    ? s.qualifiedName
    : c.status === "ambiguous"
      ? `?${c.name}(${c.candidates.length})`
      : `!${c.name}${c.module ? `@${c.module}` : ""}`
  return `${c.change ? `${c.change === "added" ? "+" : "-"} ` : ""}${c.kind} ${target} ${c.status}`
}

describe("Connections on the refund fixture (TypeScript)", () => {
  it("indexes the Change Set", () => {
    expect(index.status).toMatchObject({ state: "ready", error: null })
    expect(index.status.symbols).toBeGreaterThan(20)
  })

  it("shows what refundOrder no longer calls, and what it calls now", () => {
    const s = find("src/refunds/RefundService.ts", "RefundService.refundOrder")
    const all = index.forSymbol(s.id)!
    const uses = all.uses.map((c) => describeConn(all, c, "uses"))
    expect(uses).toEqual(
      expect.arrayContaining([
        "- calls !auditLog@../audit/auditLog external",
        "+ calls RefundService.calculateRefundable resolved",
        "+ references RefundExceedsBalance resolved",
        "calls RefundPolicy.assertWithinWindow likely",
        "references Operator resolved",
      ]),
    )
    // Changes first.
    expect(all.uses[0]?.change).not.toBeNull()
    expect(all.usedBy.map((c) => describeConn(all, c, "usedBy"))).toContain(
      "calls postRefund likely",
    )
  })

  it("follows a renamed file: describe() still calls the same formatCents", () => {
    const s = find("src/refunds/RefundService.ts", "RefundService.describe")
    const all = index.forSymbol(s.id)!
    expect(all.uses.map((c) => describeConn(all, c, "uses"))).toContain(
      "calls formatCents resolved",
    )
  })

  it("finds the use under a position and its definition", () => {
    const s = find("src/refunds/RefundService.ts", "RefundService.refundOrder")
    const lines = index["byPath"].head.get(s.path)!.lines
    const line =
      lines.findIndex(
        (l, i) => i >= s.startLine && l.includes("this.calculateRefundable"),
      ) + 1
    const col = lines[line - 1]!.indexOf("calculateRefundable")
    const at = index.at("head", s.path, line, col + 3)
    expect(at.symbol?.qualifiedName).toBe("RefundService.refundOrder")
    expect(at.connection?.kind).toBe("calls")
    expect(at.targets.map((t) => t.qualifiedName)).toEqual([
      "RefundService.calculateRefundable",
    ])
  })

  it("previews a Symbol's code with highlighting", async () => {
    const s = find(
      "src/refunds/RefundService.ts",
      "RefundService.calculateRefundable",
    )
    const src = await index.source(s.id)
    expect(src?.lines[0]).toContain(
      "async calculateRefundable(orderId: string)",
    )
    expect(src?.tokens?.[0]?.length).toBeGreaterThan(0)
  })
})

describe("Connections in Go, with neighbors found by name", () => {
  let gdir: string
  let grepo: GitRepo
  let gindex: CodeIndex
  const sh = (...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@t", ...args],
      { cwd: gdir },
    )
  const write = (path: string, text: string) => {
    execFileSync("mkdir", ["-p", join(gdir, path, "..")])
    require("node:fs").writeFileSync(join(gdir, path), text)
  }

  beforeAll(async () => {
    gdir = mkdtempSync(join(tmpdir(), "legible-go-"))
    sh("init", "-q", "-b", "main")
    write("go.mod", "module github.com/acme/shop\n")
    write(
      "internal/audit/audit.go",
      "package audit\n\nfunc Log(event string) {}\n\nfunc Flush() {}\n",
    )
    write(
      "internal/refunds/refunds.go",
      'package refunds\n\nimport "github.com/acme/shop/internal/audit"\n\ntype Service struct{}\n\nfunc (s *Service) Refund(id string) error {\n\taudit.Log("refund")\n\treturn nil\n}\n',
    )
    write(
      "internal/refunds/helpers.go",
      "package refunds\n\nfunc window() int { return 30 }\n",
    )
    write(
      "cmd/api/main.go",
      'package main\n\nimport "github.com/acme/shop/internal/refunds"\n\nfunc main() {\n\ts := &refunds.Service{}\n\ts.Refund("1")\n}\n',
    )
    write(
      "internal/orders/store.go",
      "package orders\n\ntype Store struct{}\n\nfunc (s *Store) Save() {}\n",
    )
    write(
      "internal/carts/store.go",
      "package carts\n\ntype Store struct{}\n\nfunc (s *Store) Save() {}\n",
    )
    sh("add", "-A")
    sh("commit", "-qm", "base")
    write(
      "internal/refunds/refunds.go",
      'package refunds\n\nimport "github.com/acme/shop/internal/audit"\n\ntype Service struct{ store saver }\n\ntype saver interface{ Save() }\n\nfunc (s *Service) Refund(id string) error {\n\tif window() > 60 {\n\t\treturn nil\n\t}\n\ts.store.Save()\n\taudit.Flush()\n\treturn nil\n}\n',
    )
    sh("add", "-A")
    sh("commit", "-qm", "head")
    grepo = await GitRepo.open(gdir)
    const base = (await grepo.resolveCommit("HEAD~1")) as string
    const head = (await grepo.resolveCommit("HEAD")) as string
    const built = await buildChangeSet(
      grepo,
      parsing,
      { reviewId: "r", iterationId: "i" },
      base,
      head,
      {
        ignoreWhitespace: false,
        prefetch: false,
      },
    )
    gindex = new CodeIndex({
      repo: grepo,
      parsing,
      baseSha: base,
      headSha: head,
      files: built.indexed,
    })
    await gindex.ready
  })

  afterAll(() => {
    grepo.close()
    rmSync(gdir, { recursive: true, force: true })
  })

  it("resolves package imports and the same package, and keeps ambiguous calls ambiguous", () => {
    expect(gindex.status.state).toBe("ready")
    expect(gindex.status.scope.neighborFiles).toBeGreaterThanOrEqual(3)
    const refund = gindex
      .fileSymbols(
        gindex["entries"].find((e) => e.path === "internal/refunds/refunds.go")!
          .fileId!,
      )
      .head.find((s) => s.qualifiedName === "Service.Refund")!
    const all = gindex.forSymbol(refund.id)!
    const uses = all.uses.map((c) => describeConn(all, c, "uses"))
    expect(uses).toEqual(
      expect.arrayContaining([
        "- calls Log resolved",
        "+ calls Flush resolved",
        "+ calls window resolved",
        expect.stringMatching(/^\+ calls \?Save\(2\) ambiguous$/),
      ]),
    )
    const ambiguous = all.uses.find((c) => c.status === "ambiguous")!
    expect(
      ambiguous.candidates.map((id) => all.symbols[id]!.path).toSorted(),
    ).toEqual(["internal/carts/store.go", "internal/orders/store.go"])
    // Used by an unchanged file, found with git grep.
    expect(all.usedBy.map((c) => describeConn(all, c, "usedBy"))).toContain(
      "calls main likely",
    )
  })
})
