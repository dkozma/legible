// The Connections eval's summary: totals and per-entry scores, a row per
// Change Set, and the most frequent false positives per bucket, which are
// what the resolver fixes are tuned on.

import type { EntryRun } from "./run"
import {
  addScore,
  type ChangeSetScore,
  type Count,
  emptyScore,
  type Recall,
  type SiteScore,
  type UsedBySite,
} from "./score"

export interface Example {
  /** `path:line name → ours vs SCIP`. */
  text: string
  /** Sites with the same name, our answer and SCIP's. */
  count: number
  sha: string
}

export interface ConnectionsSummary {
  label: string
  date: string
  scipTypescript: string
  /** Shared corpus (committed) or local mode. */
  mode: "corpus" | "local"
  entries: {
    name: string
    source: string
    scored: number
    skipped: number
    total: ChangeSetScore
  }[]
  total: ChangeSetScore
  changeSets: EntryRun["results"]
  /** False positives by bucket: one per single-target status, "used by", "locals". */
  examples: Record<string, Example[]>
  timings: { prepareMs: number; scoreMs: number }
}

/** Statuses with one target, where a wrong one is a false positive. */
const SINGLE = (status: string) =>
  status !== "none" && status !== "ambiguous" && status !== "external"

const MAX_EXAMPLES = 20

function top<T>(
  items: T[],
  key: (t: T) => string,
  text: (t: T) => string,
  sha: (t: T) => string,
): Example[] {
  const groups = new Map<string, { first: T; count: number }>()
  for (const t of items) {
    const k = key(t)
    const g = groups.get(k)
    if (g) g.count++
    else groups.set(k, { first: t, count: 1 })
  }
  return [...groups.values()]
    .toSorted((a, b) => b.count - a.count)
    .slice(0, MAX_EXAMPLES)
    .map((g) => ({ text: text(g.first), count: g.count, sha: sha(g.first) }))
}

const scipSays = (s: SiteScore) =>
  s.scip === "repo"
    ? `SCIP ${s.scipTarget}`
    : `SCIP ${s.scip}${s.scipTarget ? ` ${s.scipTarget}` : ""}`

export function examples(
  sites: (SiteScore & { sha: string })[],
  usedBy: (UsedBySite & { sha: string })[],
): Record<string, Example[]> {
  const out: Record<string, Example[]> = {}
  const wrong = sites.filter(
    (s) => SINGLE(s.ours) && !s.correct && s.scip !== "unknown",
  )
  for (const status of [...new Set(wrong.map((s) => s.ours))].toSorted())
    out[status] = top(
      wrong.filter((s) => s.ours === status),
      (s) => `${s.name}\0${s.target}\0${s.scip}\0${s.scipTarget}`,
      (s) =>
        `${s.path}:${s.line} ${s.name} (${s.kind}) → ${s.ours} ${s.target} vs ${scipSays(s)}`,
      (s) => s.sha,
    )
  out["used by"] = top(
    usedBy.filter((u) => !u.correct),
    (u) => `${u.path}\0${u.symbol}\0${u.status}`,
    (u) =>
      `${u.path}:${u.line} used by → ${u.status} ${u.symbol} vs SCIP ${u.scip}`,
    (u) => u.sha,
  )
  out["wrongly external"] = top(
    sites.filter((s) => s.ours === "external" && s.scip === "repo"),
    (s) => `${s.name}\0${s.scipTarget}`,
    (s) =>
      `${s.path}:${s.line} ${s.name} (${s.kind}) → external vs ${scipSays(s)}`,
    (s) => s.sha,
  )
  out.locals = top(
    sites.filter((s) => s.scip === "local" && s.ours !== "none" && !s.correct),
    (s) => `${s.name}\0${s.target}\0${s.ours}`,
    (s) =>
      `${s.path}:${s.line} ${s.name} (${s.kind}) → ${s.ours} ${s.target ?? s.name} vs ${scipSays(s)}`,
    (s) => s.sha,
  )
  return out
}

export function summarize(
  label: string,
  mode: ConnectionsSummary["mode"],
  scipTypescript: string,
  runs: { name: string; source: string; run: EntryRun }[],
  timings: ConnectionsSummary["timings"],
): ConnectionsSummary {
  const total = emptyScore()
  const entries = runs.map(({ name, source, run }) => {
    const t = emptyScore()
    for (const r of run.results) if (r.score) addScore(t, r.score)
    addScore(total, t)
    return {
      name,
      source,
      scored: run.results.filter((r) => r.score).length,
      skipped: run.results.filter((r) => r.skipped).length,
      total: t,
    }
  })
  return {
    label,
    date: new Date().toISOString(),
    scipTypescript,
    mode,
    entries,
    total,
    changeSets: runs.flatMap((r) => r.run.results),
    examples: examples(
      runs.flatMap((r) => r.run.sites),
      runs.flatMap((r) => r.run.usedBy),
    ),
    timings,
  }
}

// ---- Markdown ----------------------------------------------------------------

const pct = (n: number, d: number) =>
  d === 0 ? "—" : `${Math.round((n / d) * 100)}%`
const precision = (c: Count | undefined) =>
  c ? `${pct(c.correct, c.sites)} (${c.correct}/${c.sites})` : "—"
const sum = (r: Record<string, number>) =>
  Object.values(r).reduce((a, b) => a + b, 0)
