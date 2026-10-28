// Deterministic prep for the Walkthrough planner (engineering plan §9.2):
// every Fragment with its lines, Symbols, Layer hint and test links, under a
// short alias the model can echo back cheaply.

import type {
  FileChange,
  FragmentGraph,
  Layer,
  StepFragment,
} from "@legible/domain"

import { layerHint } from "./layers"

export interface PlannerFragment extends StepFragment {
  /** "F1", "F2"… in Change Set order. */
  alias: string
  /** Changed Symbols it touches, e.g. "RefundService.refundOrder (modified)". */
  symbols: string[]
  layerHint: Layer
  /** Fragments this test verifies. */
  testOf: string[]
  /** Who uses what it changes. */
  callers: number
  blastRadius: number
}

/** Lines of diff the planner may see for one Fragment. */
export interface FragmentText {
  removed: string[]
  added: string[]
}

/**
 * A file the line diff shows no Fragments for (a pure rename, a binary file)
 * still belongs to a Step: it gets a Fragment standing for the whole file.
 */
export const fileFragmentId = (fileId: string) => `file:${fileId}`

function rangeOf(start: number, end: number): [number, number] | null {
  return end > start ? [start + 1, end] : null
}

export function plannerFragments(
  files: FileChange[],
  graph: FragmentGraph | null,
): PlannerFragment[] {
  const nodes = new Map(graph?.nodes.map((n) => [n.fragmentId, n]))
  const out: PlannerFragment[] = []
  for (const f of files) {
    const hint = layerHint(f.path)
    const collapsed = f.collapse !== null || f.binary
    const common = {
      fileId: f.id,
      path: f.path,
      layerHint: hint,
      collapsed,
      testOf: [] as string[],
    }
    if (f.fragments.length === 0) {
      out.push({
        ...common,
        alias: "",
        fragmentId: fileFragmentId(f.id),
        kind: f.status === "renamed" && !f.binary ? "structural" : "behavioral",
        baseRange: null,
        headRange: null,
        additions: f.additions,
        deletions: f.deletions,
        test: nodes.get(fileFragmentId(f.id))?.test ?? false,
        symbols: [],
        callers: 0,
        blastRadius: 0,
      })
      continue
    }
    for (const frag of f.fragments) {
      const c = f.chunks[frag.chunkIndex]
      const node = nodes.get(frag.id)
      out.push({
        ...common,
        alias: "",
        fragmentId: frag.id,
        kind: frag.kind,
        baseRange: c ? rangeOf(c.baseStart, c.baseEnd) : null,
        headRange: c ? rangeOf(c.headStart, c.headEnd) : null,
        additions: c ? c.headEnd - c.headStart : 0,
        deletions: c ? c.baseEnd - c.baseStart : 0,
        test: node?.test ?? false,
        symbols: (node?.symbols ?? []).map(
          (s) => `${s.qualifiedName} (${s.change})`,
        ),
        callers: node?.callers ?? 0,
        blastRadius: node?.blastRadius ?? 0,
      })
    }
  }
  out.forEach((p, i) => (p.alias = `F${i + 1}`))
  const byId = new Map(out.map((p) => [p.fragmentId, p]))
  for (const [test, subjects] of Object.entries(graph?.tests ?? {})) {
    const t = byId.get(test)
    if (t) t.testOf = subjects.filter((s) => byId.has(s))
  }
  return out
}

export function toStepFragment(p: PlannerFragment): StepFragment {
  return {
    fragmentId: p.fragmentId,
    fileId: p.fileId,
    path: p.path,
    kind: p.kind,
    baseRange: p.baseRange,
    headRange: p.headRange,
    additions: p.additions,
    deletions: p.deletions,
    test: p.test,
    collapsed: p.collapsed,
  }
}

/** The removed and added lines of a Fragment. */
export function fragmentText(
  p: Pick<PlannerFragment, "baseRange" | "headRange">,
  baseLines: string[],
  headLines: string[],
): FragmentText {
  return {
    removed: p.baseRange
      ? baseLines.slice(p.baseRange[0] - 1, p.baseRange[1])
      : [],
    added: p.headRange
      ? headLines.slice(p.headRange[0] - 1, p.headRange[1])
      : [],
  }
}

/** Changed lines, Structural and collapsed ones weighted low: the effort a Fragment takes to read. */
export function readingWeight(
  p: Pick<StepFragment, "kind" | "additions" | "deletions" | "collapsed">,
): number {
  const lines = p.additions + p.deletions
  if (p.collapsed) return Math.min(lines, 20) * 0.05
  return p.kind === "structural" ? lines * 0.1 : lines
}
