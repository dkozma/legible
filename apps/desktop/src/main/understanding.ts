// Understanding: builds a Review's Intent, an Iteration's Walkthrough, its
// Scope and Risk, and its Change Brief (engineering plan §9.1–9.3), in that
// order. Stages already built are reused; a build resumes where it stopped.
// Every agent run is recorded with the provider and model that actually ran
// it, and one spend cap covers an Iteration's whole build.

import { createHash } from "node:crypto"
import { homedir } from "node:os"
import { join } from "node:path"

import type {
  ChangeBrief,
  DomainChange,
  FileChange,
  FragmentGraph,
  Intent,
  IntentSource,
  ReviewSummary,
  Settings,
  StepEdit,
  TranscriptCandidate,
  UnderstandingStage,
  UnderstandingStatus,
  Walkthrough,
} from "@legible/domain"
import { getIssue, parsePullRequestUrl } from "@legible/hosts"
import type { JudgeRequest, JudgeResult } from "@legible/judge"
import {
  applyJudged,
  assembleBrief,
  assembleWalkthrough,
  clusterFragments,
  componentMap,
  descriptionRequest,
  detectRiskAreas,
  type DomainChangesOutput,
  editWalkthrough,
  EditError,
  type FoundTranscript,
  findTranscripts,
  type FragmentText,
  fragmentText,
  hasSources,
  howToTestFromDescription,
  type IntentInput,
  type IntentOutput,
  intentPrompt,
  keepSteps,
  linkedIssues,
  type PlannerFragment,
  plannerCacheKey,
  plannerFragments,
  type PlannerOutput,
  readDescription,
  readUnderstanding,
  type RiskArea,
  toDomainChanges,
  toRequirements,
  understandingRequest,
  WALKTHROUGH_PROMPT_VERSION,
} from "@legible/pipelines"
import type { AgentRunRecord, Store } from "@legible/store"
import type { BuiltChangeSet } from "@legible/indexer"

import { type AgentHostClient, AgentRunError } from "./agentHostClient"
import type {
  PipelineName,
  Pipelines,
  RunResultMessage,
  WireContext,
} from "./agentHostCore"
import type { HostService } from "./hosts"
import type { Indexer } from "./indexerCore"
import { type ReviewService, UserError } from "./reviews"

const STAGES: UnderstandingStage[] = ["intent", "walkthrough", "scope", "brief"]

/** What to rebuild even when it's already built. */
export type Rebuild = "none" | "all" | "intent" | "walkthrough" | "brief"

const TASK_OF: Record<PipelineName, string> = {
  explanation: "explanation",
  intent: "intent",
  walkthrough: "walkthrough",
  domain_changes: "domain_changes",
  description_gap: "wording",
  judge: "judgment",
}

interface Prep {
  built: BuiltChangeSet
  graph: FragmentGraph | null
  fragments: PlannerFragment[]
  byId: Map<string, PlannerFragment>
  text: Map<string, FragmentText>
  context: WireContext
}

interface Job {
  status: UnderstandingStatus
  abort: AbortController
  runIds: Set<string>
  prep: Promise<Prep> | null
  /** A stage failed; the build goes on, and ends in "error". */
  failed: boolean
}

/** A copy of a job's status: stages are updated in place, and listeners keep what they're sent. */
const snapshot = (job: Job): UnderstandingStatus => structuredClone(job.status)

const sha = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex")

function splitIntent(text: string): { title: string; body: string } {
  const [title, ...rest] = text.split("\n")
  return { title: title ?? "", body: rest.join("\n").trim() }
}

/** Steps grouped by file, for when no model can plan: the Walkthrough still works. */
function fallbackPlan(fragments: PlannerFragment[]): PlannerOutput["steps"] {
  const byFile = new Map<string, PlannerFragment[]>()
  for (const f of fragments) {
    const list = byFile.get(f.path) ?? []
    list.push(f)
    byFile.set(f.path, list)
  }
  return [...byFile.entries()].map(([path, list]) => ({
    name: path.split("/").pop() ?? path,
    narrative: "",
    layer: list[0]?.layerHint ?? "backend",
    feature: "",
    fragments: list.map((f) => f.alias),
  }))
}

