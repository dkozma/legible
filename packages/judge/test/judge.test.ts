import {
  type AgentTask,
  FakeRuntime,
  lintSchema,
  Router,
  runTask,
  Scheduler,
  type ToolContext,
} from "@legible/agent-runtime"
import type { GitRepo } from "@legible/git"
import { describe, expect, it } from "vitest"

import {
  certainty,
  confident,
  DecisionsBackend,
  FastTierBackend,
  JevBackend,
  Judge,
  judgeCacheKey,
  type JudgeRequest,
  judgmentSchema,
  type RunTask,
} from "../src/index"

const req: JudgeRequest = {
  input: "Step 3 drops the operator from the refund audit trail.",
  judgments: [
    {
      kind: "choice",
      name: "scope",
      instructions: "How does Step 3 relate to the Intent?",
      options: [
        { value: "R1", description: "Partial refunds" },
        { value: "supporting", description: "Needed to deliver a requirement" },
        { value: "unrequested", description: "Not asked for" },
      ],
    },
    {
      kind: "predicate",
      name: "payments",
      instructions: "Does Step 3 change payment handling?",
    },
    {
      kind: "score",
      name: "impact",
      instructions: "How much does this matter?",
      levels: ["none", "some", "a lot"],
    },
  ],
}

const signal = new AbortController().signal

function recordingFetch(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status })
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

const headersOf = (c: { init: RequestInit } | undefined) =>
  (c?.init.headers ?? {}) as Record<string, string>

const ctx: ToolContext = {
  repo: {} as GitRepo,
  baseSha: "a",
  headSha: "b",
  changedFiles: [],
}

describe("JevBackend", () => {
  it("sends questions keyed by name and reads answers back", async () => {
    const { calls, fetchImpl } = recordingFetch({
      model: "jev-1.13.0",
      answers: {
        scope: {
          type: "choice",
          choice: "unrequested",
          confidence: 0.82,
          probabilities: { R1: 0.1, supporting: 0.08, unrequested: 0.82 },
        },
        payments: { type: "noul", noul: 0.91 },
        impact: { type: "score", score: 1.7, confidence: 0.55 },
      },
      usage: { input_tokens: 120, output_tokens: 12 },
    })
    const r = await new JevBackend("ts-key", "jev-latest", fetchImpl).judge(
      req,
      { signal },
    )
    const sent = JSON.parse(calls[0]?.init.body as string) as {
      state: string
      questions: Record<string, { type: string; criteria?: unknown }>
    }
    expect(calls[0]?.url).toBe("https://api.typesafe.ai/v1/systemone")
    expect(headersOf(calls[0]).Authorization).toBe("Bearer ts-key")
    expect(sent.state).toBe(req.input)
    expect(sent.questions.payments?.type).toBe("noul")
    expect(sent.questions.scope?.criteria).toEqual({
      R1: "Partial refunds",
      supporting: "Needed to deliver a requirement",
      unrequested: "Not asked for",
    })
    expect(sent.questions.impact?.criteria).toEqual(["none", "some", "a lot"])
    expect(r.model).toBe("jev-1.13.0")
    expect(r.costUsd).toBeNull()
    expect(r.answers).toEqual([
      {
        kind: "choice",
        name: "scope",
        choice: "unrequested",
        confidence: 0.82,
        probabilities: { R1: 0.1, supporting: 0.08, unrequested: 0.82 },
      },
      { kind: "predicate", name: "payments", probability: 0.91 },
      { kind: "score", name: "impact", score: 1.7, confidence: 0.55 },
    ])
  })

  it("asks for long context when the evidence is large", async () => {
    const { calls, fetchImpl } = recordingFetch({ answers: {} })
    await new JevBackend("k", "jev-latest", fetchImpl).judge(
      { ...req, input: "x".repeat(200_000) },
      { signal },
    )
    expect(headersOf(calls[0])["TypeSafe-Danger-Zone-Long-Context"]).toBe(
      "true",
    )
  })
})

