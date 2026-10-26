// The agent host: runs agent tasks and judgments away from the main process so
// a crashed or busy agent never blocks IPC, the database or windows. This
// module is the transport-independent core; agentHost.ts wires it to a
// utilityProcess.

import {
  type AgentEvent,
  type AgentRuntime,
  type AgentTask,
  type ClaudeRuntimeConfig,
  ClaudeSdkRuntime,
  FakeRuntime,
  OpenAIAgentsRuntime,
  type OpenAIRuntimeConfig,
  Router,
  runTask,
  Scheduler,
  type ToolContext,
} from "@legible/agent-runtime"
import type {
  DiffChunk,
  DomainChange,
  ExplanationTarget,
  FileChange,
  ModelTier,
  Provider,
  RuntimeStatus,
  TaskKind,
  TierAssignment,
} from "@legible/domain"
import { GitRepo } from "@legible/git"
import {
  DecisionsBackend,
  FastTierBackend,
  JevBackend,
  Judge,
  type JudgeBackend,
  type JudgeRequest,
  type JudgeResult,
} from "@legible/judge"
import {
  type DomainChangesInput,
  domainChangesTask,
  explanationTask,
  type FragmentText,
  gapTask,
  type IntentInput,
  intentTask,
  type PlannerInput,
  plannerTask,
} from "@legible/pipelines"

import { fakeAnswer, fakeFailure } from "./fakeAgent"

export interface HostConfig {
  /** Null when Claude is turned off. */
  claude: ClaudeRuntimeConfig | null
  /** Null until OpenAI is connected. */
  openai: OpenAIRuntimeConfig | null
  tiers: Record<ModelTier, TierAssignment>
  tasks: Partial<Record<TaskKind, TierAssignment>>
  concurrency: number
  /** External Judge backends in the user's order; empty = the fast tier judges. */
  judge: (
    | { name: "jev"; apiKey: string; model: string }
    | { name: "decisions"; apiKey: string }
  )[]
  /**
   * Canned answers instead of a real model (tests, demos). "fail" answers
   * every run with the structured-output error real runs can hit.
   */
  fake: false | "answer" | "fail"
}

/** What a task's tools read: a repository at two commits. Plain data, so it crosses the process boundary. */
export interface WireContext {
  repo: {
    gitDir: string
    workTree: string | null
    env: Record<string, string> | null
  }
  baseSha: string
  headSha: string
  changedFiles: ToolContext["changedFiles"]
}

export interface ExplanationRunInput extends WireContext {
  target: ExplanationTarget
  file: Pick<FileChange, "path" | "oldPath" | "language"> & {
    status: FileChange["status"] | "unchanged"
  }
  baseLines: string[]
  headLines: string[]
  chunks: DiffChunk[]
  intent: { title: string; body: string } | null
  connections?: string[]
  related?: { label: string; lines: string[] } | null
}

/** Planner and Domain Change inputs carry Fragment text as a record, not a Map. */
type Wire<T> = Omit<T, "text"> & { text: Record<string, FragmentText> }

/** Every pipeline the host runs: its input and its answer. */
export interface Pipelines {
  explanation: { input: ExplanationRunInput; output: unknown }
  intent: { input: WireContext & { intent: IntentInput }; output: unknown }
  walkthrough: {
    input: WireContext & { planner: Wire<PlannerInput> }
    output: unknown
  }
  domain_changes: {
    input: WireContext & { changes: Wire<DomainChangesInput> }
    output: unknown
  }
  description_gap: {
    input: WireContext & {
      description: { title: string; body: string }
      missing: Pick<DomainChange, "statement" | "before" | "after">[]
    }
    output: unknown
  }
  judge: {
    input: WireContext & { request: JudgeRequest }
    output: JudgeResult
  }
}
export type PipelineName = keyof Pipelines

