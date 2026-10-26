// The Walkthrough validator (engineering plan §9.2, steps 4–6). Whatever the
// model proposed, the result covers every Fragment exactly once, attaches
// tests to their subjects, orders Steps so no Step uses what a later one
// changes, packs Sittings, and keeps unchanged Steps stable across Iterations.

import { createHash } from "node:crypto"

import type {
  Chapter,
  Layer,
  Provider,
  Sitting,
  Step,
  StepFragment,
  Walkthrough,
  WalkthroughValidation,
} from "@legible/domain"

import {
  type PlannerFragment,
  readingWeight,
  toStepFragment,
} from "./fragments"
import { layerRank } from "./layers"
import type { PlannerOutput } from "./planner"

export const stepId = (fragmentIds: string[]) =>
  `s${createHash("sha1")
    .update([...fragmentIds].toSorted().join("\0"))
    .digest("hex")
    .slice(0, 15)}`

const chapterId = (name: string) =>
  `c${createHash("sha1").update(name.toLowerCase()).digest("hex").slice(0, 11)}`

/** A Step being assembled. Priority is the order to keep when dependencies allow. */
export interface Draft {
  name: string
  narrative: string
  layer: Layer
  feature: string
  fragments: StepFragment[]
  priority: number
  /** The Step this came from unchanged, keeping its id, Scope, Risk and edits. */
  kept: Step | null
  userEdited: boolean
}

type Edge = { from: string; to: string }

// ---- Ordering ------------------------------------------------------------------

/** Tarjan's strongly connected components over drafts 0..n-1. */
function components(n: number, out: Set<number>[]): number[][] {
  const index = new Array<number>(n).fill(-1)
  const low = new Array<number>(n).fill(0)
  const onStack = new Array<boolean>(n).fill(false)
  const stack: number[] = []
  const result: number[][] = []
  let next = 0
  const visit = (v: number) => {
    // Iterative, so a long dependency chain can't overflow the stack.
    const work: [number, number[]][] = [[v, [...(out[v] ?? [])]]]
    index[v] = low[v] = next++
    stack.push(v)
    onStack[v] = true
    while (work.length) {
      const top = work[work.length - 1] as [number, number[]]
      const [u, rest] = top
      const w = rest.shift()
      if (w !== undefined) {
        if (index[w] === -1) {
          index[w] = low[w] = next++
          stack.push(w)
          onStack[w] = true
          work.push([w, [...(out[w] ?? [])]])
        } else if (onStack[w]) {
          low[u] = Math.min(low[u] as number, index[w] as number)
        }
        continue
      }
      work.pop()
      const parent = work[work.length - 1]
      if (parent)
        low[parent[0]] = Math.min(low[parent[0]] as number, low[u] as number)
      if (low[u] === index[u]) {
        const comp: number[] = []
        let x: number
        do {
          x = stack.pop() as number
          onStack[x] = false
          comp.push(x)
        } while (x !== u)
        result.push(comp)
      }
    }
  }
  for (let v = 0; v < n; v++) if (index[v] === -1) visit(v)
  return result
}

/**
 * Stable topological order: dependencies first, otherwise lowest priority
 * first. Mutually dependent items (a cycle no order satisfies) stay together,
 * in priority order. Returns the order and the cycles found.
 */
