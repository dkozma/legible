// The Fragment graph the Walkthrough planner orders Steps by (engineering
// plan §9.2): which Fragments change which Symbols, which Fragments use what
// others change (definitions read before uses), how far each change reaches,
// and which code each test verifies.

import type {
  CodeSymbol,
  FileChange,
  FragmentEdge,
  FragmentGraph,
  FragmentNode,
} from "@legible/domain"

import type { CodeIndex } from "./connections"

/** Test files across the Full-tier languages. */
const TEST_PATH =
  /(^|\/)(__tests__|tests?|spec|specs)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py|rs|exs?)$|(^|\/)test_[^/]+\.py$|(Test|Tests|Spec)\.(java|kt|scala|cs)$|_spec\.rb$|_test\.rb$/

export function isTestPath(path: string): boolean {
  return TEST_PATH.test(path)
}

/** The file a test is named after: `src/a.test.ts` → `a`, `test_refunds.py` → `refunds`. */
function testStem(path: string): string | null {
  const base = path.split("/").pop() ?? path
  const m =
    base.match(/^(.+?)\.(test|spec)\.[cm]?[jt]sx?$/) ??
    base.match(/^(.+?)_(test|spec)\.\w+$/) ??
    base.match(/^test_(.+)\.py$/) ??
    base.match(/^(.+?)(Test|Tests|Spec)\.\w+$/)
  return m?.[1]?.toLowerCase() ?? null
}

function stemOf(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.[^.]+$/, "").toLowerCase()
}

type Range = [number, number]

interface Located {
  fragmentId: string
  fileId: string
  path: string
  oldPath: string
  head: Range | null
  base: Range | null
}

const overlaps = (a: Range, b: Range) => a[0] <= b[1] && b[0] <= a[1]
const within = (line: number, r: Range | null) =>
  r !== null && r[0] <= line && line <= r[1]

/** A Fragment's lines on each side, 1-based inclusive. */
export function fragmentRanges(
  file: Pick<FileChange, "chunks">,
  chunkIndex: number,
): { base: Range | null; head: Range | null } {
  const c = file.chunks[chunkIndex]
  if (!c) return { base: null, head: null }
  return {
    base: c.baseEnd > c.baseStart ? [c.baseStart + 1, c.baseEnd] : null,
    head: c.headEnd > c.headStart ? [c.headStart + 1, c.headEnd] : null,
  }
}

/**
 * The innermost Symbols a range touches, plus containers whose declaration
 * line it touches: a change inside a method is about the method, not its class.
 */
function touched(symbols: CodeSymbol[], r: Range): CodeSymbol[] {
  const hits = symbols.filter(
    (s) => s.kind !== "module" && overlaps([s.startLine, s.endLine], r),
  )
  return hits
    .filter(
      (s) =>
        within(s.nameLine, r) ||
        !hits.some(
          (o) =>
            o !== s &&
            o.startLine >= s.startLine &&
            o.endLine <= s.endLine &&
            (o.startLine > s.startLine || o.endLine < s.endLine),
        ),
    )
    .toSorted((a, b) => a.endLine - a.startLine - (b.endLine - b.startLine))
}

const MAX_HOPS = 3
const MAX_REACH = 500