export class UnderstandingService {
  private jobs = new Map<string, Job>()
  /** Agent Transcripts found per Review, kept for the Intent stage. */
  private sessions = new Map<string, FoundTranscript[]>()

  constructor(
    private readonly store: Store,
    private readonly reviews: ReviewService,
    private readonly indexer: Indexer,
    private readonly host: AgentHostClient,
    private readonly hosts: HostService,
    private readonly getSettings: () => Promise<Settings>,
    private readonly emit: (s: UnderstandingStatus) => void,
    /** Opt-in error reports (ADR 0013): the stage and error code, never content. */
    private readonly report: (
      e: Error,
      stage: UnderstandingStage,
      code: string,
    ) => void = () => undefined,
  ) {}

  private key = (reviewId: string, iterationId: string) =>
    `${reviewId}:${iterationId}`

  // ---- Status and control ---------------------------------------------------------

  async status(
    reviewId: string,
    iterationId: string,
  ): Promise<UnderstandingStatus> {
    const job = this.jobs.get(this.key(reviewId, iterationId))
    if (job) return snapshot(job)
    const [intent, w, brief] = await Promise.all([
      this.store.getIntent(reviewId),
      this.store.getWalkthrough(reviewId, iterationId),
      this.store.getBrief(reviewId, iterationId),
    ])
    const state = (built: boolean): "done" | "pending" =>
      built ? "done" : "pending"
    // What failed last time is saved with what it left behind.
    const planError = w?.fallbackReason ?? null
    const briefError = brief?.domainChangesError ?? null
    return {
      reviewId,
      iterationId,
      state: brief ? (planError || briefError ? "error" : "done") : "idle",
      stages: {
        intent: { state: state(Boolean(intent)), detail: null },
        walkthrough: planError
          ? { state: "error", detail: planError }
          : { state: state(Boolean(w)), detail: null },
        scope: { state: state(Boolean(brief)), detail: null },
        brief: briefError
          ? { state: "error", detail: briefError }
          : { state: state(Boolean(brief)), detail: null },
      },
      progress: null,
      error: planError ?? briefError,
      costUsd: brief?.costUsd ?? 0,
    }
  }

  /** Builds whatever is missing (or asked for), in the background. */
  async run(
    reviewId: string,
    iterationId: string,
    rebuild: Rebuild,
  ): Promise<UnderstandingStatus> {
    const k = this.key(reviewId, iterationId)
    const running = this.jobs.get(k)
    if (running && running.status.state === "running")
      return { ...running.status }
    const job: Job = {
      status: {
        reviewId,
        iterationId,
        state: "running",
        stages: Object.fromEntries(
          STAGES.map((s) => [s, { state: "pending", detail: null }]),
        ) as UnderstandingStatus["stages"],
        progress: "Starting",
        error: null,
        costUsd: 0,
      },
      abort: new AbortController(),
      runIds: new Set(),
      prep: null,
      failed: false,
    }
    this.jobs.set(k, job)
    this.emit(snapshot(job))
    void this.build(job, rebuild).finally(() => {
      // A newer run (after a cancel) owns the status now.
      if (this.jobs.get(k) !== job) return
      if (job.status.state === "running")
        job.status.state = job.failed ? "error" : "done"
      job.status.progress = null
      this.emit(snapshot(job))
      this.jobs.delete(k)
    })
    return snapshot(job)
  }

  cancel(reviewId: string, iterationId: string) {
    const job = this.jobs.get(this.key(reviewId, iterationId))
    if (!job) return
    job.abort.abort()
    for (const id of job.runIds) this.host.cancel(id)
    job.status.state = "cancelled"
    this.emit(snapshot(job))
  }

  private stage(
    job: Job,
    s: UnderstandingStage,
    state: UnderstandingStatus["stages"][UnderstandingStage]["state"],
    detail: string | null = null,
  ) {
    job.status.stages[s] = { state, detail }
    if (state === "running") job.status.progress = detail
    if (state === "error" && !job.status.error) job.status.error = detail
    this.emit(snapshot(job))
  }

  // ---- Agent runs ---------------------------------------------------------------------

