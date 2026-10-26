// The harness itself, and the M3 exit criteria on every labeled case with the
// deterministic fake runtime: the validator guarantees full coverage and
// dependency order whatever the planner says.

import { describe, expect, it } from "vitest"

import type { StepFragment } from "@legible/domain"

import { loadCases } from "../src/cases"
import { summarize } from "../src/report"
import { fakeEnv, runCase } from "../src/run"
import { matches, similar } from "../src/score"

const frag = (over: Partial<StepFragment>): StepFragment => ({
  fragmentId: "f",
  fileId: "x",
  path: "src/a.ts",
  kind: "behavioral",
  baseRange: [3, 5],
  headRange: [3, 8],
  additions: 6,
  deletions: 3,
  test: false,
  collapsed: false,
  ...over,
})

describe("labels", () => {
  it("point at Fragments by path and line range", () => {
    expect(matches("src/a.ts", frag({}))).toBe(true)
    expect(matches("src/a.ts@8-20", frag({}))).toBe(true)
    expect(matches("src/a.ts@9-20", frag({}))).toBe(false)
    expect(matches("src/a.ts@b5", frag({}))).toBe(true)
    expect(matches("src/b.ts", frag({}))).toBe(false)
  })

  it("match Domain Changes by their content words", () => {
    expect(
      similar(
        "Refunds are allowed up to 60 days after purchase, was 30",
        "Refunds are allowed up to 60 days after purchase.",
      ),
    ).toBeGreaterThanOrEqual(0.5)
    expect(
      similar("Refunds can be partial", "Shipping is refunded last"),
    ).toBeLessThan(0.5)
  })

  it("load every case with labels", () => {
    const cases = loadCases()
    expect(cases.length).toBeGreaterThanOrEqual(6)
    for (const c of cases) expect.soft(c.labels.steps.length).toBeGreaterThan(0)
  })
})

describe("every case, with the fake runtime", () => {
  it("covers every Fragment once, in dependency order", async () => {
    const env = fakeEnv()
    const results = []
    for (const c of loadCases()) results.push(await runCase(c, env))
    for (const r of results) expect.soft(r.error, r.name).toBeNull()
    const s = summarize("fake", results)
    expect(s.exitCriteria).toEqual({ coverage: true, dependencyOrder: true })
    // The two-feature case gets Chapters only from a model; the fake keeps one feature.
    expect(results.every((r) => r.scores.fragments > 0)).toBe(true)
  }, 120_000)
})
