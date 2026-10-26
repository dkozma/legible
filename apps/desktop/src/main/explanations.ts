// Explanation jobs: cache lookup, agent runs, progress events, persistence,
// and cost records.

import { randomUUID } from "node:crypto"

import { languageForPath, splitLines } from "@legible/diff"
import type {
  DiffChunk,
  Explanation,
  ExplanationJob,
  ExplanationTarget,
  Settings,
} from "@legible/domain"
import { targetLabel } from "@legible/domain"
import {
  describeConnections,
  EXPLANATION_PROMPT_VERSION,
  explanationCacheKey,
  type ExplanationOutput,
  toExplanationBody,
} from "@legible/pipelines"
import type { AgentRunRecord, Store } from "@legible/store"

import { type AgentHostClient, AgentRunError } from "./agentHostClient"
import type { ExplanationRunInput } from "./agentHostCore"
import { reportError } from "./errorReporting"
import type { Indexer } from "./indexerCore"
import { type ReviewService, UserError } from "./reviews"

/** Failures that describe the user's setup, not a bug. Still reported, at a lower level. */
const SETUP_CODES = new Set(["auth", "not_installed", "budget"])

/**
 * Reports a failed Explanation with what produced it: the model, the error
 * code, and the shape of the input. Never the code, the diff or the prompt.
 */
function reportExplanationFailure(
  err: Error,
  input: ExplanationRunInput,
  tier: { provider: string; model: string },
  startedAt: string,
) {
  const code = err instanceof AgentRunError ? err.code : "internal"
  const target = input.target
  reportError(err, {
    level: SETUP_CODES.has(code) ? "warning" : "error",
    tags: {
      task: "explanation",
      "agent.code": code,
      "agent.provider": tier.provider,
      "agent.model": tier.model,
      "file.language": input.file.language ?? "none",
      "file.status": input.file.status,
      "target.kind": target.kind,
    },
    extra: {
      baseLineCount: input.baseLines.length,
      headLineCount: input.headLines.length,
      selectedBaseLines:
        target.kind !== "file" && target.baseRange
          ? target.baseRange[1] - target.baseRange[0] + 1
          : null,
      selectedHeadLines:
        target.kind !== "file" && target.headRange
          ? target.headRange[1] - target.headRange[0] + 1
          : null,
      hasIntent: input.intent !== null,
      changedFileCount: input.changedFiles.length,
      durationMs: Date.now() - Date.parse(startedAt),
      costUsd: err instanceof AgentRunError ? err.costUsd : 0,
    },
    // The stack is the main process receiving the agent host's message; group by what failed.
    fingerprint: [
      "explanation",
      code,
      err.message.replace(/\d+/g, "N").slice(0, 120),
    ],
  })
}

export class ExplanationService {
  private jobs = new Map<
    string,
    ExplanationJob & { cacheKey: string; runId: string | null }
  >()

  constructor(
    private readonly store: Store,
    private readonly reviews: ReviewService,
    private readonly indexer: Indexer,
    private readonly host: AgentHostClient,
    private readonly getSettings: () => Promise<Settings>,
    private readonly emit: (job: ExplanationJob) => void,
  ) {}

