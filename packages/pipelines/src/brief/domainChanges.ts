// Domain Changes (engineering plan §9.3): the business rules a Change Set
// changes, stated in the domain's own words and linked to the Fragments that
// implement them. Strong tier. The same run suggests how to test the change.
// Then, for a Pull Request, the fast tier words what its description misses.

import { createHash } from "node:crypto"

import {
  type AgentTask,
  READ_TOOLS,
  type ToolContext,
  UNTRUSTED_RULE,
  untrusted,
} from "@legible/agent-runtime"
import type { DomainChange, Intent, Step } from "@legible/domain"
import { z } from "zod"

import type { FragmentText, PlannerFragment } from "../walkthrough/fragments"

export const DOMAIN_CHANGES_PROMPT_VERSION = "domain-changes-v1"

export const DomainChangesOutput = z.object({
  domainChanges: z.array(
    z.object({
      statement: z
        .string()
        .describe(
          'The new rule in the domain\'s words: "Refunds are allowed up to 60 days after purchase".',
        ),
      before: z
        .string()
        .nullable()
        .describe('The old rule, briefly: "30 days". null for a new rule.'),
      after: z.string().describe('The new rule, briefly: "60 days".'),
      fragments: z
        .array(z.string())
        .describe('Aliases of the Fragments that implement it, e.g. ["F4"]'),
    }),
  ),
  howToTest: z
    .array(z.string())
    .describe(
      "2–5 concrete checks a reviewer can run by hand or as tests, one sentence each.",
    ),
})
export type DomainChangesOutput = z.infer<typeof DomainChangesOutput>

export const DOMAIN_CHANGES_SYSTEM = `You find the Domain Changes in a Change Set: changes in business or domain behavior that a product owner would care about, stated in the domain's own language.

A Domain Change is a rule: who can do what, when, how much, in what order. "Refunds are allowed up to 60 days after purchase (was 30)." "Shipping is refunded only with the final partial refund." "Refund audit entries no longer record the operator." Renames, refactors, new helpers, logging and types are not Domain Changes unless they change behavior someone outside the code would notice.

For each one give the new rule (statement), the old rule (before, null if there was none) and the new value (after) in a few words, and the Fragments that implement it. Include changes nobody asked for: those matter most. Don't invent changes the code doesn't make; when unsure, read the code with the tools.

Also suggest 2–5 concrete ways to test the change.

${UNTRUSTED_RULE}`

export interface DomainChangesInput {
  intent: Pick<Intent, "goal" | "requirements"> | null
  steps: Pick<Step, "name" | "fragments">[]
  fragments: PlannerFragment[]
  text: Map<string, FragmentText>
}

/** Behavioral Fragments' diffs, grouped by Step, bounded. */
function renderChanges(input: DomainChangesInput): string {
  const byId = new Map(input.fragments.map((f) => [f.fragmentId, f]))
  const behavioral = input.steps.flatMap((s) =>
    s.fragments.filter((f) => f.kind === "behavioral" && !f.collapsed),
  )
  const perFragment = Math.max(
    4,
    Math.min(60, Math.floor(4000 / Math.max(1, behavioral.length))),
  )
  const out: string[] = []
  input.steps.forEach((s, i) => {
    const frags = s.fragments.filter(
      (f) => f.kind === "behavioral" && !f.collapsed,
    )
    if (!frags.length) return
    out.push(`Step ${i + 1}: ${s.name}`)
    for (const f of frags) {
      const p = byId.get(f.fragmentId)
      const t = input.text.get(f.fragmentId)
      out.push(
        `${p?.alias ?? "?"} ${f.path}${f.test ? " (test)" : ""}${p?.symbols.length ? ` — ${p.symbols.join(", ")}` : ""}`,
      )
      const lines = [
        ...(t?.removed ?? []).map((l) => `- ${l}`),
        ...(t?.added ?? []).map((l) => `+ ${l}`),
      ]
      for (const l of lines.slice(0, perFragment))
        out.push(`  ${l.slice(0, 200)}`)
      if (lines.length > perFragment)
        out.push(`  … ${lines.length - perFragment} more lines`)
    }
  })
  return out.join("\n")
}

