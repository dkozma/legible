// Resolves a task's Model Tier to a runtime and model, and schedules runs
// under a global concurrency cap with priority (engineering plan §8.4, §8.6).

import type {
  ModelTier,
  Provider,
  TaskKind,
  TierAssignment,
} from "@legible/domain"

import { findModel, providerDefault } from "./catalog"
import type { AgentResult, AgentRuntime, AgentTask, RunOptions } from "./types"

export type Priority = "interactive" | "foreground" | "background"
const PRIORITY_ORDER: Priority[] = ["interactive", "foreground", "background"]

export function priorityFor(kind: TaskKind): Priority {
  switch (kind) {
    case "explanation":
    case "question":
    case "conversation":
      return "interactive"
    case "change_request":
      return "foreground"
    default:
      return "background"
  }
}

export interface Resolution {
  runtime: AgentRuntime
  provider: Provider
  model: string
  /** Set when the configured model couldn't be used and another was. */
  fallbackReason: string | null
}

/** What a task needs from its model. */
export interface TaskNeeds {
  structuredOutput: boolean
  tools: boolean
}

const PROVIDER_NAME: Record<Provider, string> = {
  anthropic: "Claude",
  openai: "OpenAI",
}

/**
 * Resolves work to a connected runtime and model: a per-task override first,
 * then the tier's model. A model that can't do what the task needs, or a
 * provider that isn't connected, falls back to a default and says why.
 */
export class Router {
  constructor(
    private runtimes: Partial<Record<Provider, AgentRuntime>>,
    private tiers: Record<ModelTier, TierAssignment>,
    private tasks: Partial<Record<TaskKind, TierAssignment>> = {},
  ) {}

  update(
    runtimes: Partial<Record<Provider, AgentRuntime>>,
    tiers: Record<ModelTier, TierAssignment>,
    tasks: Partial<Record<TaskKind, TierAssignment>> = {},
  ) {
    this.runtimes = runtimes
    this.tiers = tiers
    this.tasks = tasks
  }

  get providers(): Provider[] {
    return (Object.keys(this.runtimes) as Provider[]).filter(
      (p) => this.runtimes[p],
    )
  }

  resolve(
    tier: ModelTier,
    kind: TaskKind | null = null,
    needs: TaskNeeds = { structuredOutput: false, tools: false },
    /** Keep a Conversation or a Change Request run on the provider it started on. */
    pinProvider: Provider | null = null,
  ): Resolution {
    const reasons: string[] = []
    const candidates: TierAssignment[] = []
    const override = kind ? this.tasks[kind] : undefined
    if (override) candidates.push(override)
    candidates.push(this.tiers[tier])
    // Then each connected provider's default, the configured provider's first.
    for (const p of [this.tiers[tier].provider, "anthropic", "openai"] as const)
      candidates.push(providerDefault(p, tier))

    for (const want of candidates) {
      if (pinProvider && want.provider !== pinProvider) continue
      const runtime = this.runtimes[want.provider]
      if (!runtime) {
        reasons.push(`${PROVIDER_NAME[want.provider]} isn't connected`)
        continue
      }
      // Models outside the catalog are allowed; they show as experimental in Settings.
      const info = findModel(want.provider, want.model)
      const missing =
        info &&
        ((needs.structuredOutput && !info.structuredOutput) ||
          (needs.tools && !info.toolUse))
      if (missing) {
        reasons.push(
          `${info.displayName} can't return structured answers with tools`,
        )
        continue
      }
      const first = candidates[0]
      const fell =
        first !== want &&
        !(first?.provider === want.provider && first.model === want.model)
      return {
        runtime,
        provider: want.provider,
        model: want.model,
        fallbackReason: fell
          ? `${dedupe(reasons).join("; ")}, so ${tier}-tier work uses ${want.model}.`
          : null,
      }
    }
    throw new Error(
      pinProvider
        ? `${PROVIDER_NAME[pinProvider]} isn't connected, and this work has to stay on it.`
        : `No connected provider can run ${tier}-tier work. Connect Claude or OpenAI in Settings → Providers.`,
    )
  }
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)]
}

interface Queued {
  priority: Priority
  seq: number
  provider: Provider
  start: () => void
}

/** Priority queue with a global cap and a per-provider cap. */
export class Scheduler {
  private running = 0
  private runningByProvider = new Map<Provider, number>()
  private queue: Queued[] = []
  private seq = 0

  constructor(
    private concurrency: number,
    private perProvider: number = concurrency,
  ) {}

  /** Rate limits are per provider, so one provider's backlog never takes every slot. */
  setConcurrency(n: number, perProvider: number = n) {
    this.concurrency = n
    this.perProvider = Math.min(n, perProvider)
    this.pump()
  }

  get stats() {
    return { running: this.running, queued: this.queue.length }
  }

  schedule<T>(
    priority: Priority,
    provider: Provider,
    signal: AbortSignal,
    fn: () => Promise<T>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const item: Queued = {
        priority,
        provider,
        seq: this.seq++,
        start: () => {
          this.running++
          this.runningByProvider.set(
            provider,
            (this.runningByProvider.get(provider) ?? 0) + 1,
          )
          fn()
            .then(resolve, reject)
            .finally(() => {
              this.running--
              this.runningByProvider.set(
                provider,
                (this.runningByProvider.get(provider) ?? 1) - 1,
              )
              this.pump()
            })
        },
      }
      if (signal.aborted) {
        reject(new Error("Cancelled"))
        return
      }
      signal.addEventListener(
        "abort",
        () => {
          const i = this.queue.indexOf(item)
          if (i >= 0) {
            this.queue.splice(i, 1)
            reject(new Error("Cancelled"))
          }
        },
        { once: true },
      )
      this.queue.push(item)
      this.queue.sort(
        (a, b) =>
          PRIORITY_ORDER.indexOf(a.priority) -
            PRIORITY_ORDER.indexOf(b.priority) || a.seq - b.seq,
      )
      this.pump()
    })
  }

  private pump() {
    while (this.running < this.concurrency) {
      const idx = this.queue.findIndex(
        (q) => (this.runningByProvider.get(q.provider) ?? 0) < this.perProvider,
      )
      if (idx < 0) return
      const [next] = this.queue.splice(idx, 1)
      next?.start()
    }
  }
}

/** Runs a task through the router and scheduler. */
export async function runTask<T>(
  router: Router,
  scheduler: Scheduler,
  task: AgentTask<T>,
  opts: RunOptions,
): Promise<AgentResult<T> & { fallbackReason: string | null }> {
  const r = router.resolve(task.modelTier, task.kind, {
    structuredOutput: task.output !== null,
    tools: task.tools.length > 0,
  })
  const result = await scheduler.schedule(
    priorityFor(task.kind),
    r.provider,
    opts.signal,
    () => r.runtime.run(task, r.model, opts),
  )
  return { ...result, fallbackReason: r.fallbackReason }
}