  private async agent<P extends PipelineName>(
    job: Job,
    pipeline: P,
    input: Pipelines[P]["input"],
    share = 1,
  ): Promise<RunResultMessage & { output: Pipelines[P]["output"] }> {
    if (job.abort.signal.aborted)
      throw new AgentRunError("Cancelled", "aborted", 0)
    const settings = await this.getSettings()
    const cap = settings.spend.understandingCapUsd
    const left = cap - job.status.costUsd
    if (left <= 0.001)
      throw new AgentRunError(
        `Reached the spend cap for this Change Set ($${cap.toFixed(2)}). Raise it in Settings → Spend.`,
        "budget",
        0,
      )
    const startedAt = new Date().toISOString()
    const { runId, done } = this.host.run(
      pipeline,
      input,
      left * share,
      (e) => {
        const line =
          e.type === "tool" ? e.summary : e.type === "status" ? e.message : null
        if (line && job.status.progress !== line) {
          job.status.progress = line
          this.emit(snapshot(job))
        }
      },
    )
    job.runIds.add(runId)
    const record = (r: Partial<AgentRunRecord>) =>
      this.store
        .recordRun({
          id: runId,
          reviewId: job.status.reviewId,
          taskKind: TASK_OF[pipeline],
          provider: "anthropic",
          model: "unknown",
          tier: null,
          startedAt,
          endedAt: new Date().toISOString(),
          costUsd: 0,
          inputTokens: null,
          outputTokens: null,
          status: "done",
          error: null,
          ...r,
        })
        .catch(() => undefined)
    try {
      const r = await done
      job.status.costUsd += r.costUsd
      await record({
        provider: r.provider as AgentRunRecord["provider"],
        model: r.model,
        tier: r.tier,
        costUsd: r.costUsd,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
      })
      return r
    } catch (e) {
      const err = e instanceof AgentRunError ? e : null
      job.status.costUsd += err?.costUsd ?? 0
      const configured = settings.tasks[TASK_OF[pipeline] as never] as
        | { provider: AgentRunRecord["provider"]; model: string }
        | undefined
      await record({
        provider: configured?.provider ?? "anthropic",
        model: configured?.model ?? "unknown",
        costUsd: err?.costUsd ?? 0,
        status: err?.code === "aborted" ? "cancelled" : "error",
        error: (e as Error).message,
      })
      throw e
    } finally {
      job.runIds.delete(runId)
    }
  }

  private async judge(
    job: Job,
    context: WireContext,
    request: JudgeRequest,
  ): Promise<JudgeResult | null> {
    if (!request.judgments.length) return null
    const r = await this.agent(job, "judge", { ...context, request }, 0.5)
    return r.output
  }

  // ---- Prep ----------------------------------------------------------------------------

  private prep(job: Job): Promise<Prep> {
    job.prep ??= (async () => {
      const { reviewId, iterationId } = job.status
      const review = await this.reviews.summary(reviewId)
      const built = await this.reviews.built(reviewId, iterationId, false)
      const key = await this.reviews.indexKey(reviewId, iterationId)
      const graph = await this.indexer
        .fragmentGraph(key, built.summary.files)
        .catch(() => null)
      const fragments = plannerFragments(built.summary.files, graph)
      const text = new Map<string, FragmentText>()
      for (const f of fragments) {
        const d = built.diffs.get(f.fileId)
        if (d) text.set(f.fragmentId, fragmentText(f, d.baseLines, d.headLines))
      }
      const { repo } = await this.reviews.repoFor(review)
      return {
        built,
        graph,
        fragments,
        byId: new Map(fragments.map((f) => [f.fragmentId, f])),
        text,
        context: {
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
        },
      }
    })()
    return job.prep
  }

  // ---- The build ------------------------------------------------------------------------