export function buildFragmentGraph(
  index: CodeIndex,
  files: FileChange[],
): FragmentGraph {
  const located: Located[] = []
  for (const f of files)
    for (const frag of f.fragments) {
      const r = fragmentRanges(f, frag.chunkIndex)
      located.push({
        fragmentId: frag.id,
        fileId: f.id,
        path: f.path,
        oldPath: f.oldPath ?? f.path,
        head: r.head,
        base: r.base,
      })
    }

  // Which Fragments change each Symbol, by canonical (Head) id.
  const definers = new Map<string, Set<string>>()
  const nodes = new Map<string, FragmentNode>()
  for (const l of located) {
    const symbols: CodeSymbol[] = []
    if (l.head)
      symbols.push(...touched(index.symbolsAt("head", l.path), l.head))
    // Removed code: what it removed on Base.
    if (l.base && !l.head)
      symbols.push(...touched(index.symbolsAt("base", l.oldPath), l.base))
    for (const s of symbols) {
      const key = index.canonicalId(s.id)
      const set = definers.get(key) ?? new Set()
      set.add(l.fragmentId)
      definers.set(key, set)
    }
    nodes.set(l.fragmentId, {
      fragmentId: l.fragmentId,
      fileId: l.fileId,
      path: l.path,
      symbols: symbols.map((s) => ({
        id: s.id,
        qualifiedName: s.qualifiedName,
        kind: s.kind,
        change: s.change,
      })),
      test: isTestPath(l.path),
      callers: 0,
      blastRadius: 0,
    })
  }

  // Uses: a Connection site inside a Fragment's Head lines that resolves to a Symbol another Fragment changes.
  // Only resolved Connections order the Walkthrough; likely ones are hints, possible ones nothing.
  const byPath = new Map<string, Located[]>()
  for (const l of located) {
    const list = byPath.get(l.path) ?? []
    list.push(l)
    byPath.set(l.path, list)
  }
  const edges = new Map<string, FragmentEdge>()
  for (const c of index.connectionsOn("head")) {
    if (!c.toId || c.status === "possible") continue
    const from = definers.get(index.canonicalId(c.toId))
    if (!from) continue
    const via = index.symbol(c.toId)?.qualifiedName ?? c.name
    const hard = c.status === "resolved"
    for (const site of c.sites) {
      for (const user of byPath.get(site.path) ?? []) {
        if (!within(site.line, user.head)) continue
        for (const def of from) {
          if (def === user.fragmentId) continue
          const key = `${def}\0${user.fragmentId}`
          const edge = edges.get(key)
          if (!edge)
            edges.set(key, { from: def, to: user.fragmentId, via, hard })
          else if (hard && !edge.hard) edges.set(key, { ...edge, via, hard })
        }
      }
    }
  }

  // Reach: who uses what a Fragment changes, directly and within a few hops. A user found only
  // through an Ambiguous Connection counts 1/n (n candidates), through a possible one not at all.
  for (const node of nodes.values()) {
    const own = new Set(node.symbols.map((s) => index.canonicalId(s.id)))
    const direct = new Map<string, number>()
    const seen = new Map<string, number>()
    let frontier = new Map([...own].map((id) => [id, 1]))
    for (let hop = 0; hop < MAX_HOPS && frontier.size; hop++) {
      const next = new Map<string, number>()
      for (const [id, weight] of frontier)
        for (const c of index.incomingOn("head", id)) {
          const share =
            c.status === "possible"
              ? 0
              : c.status === "ambiguous"
                ? 1 / Math.max(1, c.candidates.length)
                : 1
          const src = index.symbol(c.fromId)
          if (!src || share === 0) continue
          const key = index.canonicalId(src.id)
          const w = weight * share
          if (own.has(key) || (seen.get(key) ?? 0) >= w) continue
          const first = !seen.has(key)
          seen.set(key, w)
          if (hop === 0) direct.set(key, w)
          if (first && (src.kind !== "module" || hop === 0)) next.set(key, w)
        }
      frontier = next
      if (seen.size > MAX_REACH) break
    }
    const sum = (m: Map<string, number>) =>
      Math.round([...m.values()].reduce((a, b) => a + b, 0))
    node.callers = sum(direct)
    node.blastRadius = sum(seen)
  }

  // Tests verify what they use; failing that, the code they're named after.
  const tests: Record<string, string[]> = {}
  const nodeList = [...nodes.values()]
  for (const t of nodeList.filter((n) => n.test)) {
    const subjects = new Set<string>()
    for (const e of edges.values())
      if (e.to === t.fragmentId && !nodes.get(e.from)?.test)
        subjects.add(e.from)
    if (!subjects.size) {
      const stem = testStem(t.path)
      if (stem)
        for (const n of nodeList)
          if (!n.test && stemOf(n.path) === stem) subjects.add(n.fragmentId)
    }
    if (subjects.size) tests[t.fragmentId] = [...subjects]
  }

  return { nodes: nodeList, edges: [...edges.values()], tests }
}
