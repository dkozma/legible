// Runs one case through the real pipelines: the indexer and Fragment graph,
// the Walkthrough planner and validator, Scope and Risk through the Judge,
// and Domain Changes. Only the runtime (fake, Claude, OpenAI) and the Judge
// backend vary between runs.

import {
  type AgentRuntime,
  type AgentTask,
  ClaudeSdkRuntime,
  DEFAULT_TIERS,
  FakeRuntime,
  OPENAI_DEFAULT_TIERS,
  OpenAIAgentsRuntime,
  Router,
  runTask,
  Scheduler,
  type ToolContext,
} from "@legible/agent-runtime"
import type {
  DomainChange,
  ModelTier,
  Provider,
  TierAssignment,
  Walkthrough,
} from "@legible/domain"
import { GitRepo } from "@legible/git"
import { buildChangeSet, CodeIndex, Parsing } from "@legible/indexer"
import {
  DecisionsBackend,
  FastTierBackend,
  JevBackend,
  Judge,
  type JudgeBackend,
  type RunTask,
} from "@legible/judge"
import {
  applyJudged,
  assembleWalkthrough,
  clusterFragments,
  detectRiskAreas,
  domainChangesTask,
  type FragmentText,
  fragmentText,
  type PlannerOutput,
  plannerFragments,
  plannerTask,
  readUnderstanding,
  type RiskArea,
  toDomainChanges,
  understandingRequest,
  WALKTHROUGH_PROMPT_VERSION,
} from "@legible/pipelines"

import { type EvalCase, materialize } from "./cases"
import { fakeAnswer } from "./fake"
import { type Scores, score } from "./score"

export interface EvalEnv {
  /** "fake", "claude:claude-sonnet-5-5", "openai:gpt-6.1-sol"… */
  label: string
  runtimes: Partial<Record<Provider, AgentRuntime>>
  tiers: Record<ModelTier, TierAssignment>
  judge: "fast" | "jev" | "decisions"
  /** The backend for `jev` or `decisions`, ahead of the fast-tier fallback. */
  externalJudge: JudgeBackend | null
  /** Spend cap per case. */
  budgetUsd: number
}

export interface CaseResult {
  name: string
  changedLines: number
  scores: Scores
  costUsd: number
  durationMs: number
  model: string | null
  judgeBackend: string
  /** Why the fast tier stood in for an external Judge backend, if it did. */
  judgeFallback: string | null
  error: string | null
}

/** The deterministic baseline: no model, no network. */
export function fakeEnv(budgetUsd = 2): EvalEnv {
  return {
    label: "fake",
    runtimes: { anthropic: new FakeRuntime(fakeAnswer) },
    tiers: DEFAULT_TIERS,
    judge: "fast",
    externalJudge: null,
    budgetUsd,
  }
}

const RUNTIMES: readonly string[] = ["fake", "claude", "openai"]
const JUDGES: readonly string[] = ["fast", "jev", "decisions"]

/**
 * The runtime and models a run uses, from EVAL_* environment variables.
 * Throws before any case runs when a setting would be ignored or a key is
 * missing, so a misconfigured run never writes a result file.
 */