  private async build(job: Job, rebuild: Rebuild) {
    const { reviewId, iterationId } = job.status
    const fail = (s: UnderstandingStage, e: unknown) => {
      if (job.abort.signal.aborted) return
      const err = e instanceof Error ? e : new Error(String(e))
      this.stage(job, s, "error", err.message)
      job.failed = true
      this.report(err, s, err instanceof AgentRunError ? err.code : "internal")
    }
    try {
      // The cap covers the Iteration across rebuilds: start from what its saved build spent.
      const [savedW, savedBrief] = await Promise.all([
        this.store.getWalkthrough(reviewId, iterationId),
        this.store.getBrief(reviewId, iterationId),
      ])
      job.status.costUsd = savedBrief?.costUsd ?? savedW?.costUsd ?? 0
      const review = await this.reviews.summary(reviewId)
      const prep = await this.prep(job)

      // 1. Intent: per Review, rebuilt only when its sources change.
      let intent: Intent | null = null
      try {
        this.stage(job, "intent", "running", "Reading the Intent")
        intent = await this.intentStage(job, review, prep, rebuild)
        this.stage(
          job,
          "intent",
          "done",
          intent?.inferred ? "Inferred from the code" : null,
        )
      } catch (e) {
        intent = await this.store.getIntent(reviewId)
        fail("intent", e)
      }
      if (job.abort.signal.aborted) return

      // 2. Walkthrough.
      let w = await this.store.getWalkthrough(reviewId, iterationId)
      if (!w || rebuild === "all" || rebuild === "walkthrough") {
        this.stage(job, "walkthrough", "running", "Planning the Walkthrough")
        w = await this.walkthroughStage(job, review, prep, intent)
        if (job.abort.signal.aborted) return
        await this.store.saveWalkthrough(w)
        this.stage(
          job,
          "walkthrough",
          w.fallbackReason ? "error" : "done",
          w.fallbackReason,
        )
        if (w.fallbackReason) job.failed = true
      } else this.stage(job, "walkthrough", "done")
      if (job.abort.signal.aborted) return

      // 3–4. Scope, Risk and the Brief, rebuilt with the Walkthrough or the Intent.
      const brief = await this.store.getBrief(reviewId, iterationId)
      if (brief && rebuild === "none") {
        this.stage(job, "scope", "done")
        this.stage(job, "brief", "done")
        return
      }
      let uncovered: string[] = []
      const scoped =
        intent && (!intent.inferred || intent.confirmed) ? intent : null
      try {
        this.stage(job, "scope", "running", "Judging Scope and Risk")
        const detected = new Map<string, RiskArea[]>(
          w.steps.map((s) => [s.id, detectRiskAreas(s, prep.byId, prep.text)]),
        )
        const req = understandingRequest(scoped, w.steps, prep.byId, detected)
        const judged = await this.judge(job, prep.context, req)
        const read = judged
          ? readUnderstanding(
              w.steps,
              scoped,
              detected,
              judged.answers,
              judged.backend,
            )
          : null
        uncovered = read?.uncovered ?? []
        w = applyJudged(w, read, detected, prep.byId)
        if (job.abort.signal.aborted) return
        await this.store.saveWalkthrough(w)
        this.stage(
          job,
          "scope",
          "done",
          judged?.fallbackReason ??
            (scoped ? null : "Confirm the Intent to tag Scope"),
        )
      } catch (e) {
        fail("scope", e)
      }
      if (job.abort.signal.aborted) return

      this.stage(job, "brief", "running", "Finding Domain Changes")
      let briefError: string | null = null
      const next = await this.briefStage(
        job,
        review,
        prep,
        intent,
        w,
        uncovered,
      ).catch((e: unknown) => {
        fail("brief", e)
        briefError = e instanceof Error ? e.message : String(e)
        return null
      })
      if (job.abort.signal.aborted) return
      // Even without Domain Changes, the Brief shows the map, Risk and Sittings, and says what failed.
      await this.store.saveBrief(
        next ??
          assembleBrief({
            walkthrough: w,
            files: prep.built.summary.files,
            domainChanges: [],
            gapSuggestion: null,
            hasDescription: review.sourceKind === "pull_request",
            uncoveredRequirementIds: uncovered,
            howToTestFromSource: intent?.howToTest ?? [],
            howToTestSuggested: [],
            domainChangesError: briefError,
            costUsd: job.status.costUsd,
          }),
      )
      if (next) this.stage(job, "brief", "done")
    } catch (e) {
      if (!job.abort.signal.aborted) {
        job.failed = true
        job.status.error = e instanceof Error ? e.message : String(e)
      }
    }
  }

