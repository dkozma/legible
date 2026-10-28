// `pnpm evals:connections`: scores Connections against SCIP on the shared
// corpus (evals/corpus/connections.json), or on a repository of yours with
// EVAL_REPO. Prints a summary and writes it to evals/results/ (local mode:
// evals/.cache/results/, never committed). See README.md.

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { expect, it } from "vitest"

import {
  CACHE_DIR,
  loadCorpus,
  localEntry,
  prepare,
  SCIP_TYPESCRIPT,
} from "./src/connections/corpus"
import { markdown, summarize } from "./src/connections/report"
import { type EntryRun, runEntry } from "./src/connections/run"

it("scores Connections against SCIP", async () => {
  const local = localEntry()
  const only = process.env.EVAL_CORPUS
  const entries = local
    ? [local]
    : loadCorpus().filter((e) => !only || e.name === only)
  if (entries.length === 0)
    throw new Error(`No corpus entry named "${only}" in evals/corpus.`)
  const label = process.env.EVAL_LABEL?.replace(/[^a-z0-9.-]+/gi, "-") ?? ""
  // Vitest hides console.log from passing tests; progress goes to stderr.
  const log = (line: string) => process.stderr.write(`${line}\n`)

  let prepareMs = 0
  let scoreMs = 0
  const runs: { name: string; source: string; run: EntryRun }[] = []
  for (const entry of entries) {
    log(`${entry.name}: preparing SCIP indexes`)
    let t = Date.now()
    const prepared = await prepare(entry, log)
    prepareMs += Date.now() - t
    log(`${entry.name}: scoring`)
    t = Date.now()
    const run = await runEntry(prepared, log)
    scoreMs += Date.now() - t
    const s = entry.source
    runs.push({
      name: entry.name,
      source:
        s === "self"
          ? "this repository"
          : "url" in s
            ? `${s.url}@${s.rev.slice(0, 12)}`
            : "local",
      run,
    })
  }

  const summary = summarize(
    label || (local ? "local" : "corpus"),
    local ? "local" : "corpus",
    SCIP_TYPESCRIPT.version,
    runs,
    { prepareMs, scoreMs },
  )
  log(`\n${markdown(summary)}\n`)
  const dir = local ? join(CACHE_DIR, "results") : join(__dirname, "results")
  mkdirSync(dir, { recursive: true })
  const name = [
    summary.date.slice(0, 10),
    "connections-typescript",
    local ? local.name : null,
    label || null,
  ]
    .filter(Boolean)
    .join("-")
  writeFileSync(
    join(dir, `${name}.json`),
    `${JSON.stringify(summary, null, 2)}\n`,
  )
  writeFileSync(join(dir, `${name}.md`), `${markdown(summary)}\n`)
  log(`Wrote ${join(dir, name)}.{md,json}`)
  // Every scored use and Used by site, for digging past the examples; never committed.
  const sites = join(CACHE_DIR, "sites")
  mkdirSync(sites, { recursive: true })
  const lines = (rows: object[]) =>
    rows.map((r) => `${JSON.stringify(r)}\n`).join("")
  writeFileSync(
    join(sites, `${name}.jsonl`),
    runs.map((r) => lines(r.run.sites)).join(""),
  )
  writeFileSync(
    join(sites, `${name}-used-by.jsonl`),
    runs.map((r) => lines(r.run.usedBy)).join(""),
  )
  expect(summary.changeSets.some((c) => c.score)).toBe(true)
})
