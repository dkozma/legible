// Scoring a Walkthrough and Brief against a case's labels (engineering plan
// §14): coverage and dependency order, which the validator guarantees;
// grouping, Layers, Unrequested recall and Domain Changes, which depend on
// the model.

import type { DomainChange, StepFragment, Walkthrough } from "@legible/domain"

import type { CaseLabels } from "./cases"

/** Whether a label ("path", "path@12-20", "path@b4-9") points at a Fragment. */
export function matches(label: string, f: StepFragment): boolean {
  const m = label.match(/^(.*?)(?:@(b?)(\d+)(?:-(\d+))?)?$/)
  if (!m) return false
  const [, path, side, from, to] = m
  if (f.path !== path) return false
  if (!from) return true
  const lo = Number(from)
  const hi = Number(to ?? from)
  const r = side === "b" ? f.baseRange : f.headRange
  return r !== null && r[0] <= hi && lo <= r[1]
}

const pairs = <T>(xs: T[]) =>
  xs.flatMap((a, i) => xs.slice(i + 1).map((b) => [a, b] as const))

export interface Scores {
  fragments: number
  /** Share of Fragments in exactly one Step. Must be 1. */
  coverage: number
  dependencyViolations: number
  cycles: number
  steps: number
  /** Pairwise F1 of "these two Fragments share a Step", over labeled Fragments. Null without labels. */
  grouping: number | null
  layerAccuracy: number | null
  unrequestedRecall: number | null
  unrequestedPrecision: number | null
  domainChangeRecall: number | null
  domainChangePrecision: number | null
  chaptersRight: boolean
}

const STOP = new Set(
  "a an the is are was were be now no not of to in on for and or with by from up it its at as can do does than then this that their".split(
    " ",
  ),
)

function words(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w && !STOP.has(w))
      .map((w) => w.replace(/(ies|es|s)$/, "")),
  )
}

/** Content-word overlap: a cheap, deterministic stand-in for a judged match. */
export function similar(a: string, b: string): number {
  const x = words(a)
  const y = words(b)
  const shared = [...x].filter((w) => y.has(w)).length
  return shared / Math.max(1, Math.min(x.size, y.size))
}

export const SAME_CHANGE = 0.5

export function score(
  w: Walkthrough,
  domainChanges: DomainChange[],
  labels: CaseLabels,
  allFragmentIds: string[],
): Scores {
  const stepOf = new Map<string, number>()
  let duplicates = 0
  w.steps.forEach((s, i) =>
    s.fragments.forEach((f) => {
      if (stepOf.has(f.fragmentId)) duplicates++
      stepOf.set(f.fragmentId, i)
    }),
  )
  const covered = allFragmentIds.filter((id) => stepOf.has(id)).length
  const frags = w.steps.flatMap((s) => s.fragments)

  // Grouping: pairs of labeled Fragments.
  const group = new Map<string, number>()
  labels.steps.forEach((specs, g) => {
    for (const f of frags)
      if (specs.some((l) => matches(l, f))) group.set(f.fragmentId, g)
  })
  let tp = 0
  let fp = 0
  let fn = 0
  for (const [a, b] of pairs([...group.keys()])) {
    const truth = group.get(a) === group.get(b)
    const said = stepOf.get(a) === stepOf.get(b)
    if (truth && said) tp++
    else if (said) fp++
    else if (truth) fn++
  }
  const f1 = (p: number, r: number) => (p + r ? (2 * p * r) / (p + r) : 0)
  const grouping =
    group.size < 2
      ? null
      : tp + fp + fn === 0
        ? 1
        : f1(tp / Math.max(1, tp + fp), tp / Math.max(1, tp + fn))

  // Layers, per labeled path.
  let layerHits = 0
  let layerTotal = 0
  w.steps.forEach((s) =>
    s.fragments.forEach((f) => {
      const want = labels.layers[f.path]
      if (!want) return
      layerTotal++
      if (s.layer === want) layerHits++
    }),
  )

  // Unrequested.
  const truthU = new Set(
    frags
      .filter((f) => labels.unrequested.some((l) => matches(l, f)))
      .map((f) => f.fragmentId),
  )
  const saidU = new Set(
    w.steps
      .filter((s) => s.scope === "unrequested")
      .flatMap((s) => s.fragments.map((f) => f.fragmentId)),
  )
  const hitU = [...truthU].filter((id) => saidU.has(id)).length

  // Domain Changes.
  const labeled = labels.domainChanges
  const found = domainChanges.map((d) => d.statement)
  const recalled = labeled.filter((l) =>
    found.some((f) => similar(l, f) >= SAME_CHANGE),
  ).length
  const precise = found.filter((f) =>
    labeled.some((l) => similar(l, f) >= SAME_CHANGE),
  ).length

  return {
    fragments: allFragmentIds.length,
    coverage:
      allFragmentIds.length && !duplicates
        ? covered / allFragmentIds.length
        : duplicates
          ? 0
          : 1,
    dependencyViolations: w.validation.dependencyViolations,
    cycles: w.validation.cycles,
    steps: w.steps.length,
    grouping,
    layerAccuracy: layerTotal ? layerHits / layerTotal : null,
    unrequestedRecall: truthU.size ? hitU / truthU.size : null,
    unrequestedPrecision: saidU.size ? hitU / saidU.size : null,
    domainChangeRecall: labeled.length ? recalled / labeled.length : null,
    domainChangePrecision: found.length ? precise / found.length : null,
    chaptersRight:
      (labels.chapters > 1 ? labels.chapters : 0) === w.chapters.length,
  }
}
