// Resolves a task's Model Tier to a runtime and model, and schedules runs
// under a global concurrency cap with priority (engineering plan §8.4, §8.6).

import type { ModelTier, Provider, TierAssignment } from "@legible/domain"

import { DEFAULT_TIERS } from "./catalog"
import type {
  AgentResult,
  AgentRuntime,
  AgentTask,
  RunOptions,
  TaskKind,
} from "./types"

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
  /** Set when the configured model couldn't be used and the tier default was. */
  fallbackReason: string | null
}

export class Router {
  constructor(
    private runtimes: Partial<Record<Provider, AgentRuntime>>,
    private tiers: Record<ModelTier, TierAssignment>,
  ) {}

  update(
    runtimes: Partial<Record<Provider, AgentRuntime>>,
    tiers: Record<ModelTier, TierAssignment>,
  ) {
    this.runtimes = runtimes
    this.tiers = tiers
  }

  resolve(tier: ModelTier): Resolution {
    const want = this.tiers[tier]
    const runtime = this.runtimes[want.provider]
    // Models outside the catalog are allowed; they show as experimental in Settings.
    if (runtime)
      return {
        runtime,
        provider: want.provider,
        model: want.model,
        fallbackReason: null,
      }
    const fallback = DEFAULT_TIERS[tier]
    const fr = this.runtimes[fallback.provider]
    if (!fr)
      throw new Error(
        `No connected provider can run ${tier}-tier work. Connect Claude in Settings → Providers.`,
      )
    return {
      runtime: fr,
      provider: fallback.provider,
      model: fallback.model,
      fallbackReason: `${want.provider} isn't connected, so ${tier}-tier work uses ${fallback.model}.`,
    }
  }
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

  setConcurrency(n: number) {
    this.concurrency = n
    this.perProvider = n
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
  const r = router.resolve(task.modelTier)
  const result = await scheduler.schedule(
    priorityFor(task.kind),
    r.provider,
    opts.signal,
    () => r.runtime.run(task, r.model, opts),
  )
  return { ...result, fallbackReason: r.fallbackReason }
}
