// `pnpm evals`: every labeled case through the real pipelines; prints a
// summary and writes it to evals/results/. See README.md.

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { expect, it } from "vitest"

import { loadCases } from "./src/cases"
import { markdown, summarize } from "./src/report"
import { envFromProcess, runCase } from "./src/run"

it("runs the evals", async () => {
  const env = envFromProcess()
  const cases = loadCases(undefined, process.env.EVAL_CASE)
  const results = []
  for (const c of cases) results.push(await runCase(c, env))
  const summary = summarize(env.label, results)
  console.log(`\n${markdown(summary)}\n`)
  const dir = join(__dirname, "results")
  mkdirSync(dir, { recursive: true })
  const name = `${summary.date.slice(0, 10)}-${env.label.replace(/[^a-z0-9.-]+/gi, "-")}`
  writeFileSync(
    join(dir, `${name}.json`),
    `${JSON.stringify(summary, null, 2)}\n`,
  )
  writeFileSync(join(dir, `${name}.md`), `${markdown(summary)}\n`)
  expect(summary.exitCriteria).toEqual({
    coverage: true,
    dependencyOrder: true,
  })
})