export function envFromProcess(vars: NodeJS.ProcessEnv = process.env): EvalEnv {
  const runtime = vars.EVAL_RUNTIME ?? "fake"
  const model = vars.EVAL_MODEL ?? null
  const judge = (vars.EVAL_JUDGE ?? "fast") as EvalEnv["judge"]
  const budgetUsd = Number(vars.EVAL_BUDGET_USD ?? 2)
  const need = (key: string, setting: string): string => {
    const value = vars[key]
    if (!value)
      throw new Error(
        `${setting} needs ${key}, in your shell or the repository's .env.`,
      )
    return value
  }
  if (!RUNTIMES.includes(runtime))
    throw new Error(
      `EVAL_RUNTIME must be fake, claude or openai, not "${runtime}".`,
    )
  if (!JUDGES.includes(judge))
    throw new Error(
      `EVAL_JUDGE must be fast, jev or decisions, not "${judge}".`,
    )
  if (!(budgetUsd > 0))
    throw new Error(
      `EVAL_BUDGET_USD must be a positive number of dollars, not "${vars.EVAL_BUDGET_USD}".`,
    )
  if (runtime === "fake" && judge !== "fast")
    throw new Error(
      `EVAL_JUDGE=${judge} needs a model runtime: the fake runtime answers every judgment itself. Add EVAL_RUNTIME=claude or EVAL_RUNTIME=openai.`,
    )
  if (runtime === "fake" && model)
    throw new Error(
      "EVAL_MODEL needs a model runtime: the fake runtime has no models. Add EVAL_RUNTIME=claude or EVAL_RUNTIME=openai.",
    )
  if (runtime === "fake") return fakeEnv(budgetUsd)
  const externalJudge =
    judge === "jev"
      ? new JevBackend(
          need("TYPESAFE_API_KEY", "EVAL_JUDGE=jev"),
          vars.EVAL_JEV_MODEL ?? "jev-latest",
        )
      : judge === "decisions"
        ? new DecisionsBackend(need("OPENAI_API_KEY", "EVAL_JUDGE=decisions"))
        : null
  // In the label, so a Judge run doesn't overwrite the same day's plain run.
  const judgeLabel = judge === "fast" ? "" : `+${judge}`
  if (runtime === "openai") {
    const tiers: Record<ModelTier, TierAssignment> = { ...OPENAI_DEFAULT_TIERS }
    if (model)
      for (const t of ["strong", "mid", "fast"] as const)
        tiers[t] = { provider: "openai", model }
    return {
      label: `openai:${model ?? "defaults"}${judgeLabel}`,
      runtimes: {
        openai: new OpenAIAgentsRuntime({
          auth: "api-key",
          apiKey: need("OPENAI_API_KEY", "EVAL_RUNTIME=openai"),
          chatgpt: null,
        }),
      },
      tiers,
      judge,
      externalJudge,
      budgetUsd,
    }
  }
  const tiers: Record<ModelTier, TierAssignment> = { ...DEFAULT_TIERS }
  if (model)
    for (const t of ["strong", "mid", "fast"] as const)
      tiers[t] = { provider: "anthropic", model }
  const key = vars.ANTHROPIC_API_KEY
  return {
    label: `claude:${model ?? "defaults"}${judgeLabel}`,
    runtimes: {
      anthropic: new ClaudeSdkRuntime({
        auth: key ? "anthropic-api" : "claude-code",
        executablePath: null,
        env: key ? { ANTHROPIC_API_KEY: key } : {},
        bedrock: { region: "", profile: "" },
        vertex: { projectId: "", region: "" },
        foundry: { resource: "" },
        clientApp: "legible-evals",
        scratchDir: process.cwd(),
        bundledExecutable: null,
      }),
    },
    tiers,
    judge,
    externalJudge,
    budgetUsd,
  }
}

