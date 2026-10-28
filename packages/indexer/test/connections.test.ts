import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

import type {
  CodeSymbol,
  Connection,
  FileChange,
  SymbolConnections,
} from "@legible/domain"
import { GitRepo } from "@legible/git"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { buildChangeSet } from "../src/changeSet"
import { CodeIndex, normalizeCodeSpan } from "../src/connections"
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
    // Found by name; the files reach RefundService through their imports (postRefund via src/services.ts).
    expect(all.usedBy.map((c) => describeConn(all, c, "usedBy"))).toEqual([
      "+ calls src/refunds/RefundService.test.ts likely",
      "calls postRefund likely",
    ])
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

describe("code spans in Explanations", () => {
  it("normalizes names and leaves prose alone", () => {
    expect(normalizeCodeSpan("calculateRefundable()")).toBe(
      "calculateRefundable",
    )
    expect(normalizeCodeSpan("new RefundExceedsBalance(a, b)")).toBe(
      "RefundExceedsBalance",
    )
    expect(normalizeCodeSpan("this.policy")).toBe("policy")
    expect(normalizeCodeSpan("println!")).toBe("println")
    expect(normalizeCodeSpan("crate::audit::log")).toBe("crate.audit.log")
    expect(normalizeCodeSpan("./src/refunds/RefundPolicy.ts")).toBe(
      "src/refunds/RefundPolicy.ts",
    )
    expect(normalizeCodeSpan("requested > balance")).toBeNull()
    expect(normalizeCodeSpan("'refund.issued'")).toBeNull()
  })

  it("resolves names to Symbols, and nothing else", () => {
    const refundOrder = find(
      "src/refunds/RefundService.ts",
      "RefundService.refundOrder",
    )
    const found = index.lookup(
      [
        "calculateRefundable()",
        "RefundService.refundOrder",
        "this.refunds.record",
        "refund.issued",
        "src/refunds/RefundPolicy.ts",
        "amountCents",
      ],
      { path: refundOrder.path, symbolIds: [refundOrder.id] },
    )
    const names = (k: string) => found[k]!.map((s) => s.qualifiedName)
    expect(names("calculateRefundable()")).toEqual([
      "RefundService.calculateRefundable",
    ])
    expect(found["calculateRefundable()"]![0]!.side).toBe("head")
    expect(names("RefundService.refundOrder")).toEqual([
      "RefundService.refundOrder",
    ])
    expect(names("this.refunds.record")).toEqual([])
    expect(names("refund.issued")).toEqual([])
    expect(found["src/refunds/RefundPolicy.ts"]!.map((s) => s.kind)).toEqual([
      "module",
    ])
    expect(names("amountCents")).toEqual([])
  })

  it("ranks the explained file first when names repeat", () => {
    // `Operator` is defined in RefundService.ts; formatCents in refund-math.ts.
    const policy = find("src/refunds/RefundPolicy.ts", "RefundPolicy")
    const hits = index.lookup(["formatCents"], {
      path: "src/refunds/refund-math.ts",
      symbolIds: [policy.id],
    })
    expect(hits.formatCents![0]!.path).toBe("src/refunds/refund-math.ts")
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
    mkdirSync(dirname(join(gdir, path)), { recursive: true })
    writeFileSync(join(gdir, path), text)
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
    // Used by an unchanged file, found with git grep: `s := &refunds.Service{}` says which Refund.
    expect(all.usedBy.map((c) => describeConn(all, c, "usedBy"))).toContain(
      "calls main resolved",
    )
  })
})