export function stableTopo(
  priorities: number[],
  out: Set<number>[],
): { order: number[]; cycles: number[][] } {
  const n = priorities.length
  const comps = components(n, out)
  const compOf = new Array<number>(n)
  comps.forEach((c, i) => c.forEach((v) => (compOf[v] = i)))
  const compPriority = comps.map((c) =>
    Math.min(...c.map((v) => priorities[v] as number)),
  )
  const indeg = new Array<number>(comps.length).fill(0)
  const compOut = comps.map(() => new Set<number>())
  for (let v = 0; v < n; v++)
    for (const w of out[v] ?? []) {
      const a = compOf[v] as number
      const b = compOf[w] as number
      if (a !== b && !compOut[a]?.has(b)) {
        compOut[a]?.add(b)
        indeg[b] = (indeg[b] as number) + 1
      }
    }
  const ready = comps.map((_, i) => i).filter((i) => indeg[i] === 0)
  const order: number[] = []
  while (ready.length) {
    ready.sort(
      (a, b) => (compPriority[a] as number) - (compPriority[b] as number),
    )
    const c = ready.shift() as number
    order.push(
      ...(comps[c] as number[]).toSorted(
        (a, b) => (priorities[a] as number) - (priorities[b] as number),
      ),
    )
    for (const d of compOut[c] ?? []) {
      indeg[d] = (indeg[d] as number) - 1
      if (indeg[d] === 0) ready.push(d)
    }
  }
  return { order, cycles: comps.filter((c) => c.length > 1) }
}

function draftEdges(drafts: Draft[], edges: Edge[]): Set<number>[] {
  const owner = new Map<string, number>()
  drafts.forEach((d, i) =>
    d.fragments.forEach((f) => owner.set(f.fragmentId, i)),
  )
  const out = drafts.map(() => new Set<number>())
  for (const e of edges) {
    const a = owner.get(e.from)
    const b = owner.get(e.to)
    if (a !== undefined && b !== undefined && a !== b) out[a]?.add(b)
  }
  return out
}

/** Steps grouped by Chapter, Chapters in dependency order, Steps in dependency order within each. */
function orderDrafts(
  drafts: Draft[],
  edges: Edge[],
): { drafts: Draft[]; features: string[]; cycles: number } {
  const out = draftEdges(drafts, edges)
  // Chapters: one per feature, merged when they depend on each other both ways.
  const features = [...new Set(drafts.map((d) => featureKey(d.feature)))]
  const fIndex = new Map(features.map((f, i) => [f, i]))
  const fOut = features.map(() => new Set<number>())
  drafts.forEach((d, i) => {
    const a = fIndex.get(featureKey(d.feature)) as number
    for (const j of out[i] ?? []) {
      const b = fIndex.get(featureKey((drafts[j] as Draft).feature)) as number
      if (a !== b) fOut[a]?.add(b)
    }
  })
  const fPriority = features.map((f) =>
    Math.min(
      ...drafts
        .filter((d) => featureKey(d.feature) === f)
        .map((d) => d.priority),
    ),
  )
  const fTopo = stableTopo(fPriority, fOut)
  // A cycle between features means they aren't independent: one Chapter.
  const merged = new Map<number, number>()
  for (const cycle of fTopo.cycles) {
    const first = cycle.toSorted(
      (a, b) => (fPriority[a] as number) - (fPriority[b] as number),
    )[0] as number
    for (const c of cycle) merged.set(c, first)
  }
  const display = new Map<string, string>()
  for (const d of drafts)
    if (!display.has(featureKey(d.feature)))
      display.set(featureKey(d.feature), d.feature.trim())
  for (const d of drafts) {
    const f = fIndex.get(featureKey(d.feature)) as number
    const m = merged.get(f)
    if (m !== undefined && m !== f)
      d.feature = display.get(features[m] as string) ?? (features[m] as string)
  }
  const chapterOrder = fTopo.order.filter(
    (f) => !merged.has(f) || merged.get(f) === f,
  )

  const result: Draft[] = []
  let cycles = 0
  for (const f of chapterOrder) {
    const key = features[f] as string
    const members = drafts
      .map((d, i) => ({ d, i }))
      .filter(({ d }) => featureKey(d.feature) === key)
    const local = new Map(members.map(({ i }, k) => [i, k]))
    const localOut = members.map(({ i }) => {
      const s = new Set<number>()
      for (const j of out[i] ?? []) {
        const k = local.get(j)
        if (k !== undefined) s.add(k)
      }
      return s
    })
    const t = stableTopo(
      members.map(({ d }) => d.priority),
      localOut,
    )
    cycles += t.cycles.length
    result.push(...t.order.map((k) => (members[k] as { d: Draft }).d))
  }
  return {
    drafts: result,
    features: chapterOrder.map((f) => features[f] as string),
    cycles,
  }
}

