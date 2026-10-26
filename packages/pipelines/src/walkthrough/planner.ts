// LLM grouping for the Walkthrough (engineering plan §9.2, step 3): the mid
// tier groups Fragments into Steps and proposes an order. Everything it gets
// wrong about coverage or order, the validator (assemble.ts) repairs.

import { createHash } from "node:crypto"

import {
  type AgentTask,
  READ_TOOLS,
  type ToolContext,
  UNTRUSTED_RULE,
  untrusted,
} from "@legible/agent-runtime"
import { type FragmentEdge, type Intent, Layer } from "@legible/domain"
import { z } from "zod"

import type { FragmentText, PlannerFragment } from "./fragments"

export const WALKTHROUGH_PROMPT_VERSION = "walkthrough-v1"

export const PlannerOutput = z.object({
  steps: z
    .array(
      z.object({
        name: z
          .string()
          .describe(
            'A short imperative name for the concern, 2–6 words: "Track refunded balance"',
          ),
        narrative: z
          .string()
          .describe(
            "1–3 sentences: what this Step does and why, tied to the Intent when there is one.",
          ),
        layer: Layer,
        feature: z
          .string()
          .describe(
            "The independent feature this Step belongs to, in 1–4 words. Steps of one feature share the exact same name.",
          ),
        fragments: z
          .array(z.string())
          .describe('Aliases of the Fragments in this Step, e.g. ["F3", "F4"]'),
      }),
    )
    .describe("Steps in reading order"),
})
export type PlannerOutput = z.infer<typeof PlannerOutput>

export const WALKTHROUGH_SYSTEM = `You plan a Walkthrough: the order in which a developer reads a Change Set, usually written by an AI agent, to understand it.

Group the Change Set's Fragments (numbered change regions, F1, F2…) into Steps. Each Step is one logical concern, such as "Add the refund balance table" or "Validate partial amounts in the API", not one file. A Step can span files, and one file's Fragments can sit in different Steps.

Rules:
- Put every Fragment in exactly one Step. Don't leave any out and don't repeat one.
- Order Steps so each builds only on earlier ones: definitions before their uses. Fragment "uses" lines list known dependencies.
- When dependencies don't decide, order by layer: data_model, backend, api, client_data, presentation, chores.
- Put a test Fragment in the same Step as the code it tests (its "tests" line).
- Keep Steps small enough to read in a few minutes, roughly 10–150 changed lines. Group lockfiles, generated files and formatting-only changes into one chores Step.
- Name the independent feature each Step belongs to. Most Change Sets are one feature: give every Step the same feature name. Use different names only for unrelated changes that could have been separate pull requests.
- Narratives say what changes and why in the domain's own words, in 1–3 sentences. Tie them to the Intent when one is given. Don't restate the diff line by line.

You can call tools to read files at Base or Head when a Fragment is unclear, but the summary below is usually enough. Keep tool calls few.

${UNTRUSTED_RULE}`

/** Lines of diff per Fragment, shrinking as the Change Set grows so the prompt stays bounded. */
function linesPerFragment(count: number): number {
  return Math.max(3, Math.min(30, Math.floor(2400 / Math.max(1, count))))
}

function rangeLabel(p: PlannerFragment): string {
  const r = p.headRange ?? p.baseRange
  if (!r) return p.kind === "structural" ? "renamed" : "whole file"
  const side = p.headRange ? "" : " (removed)"
  return `${r[0]}–${r[1]}${side}`
}

export interface PlannerInput {
  fragments: PlannerFragment[]
  text: Map<string, FragmentText>
  edges: FragmentEdge[]
  intent: Pick<Intent, "goal" | "requirements"> | null
  /** Steps kept from the previous Iteration, for context only. */
  keptSteps: { name: string; layer: Layer }[]
}

