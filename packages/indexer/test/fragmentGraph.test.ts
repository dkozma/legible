import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import type { FileChange, FragmentGraph } from "@legible/domain"
import { GitRepo } from "@legible/git"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { buildChangeSet } from "../src/changeSet"
import { CodeIndex } from "../src/connections"
import { fragmentRanges, isTestPath } from "../src/fragmentGraph"
import { Parsing } from "../src/parse"

let dir: string
let repo: GitRepo
let files: FileChange[]
let graph: FragmentGraph

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "legible-fragment-graph-"))
  execFileSync("node", [
    resolve(__dirname, "../../../fixtures/make-refund-repo.mjs"),
    dir,
  ])
  execFileSync("git", ["add", "-A"], { cwd: dir })
  execFileSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "wip"],
    { cwd: dir },
  )
  repo = await GitRepo.open(dir)
  const base = await repo.mergeBase("main", "HEAD")
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
  files = built.summary.files
  const index = new CodeIndex({
    repo,
    parsing,
    baseSha: base,
    headSha: head,
    files: built.indexed,
  })
  await index.ready
  graph = index.fragmentGraph(files)
})

afterAll(() => {
  repo.close()
  rmSync(dir, { recursive: true, force: true })
})

const fragmentsOf = (path: string, qualifiedName?: string) =>
  graph.nodes
    .filter(
      (n) =>
        n.path === path &&
        (qualifiedName === undefined
          ? n.symbols.length === 0
          : n.symbols.some((s) => s.qualifiedName === qualifiedName)),
    )
    .map((n) => n.fragmentId)

const hasEdge = (from: string[], to: string[]) =>
  graph.edges.some((e) => from.includes(e.from) && to.includes(e.to))

describe("fragmentGraph", () => {
  it("has a node for every Fragment", () => {
    const all = files.flatMap((f) => f.fragments.map((x) => x.id))
    expect(graph.nodes.map((n) => n.fragmentId).toSorted()).toEqual(
      all.toSorted(),
    )
  })

  it("orders definitions before their uses", () => {
    const service = "src/refunds/RefundService.ts"
    expect(
      hasEdge(
        fragmentsOf(service, "RefundService.calculateRefundable"),
        fragmentsOf(service, "RefundService.refundOrder"),
      ),
    ).toBe(true)
    // The new repository comes before the service's import of it.
    expect(
      hasEdge(
        fragmentsOf("src/refunds/RefundRepository.ts", "RefundRepository"),
        fragmentsOf(service),
      ),
    ).toBe(true)
    // Across layers: the service's change before the API handler calling it. The handler
    // reaches RefundService only through `service.refunds`, so it's a hint, not a constraint.
    const handler = graph.edges.filter(
      (e) =>
        fragmentsOf(service, "RefundService.refundOrder").includes(e.from) &&
        fragmentsOf("src/api/refunds.ts", "postRefund").includes(e.to),
    )
    expect(handler.length).toBeGreaterThan(0)
    expect(handler.every((e) => !e.hard)).toBe(true)
    expect(
      graph.edges.find(
        (e) =>
          fragmentsOf(service, "RefundService.calculateRefundable").includes(
            e.from,
          ) && fragmentsOf(service, "RefundService.refundOrder").includes(e.to),
      )?.hard,
    ).toBe(true)
    expect(graph.edges.every((e) => e.from !== e.to)).toBe(true)
  })

  it("links tests to the code they verify", () => {
    const [test] = graph.nodes.filter((n) => n.test)
    expect(test?.path).toBe("src/refunds/RefundService.test.ts")
    const subjects = graph.tests[test?.fragmentId ?? ""] ?? []
    expect(subjects.length).toBeGreaterThan(0)
    expect(
      subjects.some((id) =>
        fragmentsOf(
          "src/refunds/RefundService.ts",
          "RefundService.refundOrder",
        ).includes(id),
      ),
    ).toBe(true)
  })

  it("measures how far a change reaches", () => {
    const [policy] = fragmentsOf(
      "src/refunds/RefundPolicy.ts",
      "REFUND_WINDOW_DAYS",
    )
    const node = graph.nodes.find((n) => n.fragmentId === policy)
    expect(node?.callers).toBeGreaterThan(0)
    expect(node?.blastRadius).toBeGreaterThanOrEqual(node?.callers ?? 0)
  })
})

describe("helpers", () => {
  it("recognizes test files across languages", () => {
    for (const p of [
      "src/a.test.ts",
      "src/__tests__/a.ts",
      "pkg/a_test.go",
      "tests/test_a.py",
      "src/main/java/ATest.java",
      "spec/a_spec.rb",
    ])
      expect.soft(isTestPath(p)).toBe(true)
    for (const p of ["src/a.ts", "src/latest.ts", "src/contest/a.go"])
      expect.soft(isTestPath(p)).toBe(false)
  })

  it("gives 1-based inclusive ranges, null for an empty side", () => {
    const file = {
      chunks: [
        { kind: "change", baseStart: 4, baseEnd: 4, headStart: 4, headEnd: 6 },
      ],
    } as Pick<FileChange, "chunks">
    expect(fragmentRanges(file, 0)).toEqual({ base: null, head: [5, 6] })
  })
})