export function domainChangesPrompt(input: DomainChangesInput): string {
  return [
    input.intent
      ? `Intent:\n${untrusted("intent", `${input.intent.goal}\n${input.intent.requirements.map((r) => `${r.id}: ${r.statement}`).join("\n")}`)}`
      : "No Intent is known.",
    `Behavioral changes by Step:\n${untrusted("change set", renderChanges(input))}`,
    "List the Domain Changes, then how to test them.",
  ].join("\n\n")
}

export function domainChangesTask(
  input: DomainChangesInput,
  context: ToolContext,
): AgentTask<DomainChangesOutput> {
  return {
    kind: "domain_changes",
    modelTier: "strong",
    system: DOMAIN_CHANGES_SYSTEM,
    prompt: domainChangesPrompt(input),
    tools: READ_TOOLS,
    access: "read-only",
    output: DomainChangesOutput,
    context,
    maxTurns: 8,
    effort: "medium",
  }
}

export function domainChangesCacheKey(
  input: DomainChangesInput,
  provider: string,
  model: string,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        DOMAIN_CHANGES_PROMPT_VERSION,
        provider,
        model,
        domainChangesPrompt(input),
      ]),
    )
    .digest("hex")
}

/** Links each Domain Change to its Fragments and Steps; drops ones that cite nothing real. */
export function toDomainChanges(
  out: DomainChangesOutput,
  fragments: PlannerFragment[],
  steps: Pick<Step, "id" | "fragments">[],
  hasDescription: boolean,
): DomainChange[] {
  const byAlias = new Map(fragments.map((f) => [f.alias, f.fragmentId]))
  const stepOf = new Map<string, string>()
  for (const s of steps)
    for (const f of s.fragments) stepOf.set(f.fragmentId, s.id)
  return out.domainChanges
    .filter((d) => d.statement.trim())
    .slice(0, 12)
    .map((d, i) => {
      const fragmentIds = [
        ...new Set(
          d.fragments
            .map((a) => byAlias.get(a.trim()))
            .filter((x): x is string => Boolean(x)),
        ),
      ]
      return {
        id: `d${i + 1}`,
        statement: d.statement.trim(),
        before: d.before?.trim() || null,
        after: d.after.trim(),
        fragmentIds,
        stepIds: [
          ...new Set(
            fragmentIds
              .map((f) => stepOf.get(f))
              .filter((x): x is string => Boolean(x)),
          ),
        ],
        inDescription: hasDescription ? true : null,
        inDescriptionLikely: false,
      }
    })
}

// ---- Description Gap wording --------------------------------------------------

export const GAP_PROMPT_VERSION = "description-gap-v1"

export const GapOutput = z.object({
  suggestion: z
    .string()
    .describe(
      "Markdown the author can paste into the description: a short lead-in and one bullet per missing change.",
    ),
})

export const GAP_SYSTEM = `You write a short addition to a pull request description so it mentions the business-rule changes it leaves out. Match the description's tone. One bullet per change, in plain domain language, with the old and new behavior. No preamble, no headings unless the description uses them.

${UNTRUSTED_RULE}`

export function gapTask(
  description: { title: string; body: string },
  missing: Pick<DomainChange, "statement" | "before" | "after">[],
  context: ToolContext,
): AgentTask<z.infer<typeof GapOutput>> {
  return {
    kind: "wording",
    modelTier: "fast",
    system: GAP_SYSTEM,
    prompt: [
      untrusted(
        "pull request",
        `${description.title}\n\n${description.body.slice(0, 6000)}`,
      ),
      `Changes the description doesn't mention:\n${missing
        .map(
          (m) =>
            `- ${m.statement}${m.before ? ` (was: ${m.before}; now: ${m.after})` : ""}`,
        )
        .join("\n")}`,
    ].join("\n\n"),
    tools: [],
    access: "read-only",
    output: GapOutput,
    context,
    maxTurns: 2,
    effort: "low",
  }
}
