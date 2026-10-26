// AgentRuntime over the OpenAI Agents SDK and the Responses API (ADR 0006).
//
// Two ways to authenticate:
//  - An OpenAI API key, billed per token.
//  - "Continue with ChatGPT": an access token from OpenAI's sign-in for
//    open-source apps, which main keeps fresh and passes in. Used only for the
//    Responses API requests the program allows.
//
// Every tool is a Legible function tool. There are no hosted tools (web
// search, code interpreter, file search) and no shell, so the permission
// policy lives entirely in Legible's code. Tracing is off: nothing about a run
// is sent anywhere but the model request itself.

import type { ModelInfo, RuntimeStatus } from "@legible/domain"
import {
  Agent,
  MaxTurnsExceededError,
  type Model,
  ModelBehaviorError,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  OpenAIProvider,
  Runner,
  setTracingDisabled,
  tool,
} from "@openai/agents"
import OpenAI, { APIError } from "openai"
import { z } from "zod"

import { estimateCostUsd, findModel, MODEL_CATALOG } from "./catalog"
import { grantedTools, summarizeToolCall } from "./tools"
import {
  AgentError,
  type AgentResult,
  type AgentRuntime,
  type AgentTask,
  type OpenAIRuntimeConfig,
  type RunOptions,
} from "./types"

setTracingDisabled(true)

const UNPRICED = MODEL_CATALOG.filter(
  (m) => m.provider === "openai" && m.inputPrice !== null,
).reduce((a, b) => ((b.inputPrice ?? 0) > (a.inputPrice ?? 0) ? b : a))

/** Rough token count for a request, for projecting spend before it's sent. */
function estimateTokens(request: ModelRequest): number {
  const text =
    (request.systemInstructions ?? "") +
    (typeof request.input === "string"
      ? request.input
      : JSON.stringify(request.input))
  return Math.ceil(text.length / 4)
}

interface Meter {
  /** Throws when the next request would push spend past the cap. */
  before(request: ModelRequest): void
  after(response: ModelResponse): void
}

/** Wraps each model call to meter tokens and enforce the spend cap. */
class MeteredModel implements Model {
  constructor(
    private readonly inner: Model,
    private readonly meter: Meter,
  ) {}

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    this.meter.before(request)
    const response = await this.inner.getResponse(request)
    this.meter.after(response)
    return response
  }

  getStreamedResponse(request: ModelRequest) {
    this.meter.before(request)
    return this.inner.getStreamedResponse(request)
  }
}

class MeteredProvider implements ModelProvider {
  constructor(
    private readonly inner: ModelProvider,
    private readonly meter: Meter,
  ) {}

  async getModel(name?: string): Promise<Model> {
    return new MeteredModel(await this.inner.getModel(name), this.meter)
  }
}

export class OpenAIAgentsRuntime implements AgentRuntime {
  readonly provider = "openai" as const
  private listed: ModelInfo[] | null = null

  constructor(
    private readonly config: OpenAIRuntimeConfig,
    /** Tests: answers from a fake model instead of OpenAI. */
    private readonly modelProvider: ModelProvider | null = null,
  ) {}

  private client(): OpenAI | null {
    if (this.config.auth === "chatgpt") {
      const c = this.config.chatgpt
      if (!c) return null
      return new OpenAI({
        apiKey: c.accessToken,
        baseURL: c.baseURL,
        defaultHeaders: c.accountId
          ? { "ChatGPT-Account-Id": c.accountId }
          : {},
      })
    }
    return this.config.apiKey
      ? new OpenAI({ apiKey: this.config.apiKey })
      : null
  }

  private providerFor(): ModelProvider {
    if (this.modelProvider) return this.modelProvider
    const client = this.client()
    if (!client)
      throw new AgentError(
        this.config.auth === "chatgpt"
          ? "Sign in with ChatGPT in Settings → Providers."
          : "Add an OpenAI API key in Settings → Providers.",
        "auth",
      )
    return new OpenAIProvider({ openAIClient: client, useResponses: true })
  }

