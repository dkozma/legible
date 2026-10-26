import type { GitRepo } from "@legible/git"
import {
  type Model,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  Usage,
} from "@openai/agents"
import { describe, expect, it } from "vitest"
import { z } from "zod"

import {
  AgentError,
  type AgentTask,
  FakeRuntime,
  OpenAIAgentsRuntime,
  Router,
  runTask,
  Scheduler,
} from "../src/index"

/** Answers each request with the next scripted response, and records the requests. */
class ScriptedModel implements Model {
  readonly requests: ModelRequest[] = []
  constructor(private readonly script: ModelResponse["output"][]) {}

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request)
    const output = this.script.shift()
    if (!output) throw new Error("Script ran out")
    return {
      output,
      usage: new Usage({ inputTokens: 1_000_000, outputTokens: 100_000 }),
    }
  }

  // oxlint-disable-next-line require-yield
  async *getStreamedResponse(): AsyncIterable<never> {
    throw new Error("Not streamed")
  }
}

const provider = (model: Model): ModelProvider => ({ getModel: () => model })

const Answer = z.object({ files: z.number() })

const task = (over: Partial<AgentTask<{ files: number }>> = {}) =>
  ({
    kind: "intent",
    modelTier: "mid",
    system: "You count files.",
    prompt: "How many files changed?",
    tools: ["get_change_set_summary"],
    access: "read-only",
    output: Answer,
    context: {
      repo: {} as GitRepo,
      baseSha: "a",
      headSha: "b",
      changedFiles: [
        {
          path: "src/a.ts",
          oldPath: null,
          status: "modified",
          additions: 1,
          deletions: 1,
        },
      ],
    },
    maxTurns: 4,
    effort: null,
    ...over,
  }) satisfies AgentTask<{ files: number }>

const call = (name: string): ModelResponse["output"] => [
  {
    type: "function_call",
    callId: "c1",
    name,
    arguments: "{}",
    status: "completed",
  },
]

const say = (text: string): ModelResponse["output"] => [
  {
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text }],
  },
]

const config = { auth: "api-key", apiKey: "sk-test", chatgpt: null } as const

describe("OpenAIAgentsRuntime", () => {
  it("calls Legible tools, returns structured output and prices the tokens", async () => {
    const model = new ScriptedModel([
      call("get_change_set_summary"),
      say(JSON.stringify({ files: 1 })),
    ])
    const runtime = new OpenAIAgentsRuntime(config, provider(model))
    const events: string[] = []
    const r = await runtime.run(task(), "gpt-6-luna", {
      signal: new AbortController().signal,
      budgetUsd: 5,
      onEvent: (e) => events.push(e.type === "tool" ? e.summary : e.type),
    })
    expect(r.output).toEqual({ files: 1 })
    expect(r.provider).toBe("openai")
    expect(r.numTurns).toBe(2)
    // 2M input × $0.10 + 200k output × $0.50 per million.
    expect(r.costUsd).toBeCloseTo(0.3)
    // The tool's result went back to the model.
    expect(JSON.stringify(model.requests[1]?.input)).toContain("src/a.ts")
    expect(events).toContain("Reading the Change Set summary")
    // Only the granted tool was offered.
    expect(model.requests[0]?.tools.map((t) => t.name)).toEqual([
      "get_change_set_summary",
    ])
  })

  it("stops before a request that would pass the spend cap", async () => {
    const model = new ScriptedModel([
      call("get_change_set_summary"),
      say(JSON.stringify({ files: 1 })),
    ])
    const runtime = new OpenAIAgentsRuntime(config, provider(model))
    const err = await runtime
      .run(task(), "gpt-6-astra", {
        signal: new AbortController().signal,
        budgetUsd: 1,
      })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AgentError)
    expect((err as AgentError).code).toBe("budget")
    // The first request cost $15 at Astra prices; the second was never sent.
    expect(model.requests).toHaveLength(1)
    expect((err as AgentError & { costUsd: number }).costUsd).toBeCloseTo(15)
  })

  it("reports an answer of the wrong shape", async () => {
    const model = new ScriptedModel([say(JSON.stringify({ count: 1 }))])
    const runtime = new OpenAIAgentsRuntime(config, provider(model))
    const err = await runtime
      .run(task(), "gpt-6-luna", {
        signal: new AbortController().signal,
        budgetUsd: 5,
      })
      .catch((e: unknown) => e)
    expect((err as AgentError).code).toBe("structured_output")
  })

  it("needs credentials before it runs", async () => {
    const runtime = new OpenAIAgentsRuntime({ ...config, apiKey: null })
    const err = await runtime
      .run(task(), "gpt-6-luna", {
        signal: new AbortController().signal,
        budgetUsd: 5,
      })
      .catch((e: unknown) => e)
    expect((err as AgentError).code).toBe("auth")
    expect((await runtime.status()).ready).toBe(false)
  })
})

describe("Router across providers", () => {
  const claude = new FakeRuntime(() => ({ files: 1 }))
  const openai = new FakeRuntime(() => ({ files: 1 }), { provider: "openai" })
  const tiers = {
    strong: { provider: "anthropic", model: "claude-opus-5-5" },
    mid: { provider: "anthropic", model: "claude-sonnet-5-5" },
    fast: { provider: "openai", model: "gpt-6-luna" },
  } as const

  it("runs each tier on its own provider", () => {
    const router = new Router({ anthropic: claude, openai }, tiers)
    expect(router.resolve("mid").provider).toBe("anthropic")
    expect(router.resolve("fast")).toMatchObject({
      provider: "openai",
      model: "gpt-6-luna",
      fallbackReason: null,
    })
  })

  it("prefers a per-task override", () => {
    const router = new Router({ anthropic: claude, openai }, tiers, {
      walkthrough: { provider: "openai", model: "gpt-6.1-sol" },
    })
    expect(router.resolve("mid", "walkthrough")).toMatchObject({
      provider: "openai",
      model: "gpt-6.1-sol",
      fallbackReason: null,
    })
    expect(router.resolve("mid", "intent").model).toBe("claude-sonnet-5-5")
  })

  it("falls back to the other provider's default and says why", () => {
    const router = new Router({ openai }, tiers)
    const r = router.resolve("strong")
    expect(r).toMatchObject({ provider: "openai", model: "gpt-6-astra" })
    expect(r.fallbackReason).toContain("Claude isn't connected")
  })

  it("keeps pinned work on its provider", () => {
    const router = new Router({ openai }, tiers)
    expect(() =>
      router.resolve("mid", "conversation", undefined, "anthropic"),
    ).toThrow(/has to stay on it/)
  })

  it("schedules through the resolved runtime", async () => {
    const router = new Router({ anthropic: claude, openai }, tiers)
    const r = await runTask(
      router,
      new Scheduler(2),
      task({ modelTier: "fast" }),
      {
        signal: new AbortController().signal,
        budgetUsd: 1,
      },
    )
    expect(r.provider).toBe("openai")
    expect(openai.calls.at(-1)?.model).toBe("gpt-6-luna")
  })
})