  private async intentStage(
    job: Job,
    review: ReviewSummary,
    prep: Prep,
    rebuild: Rebuild,
  ): Promise<Intent | null> {
    const existing = await this.store.getIntent(review.id)
    // The user's own Intent is never regenerated.
    if (existing && existing.sourceKey === null) return existing

    const pr =
      review.sourceKind === "pull_request" && review.intentText
        ? splitIntent(review.intentText)
        : null
    const sources: IntentSource[] = []
    if (pr)
      sources.push({
        kind: "pull_request",
        label: `Pull Request #${review.prNumber ?? ""} description`.trim(),
        ref: review.prUrl,
      })
    const linked = pr
      ? await this.linkedIssues(review, pr.body)
      : { issues: [], failed: false }
    // An issue that couldn't be fetched this time isn't a change of sources.
    if (linked.failed && existing && rebuild !== "all" && rebuild !== "intent")
      return existing
    const issues = linked.issues
    for (const i of issues)
      sources.push({ kind: "issue", label: i.title, ref: i.url })
    const found = await this.findSessions(review)
    const choices = await this.store.transcriptChoices(review.id)
    const chosen = found.filter((f) => choices.get(f.session.id) ?? f.likely)
    for (const f of chosen) {
      const s = f.session
      sources.push({
        kind: "transcript",
        label: `${s.tool === "codex" ? "Codex" : "Claude Code"} session · ${s.prompts.length} ${s.prompts.length === 1 ? "prompt" : "prompts"}${s.corrections.length ? `, ${s.corrections.length} ${s.corrections.length === 1 ? "correction" : "corrections"}` : ""}`,
        ref: s.id,
      })
    }
    const input: IntentInput = {
      pullRequest: pr ? { ...pr, url: review.prUrl } : null,
      issues,
      transcripts: chosen.map((f) => ({
        label: f.session.tool === "codex" ? "Codex" : "Claude Code",
        prompts: f.session.prompts,
        plans: f.session.plans,
        corrections: f.session.corrections,
      })),
      userText: null,
      changeSummary: prep.context.changedFiles
        .map((f) => `${f.status} ${f.path} (+${f.additions} −${f.deletions})`)
        .join("\n"),
    }
    const inferred = !hasSources(input)
    // An Inferred Intent depends on the code; a sourced one only on its sources.
    const sourceKey = sha(
      inferred ? intentPrompt(input) : { ...input, changeSummary: "" },
    )
    if (
      existing &&
      existing.sourceKey === sourceKey &&
      rebuild !== "all" &&
      rebuild !== "intent"
    )
      return existing

    const r = await this.agent(job, "intent", {
      ...prep.context,
      intent: input,
    })
    const out = r.output as IntentOutput
    const intent: Intent = {
      reviewId: review.id,
      goal: out.goal.trim(),
      requirements: toRequirements(out.requirements),
      sources: inferred
        ? [{ kind: "inferred", label: "Inferred from the code", ref: null }]
        : sources,
      inferred,
      confirmed: false,
      corrections: chosen
        .flatMap((f) => f.session.corrections)
        .map((c) => (c.length > 240 ? `${c.slice(0, 240)}…` : c))
        .slice(0, 3),
      howToTest: pr ? howToTestFromDescription(pr.body) : [],
      provider: r.provider as Intent["provider"],
      model: r.model,
      sourceKey,
      updatedAt: new Date().toISOString(),
    }
    await this.store.saveIntent(intent)
    return intent
  }

  private async linkedIssues(
    review: ReviewSummary,
    body: string,
  ): Promise<{ issues: IntentInput["issues"]; failed: boolean }> {
    const ref = review.prUrl ? parsePullRequestUrl(review.prUrl) : null
    if (!ref) return { issues: [], failed: false }
    const token = await this.hosts.token(ref.hostname).catch(() => null)
    const issues: IntentInput["issues"] = []
    let failed = false
    for (const i of linkedIssues(body, ref.hostname)) {
      try {
        issues.push(
          await getIssue(
            { ...ref, project: i.project ?? ref.project },
            i.number,
            token,
          ),
        )
      } catch {
        // A private or deleted issue: the Intent does without it.
        failed = true
      }
    }
    return { issues, failed }
  }