export type ToHost =
  | { type: "configure"; config: HostConfig }
  | {
      type: "run"
      runId: string
      pipeline: PipelineName
      input: unknown
      budgetUsd: number
    }
  | { type: "cancel"; runId: string }
  | { type: "status"; reqId: string; provider: Provider }

export interface RunResultMessage {
  output: unknown
  /** "typesafe" for a Jev judgment. */
  provider: string
  model: string
  tier: ModelTier | null
  costUsd: number
  durationMs: number
  inputTokens: number
  outputTokens: number
  fallbackReason: string | null
}

export type FromHost =
  | { type: "event"; runId: string; event: AgentEvent }
  | { type: "result"; runId: string; result: RunResultMessage }
  | {
      type: "error"
      runId: string
      message: string
      code: string
      costUsd: number
    }
  | { type: "status"; reqId: string; status: RuntimeStatus }

const toMap = <T>(r: Record<string, T>) => new Map(Object.entries(r))

/** The agent task for each pipeline but the Judge. */
const TASKS: {
  [P in Exclude<PipelineName, "judge">]: (
    input: Pipelines[P]["input"],
    context: ToolContext,
  ) => AgentTask<unknown>
} = {
  explanation: (i, context) => explanationTask({ ...i, context }),
  intent: (i, context) => intentTask(i.intent, context),
  walkthrough: (i, context) =>
    plannerTask({ ...i.planner, text: toMap(i.planner.text) }, context),
  domain_changes: (i, context) =>
    domainChangesTask({ ...i.changes, text: toMap(i.changes.text) }, context),
  description_gap: (i, context) => gapTask(i.description, i.missing, context),
}

function notConfigured(provider: Provider, detail: string): RuntimeStatus {
  return {
    provider,
    auth: provider === "openai" ? "api-key" : "claude-code",
    ready: false,
    detail,
    executablePath: null,
    version: null,
  }
}