const featureKey = (f: string) => f.trim().toLowerCase()

/** Pairs where a Step uses what a later Step changes, outside a cycle. */
export function dependencyViolations(steps: Step[], edges: Edge[]): number {
  const pos = new Map<string, number>()
  steps.forEach((s, i) => s.fragments.forEach((f) => pos.set(f.fragmentId, i)))
  const drafts: Draft[] = steps.map((s, i) => ({
    name: s.name,
    narrative: s.narrative,
    layer: s.layer,
    feature: "",
    fragments: s.fragments,
    priority: i,
    kept: null,
    userEdited: false,
  }))
  const out = draftEdges(drafts, edges)
  const { cycles } = stableTopo(
    drafts.map((d) => d.priority),
    out,
  )
  const cyclic = new Map<number, number>()
  cycles.forEach((c, k) => c.forEach((v) => cyclic.set(v, k)))
  let n = 0
  out.forEach((targets, a) => {
    for (const b of targets) {
      const sameCycle = cyclic.has(a) && cyclic.get(a) === cyclic.get(b)
      if (b < a && !sameCycle) n++
    }
  })
  return n
}

// ---- Sittings --------------------------------------------------------------------

/** Changed lines per Sitting (~45 minutes of focused reading). */
export const SITTING_TARGET = 350
const SITTING_MAX = 400
const SITTING_MIN = 150
/** Reading pace behind the minute estimates. */
const LINES_PER_MINUTE = 7.8

export const minutesFor = (lines: number) =>
  Math.max(2, Math.round(lines / LINES_PER_MINUTE))

export function stepWeight(s: Pick<Step, "fragments">): number {
  return s.fragments.reduce((n, f) => n + readingWeight(f), 0)
}

/** Greedy packing at Step boundaries; a new Chapter starts a new Sitting. */
export function packSittings(steps: Step[]): Sitting[] {
  const sittings: Sitting[] = []
  let current: Sitting | null = null
  for (const s of steps) {
    const w = stepWeight(s)
    const full =
      current &&
      (current.chapterId !== s.chapterId ||
        (current.lines + w > SITTING_MAX && current.lines >= SITTING_MIN) ||
        current.lines >= SITTING_TARGET)
    if (!current || full) {
      current = {
        index: sittings.length + 1,
        stepIds: [],
        lines: 0,
        minutes: 0,
        chapterId: s.chapterId,
      }
      sittings.push(current)
    }
    current.stepIds.push(s.id)
    current.lines += w
  }
  for (const st of sittings) {
    st.lines = Math.round(st.lines)
    st.minutes = minutesFor(st.lines)
  }
  return sittings
}

// ---- Assembly ----------------------------------------------------------------------

/**
 * Steps from the previous Iteration whose Fragments are all still here are
 * kept as they were; only the rest is planned again (§9.2, step 6).
 */
export function keepSteps(
  previous: Walkthrough | null,
  fragments: PlannerFragment[],
): { kept: Step[]; remaining: PlannerFragment[] } {
  if (!previous) return { kept: [], remaining: fragments }
  const byId = new Map(fragments.map((f) => [f.fragmentId, f]))
  const kept: Step[] = []
  const taken = new Set<string>()
  for (const s of previous.steps) {
    if (!s.fragments.every((f) => byId.has(f.fragmentId))) continue
    // Ranges can move when code above changed; take the current ones.
    kept.push({
      ...s,
      fragments: s.fragments.map((f) =>
        toStepFragment(byId.get(f.fragmentId) as PlannerFragment),
      ),
    })
    for (const f of s.fragments) taken.add(f.fragmentId)
  }
  return {
    kept,
    remaining: fragments.filter((f) => !taken.has(f.fragmentId)),
  }
}

