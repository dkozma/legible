// The fake runtime's answers: a deterministic baseline that groups Fragments
// by file, answers every judgment with its first option, and finds no Domain
// Changes. It measures the harness and the validator, not a model.

import type { AgentTask } from "@legible/agent-runtime"
import type { PlannerOutput } from "@legible/pipelines"

function walkthrough(prompt: string): PlannerOutput {
  const byFile = new Map<string, { aliases: string[]; layer: string }>()
  for (const m of prompt.matchAll(/^(F\d+) (\S+) .*?layer hint: (\w+)$/gm)) {
    const [, alias, path, layer] = m as unknown as [
      string,
      string,
      string,
      string,
    ]
    const g = byFile.get(path) ?? { aliases: [], layer }
    g.aliases.push(alias)
    byFile.set(path, g)
  }
  return {
    steps: [...byFile.entries()].map(([path, g]) => ({
      name: path.split("/").pop() ?? path,
      narrative: "",
      layer: g.layer as PlannerOutput["steps"][number]["layer"],
      feature: "Change",
      fragments: g.aliases,
    })),
  }
}

function judgments(prompt: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const b of prompt.split(/\n(?=q\d+ \()/)) {
    const m = b.match(/^(q\d+) \((yes\/no|choice|graded)\)/)
    if (!m) continue
    const [, key, kind] = m as unknown as [string, string, string]
    if (kind === "yes/no") out[key] = { answer: true, confidence: 0.9 }
    else if (kind === "graded") out[key] = { level: 0, confidence: 0.9 }
    else
      out[key] = {
        choice: b.match(/^ {2}- ([^:]+):/m)?.[1] ?? "",
        confidence: 0.9,
      }
  }
  return out
}

export function fakeAnswer(task: AgentTask<unknown>): unknown {
  if (task.kind === "walkthrough") return walkthrough(task.prompt)
  if (task.kind === "judgment") return judgments(task.prompt)
  if (task.kind === "domain_changes")
    return { domainChanges: [], howToTest: [] }
  return null
}