describe("resolution doesn't guess", () => {
  let tdir: string
  let trepo: GitRepo
  let tindex: CodeIndex

  beforeAll(async () => {
    tdir = mkdtempSync(join(tmpdir(), "legible-ts-"))
    const write = (path: string, text: string) => {
      mkdirSync(dirname(join(tdir, path)), { recursive: true })
      writeFileSync(join(tdir, path), text)
    }
    const sh = (...args: string[]) =>
      execFileSync(
        "git",
        ["-c", "user.name=t", "-c", "user.email=t@t", ...args],
        { cwd: tdir },
      )
    sh("init", "-q", "-b", "main")
    write(
      "src/secrets.ts",
      "export class SecretStore {\n  get(name: string) {\n    return name\n  }\n}\n",
    )
    write(
      "src/cache.ts",
      "export class Cache {\n  private items = new Map<string, number>()\n  refresh() {}\n  lookup(key: string) {\n    return this.items.get(key)\n  }\n}\n",
    )
    sh("add", "-A")
    sh("commit", "-qm", "base")
    write(
      "src/cache.ts",
      "export class Cache {\n  private items = new Map<string, number>()\n  refresh() {}\n  lookup(key: string) {\n    const refresh = this.items.get(key)\n    return refresh\n  }\n}\n",
    )
    sh("add", "-A")
    sh("commit", "-qm", "head")
    trepo = await GitRepo.open(tdir)
    const base = (await trepo.resolveCommit("HEAD~1")) as string
    const head = (await trepo.resolveCommit("HEAD")) as string
    const built = await buildChangeSet(
      trepo,
      parsing,
      { reviewId: "r", iterationId: "i" },
      base,
      head,
      {
        ignoreWhitespace: false,
        prefetch: false,
      },
    )
    tindex = new CodeIndex({
      repo: trepo,
      parsing,
      baseSha: base,
      headSha: head,
      files: built.indexed,
    })
    await tindex.ready
  })

  afterAll(() => {
    trepo.close()
    rmSync(tdir, { recursive: true, force: true })
  })

  it("leaves built-in methods on unknown receivers external, and locals aren't members", () => {
    const e = tindex["entries"].find(
      (x) => x.path === "src/cache.ts" && x.side === "head",
    )!
    const lookup = e.symbols.find((s) => s.qualifiedName === "Cache.lookup")!
    const all = tindex.forSymbol(lookup.id)!
    const uses = all.uses.map((c) => describeConn(all, c, "uses"))
    // Map#get, not the only `get` in the repository.
    expect(uses).toContain("calls !get external")
    // The local `refresh` is neither a use of the method Cache.refresh nor a binding.
    expect(uses.some((u) => u.includes("Cache.refresh"))).toBe(false)
  })
})

/** A CodeIndex for one commit on top of another, in a fresh repository. */
async function indexChange(
  base: Record<string, string>,
  head: Record<string, string>,
): Promise<{ index: CodeIndex; files: FileChange[]; done: () => void }> {
  const d = mkdtempSync(join(tmpdir(), "legible-resolve-"))
  const sh = (...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@t", ...args],
      { cwd: d },
    )
  const write = (files: Record<string, string>) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(d, path)), { recursive: true })
      writeFileSync(join(d, path), text)
    }
  }
  sh("init", "-q", "-b", "main")
  write(base)
  sh("add", "-A")
  sh("commit", "-qm", "base")
  write(head)
  sh("add", "-A")
  sh("commit", "-qm", "head")
  const r = await GitRepo.open(d)
  const baseSha = (await r.resolveCommit("HEAD~1")) as string
  const headSha = (await r.resolveCommit("HEAD")) as string
  const built = await buildChangeSet(
    r,
    parsing,
    { reviewId: "r", iterationId: "i" },
    baseSha,
    headSha,
    { ignoreWhitespace: false, prefetch: false },
  )
  const ix = new CodeIndex({
    repo: r,
    parsing,
    baseSha,
    headSha,
    files: built.indexed,
  })
  await ix.ready
  return {
    index: ix,
    files: built.summary.files,
    done: () => {
      r.close()
      rmSync(d, { recursive: true, force: true })
    },
  }
}

function connectionsOf(ix: CodeIndex, path: string, qualifiedName: string) {
  const s = ix["entries"]
    .find((e) => e.path === path && e.side === "head")
    ?.symbols.find((x) => x.qualifiedName === qualifiedName)
  if (!s) throw new Error(`no ${qualifiedName} in ${path}`)
  const all = ix.forSymbol(s.id)!
  return {
    uses: all.uses.map((c) => describeConn(all, c, "uses")),
    usedBy: all.usedBy.map((c) => describeConn(all, c, "usedBy")),
  }
}