export interface AssembleInput {
  reviewId: string
  iterationId: string
  fragments: PlannerFragment[]
  /** The planner's Steps (all clusters, in order), by alias. */
  planned: PlannerOutput["steps"]
  edges: Edge[]
  kept: Step[]
  /** Chapters of the previous Walkthrough, for kept Steps' feature names. */
  previousChapters: Chapter[]
  provider: Provider | null
  model: string | null
  promptVersion: string
  costUsd: number
}

export function assembleWalkthrough(input: AssembleInput): Walkthrough {
  const byAlias = new Map(input.fragments.map((f) => [f.alias, f]))
  const byId = new Map(input.fragments.map((f) => [f.fragmentId, f]))
  const assigned = new Set<string>()
  const chapterName = new Map(input.previousChapters.map((c) => [c.id, c.name]))
  let removedDuplicates = 0

  const kept: Draft[] = input.kept.map((s) => {
    for (const f of s.fragments) assigned.add(f.fragmentId)
    return {
      name: s.name,
      narrative: s.narrative,
      layer: s.layer,
      feature: (s.chapterId && chapterName.get(s.chapterId)) || "",
      fragments: s.fragments,
      priority: 0,
      kept: s,
      userEdited: s.userEdited,
    }
  })

  const planned: Draft[] = []
  for (const p of input.planned) {
    const fragments: StepFragment[] = []
    for (const alias of p.fragments) {
      const f = byAlias.get(alias.trim())
      if (!f) continue
      if (assigned.has(f.fragmentId)) {
        removedDuplicates++
        continue
      }
      assigned.add(f.fragmentId)
      fragments.push(toStepFragment(f))
    }
    if (!fragments.length) continue
    planned.push({
      name: p.name.trim() || "Changes",
      narrative: p.narrative.trim(),
      layer: p.layer,
      feature: p.feature,
      fragments,
      priority: 0,
      kept: null,
      userEdited: false,
    })
  }

  // Tests belong to the Step whose behavior they verify.
  const stepOf = (id: string) =>
    planned.find((d) => d.fragments.some((f) => f.fragmentId === id))
  for (const f of input.fragments) {
    if (!f.test || !f.testOf.length) continue
    const from = stepOf(f.fragmentId)
    if (!from) continue
    const counts = new Map<Draft, number>()
    for (const s of f.testOf) {
      const d = stepOf(s)
      if (d) counts.set(d, (counts.get(d) ?? 0) + 1)
    }
    const to = [...counts.entries()].toSorted((a, b) => b[1] - a[1])[0]?.[0]
    if (!to || to === from) continue
    from.fragments = from.fragments.filter((x) => x.fragmentId !== f.fragmentId)
    to.fragments.push(toStepFragment(f))
  }

  // Fragments the model left out.
  const missing = input.fragments.filter((f) => !assigned.has(f.fragmentId))
  const fallbackFeature = planned[0]?.feature ?? kept[0]?.feature ?? ""
  if (missing.length) {
    const layers = missing.map((f) => f.layerHint)
    const layer = layers.toSorted(
      (a, b) =>
        layers.filter((x) => x === b).length -
        layers.filter((x) => x === a).length,
    )[0] as Layer
    planned.push({
      name: "Other changes",
      narrative:
        "Changes the Walkthrough planner didn't group. Read them on their own.",
      layer,
      feature: fallbackFeature,
      fragments: missing.map(toStepFragment),
      priority: 0,
      kept: null,
      userEdited: false,
    })
  }

  // Priority: kept Steps in their old order; new ones in the planner's order, each
  // before the first kept Step of a later Layer.
  const sequence: Draft[] = [...kept]
  let floor = 0
  for (const d of planned.filter((x) => x.fragments.length)) {
    let at = sequence.length
    if (d.name !== "Other changes")
      for (let i = floor; i < sequence.length; i++) {
        const s = sequence[i] as Draft
        if (s.kept && layerRank(s.layer) > layerRank(d.layer)) {
          at = i
          break
        }
      }
    sequence.splice(at, 0, d)
    floor = at + 1
  }
  sequence.forEach((d, i) => (d.priority = i))
  // Kept Steps without a feature join the main one.
  for (const d of sequence) if (!d.feature.trim()) d.feature = fallbackFeature

  const w = finishWalkthrough(sequence, input.edges, {
    reviewId: input.reviewId,
    iterationId: input.iterationId,
    provider: input.provider,
    model: input.model,
    promptVersion: input.promptVersion,
    costUsd: input.costUsd,
  })
  w.validation.repairedMissing = missing.length
  w.validation.removedDuplicates = removedDuplicates
  w.validation.fragments = byId.size
  return w
}

