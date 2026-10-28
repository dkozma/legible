// The summary of a run: a Markdown table per case, the averages, and whether
// the M3 exit criteria hold.

import type { CaseResult } from "./run"

const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`)

function mean(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x !== null)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

export interface RunSummary {
  label: string
  date: string
  cases: CaseResult[]
  averages: {
    coverage: number | null
    dependencyViolations: number
    grouping: number | null
    layerAccuracy: number | null
    unrequestedRecall: number | null
    unrequestedPrecision: number | null
    domainChangeRecall: number | null
    domainChangePrecision: number | null
    costPer1kLines: number | null
  }
  /** M3 exit: every Fragment covered and no dependency violations, on every case. */
  exitCriteria: { coverage: boolean; dependencyOrder: boolean }
}

export function summarize(label: string, cases: CaseResult[]): RunSummary {
  const lines = cases.reduce((n, c) => n + c.changedLines, 0)
  const cost = cases.reduce((n, c) => n + c.costUsd, 0)
  return {
    label,
    date: new Date().toISOString(),
    cases,
    averages: {
      coverage: mean(cases.map((c) => c.scores.coverage)),
      dependencyViolations: cases.reduce(
        (n, c) => n + c.scores.dependencyViolations,
        0,
      ),
      grouping: mean(cases.map((c) => c.scores.grouping)),
      layerAccuracy: mean(cases.map((c) => c.scores.layerAccuracy)),
      unrequestedRecall: mean(cases.map((c) => c.scores.unrequestedRecall)),
      unrequestedPrecision: mean(
        cases.map((c) => c.scores.unrequestedPrecision),
      ),
      domainChangeRecall: mean(cases.map((c) => c.scores.domainChangeRecall)),
      domainChangePrecision: mean(
        cases.map((c) => c.scores.domainChangePrecision),
      ),
      costPer1kLines: lines ? (cost / lines) * 1000 : null,
    },
    exitCriteria: {
      coverage: cases.every((c) => !c.error && c.scores.coverage === 1),
      dependencyOrder: cases.every(
        (c) => !c.error && c.scores.dependencyViolations === 0,
      ),
    },
  }
}

export function markdown(s: RunSummary): string {
  const rows = s.cases.map((c) =>
    [
      c.name,
      c.error ? `error: ${c.error.slice(0, 60)}` : String(c.scores.steps),
      pct(c.scores.coverage),
      String(c.scores.dependencyViolations),
      pct(c.scores.grouping),
      pct(c.scores.layerAccuracy),
      pct(c.scores.unrequestedRecall),
      pct(c.scores.unrequestedPrecision),
      pct(c.scores.domainChangeRecall),
      pct(c.scores.domainChangePrecision),
      c.scores.chaptersRight ? "yes" : "no",
      `$${c.costUsd.toFixed(3)}`,
    ].join(" | "),
  )
  const a = s.averages
  const judges = [...new Set(s.cases.map((c) => c.judgeBackend))]
  const fallbacks = [...new Set(s.cases.flatMap((c) => c.judgeFallback ?? []))]
  return [
    `## ${s.label} · ${s.date.slice(0, 10)}`,
    "",
    "| Case | Steps | Coverage | Dep. violations | Grouping F1 | Layers | Unrequested recall | Unrequested precision | Domain Change recall | Domain Change precision | Chapters | Cost |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r} |`),
    `| **All** | | ${pct(a.coverage)} | ${a.dependencyViolations} | ${pct(a.grouping)} | ${pct(a.layerAccuracy)} | ${pct(a.unrequestedRecall)} | ${pct(a.unrequestedPrecision)} | ${pct(a.domainChangeRecall)} | ${pct(a.domainChangePrecision)} | | ${a.costPer1kLines === null ? "—" : `$${a.costPer1kLines.toFixed(3)}/1k lines`} |`,
    "",
    `Judge: ${judges.join(", ")}${fallbacks.length ? ` (fast tier stood in: ${fallbacks.join("; ")})` : ""}.`,
    "",
    `Exit criteria: coverage ${s.exitCriteria.coverage ? "met" : "NOT met"}, dependency order ${s.exitCriteria.dependencyOrder ? "met" : "NOT met"}.`,
  ].join("\n")
}