  async request(
    reviewId: string,
    iterationId: string,
    target: ExplanationTarget,
    force: boolean,
  ): Promise<ExplanationJob> {
    const review = await this.reviews.summary(reviewId)
    const built = await this.reviews.built(reviewId, iterationId, false)
    const settings = await this.getSettings()
    const tier = settings.tasks.explanation ?? settings.tiers.fast
    const intent = await this.intentFor(review, iterationId, target)
    const base = {
      target,
      ...(await this.code(review, built, target)),
      intent,
      ...(await this.connectionContext(reviewId, iterationId, target)),
    }
    const cacheKey = explanationCacheKey(base, tier.provider, tier.model)
    const label = targetLabel(target)

    if (!force) {
      const cached = await this.store.getExplanation(cacheKey)
      if (cached) {
        const job: ExplanationJob = {
          jobId: randomUUID(),
          reviewId,
          target,
          label,
          status: "done",
          progress: null,
          error: null,
          explanation: cached,
          startedAt: new Date().toISOString(),
        }
        return job
      }
      for (const j of this.jobs.values()) {
        if (
          j.cacheKey === cacheKey &&
          (j.status === "queued" || j.status === "running")
        )
          return strip(j)
      }
    }

    const { repo } = await this.reviews.repoFor(review)
    const input: ExplanationRunInput = {
      ...base,
      repo: {
        gitDir: repo.gitDir,
        workTree: repo.workTree,
        env: (repo.env as Record<string, string> | undefined) ?? null,
      },
      baseSha: built.summary.baseSha,
      headSha: built.summary.headSha,
      changedFiles: built.summary.files.map((f) => ({
        path: f.path,
        oldPath: f.oldPath,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
      })),
    }

    const job: ExplanationJob & { cacheKey: string; runId: string | null } = {
      jobId: randomUUID(),
      reviewId,
      target,
      label,
      status: "queued",
      progress: "Waiting for Claude",
      error: null,
      explanation: null,
      startedAt: new Date().toISOString(),
      cacheKey,
      runId: null,
    }
    this.jobs.set(job.jobId, job)
    this.prune()
    this.emit(strip(job))

    const started = new Date().toISOString()
    const { runId, done } = this.host.runExplanation(
      input,
      settings.spend.explanationCapUsd,
      (e) => {
        const progress =
          e.type === "tool" ? e.summary : e.type === "status" ? e.message : null
        if (!progress && job.status === "running") return
        job.status = "running"
        if (progress) job.progress = progress
        this.emit(strip(job))
      },
    )
    job.runId = runId

    // Saving the Explanation and the run record is bookkeeping: if it fails (say the Review was
    // deleted mid-run), the job must still finish, or later requests would dedupe onto it forever.
    const record = (
      run: Omit<
        AgentRunRecord,
        "id" | "reviewId" | "taskKind" | "tier" | "startedAt" | "endedAt"
      >,
    ) =>
      this.store
        .recordRun({
          ...run,
          id: runId,
          reviewId,
          taskKind: "explanation",
          tier: "fast",
          startedAt: started,
          endedAt: new Date().toISOString(),
        })
        .catch(() => undefined)
    done
      .then(async (r) => {
        const explanation: Explanation = {
          id: randomUUID(),
          cacheKey,
          target,
          label,
          body: toExplanationBody(r.output as ExplanationOutput),
          provider: r.provider as Explanation["provider"],
          model: r.model,
          tier: r.tier ?? "fast",
          promptVersion: EXPLANATION_PROMPT_VERSION,
          costUsd: r.costUsd,
          durationMs: r.durationMs,
          createdAt: new Date().toISOString(),
          cached: false,
        }
        await this.store
          .saveExplanation(explanation, reviewId)
          .catch(() => undefined)
        await record({
          provider: explanation.provider,
          model: r.model,
          costUsd: r.costUsd,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          status: "done",
          error: null,
        })
        Object.assign(job, {
          status: "done",
          progress: r.fallbackReason,
          explanation,
        })
        this.emit(strip(job))
      })
      .catch(async (e: unknown) => {
        const err = e instanceof Error ? e : new Error(String(e))
        const cancelled = err instanceof AgentRunError && err.code === "aborted"
        await record({
          provider: tier.provider,
          model: tier.model,
          costUsd: err instanceof AgentRunError ? err.costUsd : 0,
          inputTokens: null,
          outputTokens: null,
          status: cancelled ? "cancelled" : "error",
          error: err.message,
        })
        Object.assign(job, {
          status: cancelled ? "cancelled" : "error",
          error: cancelled ? null : err.message,
          progress: null,
        })
        this.emit(strip(job))
        if (!cancelled) reportExplanationFailure(err, input, tier, started)
      })
    return strip(job)
  }

  /**
   * The Intent an Explanation is read against (engineering plan §9.4): the
   * Review's Intent, else the Pull Request description, plus the narrative of
   * the Step the code belongs to.
   */
  private async intentFor(
    review: Awaited<ReturnType<ReviewService["summary"]>>,
    iterationId: string,
    target: ExplanationTarget,
  ): Promise<{ title: string; body: string } | null> {
    const stored = await this.store.getIntent(review.id)
    const base = stored
      ? {
          title: stored.goal,
          body: stored.requirements
            .map((r) => `${r.id}: ${r.statement}`)
            .join("\n"),
        }
      : review.intentText
        ? splitIntent(review.intentText)
        : null
    const w = await this.store.getWalkthrough(review.id, iterationId)
    const range =
      target.kind === "file" ? null : (target.headRange ?? target.baseRange)
    const step = w?.steps.find((s) =>
      s.fragments.some(
        (f) =>
          f.fileId === target.fileId &&
          (!range ||
            [f.headRange, f.baseRange].some(
              (r) => r && r[0] <= range[1] && range[0] <= r[1],
            )),
      ),
    )
    if (!step) return base
    const note = `This code is part of the Step "${step.name}"${step.narrative ? `: ${step.narrative}` : "."}`
    return base
      ? { title: base.title, body: `${base.body}\n\n${note}`.trim() }
      : { title: step.name, body: note }
  }

