// The harness itself, and the M3 exit criteria on every labeled case with the
// deterministic fake runtime: the validator guarantees full coverage and
// dependency order whatever the planner says.

import { describe, expect, it } from "vitest"

import type { StepFragment } from "@legible/domain"

import { loadCases } from "../src/cases"
import { summarize } from "../src/report"
import { envFromProcess, fakeEnv, runCase } from "../src/run"
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

describe("settings", () => {
  it("default to the fake runtime and the fast-tier Judge", () => {
    const env = envFromProcess({})
    expect(env.label).toBe("fake")
    expect(env.externalJudge).toBeNull()
  })

  it("refuse what the fake runtime would ignore", () => {
    expect(() => envFromProcess({ EVAL_JUDGE: "jev" })).toThrow(
      "EVAL_JUDGE=jev needs a model runtime",
    )
    expect(() => envFromProcess({ EVAL_MODEL: "gpt-5" })).toThrow(
      "EVAL_MODEL needs a model runtime",
    )
  })

  it("refuse unknown values", () => {
    expect(() => envFromProcess({ EVAL_RUNTIME: "opneai" })).toThrow(
      'EVAL_RUNTIME must be fake, claude or openai, not "opneai"',
    )
    expect(() =>
      envFromProcess({ EVAL_RUNTIME: "claude", EVAL_JUDGE: "typesafe" }),
    ).toThrow("EVAL_JUDGE must be fast, jev or decisions")
    expect(() => envFromProcess({ EVAL_BUDGET_USD: "two" })).toThrow(
      "EVAL_BUDGET_USD must be a positive number",
    )
  })

  it("need the key for the runtime and the Judge", () => {
    expect(() => envFromProcess({ EVAL_RUNTIME: "openai" })).toThrow(
      "EVAL_RUNTIME=openai needs OPENAI_API_KEY",
    )
    expect(() =>
      envFromProcess({ EVAL_RUNTIME: "claude", EVAL_JUDGE: "jev" }),
    ).toThrow("EVAL_JUDGE=jev needs TYPESAFE_API_KEY")
    expect(() =>
      envFromProcess({ EVAL_RUNTIME: "claude", EVAL_JUDGE: "decisions" }),
    ).toThrow("EVAL_JUDGE=decisions needs OPENAI_API_KEY")
    const env = envFromProcess({
      EVAL_RUNTIME: "claude",
      EVAL_JUDGE: "jev",
      TYPESAFE_API_KEY: "test",
    })
    expect(env.externalJudge?.name).toBe("jev")
    expect(env.label).toBe("claude:defaults+jev")
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