export async function runCase(c: EvalCase, env: EvalEnv): Promise<CaseResult> {
  const started = Date.now()
  const { dir, cleanup } = materialize(c)
  const repo = await GitRepo.open(dir)
  let costUsd = 0
  let model: string | null = null
  let judgeBackend = env.judge as string
  let judgeFallback: string | null = null
  try {
    const base = await repo.mergeBase("main", "HEAD")
    const head = (await repo.resolveCommit("HEAD")) as string
    const parsing = new Parsing()
    const built = await buildChangeSet(
      repo,
      parsing,
      { reviewId: c.name, iterationId: "eval" },
      base,
      head,
      { ignoreWhitespace: false, prefetch: false },
    )
    const files = built.summary.files
    const index = new CodeIndex({
      repo,
      parsing,
      baseSha: base,
      headSha: head,
      files: built.indexed,
    })
    await index.ready
    const graph = index.fragmentGraph(files)
    const fragments = plannerFragments(files, graph)
    const byId = new Map(fragments.map((f) => [f.fragmentId, f]))
    const text = new Map<string, FragmentText>()
    for (const f of fragments) {
      const d = built.diffs.get(f.fileId)
      if (d) text.set(f.fragmentId, fragmentText(f, d.baseLines, d.headLines))
    }
    const context: ToolContext = {
      repo,
      baseSha: base,
      headSha: head,
      changedFiles: files.map((f) => ({
        path: f.path,
        oldPath: f.oldPath,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
      })),
    }
    const router = new Router(env.runtimes, env.tiers)
    const scheduler = new Scheduler(4)
    const signal = new AbortController().signal
    const run: RunTask = async <T>(task: AgentTask<T>) => {
      const r = await runTask(router, scheduler, task, {
        signal,
        budgetUsd: Math.max(0.05, env.budgetUsd - costUsd),
      })
      costUsd += r.costUsd
      return r
    }
    const intent = c.intent
      ? {
          goal: c.intent.goal,
          requirements: c.intent.requirements.map((statement, i) => ({
            id: `R${i + 1}`,
            statement,
          })),
        }
      : null

    // Walkthrough.
    const planned: PlannerOutput["steps"] = []
    for (const cluster of clusterFragments(fragments, graph.edges)) {
      const r = await run(
        plannerTask(
          {
            fragments: cluster,
            text,
            edges: graph.edges,
            intent,
            keptSteps: [],
          },
          context,
        ),
      )
      model = r.model
      planned.push(...(r.output?.steps ?? []))
    }
    let w: Walkthrough = assembleWalkthrough({
      reviewId: c.name,
      iterationId: "eval",
      fragments,
      planned,
      edges: graph.edges,
      kept: [],
      previousChapters: [],
      provider: null,
      model,
      promptVersion: WALKTHROUGH_PROMPT_VERSION,
      costUsd,
    })

    // Scope and Risk.
    const detected = new Map<string, RiskArea[]>(
      w.steps.map((s) => [s.id, detectRiskAreas(s, byId, text)]),
    )
    const external = env.externalJudge ? [env.externalJudge] : []
    const judge = new Judge(external, new FastTierBackend(run, context))
    const req = understandingRequest(intent, w.steps, byId, detected)
    if (req.judgments.length) {
      const judged = await judge.judge(req, { signal })
      judgeBackend = `${judged.backend}:${judged.model}`
      judgeFallback = judged.fallbackReason
      costUsd += judged.backend === "fast" ? 0 : (judged.costUsd ?? 0)
      w = applyJudged(
        w,
        readUnderstanding(
          w.steps,
          intent,
          detected,
          judged.answers,
          judged.backend,
        ),
        detected,
        byId,
      )
    }

    // Domain Changes.
    const dc = await run(
      domainChangesTask({ intent, steps: w.steps, fragments, text }, context),
    )
    const domainChanges: DomainChange[] = toDomainChanges(
      dc.output ?? { domainChanges: [], howToTest: [] },
      fragments,
      w.steps,
      false,
    )

    return {
      name: c.name,
      changedLines: built.summary.additions + built.summary.deletions,
      scores: score(
        w,
        domainChanges,
        c.labels,
        fragments.map((f) => f.fragmentId),
      ),
      costUsd,
      durationMs: Date.now() - started,
      model,
      judgeBackend,
      judgeFallback,
      error: null,
    }
  } catch (e) {
    return {
      name: c.name,
      changedLines: 0,
      scores: score(
        {
          steps: [],
          chapters: [],
          validation: {
            fragments: 0,
            repairedMissing: 0,
            removedDuplicates: 0,
            dependencyViolations: 0,
            cycles: 0,
          },
        } as unknown as Walkthrough,
        [],
        c.labels,
        ["unscored"],
      ),
      costUsd,
      durationMs: Date.now() - started,
      model,
      judgeBackend,
      judgeFallback,
      error: (e as Error).message,
    }
  } finally {
    repo.close()
    cleanup()
  }
}