  /** The lines an Explanation is about: the file's diff, or an unchanged file's text at Head. */
  private async code(
    review: Awaited<ReturnType<ReviewService["summary"]>>,
    built: Awaited<ReturnType<ReviewService["built"]>>,
    target: ExplanationTarget,
  ): Promise<
    Pick<ExplanationRunInput, "file" | "baseLines" | "headLines" | "chunks">
  > {
    if (target.fileId) {
      const file = built.summary.files.find((f) => f.id === target.fileId)
      const diff = built.diffs.get(target.fileId)
      if (!file || !diff)
        throw new UserError("That file is not part of this Change Set.")
      if (file.binary) throw new UserError("Binary files can't be explained.")
      return {
        file: {
          path: file.path,
          oldPath: file.oldPath,
          status: file.status,
          language: file.language,
        },
        baseLines: diff.baseLines,
        headLines: diff.headLines,
        chunks: diff.chunks,
      }
    }
    // A Symbol outside the Change Set: the same on both sides.
    const { repo } = await this.reviews.repoFor(review)
    const buf = await repo.blobs().readPath(built.summary.headSha, target.path)
    if (!buf) throw new UserError(`Can't read ${target.path} at Head.`)
    const lines = splitLines(buf.toString("utf8"))
    const all: DiffChunk = {
      kind: "equal",
      baseStart: 0,
      baseEnd: lines.length,
      headStart: 0,
      headEnd: lines.length,
    }
    return {
      file: {
        path: target.path,
        oldPath: null,
        status: "unchanged",
        language: languageForPath(target.path),
      },
      baseLines: lines,
      headLines: lines,
      chunks: [all],
    }
  }

  /** For Symbols and Connections: their Connection changes, and a Connection's target code. */
  private async connectionContext(
    reviewId: string,
    iterationId: string,
    target: ExplanationTarget,
  ): Promise<Pick<ExplanationRunInput, "connections" | "related">> {
    if (target.kind !== "symbol" && target.kind !== "connection") return {}
    const key = await this.reviews.indexKey(reviewId, iterationId)
    const id = target.kind === "symbol" ? target.symbolId : target.fromSymbolId
    const all = await this.indexer.connections(key, id)
    if (!all) throw new UserError("That Symbol isn't in the index any more.")
    const connections = describeConnections(
      all,
      target.kind === "connection" ? target.connectionId : null,
    )
    if (target.kind !== "connection" || !target.toSymbolId)
      return { connections, related: null }
    const src = await this.indexer.source(key, target.toSymbolId)
    return {
      connections,
      related: src
        ? {
            label: `\`${src.symbol.qualifiedName}\` (${src.symbol.path}:${src.firstLine})`,
            lines: src.lines,
          }
        : null,
    }
  }

  cancel(jobId: string) {
    const job = this.jobs.get(jobId)
    if (job?.runId) this.host.cancel(job.runId)
  }

  /** Keeps the most recent finished jobs; Explanations themselves live in the store. */
  private prune() {
    const finished = [...this.jobs.values()].filter(
      (j) => j.status !== "queued" && j.status !== "running",
    )
    for (const j of finished.slice(0, Math.max(0, finished.length - 50)))
      this.jobs.delete(j.jobId)
  }

  list(reviewId: string): ExplanationJob[] {
    return [...this.jobs.values()]
      .filter((j) => j.reviewId === reviewId)
      .map(strip)
  }
}

function strip(
  j: ExplanationJob & { cacheKey: string; runId: string | null },
): ExplanationJob {
  const { cacheKey: _k, runId: _r, ...rest } = j
  return { ...rest }
}

function splitIntent(text: string): { title: string; body: string } {
  const [title, ...rest] = text.split("\n")
  return { title: title ?? "", body: rest.join("\n").trim() }
}