describe("DecisionsBackend", () => {
  it("sends a questions array and prices input tokens", async () => {
    const { calls, fetchImpl } = recordingFetch({
      answers: [
        {
          type: "choice",
          name: "scope",
          choice: "R1",
          probabilities: [
            { value: "R1", probability: 0.95 },
            { value: "supporting", probability: 0.03 },
            { value: "unrequested", probability: 0.02 },
          ],
          confidence: 0.93,
        },
        { type: "predicate", name: "payments", probability: 0.2 },
        { type: "refusal", name: "impact" },
      ],
      usage: { input_tokens: 2_000_000 },
    })
    const r = await new DecisionsBackend("sk", fetchImpl).judge(req, {
      signal,
    })
    const sent = JSON.parse(calls[0]?.init.body as string) as {
      model: string
      questions: { type: string; levels?: unknown }[]
    }
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/decisions")
    expect(sent.model).toBe("gpt-6-luna")
    expect(sent.questions.map((q) => q.type)).toEqual([
      "choice",
      "predicate",
      "score",
    ])
    expect(sent.questions[2]?.levels).toEqual([
      { label: "none" },
      { label: "some" },
      { label: "a lot" },
    ])
    expect(r.costUsd).toBeCloseTo(0.2)
    expect(r.answers[0]).toMatchObject({
      choice: "R1",
      probabilities: { R1: 0.95 },
    })
    expect(r.answers[2]).toEqual({ kind: "refusal", name: "impact" })
  })

  it("reads an answer without a probability as a refusal, not a confident no", async () => {
    const { fetchImpl } = recordingFetch({
      answers: [
        { type: "choice", name: "scope", choice: "nope", confidence: 0.9 },
        { type: "predicate", name: "payments" },
        { type: "score", name: "impact", score: 1, confidence: "high" },
      ],
    })
    const r = await new DecisionsBackend("sk", fetchImpl).judge(req, {
      signal,
    })
    expect(r.answers.map((a) => a.kind)).toEqual([
      "refusal",
      "refusal",
      "refusal",
    ])
  })

  it("names a rejected key", async () => {
    const { fetchImpl } = recordingFetch({ error: "nope" }, 401)
    await expect(
      new DecisionsBackend("sk", fetchImpl).judge(req, { signal }),
    ).rejects.toThrow(/rejected the API key/)
  })
})

describe("FastTierBackend", () => {
  const answer = {
    q1: { choice: "unrequested", confidence: 0.9 },
    q2: { answer: false, confidence: 0.75 },
    q3: { level: 2, confidence: 0.6 },
  }

  it("asks every judgment in one structured run", async () => {
    const fake = new FakeRuntime(() => answer)
    const router = new Router(
      { anthropic: fake },
      {
        strong: { provider: "anthropic", model: "s" },
        mid: { provider: "anthropic", model: "m" },
        fast: { provider: "anthropic", model: "claude-haiku-5-5" },
      },
    )
    const scheduler = new Scheduler(2)
    const run: RunTask = (task) =>
      runTask(router, scheduler, task, { signal, budgetUsd: 1 })
    const r = await new FastTierBackend(run, ctx).judge(req)
    expect(fake.calls).toHaveLength(1)
    const task = fake.calls[0]?.task as AgentTask<unknown>
    expect(task.kind).toBe("judgment")
    expect(task.tools).toEqual([])
    expect(task.prompt).toContain('<untrusted source="evidence">')
    expect(r.model).toBe("claude-haiku-5-5")
    expect(r.answers[0]).toMatchObject({
      choice: "unrequested",
      confidence: 0.9,
    })
    expect(r.answers[1]).toEqual({
      kind: "predicate",
      name: "payments",
      probability: 0.25,
    })
    expect(r.answers[2]).toMatchObject({ score: 2, confidence: 0.6 })
  })

  it("has a schema both providers accept", () => {
    expect(lintSchema(judgmentSchema(req.judgments))).toEqual([])
  })
})

describe("Judge", () => {
  const fastAnswer = new FakeRuntime(() => ({
    q1: { choice: "R1", confidence: 0.85 },
    q2: { answer: true, confidence: 0.95 },
    q3: { level: 0, confidence: 0.9 },
  }))
  const router = new Router(
    { anthropic: fastAnswer },
    {
      strong: { provider: "anthropic", model: "s" },
      mid: { provider: "anthropic", model: "m" },
      fast: { provider: "anthropic", model: "f" },
    },
  )
  const run: RunTask = (task) =>
    runTask(router, new Scheduler(1), task, { signal, budgetUsd: 1 })

  it("falls back to the fast tier when an external backend fails, and says why", async () => {
    const { fetchImpl } = recordingFetch({}, 500)
    const judge = new Judge(
      [new JevBackend("k", "jev-latest", fetchImpl)],
      new FastTierBackend(run, ctx),
    )
    expect(judge.preferred.name).toBe("jev")
    const r = await judge.judge(req, { signal })
    expect(r.backend).toBe("fast")
    expect(r.fallbackReason).toMatch(/TypeSafe failed .*500/)
  })

  it("rejects duplicate judgment names", async () => {
    const judge = new Judge([], new FastTierBackend(run, ctx))
    await expect(
      judge.judge(
        { input: "x", judgments: [req.judgments[1]!, req.judgments[1]!] },
        { signal },
      ),
    ).rejects.toThrow(/unique/)
  })

  it("applies thresholds per backend", () => {
    const a = { kind: "predicate", name: "p", probability: 0.75 } as const
    expect(certainty(a)).toBe(0.75)
    expect(confident("risk-signal", a, "decisions")).toBe(true)
    expect(confident("risk-signal", a, "fast")).toBe(false)
  })

  it("keys the cache by input, judgments and backend", () => {
    const k = judgeCacheKey(req, "jev", "jev-latest")
    expect(judgeCacheKey(req, "jev", "jev-latest")).toBe(k)
    expect(judgeCacheKey(req, "fast", "jev-latest")).not.toBe(k)
    expect(judgeCacheKey({ ...req, input: "y" }, "jev", "jev-latest")).not.toBe(
      k,
    )
  })
})