  private async walkthroughStage(
    job: Job,
    review: ReviewSummary,
    prep: Prep,
    intent: Intent | null,
  ): Promise<Walkthrough> {
    const { reviewId, iterationId } = job.status
    const iteration = await this.store.getIteration(iterationId)
    const previous = iteration
      ? await this.store.previousWalkthrough(reviewId, iteration.seq)
      : null
    const { kept, remaining } = keepSteps(previous, prep.fragments)
    const edges = prep.graph?.edges ?? []
    const settings = await this.getSettings()
    const tier = settings.tasks.walkthrough ?? settings.tiers.mid
    let planned: PlannerOutput["steps"] = []
    let model: string | null = null
    let provider: Walkthrough["provider"] = null
    const costBefore = job.status.costUsd

    const plan = async (
      fragments: PlannerFragment[],
      share: number,
    ): Promise<PlannerOutput["steps"]> => {
      const input = {
        fragments,
        text: Object.fromEntries(
          fragments
            .map((f) => [f.fragmentId, prep.text.get(f.fragmentId)] as const)
            .filter((e): e is [string, FragmentText] => Boolean(e[1])),
        ),
        edges,
        intent: intent
          ? { goal: intent.goal, requirements: intent.requirements }
          : null,
        keptSteps: kept.map((s) => ({ name: s.name, layer: s.layer })),
      }
      const cacheKey = plannerCacheKey(
        { ...input, text: new Map(Object.entries(input.text)) },
        tier.provider,
        tier.model,
      )
      const cached = await this.store.getCachedOutput(cacheKey)
      if (cached) {
        model = cached.model
        provider = tier.provider
        return (cached.body as PlannerOutput).steps
      }
      const r = await this.agent(
        job,
        "walkthrough",
        { ...prep.context, planner: input },
        share,
      )
      const out = r.output as PlannerOutput
      model = r.model
      provider = r.provider as Walkthrough["provider"]
      if (r.provider === tier.provider && r.model === tier.model)
        await this.store.saveCachedOutput(
          cacheKey,
          reviewId,
          "walkthrough",
          r.model,
          out,
        )
      return out.steps
    }

    let fallbackReason: string | null = null
    if (remaining.length) {
      try {
        const clusters = clusterFragments(remaining, edges)
        const results = await Promise.allSettled(
          clusters.map((c) => plan(c, 1 / clusters.length)),
        )
        if (job.abort.signal.aborted) throw new Error("aborted")
        const failed = clusters.filter(
          (_, i) => results[i]?.status === "rejected",
        )
        const reasons = results.flatMap((r) =>
          r.status === "rejected" ? [r.reason as Error] : [],
        )
        if (failed.length === clusters.length) throw reasons[0]
        planned = results.flatMap((r) =>
          r.status === "fulfilled" ? r.value : [],
        )
        // One more try for anything the model left out; the validator repairs the rest.
        const placed = new Set(
          planned.flatMap((s) => s.fragments.map((a) => a.trim())),
        )
        const failedAliases = new Set(failed.flat().map((f) => f.alias))
        const missing = remaining.filter(
          (f) => !placed.has(f.alias) && !failedAliases.has(f.alias),
        )
        if (missing.length && missing.length < remaining.length)
          planned.push(...(await plan(missing, 0.5).catch(() => [])))
        // A failed cluster is planned by file; the clusters that answered keep their Steps.
        if (failed.length) {
          fallbackReason = `${failed.length} of ${clusters.length} parts planned by file, without a model: ${reasons[0]?.message}`
          this.stage(job, "walkthrough", "running", fallbackReason)
          planned.push(...fallbackPlan(failed.flat()))
        }
      } catch (e) {
        if (job.abort.signal.aborted) throw e
        fallbackReason = `Planned by file, without a model: ${(e as Error).message}`
        this.stage(job, "walkthrough", "running", fallbackReason)
        planned = fallbackPlan(remaining)
        model = null
      }
    } else if (previous) {
      model = previous.model
      provider = previous.provider
    }

    return assembleWalkthrough({
      reviewId,
      iterationId,
      fragments: prep.fragments,
      planned,
      edges,
      kept,
      previousChapters: previous?.chapters ?? [],
      provider,
      model,
      promptVersion: WALKTHROUGH_PROMPT_VERSION,
      costUsd: job.status.costUsd - costBefore,
      fallbackReason,
    })
  }