export function renderFragments(input: PlannerInput): string {
  const byId = new Map(input.fragments.map((f) => [f.fragmentId, f]))
  const uses = new Map<string, Set<string>>()
  for (const e of input.edges) {
    const from = byId.get(e.from)
    if (!from || !byId.has(e.to)) continue
    const set = uses.get(e.to) ?? new Set()
    set.add(`${from.alias} (${e.via})`)
    uses.set(e.to, set)
  }
  const max = linesPerFragment(input.fragments.length)
  const out: string[] = []
  for (const f of input.fragments) {
    const head = [
      `${f.alias} ${f.path} ${rangeLabel(f)} +${f.additions} −${f.deletions}`,
      f.kind === "structural" ? "structural (behavior-preserving)" : null,
      f.collapsed ? "generated/lockfile" : null,
      f.test ? "test" : null,
      `layer hint: ${f.layerHint}`,
    ]
      .filter(Boolean)
      .join(" · ")
    out.push(head)
    if (f.symbols.length) out.push(`  changes: ${f.symbols.join(", ")}`)
    const u = uses.get(f.fragmentId)
    if (u?.size) out.push(`  uses: ${[...u].slice(0, 8).join(", ")}`)
    if (f.testOf.length)
      out.push(
        `  tests: ${f.testOf
          .map((id) => byId.get(id)?.alias)
          .filter(Boolean)
          .join(", ")}`,
      )
    const t = input.text.get(f.fragmentId)
    if (t && !f.collapsed) {
      const lines = [
        ...t.removed.map((l) => `- ${l}`),
        ...t.added.map((l) => `+ ${l}`),
      ]
      for (const l of lines.slice(0, max)) out.push(`  ${l.slice(0, 160)}`)
      if (lines.length > max) out.push(`  … ${lines.length - max} more lines`)
    }
  }
  return out.join("\n")
}

export function plannerPrompt(input: PlannerInput): string {
  const parts: string[] = []
  if (input.intent)
    parts.push(
      `Intent:\n${untrusted(
        "intent",
        `${input.intent.goal}\n${input.intent.requirements.map((r) => `${r.id}: ${r.statement}`).join("\n")}`,
      )}`,
    )
  else parts.push("No Intent is known for this Change Set.")
  if (input.keptSteps.length)
    parts.push(
      `These Steps already exist from an earlier Iteration and are not part of this request:\n${input.keptSteps.map((s) => `- ${s.name} (${s.layer})`).join("\n")}`,
    )
  parts.push(
    `Fragments (${input.fragments.length}):\n${untrusted("change set", renderFragments(input))}`,
  )
  parts.push("Group every Fragment into Steps, in reading order.")
  return parts.join("\n\n")
}

export function plannerTask(
  input: PlannerInput,
  context: ToolContext,
): AgentTask<PlannerOutput> {
  return {
    kind: "walkthrough",
    modelTier: "mid",
    system: WALKTHROUGH_SYSTEM,
    prompt: plannerPrompt(input),
    tools: READ_TOOLS,
    access: "read-only",
    output: PlannerOutput,
    context,
    maxTurns: 6,
    effort: "medium",
  }
}

/** Same Fragments, Intent and model: the same plan. */
export function plannerCacheKey(
  input: PlannerInput,
  provider: string,
  model: string,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        WALKTHROUGH_PROMPT_VERSION,
        provider,
        model,
        plannerPrompt(input),
      ]),
    )
    .digest("hex")
}

// ---- Large Change Sets -----------------------------------------------------------

/** Fragments one planning run takes; larger Change Sets are planned in clusters. */
export const CLUSTER_SIZE = 120

/**
 * Partitions Fragments into clusters of at most `size` (engineering plan §9.2,
 * step 2): connected components of the dependency graph, with tests joining
 * their subjects, and small components packed together by directory so each
 * run sees related code.
 */
export function clusterFragments(
  fragments: PlannerFragment[],
  edges: Pick<FragmentEdge, "from" | "to">[],
  size = CLUSTER_SIZE,
): PlannerFragment[][] {
  if (fragments.length <= size) return [fragments]
  const parent = new Map(fragments.map((f) => [f.fragmentId, f.fragmentId]))
  const find = (x: string): string => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r) as string
    parent.set(x, r)
    return r
  }
  const union = (a: string, b: string) => {
    if (!parent.has(a) || !parent.has(b)) return
    parent.set(find(a), find(b))
  }
  for (const e of edges) union(e.from, e.to)
  for (const f of fragments) for (const s of f.testOf) union(f.fragmentId, s)

  const groups = new Map<string, PlannerFragment[]>()
  for (const f of fragments) {
    const root = find(f.fragmentId)
    const g = groups.get(root) ?? []
    g.push(f)
    groups.set(root, g)
  }
  const dir = (g: PlannerFragment[]) =>
    (g[0]?.path ?? "").split("/").slice(0, -1).join("/")
  const sorted = [...groups.values()].toSorted(
    (a, b) => dir(a).localeCompare(dir(b)) || b.length - a.length,
  )
  const clusters: PlannerFragment[][] = []
  let current: PlannerFragment[] = []
  for (const g of sorted) {
    // A component bigger than a cluster is split in Change Set order.
    for (let i = 0; i < g.length; i += size) {
      const part = g.slice(i, i + size)
      if (current.length + part.length > size && current.length) {
        clusters.push(current)
        current = []
      }
      current.push(...part)
    }
  }
  if (current.length) clusters.push(current)
  return clusters
}