  async run<T>(
    task: AgentTask<T>,
    model: string,
    opts: RunOptions,
  ): Promise<AgentResult<T>> {
    if (task.access !== "read-only")
      throw new AgentError("Revision writes arrive in M4.", "execution")
    const started = Date.now()
    // A model the catalog doesn't price is metered at the dearest catalog price, so the cap still holds.
    const known = findModel("openai", model)
    const info = known?.inputPrice != null ? known : UNPRICED
    let inputTokens = 0
    let outputTokens = 0
    let turns = 0
    const spent = () => estimateCostUsd(info, inputTokens, outputTokens) ?? 0
    const capped = () =>
      Object.assign(
        new AgentError(
          `Stopped at the spend cap ($${opts.budgetUsd.toFixed(2)}). Raise it in Settings → Spend.`,
          "budget",
        ),
        { costUsd: spent() },
      )
    const meter: Meter = {
      before(request) {
        // Projected spend: what's spent plus this request's input. Output isn't knowable yet.
        const next =
          spent() + (estimateCostUsd(info, estimateTokens(request), 0) ?? 0)
        if (opts.budgetUsd > 0 && next > opts.budgetUsd) throw capped()
        opts.onEvent?.({
          type: "status",
          message: turns === 0 ? "Thinking" : "Reading the answers",
        })
      },
      after(response) {
        turns++
        inputTokens += response.usage.inputTokens
        outputTokens += response.usage.outputTokens
      },
    }

    const tools = grantedTools(task.tools).map((t) =>
      tool({
        name: t.name,
        description: t.description,
        parameters: z.object(t.input),
        strict: true,
        async execute(input) {
          const args = input as Record<string, unknown>
          opts.onEvent?.({
            type: "tool",
            name: t.name,
            summary: summarizeToolCall(t.name, args),
          })
          return t.handler(args as never, task.context)
        },
      }),
    )
    const agent = new Agent({
      name: "Legible",
      instructions: task.system,
      model,
      tools,
      ...(task.output ? { outputType: task.output as z.ZodObject } : {}),
      modelSettings: task.effort ? { reasoning: { effort: task.effort } } : {},
    })
    const runner = new Runner({
      modelProvider: new MeteredProvider(this.providerFor(), meter),
      tracingDisabled: true,
      traceIncludeSensitiveData: false,
    })

    opts.onEvent?.({ type: "status", message: "Starting OpenAI" })
    let finalOutput: unknown
    try {
      const result = await runner.run(agent, task.prompt, {
        maxTurns: task.maxTurns,
        signal: opts.signal,
      })
      finalOutput = result.finalOutput
    } catch (e) {
      throw Object.assign(this.classify(e, opts.signal), { costUsd: spent() })
    }

    const base = {
      text: typeof finalOutput === "string" ? finalOutput : "",
      provider: this.provider,
      model,
      costUsd: spent(),
      durationMs: Date.now() - started,
      inputTokens,
      outputTokens,
      numTurns: turns,
    }
    if (!task.output) return { ...base, output: null }
    const parsed = task.output.safeParse(finalOutput)
    if (!parsed.success)
      throw Object.assign(
        new AgentError(
          `OpenAI's answer didn't match the expected shape: ${parsed.error.message.slice(0, 300)}`,
          "structured_output",
        ),
        { costUsd: base.costUsd },
      )
    return { ...base, output: parsed.data }
  }

  private classify(e: unknown, signal: AbortSignal): AgentError {
    if (e instanceof AgentError) return e
    if (signal.aborted) return new AgentError("Cancelled", "aborted")
    if (e instanceof MaxTurnsExceededError)
      return new AgentError(
        "Stopped after too many steps without an answer.",
        "max_turns",
      )
    if (e instanceof ModelBehaviorError)
      return new AgentError(
        `OpenAI's answer didn't match the expected shape: ${e.message.slice(0, 300)}`,
        "structured_output",
      )
    if (e instanceof APIError && (e.status === 401 || e.status === 403))
      return new AgentError(
        this.config.auth === "chatgpt"
          ? "ChatGPT sign-in expired or isn't allowed for this request. Sign in again in Settings → Providers."
          : "OpenAI rejected the API key. Check it in Settings → Providers.",
        "auth",
      )
    const message = e instanceof Error ? e.message : String(e)
    return new AgentError(
      `OpenAI failed: ${message.split("\n")[0]?.slice(0, 300)}`,
      "execution",
    )
  }

  async status(): Promise<RuntimeStatus> {
    const auth = this.config.auth
    const base = {
      provider: this.provider,
      auth,
      executablePath: null,
      version: null,
    } as const
    if (this.modelProvider)
      return { ...base, ready: true, detail: "Test model provider" }
    const client = this.client()
    if (!client)
      return {
        ...base,
        ready: false,
        detail:
          auth === "chatgpt"
            ? "Not signed in with ChatGPT"
            : "No OpenAI API key yet",
      }
    try {
      await this.models(client)
      return {
        ...base,
        ready: true,
        detail:
          auth === "chatgpt"
            ? "Signed in with ChatGPT"
            : "OpenAI API key works",
      }
    } catch (e) {
      const status = e instanceof APIError ? e.status : null
      return {
        ...base,
        ready: false,
        detail:
          status === 401 || status === 403
            ? auth === "chatgpt"
              ? "ChatGPT sign-in expired. Sign in again."
              : "OpenAI rejected the API key."
            : `Couldn't reach OpenAI: ${(e as Error).message.slice(0, 200)}`,
      }
    }
  }

  /** The catalog's OpenAI models, plus any other GPT model the account lists, as experimental. */
  async models(client: OpenAI | null = this.client()): Promise<ModelInfo[]> {
    const curated = MODEL_CATALOG.filter((m) => m.provider === "openai")
    if (this.listed) return this.listed
    if (!client || this.config.auth === "chatgpt") return curated
    const ids: string[] = []
    for await (const m of client.models.list({ timeout: 10_000 }))
      ids.push(m.id)
    const extra = ids
      .filter((id) => /^gpt-\d/.test(id) && !curated.some((c) => c.id === id))
      .toSorted()
      .map((id): ModelInfo => ({
        provider: "openai",
        id,
        displayName: id,
        inputPrice: null,
        outputPrice: null,
        contextWindow: null,
        status: "experimental",
        structuredOutput: true,
        toolUse: true,
        costRank: 2,
        tiers: ["strong", "mid", "fast"],
      }))
    this.listed = [...curated, ...extra]
    return this.listed
  }
}