/** Orders drafts, gives them ids and Chapters, and packs Sittings. Also used after the user edits Steps. */
export function finishWalkthrough(
  drafts: Draft[],
  edges: Edge[],
  meta: Pick<
    Walkthrough,
    | "reviewId"
    | "iterationId"
    | "provider"
    | "model"
    | "promptVersion"
    | "costUsd"
  >,
): Walkthrough {
  const live = drafts.filter((d) => d.fragments.length)
  const ordered = orderDrafts(live, edges)
  const named = ordered.features.filter((f) => f.length)
  const chapters: Chapter[] =
    named.length > 1
      ? named.map((key) => {
          const name =
            live.find((d) => featureKey(d.feature) === key)?.feature.trim() ??
            key
          return { id: chapterId(name), name, summary: "" }
        })
      : []
  const chapterFor = (d: Draft) =>
    chapters.length ? chapterId(d.feature.trim()) : null

  const owner = new Map<string, number>()
  ordered.drafts.forEach((d, i) =>
    d.fragments.forEach((f) => owner.set(f.fragmentId, i)),
  )
  const ids = ordered.drafts.map((d) => {
    const id = stepId(d.fragments.map((f) => f.fragmentId))
    return d.kept && d.kept.id === id ? d.kept.id : id
  })
  const steps: Step[] = ordered.drafts.map((d, i) => {
    const deps = new Set<string>()
    for (const e of edges) {
      const a = owner.get(e.from)
      if (owner.get(e.to) === i && a !== undefined && a !== i)
        deps.add(ids[a] as string)
    }
    return {
      id: ids[i] as string,
      name: d.name,
      narrative: d.narrative,
      layer: d.layer,
      scope: d.kept?.scope ?? null,
      scopeLikely: d.kept?.scopeLikely ?? false,
      requirementIds: d.kept?.requirementIds ?? [],
      risk: d.kept?.risk ?? { level: "low", reasons: [] },
      fragments: d.fragments,
      additions: d.fragments.reduce((n, f) => n + f.additions, 0),
      deletions: d.fragments.reduce((n, f) => n + f.deletions, 0),
      dependsOn: [...deps],
      chapterId: chapterFor(d),
      userEdited: d.userEdited,
    }
  })
  for (const c of chapters) {
    const members = steps.filter((s) => s.chapterId === c.id)
    c.summary = `${members.length} ${members.length === 1 ? "Step" : "Steps"}`
  }
  const validation: WalkthroughValidation = {
    fragments: steps.reduce((n, s) => n + s.fragments.length, 0),
    repairedMissing: 0,
    removedDuplicates: 0,
    dependencyViolations: dependencyViolations(steps, edges),
    cycles: ordered.cycles,
  }
  return {
    ...meta,
    steps,
    chapters,
    sittings: packSittings(steps),
    edges: edges.map((e) => ({ from: e.from, to: e.to })),
    validation,
    createdAt: new Date().toISOString(),
  }
}

/** Drafts back from a finished Walkthrough, for edits. */
export function toDrafts(w: Walkthrough): Draft[] {
  const name = new Map(w.chapters.map((c) => [c.id, c.name]))
  return w.steps.map((s, i) => ({
    name: s.name,
    narrative: s.narrative,
    layer: s.layer,
    feature: (s.chapterId && name.get(s.chapterId)) || "",
    fragments: s.fragments,
    priority: i,
    kept: s,
    userEdited: s.userEdited,
  }))
}
