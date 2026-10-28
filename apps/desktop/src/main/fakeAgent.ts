// Canned answers for LEGIBLE_FAKE_AGENT=1 (E2E tests, demos): plausible
// output for every pipeline, derived from the prompt so it fits any Change Set.

import { AgentError, type AgentTask } from "@legible/agent-runtime"
import type {
  DomainChangesOutput,
  ExplanationOutput,
  IntentOutput,
  PlannerOutput,
} from "@legible/pipelines"

export const fakeFailure = (): never => {
  throw new AgentError(
    "Claude's answer didn't match the expected shape: Output does not match required schema: root: must have required property 'whatChanged'",
    "structured_output",
  )
}

const explanation = (): ExplanationOutput => ({
  before:
    "Refunded the whole order total in one gateway call, then wrote an audit entry naming the operator.",
  after:
    "Refunds `amountCents`, defaulting to the remaining balance from `calculateRefundable()`, and rejects anything larger. Shipping is included only on the final refund.",
  whatChanged: [
    {
      kind: "behavior",
      text: "Partial refunds are now possible, capped at the remaining balance.",
    },
    {
      kind: "connection",
      text: "No longer calls `auditLog()`; emits `refund.issued` instead, without the operator.",
    },
  ],
  watchOut: [
    "Two concurrent partial refunds can read the same `balance.count` and send the same idempotency key.",
  ],
})

const intent = (): IntentOutput => ({
  goal: "Let support staff refund part of an order, and give customers 60 days to ask for a refund.",
  requirements: [
    {
      id: "R1",
      statement:
        "Support staff can refund part of an order, up to what's left to refund.",
    },
    {
      id: "R2",
      statement: "Refunds are allowed up to 60 days after purchase.",
    },
  ],
})

interface Line {
  alias: string
  path: string
  layer: string
}

/** The planner prompt's Fragment lines: "F3 src/a.ts 4–9 +6 −0 · layer hint: backend". */
function fragmentLines(prompt: string): Line[] {
  const out: Line[] = []
  for (const m of prompt.matchAll(/^(F\d+) (\S+) .*?layer hint: (\w+)$/gm))
    out.push({
      alias: m[1] as string,
      path: m[2] as string,
      layer: m[3] as string,
    })
  return out
}

const NAMES: Record<string, string> = {
  data_model: "Store refund data",
  backend: "Refund logic",
  api: "Expose it in the API",
  client_data: "Client state",
  presentation: "Show it in the UI",
  chores: "Dependencies and docs",
}

/** One Step per file, named by Layer. */
function walkthrough(prompt: string): PlannerOutput {
  const byFile = new Map<string, Line[]>()
  for (const l of fragmentLines(prompt)) {
    const list = byFile.get(l.path) ?? []
    list.push(l)
    byFile.set(l.path, list)
  }
  return {
    steps: [...byFile.entries()].map(([path, lines]) => {
      const layer = (lines[0]?.layer ??
        "backend") as PlannerOutput["steps"][number]["layer"]
      const file = path.split("/").pop() ?? path
      return {
        name: `${NAMES[layer] ?? "Changes"}: ${file}`,
        narrative: `Changes ${file} for partial refunds.`,
        layer,
        feature: "Partial refunds",
        fragments: lines.map((l) => l.alias),
      }
    }),
  }
}

function domainChanges(prompt: string): DomainChangesOutput {
  const aliases = [...prompt.matchAll(/^(F\d+) (\S+)/gm)]
  const pick = (re: RegExp) =>
    aliases.filter((m) => re.test(m[2] as string)).map((m) => m[1] as string)
  return {
    domainChanges: [
      {
        statement:
          "Support staff can refund part of an order, up to the remaining balance.",
        before: "whole order only",
        after: "any amount up to the remaining balance",
        fragments: pick(/RefundService|api\/refunds/).slice(0, 3),
      },
      {
        statement: "Refunds are allowed up to 60 days after purchase.",
        before: "30 days",
        after: "60 days",
        fragments: pick(/RefundPolicy/).slice(0, 2),
      },
      {
        statement: "Refund audit entries no longer record the operator.",
        before: "operator recorded",
        after: "not recorded",
        fragments: pick(/RefundService|Audit/).slice(0, 2),
      },
    ],
    howToTest: [
      "Refund $5 of a $20 order, then try to refund $20 more: the second is refused.",
      "Refund an order placed 45 days ago: it's allowed.",
      "Check the audit log after a refund: does it still say who refunded?",
    ],
  }
}

/** Judgments: the fast-tier schema's q1…qn, from the question lines. */
function judgments(prompt: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const blocks = prompt.split(/\n(?=q\d+ \()/)
  for (const b of blocks) {
    const m = b.match(/^(q\d+) \((yes\/no|choice|graded)\): ([^\n]*)/)
    if (!m) continue
    const [, key, kind, text] = m as unknown as [string, string, string, string]
    if (kind === "yes/no") out[key] = { answer: true, confidence: 0.9 }
    else if (kind === "graded") out[key] = { level: 0, confidence: 0.9 }
    else {
      const options = [...b.matchAll(/^ {2}- ([^:]+):/gm)].map(
        (o) => o[1] as string,
      )
      // The fixture's Unrequested change: its audit event lost the operator.
      const pickUnrequested =
        /audit|Refund logic: RefundService/i.test(text) &&
        options.includes("unrequested")
      out[key] = {
        choice: pickUnrequested
          ? "unrequested"
          : /migration|Store refund data|Dependencies/i.test(text) &&
              options.includes("supporting")
            ? "supporting"
            : options[0],
        confidence: 0.9,
      }
    }
  }
  return out
}

export function fakeAnswer(task: AgentTask<unknown>): unknown {
  switch (task.kind) {
    case "intent":
      return intent()
    case "walkthrough":
      return walkthrough(task.prompt)
    case "domain_changes":
      return domainChanges(task.prompt)
    case "wording":
      return {
        suggestion:
          "This also changes how refunds are audited:\n\n- Refund audit entries no longer record which operator issued the refund.",
      }
    case "judgment":
      return judgments(task.prompt)
    default:
      return explanation()
  }
}