const found = (r: Recall) => sum(r.found)
const breakdown = (r: Record<string, number>) =>
  Object.entries(r)
    .toSorted((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(", ") || "none"

/** resolved, likely, then any others alphabetically, then ambiguous and external. */
function statusOrder(statuses: Iterable<string>): string[] {
  const rank = (s: string) =>
    s === "resolved"
      ? 0
      : s === "likely"
        ? 1
        : s === "ambiguous"
          ? 3
          : s === "external"
            ? 4
            : 2
  return [...new Set(statuses)].toSorted(
    (a, b) => rank(a) - rank(b) || a.localeCompare(b),
  )
}

function totals(s: ChangeSetScore): string[] {
  const statuses = statusOrder(Object.keys(s.byStatus))
  const kinds = Object.keys(s.byKind).toSorted()
  const usedByStatuses = statusOrder(Object.keys(s.usedBy.precision))
  const usedByAll = Object.values(s.usedBy.precision).reduce(
    (a, c) => ({ sites: a.sites + c.sites, correct: a.correct + c.correct }),
    { sites: 0, correct: 0 },
  )
  const externals = s.byStatus.external?.sites ?? 0
  return [
    "| Status | Precision (correct/uses) |",
    "|---|---|",
    ...statuses.map(
      (st) =>
        `| ${st}${st === "ambiguous" ? " (SCIP's target among candidates)" : st === "external" ? " (SCIP has no definition)" : ""} | ${precision(s.byStatus[st])} |`,
    ),
    "",
    `| Kind | ${statuses.join(" | ")} |`,
    `|---|${statuses.map(() => "---").join("|")}|`,
    ...kinds.map(
      (k) =>
        `| ${k} | ${statuses.map((st) => precision(s.byKind[k]?.[st])).join(" | ")} |`,
    ),
    "",
    `- **Connections on locals and parameters** (pattern A): ${sum(s.localsConnected)} (${breakdown(s.localsConnected)}). On names being declared: ${sum(s.declarationsConnected)} (${breakdown(s.declarationsConnected)}).`,
    `- **Ambiguous**, where SCIP has a definition: it's among the candidates in ${precision(s.ambiguous)}.`,
    `- **Wrongly external**: ${s.wronglyExternal} of ${externals} external uses resolve in the repository.`,
    `- **Recall**, uses of definitions we have a Symbol for: ${pct(found(s.recallIndexed), s.recallIndexed.sites)} (${found(s.recallIndexed)}/${s.recallIndexed.sites}) counting files we indexed; ${pct(found(s.recallAll), s.recallAll.sites)} (${found(s.recallAll)}/${s.recallAll.sites}) counting every file. Found as ${breakdown(s.recallAll.found)}; ${s.recallAll.notExtracted} not extracted as references at all.`,
    `- **Used by** of ${s.usedBy.symbols} changed Symbols (${s.usedBy.unmatched} not defined in SCIP at their name, not scored): precision ${precision(usedByAll)} (${usedByStatuses.map((st) => `${st} ${precision(s.usedBy.precision[st])}`).join(", ") || "none"}); recall ${pct(s.usedBy.recall.found, s.usedBy.recall.sites)} (${s.usedBy.recall.found}/${s.usedBy.recall.sites}).`,
    `- Not scored: ${s.unknown} uses with no SCIP occurrence; ${s.filesWithoutScip} changed files SCIP didn't index.`,
  ]
}

export function markdown(s: ConnectionsSummary): string {
  const rows = s.changeSets.map((c) => {
    const sc = c.score
    const name = `${c.entry} \`${c.sha.slice(0, 8)}\` ${c.subject.replace(/\|/g, "\\|").slice(0, 60)}`
    if (!sc)
      return `| ${name} | skipped: ${(c.skipped ?? "").replace(/\|/g, "\\|").slice(0, 80)} | | | | | |`
    const ub = Object.values(sc.usedBy.precision).reduce(
      (a, x) => ({ sites: a.sites + x.sites, correct: a.correct + x.correct }),
      { sites: 0, correct: 0 },
    )
    return `| ${name} | ${c.files} | ${precision(sc.byStatus.resolved)} | ${precision(sc.byStatus.likely)} | ${sum(sc.localsConnected)} | ${pct(found(sc.recallIndexed), sc.recallIndexed.sites)} | ${precision(ub)} |`
  })
  const ex = Object.entries(s.examples).flatMap(([bucket, list]) => [
    `### ${bucket}`,
    "",
    ...(list.length
      ? list.map(
          (e) =>
            `- ${e.text}${e.count > 1 ? ` (×${e.count})` : ""} · \`${e.sha.slice(0, 8)}\``,
        )
      : ["None."]),
    "",
  ])
  return [
    `## Connections against SCIP · TypeScript · ${s.label} · ${s.date.slice(0, 10)}`,
    "",
    `scip-typescript ${s.scipTypescript}. ${s.entries.map((e) => `**${e.name}** (${e.source}): ${e.scored} Change Sets scored, ${e.skipped} skipped`).join("; ")}. Preparing indexes took ${Math.round(s.timings.prepareMs / 1000)}s, scoring ${Math.round(s.timings.scoreMs / 1000)}s.`,
    "",
    "### All",
    "",
    ...totals(s.total),
    "",
    ...s.entries.flatMap((e) => [`### ${e.name}`, "", ...totals(e.total), ""]),
    "### Change Sets",
    "",
    "| Change Set | Files | resolved | likely | Locals connected | Recall (indexed) | Used by |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    "",
    "## False positives, most frequent first",
    "",
    ...ex,
  ].join("\n")
}