  private async briefStage(
    job: Job,
    review: ReviewSummary,
    prep: Prep,
    intent: Intent | null,
    w: Walkthrough,
    uncovered: string[],
  ): Promise<ChangeBrief> {
    const hasDescription = review.sourceKind === "pull_request"
    // Nothing behavioral (formatting, renames, an empty Change Set): no business rule changed.
    if (!w.steps.some((s) => s.fragments.some((f) => f.kind === "behavioral")))
      return assembleBrief({
        walkthrough: w,
        files: prep.built.summary.files,
        domainChanges: [],
        gapSuggestion: null,
        hasDescription,
        uncoveredRequirementIds: uncovered,
        howToTestFromSource: intent?.howToTest ?? [],
        howToTestSuggested: [],
        costUsd: job.status.costUsd,
      })
    const r = await this.agent(job, "domain_changes", {
      ...prep.context,
      changes: {
        intent: intent
          ? { goal: intent.goal, requirements: intent.requirements }
          : null,
        steps: w.steps,
        fragments: prep.fragments,
        text: Object.fromEntries(prep.text),
      },
    })
    const out = r.output as DomainChangesOutput
    let domainChanges = toDomainChanges(
      out,
      prep.fragments,
      w.steps,
      hasDescription,
    )
    let suggestion: string | null = null
    if (hasDescription && domainChanges.length && review.intentText) {
      this.stage(job, "brief", "running", "Checking the description")
      const description = splitIntent(review.intentText)
      // Domain Changes are paid for; a failed check leaves them unchecked rather than lost.
      const judged = await this.judge(
        job,
        prep.context,
        descriptionRequest(description, domainChanges),
      ).catch(() => {
        domainChanges = domainChanges.map((d) => ({
          ...d,
          inDescription: null,
        }))
        return null
      })
      if (judged)
        domainChanges = readDescription(
          domainChanges,
          judged.answers,
          judged.backend,
        )
      const missing = domainChanges.filter((d) => d.inDescription === false)
      if (missing.length) {
        const g = await this.agent(job, "description_gap", {
          ...prep.context,
          description,
          missing,
        }).catch(() => null)
        suggestion =
          (
            g?.output as { suggestion?: string } | undefined
          )?.suggestion?.trim() || null
      }
    }
    return assembleBrief({
      walkthrough: w,
      files: prep.built.summary.files,
      domainChanges,
      gapSuggestion: suggestion,
      hasDescription,
      uncoveredRequirementIds: uncovered,
      howToTestFromSource: intent?.howToTest ?? [],
      howToTestSuggested: out.howToTest
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 6),
      costUsd: job.status.costUsd,
    })
  }

  // ---- Agent Transcripts ---------------------------------------------------------------

  private async findSessions(
    review: ReviewSummary,
  ): Promise<FoundTranscript[]> {
    const settings = await this.getSettings()
    if (!settings.intent.readTranscripts || !review.repo.workTree) {
      this.sessions.set(review.id, [])
      return []
    }
    const { repo } = await this.reviews.repoFor(review)
    const iterations = await this.store.listIterations(review.id)
    const latest = iterations.at(-1)
    const first = iterations[0]
    let since = first
      ? new Date(Date.parse(first.createdAt) - 7 * 86_400_000)
      : new Date(0)
    let until = latest
      ? new Date(Date.parse(latest.createdAt) + 3_600_000)
      : new Date()
    if (latest) {
      const t = await repo
        .commitTimes(latest.baseSha, latest.headSha)
        .catch(() => null)
      if (t?.first) since = new Date(t.first.getTime() - 6 * 3_600_000)
      if (t?.last && t.last > until)
        until = new Date(t.last.getTime() + 3_600_000)
    }
    const worktrees = await repo.worktreePaths().catch(() => [])
    const env = process.env
    const found = await findTranscripts({
      claudeDir: env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"),
      codexDir: env.CODEX_HOME || join(homedir(), ".codex"),
      repoPaths: [review.repo.workTree, ...worktrees],
      branch: review.headRef ?? (await repo.currentBranch().catch(() => null)),
      since,
      until,
    }).catch(() => [])
    this.sessions.set(review.id, found)
    return found
  }

  async transcripts(reviewId: string): Promise<TranscriptCandidate[]> {
    const review = await this.reviews.summary(reviewId)
    const found =
      this.sessions.get(reviewId) ?? (await this.findSessions(review))
    const choices = await this.store.transcriptChoices(reviewId)
    return found.map((f) => ({
      id: f.session.id,
      tool: f.session.tool,
      startedAt: f.session.startedAt,
      endedAt: f.session.endedAt,
      branch: f.session.branch,
      title:
        (f.session.prompts[0] ?? "").replace(/\s+/g, " ").slice(0, 120) ||
        "(no prompt)",
      prompts: f.session.prompts.length,
      corrections: f.session.corrections.length,
      match: f.match,
      selected: choices.get(f.session.id) ?? f.likely,
    }))
  }

  async setTranscript(
    reviewId: string,
    transcriptId: string,
    selected: boolean,
  ) {
    await this.store.setTranscriptChoice(reviewId, transcriptId, selected)
  }

  // ---- The user's edits -------------------------------------------------------------------

  /** The user's own Intent: confirmed, and never regenerated. Scope and the Brief follow it. */
  async saveIntent(
    reviewId: string,
    patch: Pick<Intent, "goal" | "requirements">,
  ): Promise<Intent> {
    const existing = await this.store.getIntent(reviewId)
    const intent: Intent = {
      reviewId,
      goal: patch.goal.trim(),
      requirements: patch.requirements
        .map((r) => r.statement.trim())
        .filter(Boolean)
        .map((statement, i) => ({ id: `R${i + 1}`, statement })),
      sources: existing?.sources.length
        ? existing.sources.filter((s) => s.kind !== "inferred")
        : [],
      inferred: false,
      confirmed: true,
      corrections: existing?.corrections ?? [],
      howToTest: existing?.howToTest ?? [],
      provider: existing?.provider ?? null,
      model: existing?.model ?? null,
      sourceKey: null,
      updatedAt: new Date().toISOString(),
    }
    if (!intent.sources.some((s) => s.kind === "user"))
      intent.sources.push({ kind: "user", label: "Edited by you", ref: null })
    await this.store.saveIntent(intent)
    return intent
  }

  async confirmIntent(reviewId: string): Promise<Intent | null> {
    const existing = await this.store.getIntent(reviewId)
    if (!existing) return null
    const intent = {
      ...existing,
      confirmed: true,
      updatedAt: new Date().toISOString(),
    }
    await this.store.saveIntent(intent)
    return intent
  }

  /** Forgets the Intent so it's built again from its sources. */
  async resetIntent(reviewId: string) {
    await this.store.deleteIntent(reviewId)
  }

  async editStep(
    reviewId: string,
    iterationId: string,
    edit: StepEdit,
  ): Promise<Walkthrough> {
    if (
      this.jobs.get(this.key(reviewId, iterationId))?.status.state === "running"
    )
      throw new UserError(
        "The Walkthrough is still being built. Edit it once it's done.",
      )
    const w = await this.store.getWalkthrough(reviewId, iterationId)
    if (!w) throw new UserError("There's no Walkthrough to edit yet.")
    let next: Walkthrough
    try {
      next = editWalkthrough(w, edit)
    } catch (e) {
      if (e instanceof EditError) throw new UserError(e.message)
      throw e
    }
    await this.store.saveWalkthrough(next)
    // The Brief points at Steps by id; follow them to the edited ones.
    const brief = await this.store.getBrief(reviewId, iterationId)
    if (brief) {
      const built = await this.reviews.built(reviewId, iterationId, false)
      await this.store.saveBrief(relink(brief, next, built.summary.files))
    }
    return next
  }
}

function relink(
  brief: ChangeBrief,
  w: Walkthrough,
  files: FileChange[],
): ChangeBrief {
  const stepOf = new Map<string, string>()
  for (const s of w.steps)
    for (const f of s.fragments) stepOf.set(f.fragmentId, s.id)
  const domainChanges: DomainChange[] = brief.domainChanges.map((d) => ({
    ...d,
    stepIds: [
      ...new Set(
        d.fragmentIds
          .map((f) => stepOf.get(f))
          .filter((x): x is string => Boolean(x)),
      ),
    ],
  }))
  return { ...brief, domainChanges, components: componentMap(w.steps, files) }
}