describe("false positives the resolver doesn't make", () => {
  it("A: a parameter or local named like a function or import is the local", async () => {
    const { index: ix, done } = await indexChange(
      {
        "src/fmt.ts":
          "export function format(n: number) {\n  return String(n)\n}\n",
        "src/render.ts":
          'import { format } from "./fmt"\n\nexport function total() {\n  return 1\n}\n',
        "app/fmt.py": "def format(n):\n    return str(n)\n",
        "app/render.py":
          "from app.fmt import format\n\n\ndef total():\n    return 1\n",
      },
      {
        "src/render.ts":
          'import { format } from "./fmt"\n\nexport function total() {\n  return 1\n}\n\nexport function render(n: number, format: string) {\n  const total = n * 2\n  return format + total\n}\n\nexport function show(n: number) {\n  return format(n) + total()\n}\n',
        "app/render.py":
          "from app.fmt import format\n\n\ndef total():\n    return 1\n\n\ndef render(n, format):\n    total = n * 2\n    return format + str(total)\n\n\ndef show(n):\n    return format(n) + str(total())\n",
      },
    )
    try {
      for (const path of ["src/render.ts", "app/render.py"]) {
        const uses = connectionsOf(ix, path, "render").uses
        expect(uses.filter((u) => /format|total/.test(u))).toEqual([])
        // Kept: the same names, not shadowed, still resolve.
        expect(connectionsOf(ix, path, "show").uses).toEqual(
          expect.arrayContaining([
            "+ calls format resolved",
            "+ calls total resolved",
          ]),
        )
      }
    } finally {
      done()
    }
  })

  it("B: a method call on a library type, or a value of unknown type, isn't likely", async () => {
    const card =
      "export class Card {\n  charge(cents: number) {\n    return cents\n  }\n}\n"
    const { index: ix, done } = await indexChange(
      {
        "src/billing/card.ts": card,
        "src/checkout.ts": 'import Stripe from "stripe"\n',
        "src/wallet.ts": 'import { Card } from "./billing/card"\n',
      },
      {
        "src/checkout.ts":
          'import Stripe from "stripe"\n\nexport function pay(client: Stripe) {\n  client.charge(5)\n}\n\nexport function payAny(client: any) {\n  client.charge(5)\n}\n',
        "src/wallet.ts":
          'import { Card } from "./billing/card"\n\nexport function topUp(card: Card) {\n  card.charge(5)\n}\n\nexport function topUpAny(card: any) {\n  card.charge(5)\n}\n',
      },
    )
    try {
      expect(connectionsOf(ix, "src/checkout.ts", "pay").uses).toContain(
        "+ calls !charge@stripe external",
      )
      // Card.charge is the only `charge`, but nothing in checkout.ts leads to it.
      expect(connectionsOf(ix, "src/checkout.ts", "payAny").uses).toEqual([
        "+ calls Card.charge possible",
      ])
      // Kept: the declared type resolves it; an import makes it likely.
      expect(connectionsOf(ix, "src/wallet.ts", "topUp").uses).toContain(
        "+ calls Card.charge resolved",
      )
      expect(connectionsOf(ix, "src/wallet.ts", "topUpAny").uses).toContain(
        "+ calls Card.charge likely",
      )
    } finally {
      done()
    }
  })

  it("C: an unrelated `u.save()` is at most a possible user of a changed Order.save", async () => {
    const {
      index: ix,
      files,
      done,
    } = await indexChange(
      {
        "src/order.ts":
          "export class Order {\n  save() {\n    return 1\n  }\n}\n",
        "src/user.ts":
          "export function persist(u: any) {\n  return u.saveAll() + u.save()\n}\n",
        "src/checkout.ts":
          'import { Order } from "./order"\n\nexport function done(o: any) {\n  return o.save()\n}\n',
      },
      {
        "src/order.ts":
          "export class Order {\n  save() {\n    return 2\n  }\n}\n",
      },
    )
    try {
      expect(connectionsOf(ix, "src/order.ts", "Order.save").usedBy).toEqual([
        "calls done likely",
        "calls persist possible",
      ])
      // Possible users don't count toward reach.
      expect(ix.fragmentGraph(files).nodes[0]?.callers).toBe(1)
    } finally {
      done()
    }
  })

  it("counts an ambiguous user 1/n toward each candidate's reach", async () => {
    const order = (n: number) =>
      `export class Order {\n  save() {\n    return ${n}\n  }\n}\n`
    const cart = (n: number) =>
      `export class Cart {\n  save() {\n    return ${n}\n  }\n}\n`
    const {
      index: ix,
      files,
      done,
    } = await indexChange(
      {
        "src/order.ts": order(1),
        "src/cart.ts": cart(1),
        "src/a.ts":
          'import "./order"\nimport "./cart"\n\nexport function a(x: any) {\n  return x.save()\n}\n',
        "src/b.ts":
          'import "./order"\nimport "./cart"\n\nexport function b(x: any) {\n  return x.save()\n}\n',
      },
      { "src/order.ts": order(2), "src/cart.ts": cart(2) },
    )
    try {
      expect(connectionsOf(ix, "src/order.ts", "Order.save").usedBy).toEqual([
        "calls a ambiguous",
        "calls b ambiguous",
      ])
      // Two users, each one of two candidates: one caller each, not two.
      for (const n of ix.fragmentGraph(files).nodes) expect(n.callers).toBe(1)
    } finally {
      done()
    }
  })

  it("keeps true links through re-exports, namespace imports and self", async () => {
    const { index: ix, done } = await indexChange(
      {
        "src/billing/card.ts":
          "export function charge(cents: number) {\n  return cents\n}\n",
        "src/billing/index.ts": 'export { charge } from "./card"\n',
        "src/pay.ts":
          'import { charge } from "./billing"\nimport * as card from "./billing/card"\n',
        "app/cart.py": "class Cart:\n    def total(self):\n        return 1\n",
      },
      {
        "src/pay.ts":
          'import { charge } from "./billing"\nimport * as card from "./billing/card"\n\nexport function pay() {\n  return charge(1) + card.charge(2)\n}\n',
        "app/cart.py":
          "class Cart:\n    def total(self):\n        return 1\n\n    def checkout(self):\n        return self.total()\n",
      },
    )
    try {
      expect(connectionsOf(ix, "src/pay.ts", "pay").uses).toEqual([
        "+ calls charge resolved",
        "+ references src/billing/card.ts resolved",
      ])
      expect(connectionsOf(ix, "app/cart.py", "Cart.checkout").uses).toEqual([
        "+ calls Cart.total resolved",
      ])
    } finally {
      done()
    }
  })

  it("D: Go imports are local only under the go.mod module", async () => {
    const { index: ix, done } = await indexChange(
      {
        "go.mod": "module example.com/app\n\ngo 1.22\n",
        "config/config.go": "package config\n\nfunc Load() int { return 1 }\n",
        "cmd/a/main.go": "package main\n\nfunc main() {}\n",
        "cmd/b/main.go": "package main\n\nfunc main() {}\n",
      },
      {
        "cmd/a/main.go":
          'package main\n\nimport "github.com/other/lib/config"\n\nfunc main() {\n\tconfig.Load()\n}\n',
        "cmd/b/main.go":
          'package main\n\nimport "example.com/app/config"\n\nfunc main() {\n\tconfig.Load()\n}\n',
      },
    )
    try {
      expect(connectionsOf(ix, "cmd/a/main.go", "main").uses).toContain(
        "+ calls !Load@github.com/other/lib/config external",
      )
      expect(connectionsOf(ix, "cmd/b/main.go", "main").uses).toContain(
        "+ calls Load resolved",
      )
    } finally {
      done()
    }
  })
})