export function createAgentHost(post: (m: FromHost) => void) {
  let config: HostConfig | null = null
  let runtimes: Partial<Record<Provider, AgentRuntime>> = {}
  let router: Router | null = null
  const scheduler = new Scheduler(6)
  const runs = new Map<string, AbortController>()
  const repos = new Map<string, GitRepo>()

  const repoFor = (r: WireContext["repo"]) => {
    const key = `${r.gitDir}\0${JSON.stringify(r.env ?? {})}`
    let repo = repos.get(key)
    if (!repo) {
      repo = GitRepo.at(r.gitDir, r.workTree, r.env ?? undefined)
      repos.set(key, repo)
    }
    return repo
  }
  const contextOf = (i: WireContext): ToolContext => ({
    repo: repoFor(i.repo),
    baseSha: i.baseSha,
    headSha: i.headSha,
    changedFiles: i.changedFiles,
  })

  function judgeFor(
    context: ToolContext,
    signal: AbortSignal,
    budgetUsd: number,
  ) {
    const backends: JudgeBackend[] = (config?.judge ?? []).map((b) =>
      b.name === "jev"
        ? new JevBackend(b.apiKey, b.model)
        : new DecisionsBackend(b.apiKey),
    )
    // Batches share the request's budget.
    let spent = 0
    const fast = new FastTierBackend(async <T>(task: AgentTask<T>) => {
      const r = await runTask(router as Router, scheduler, task, {
        signal,
        budgetUsd: Math.max(0.001, budgetUsd - spent),
      })
      spent += r.costUsd
      return r
    }, context)
    return new Judge(backends, fast)
  }

  async function run(m: Extract<ToHost, { type: "run" }>) {
    if (!router || !config) throw new Error("Agent host is not configured")
    const abort = new AbortController()
    runs.set(m.runId, abort)
    try {
      const input = m.input as WireContext
      const context = contextOf(input)
      if (m.pipeline === "judge") {
        const started = Date.now()
        const req = (m.input as Pipelines["judge"]["input"]).request
        const r = await judgeFor(context, abort.signal, m.budgetUsd).judge(
          req,
          {
            signal: abort.signal,
          },
        )
        post({
          type: "result",
          runId: m.runId,
          result: {
            output: r,
            provider:
              r.backend === "jev"
                ? "typesafe"
                : r.backend === "decisions"
                  ? "openai"
                  : router.resolve("fast", "judgment").provider,
            model: r.model,
            tier: r.backend === "fast" ? "fast" : null,
            costUsd: r.costUsd ?? 0,
            durationMs: Date.now() - started,
            inputTokens: r.inputTokens,
            outputTokens: r.outputTokens,
            fallbackReason: r.fallbackReason,
          },
        })
        return
      }
      const build = TASKS[m.pipeline] as (
        i: unknown,
        c: ToolContext,
      ) => AgentTask<unknown>
      const task = build(m.input, context)
      const r = await runTask(router, scheduler, task, {
        signal: abort.signal,
        budgetUsd: m.budgetUsd,
        onEvent: (event) => post({ type: "event", runId: m.runId, event }),
      })
      post({
        type: "result",
        runId: m.runId,
        result: {
          output: r.output,
          provider: r.provider,
          model: r.model,
          tier: task.modelTier,
          costUsd: r.costUsd,
          durationMs: r.durationMs,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          fallbackReason: r.fallbackReason,
        },
      })
    } catch (e) {
      const err = e as Error & { code?: string; costUsd?: number }
      post({
        type: "error",
        runId: m.runId,
        message: abort.signal.aborted ? "Cancelled" : err.message,
        code: abort.signal.aborted ? "aborted" : (err.code ?? "execution"),
        costUsd: err.costUsd ?? 0,
      })
    } finally {
      runs.delete(m.runId)
    }
  }

  async function handle(m: ToHost) {
    switch (m.type) {
      case "configure": {
        config = m.config
        const c = m.config
        runtimes = {}
        if (c.fake) {
          const respond = c.fake === "fail" ? fakeFailure : fakeAnswer
          runtimes.anthropic = new FakeRuntime(respond, { delayMs: 600 })
          if (c.openai)
            runtimes.openai = new FakeRuntime(respond, {
              delayMs: 600,
              provider: "openai",
            })
        } else {
          if (c.claude) runtimes.anthropic = new ClaudeSdkRuntime(c.claude)
          if (c.openai) runtimes.openai = new OpenAIAgentsRuntime(c.openai)
        }
        router = new Router(runtimes, c.tiers, c.tasks)
        // Half the slots per provider, so one provider's backlog never starves the other.
        const both = Boolean(runtimes.anthropic && runtimes.openai)
        scheduler.setConcurrency(
          c.concurrency,
          both ? Math.max(1, Math.ceil(c.concurrency / 2)) : c.concurrency,
        )
        return
      }
      case "status": {
        const runtime = runtimes[m.provider]
        if (!runtime) {
          post({
            type: "status",
            reqId: m.reqId,
            status: notConfigured(
              m.provider,
              config ? "Not connected" : "Not configured",
            ),
          })
          return
        }
        try {
          post({
            type: "status",
            reqId: m.reqId,
            status: await runtime.status(),
          })
        } catch (e) {
          post({
            type: "status",
            reqId: m.reqId,
            status: notConfigured(
              m.provider,
              `Couldn't check ${m.provider === "openai" ? "OpenAI" : "Claude"}: ${(e as Error).message}`,
            ),
          })
        }
        return
      }
      case "cancel":
        runs.get(m.runId)?.abort()
        return
      case "run":
        await run(m)
        return
    }
  }

  return {
    handle: (m: ToHost) => {
      handle(m).catch((e: unknown) => {
        if (m.type === "run")
          post({
            type: "error",
            runId: m.runId,
            message: (e as Error).message,
            code: "execution",
            costUsd: 0,
          })
      })
    },
    dispose() {
      for (const a of runs.values()) a.abort()
      for (const r of repos.values()) r.close()
    },
  }
}
