// Intent (engineering plan §9.1): what a Change Set was supposed to
// accomplish, as a goal and numbered business requirements, from the Pull
// Request, its linked issues, the Agent Transcript and the user's own words.
// With none of those, an Inferred Intent from the code, flagged for the user
// to correct. Mid tier.

import { createHash } from "node:crypto"

import {
  type AgentTask,
  READ_TOOLS,
  type ToolContext,
  UNTRUSTED_RULE,
  untrusted,
} from "@legible/agent-runtime"
import type { Requirement } from "@legible/domain"
import { z } from "zod"

export const INTENT_PROMPT_VERSION = "intent-v1"

export const IntentOutput = z.object({
  goal: z
    .string()
    .describe(
      "What the Change Set is for, in 1–2 sentences of domain language.",
    ),
  requirements: z
    .array(
      z.object({
        id: z.string().describe('"R1", "R2"… in order'),
        statement: z
          .string()
          .describe(
            'One atomic business requirement in the domain\'s own words: "Refunds are allowed up to 60 days after purchase".',
          ),
      }),
    )
    .describe("1–8 requirements"),
})
export type IntentOutput = z.infer<typeof IntentOutput>

export const INTENT_SYSTEM = `You extract the Intent of a Change Set: what it was supposed to accomplish, before anyone looks at what the code actually does. A reviewer will compare the code against it to find changes nobody asked for.

Return:
- goal: 1–2 sentences on what the change is for, in the domain's language (orders, refunds, invoices), not the code's.
- requirements: the individual business requirements, numbered R1, R2…, each one atomic and checkable. Include constraints the user stated ("don't change the public API"). Leave out implementation details nobody asked for.

Sources, from strongest to weakest: the user's own words, corrections the user gave the agent (the latest one wins), the agent's accepted plan, the pull request description, linked issues. When they disagree, follow the stronger source.

When there are no sources, you are inferring the Intent from the code itself. Read the Change Set with the tools, then describe what the change appears to be for. Write requirements as what the code does, so the user can correct them.

${UNTRUSTED_RULE}`

export interface IntentInput {
  pullRequest: { title: string; body: string; url: string | null } | null
  issues: { title: string; body: string; url: string }[]
  transcripts: {
    label: string
    prompts: string[]
    plans: string[]
    corrections: string[]
  }[]
  userText: string | null
  /** The Change Set's files and line counts. */
  changeSummary: string
}

export function hasSources(input: IntentInput): boolean {
  return Boolean(
    (input.pullRequest &&
      (input.pullRequest.body.trim() || input.pullRequest.title.trim())) ||
    input.issues.length ||
    input.transcripts.some((t) => t.prompts.length) ||
    input.userText?.trim(),
  )
}

const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n)}\n… (shortened)` : s

export function intentPrompt(input: IntentInput): string {
  const parts: string[] = []
  if (input.userText?.trim())
    parts.push(untrusted("the user's own words", clip(input.userText, 6000)))
  for (const t of input.transcripts) {
    const body = [
      ...t.prompts
        .slice(0, 8)
        .map((p, i) => `Prompt ${i + 1}:\n${clip(p, 2000)}`),
      ...t.corrections.map((c) => `Correction:\n${clip(c, 1000)}`),
      ...t.plans.slice(-2).map((p) => `Accepted plan:\n${clip(p, 4000)}`),
    ].join("\n\n")
    parts.push(untrusted(`agent transcript (${t.label})`, body))
  }
  if (input.pullRequest)
    parts.push(
      untrusted(
        "pull request",
        `${input.pullRequest.title}\n\n${clip(input.pullRequest.body, 8000)}`,
      ),
    )
  for (const i of input.issues)
    parts.push(
      untrusted(`linked issue ${i.url}`, `${i.title}\n\n${clip(i.body, 4000)}`),
    )
  parts.push(
    `The Change Set's files:\n${untrusted("change set", clip(input.changeSummary, 6000))}`,
  )
  parts.push(
    hasSources(input)
      ? "Extract the Intent from the sources."
      : "There are no sources. Infer the Intent from the code, using the tools to read the changes.",
  )
  return parts.join("\n\n")
}

export function intentTask(
  input: IntentInput,
  context: ToolContext,
): AgentTask<IntentOutput> {
  const inferred = !hasSources(input)
  return {
    kind: "intent",
    modelTier: "mid",
    system: INTENT_SYSTEM,
    prompt: intentPrompt(input),
    tools: inferred ? READ_TOOLS : [],
    access: "read-only",
    output: IntentOutput,
    context,
    maxTurns: inferred ? 10 : 3,
    effort: inferred ? "medium" : "low",
  }
}

export function intentCacheKey(
  input: IntentInput,
  provider: string,
  model: string,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        INTENT_PROMPT_VERSION,
        provider,
        model,
        intentPrompt(input),
      ]),
    )
    .digest("hex")
}

/** Requirement ids normalized to R1, R2… in order, empty statements dropped. */
export function toRequirements(
  out: IntentOutput["requirements"],
): Requirement[] {
  return out
    .map((r) => r.statement.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((statement, i) => ({ id: `R${i + 1}`, statement }))
}

// ---- From the Pull Request description -------------------------------------------

/** Items under a "How to test" / "Testing" / "Test plan" heading. */
export function howToTestFromDescription(body: string): string[] {
  const lines = body.split(/\r?\n/)
  const heading =
    /^\s*(#{1,6}\s*|\*\*)?\s*(how to test|testing|test plan|steps to test|to test|verification|qa)\b.*$/i
  const out: string[] = []
  let inside = false
  for (const line of lines) {
    if (heading.test(line)) {
      inside = true
      continue
    }
    if (!inside) continue
    if (/^\s*(#{1,6}\s|\*\*[^*]+\*\*\s*$)/.test(line) && out.length) break
    const item = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ x]\]\s*)?(.+)$/i)
    if (item?.[1]) out.push(item[1].trim())
    else if (line.trim() && !out.length) out.push(line.trim())
  }
  return out.slice(0, 12)
}

export interface IssueRef {
  /** owner/name, or null for the Pull Request's own repository. */
  project: string | null
  number: number
}

/** Issues a description closes (`Fixes #12`, `Closes owner/repo#3`) or links (`…/issues/7`). */
export function linkedIssues(body: string, hostname: string): IssueRef[] {
  const out = new Map<string, IssueRef>()
  const add = (project: string | null, n: string | undefined) => {
    const number = Number(n)
    if (Number.isInteger(number) && number > 0)
      out.set(`${project ?? ""}#${number}`, { project, number })
  }
  for (const m of body.matchAll(
    /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|implements?|addresses)\s*:?\s+(?:([\w.-]+\/[\w.-]+))?#(\d+)\b/gi,
  ))
    add(m[1] ?? null, m[2])
  const host = hostname.replace(/[.]/g, "\\.")
  for (const m of body.matchAll(
    new RegExp(
      `https?://${host}/([\\w.-]+/[\\w./-]+?)/(?:-/)?issues/(\\d+)`,
      "gi",
    ),
  ))
    add(m[1] ?? null, m[2])
  return [...out.values()].slice(0, 5)
}
