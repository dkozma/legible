// Local persistence: one SQLite database per user. Secrets never come here.

import { randomUUID } from "node:crypto"

import {
  type ChangeBrief,
  DEFAULT_SETTINGS,
  type Explanation,
  type ExplanationBody,
  type ExplanationTarget,
  type Iteration,
  type Intent,
  type IterationKind,
  type Mode,
  type ModelTier,
  type Provider,
  type Repo,
  type Review,
  type ReviewSummary,
  Settings,
  type SourceKind,
  type Walkthrough,
} from "@legible/domain"
import type { Kysely } from "kysely"
import { sql } from "kysely"

import { MIGRATIONS } from "./migrations"
import { createKysely, NodeSqliteDatabase } from "./sqlite"

export { MIGRATIONS } from "./migrations"

interface DB {
  repos: {
    id: string
    display_name: string
    git_dir: string
    work_tree: string | null
    remote_url: string | null
    host: string | null
    created_at: string
  }
  reviews: {
    id: string
    repo_id: string
    title: string
    source_kind: SourceKind
    base_ref: string | null
    head_ref: string | null
    pr_url: string | null
    pr_number: number | null
    mode: Mode
    intent_text: string | null
    created_at: string
    updated_at: string
  }
  iterations: {
    id: string
    review_id: string
    seq: number
    kind: IterationKind
    base_sha: string
    head_sha: string
    head_tree: string | null
    created_at: string
  }
  viewed_files: { review_id: string; file_key: string; viewed_at: string }
  explanations: {
    cache_key: string
    id: string
    review_id: string | null
    target_json: string
    label: string
    body_json: string
    provider: string
    model: string
    tier: string
    prompt_version: string
    cost_usd: number | null
    duration_ms: number | null
    created_at: string
  }
  agent_runs: {
    id: string
    review_id: string | null
    task_kind: string
    provider: string
    model: string
    tier: string
    started_at: string
    ended_at: string | null
    cost_usd: number | null
    input_tokens: number | null
    output_tokens: number | null
    status: string
    error: string | null
  }
  settings: { key: string; value_json: string }
  review_state: { review_id: string; state_json: string }
  intents: { review_id: string; body_json: string; updated_at: string }
  transcript_choices: {
    review_id: string
    transcript_id: string
    selected: number
  }
  walkthroughs: {
    review_id: string
    iteration_id: string
    body_json: string
    created_at: string
  }
  briefs: {
    review_id: string
    iteration_id: string
    body_json: string
    created_at: string
  }
  viewed_steps: { review_id: string; step_id: string; viewed_at: string }
  judgments: {
    cache_key: string
    backend: string
    model: string
    answers_json: string
    created_at: string
  }
}

const now = () => new Date().toISOString()

export interface AgentRunRecord {
  id: string
  reviewId: string | null
  taskKind: string
  provider: Provider
  model: string
  tier: ModelTier
  startedAt: string
  endedAt: string | null
  costUsd: number | null
  inputTokens: number | null
  outputTokens: number | null
  status: "running" | "done" | "error" | "cancelled"
  error: string | null
}

export class Store {
  readonly db: Kysely<DB>
  private readonly sqlite: NodeSqliteDatabase

  constructor(path: string) {
    this.sqlite = new NodeSqliteDatabase(path)
    this.migrate()
    this.db = createKysely<DB>(this.sqlite)
  }

  private migrate() {
    const raw = this.sqlite.raw
    const row = raw.prepare("PRAGMA user_version").get() as {
      user_version: number
    }
    for (let v = row.user_version; v < MIGRATIONS.length; v++) {
      raw.exec("BEGIN")
      try {
        raw.exec(MIGRATIONS[v] as string)
        raw.exec(`PRAGMA user_version = ${v + 1}`)
        raw.exec("COMMIT")
      } catch (e) {
        raw.exec("ROLLBACK")
        throw e
      }
    }
  }

  async close() {
    await this.db.destroy()
  }

  // ---- Settings -------------------------------------------------------------

  async getSettings(): Promise<Settings> {
    const row = await this.db
      .selectFrom("settings")
      .select("value_json")
      .where("key", "=", "app")
      .executeTakeFirst()
    if (!row) return DEFAULT_SETTINGS
    // Merge over defaults so settings added in later versions get their default.
    const stored = JSON.parse(row.value_json) as Partial<Settings>
    const merged = deepMerge(DEFAULT_SETTINGS, stored)
    const parsed = Settings.safeParse(merged)
    return parsed.success ? parsed.data : DEFAULT_SETTINGS
  }

  async saveSettings(s: Settings): Promise<Settings> {
    const value = Settings.parse(s)
    await this.db
      .insertInto("settings")
      .values({ key: "app", value_json: JSON.stringify(value) })
      .onConflict((oc) =>
        oc.column("key").doUpdateSet({ value_json: JSON.stringify(value) }),
      )
      .execute()
    return value
  }

  // ---- Repos ----------------------------------------------------------------

  async upsertRepo(r: Omit<Repo, "id">): Promise<Repo> {
    const existing = await this.db
      .selectFrom("repos")
      .selectAll()
      .where("git_dir", "=", r.gitDir)
      .executeTakeFirst()
    if (existing) {
      await this.db
        .updateTable("repos")
        .set({
          display_name: r.displayName,
          work_tree: r.workTree,
          remote_url: r.remoteUrl,
          host: r.host,
        })
        .where("id", "=", existing.id)
        .execute()
      return { ...r, id: existing.id }
    }
    const id = randomUUID()
    await this.db
      .insertInto("repos")
      .values({
        id,
        display_name: r.displayName,
        git_dir: r.gitDir,
        work_tree: r.workTree,
        remote_url: r.remoteUrl,
        host: r.host,
        created_at: now(),
      })
      .execute()
    return { ...r, id }
  }

  async getRepo(id: string): Promise<Repo | null> {
    const row = await this.db
      .selectFrom("repos")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst()
    return row ? toRepo(row) : null
  }

  // ---- Reviews ----------------------------------------------------------------

  async createReview(
    r: Omit<Review, "id" | "createdAt" | "updatedAt"> & {
      intentText: string | null
    },
  ): Promise<Review> {
    const id = randomUUID()
    const t = now()
    await this.db
      .insertInto("reviews")
      .values({
        id,
        repo_id: r.repoId,
        title: r.title,
        source_kind: r.sourceKind,
        base_ref: r.baseRef,
        head_ref: r.headRef,
        pr_url: r.prUrl,
        pr_number: r.prNumber,
        mode: r.mode,
        intent_text: r.intentText,
        created_at: t,
        updated_at: t,
      })
      .execute()
    return { ...r, id, createdAt: t, updatedAt: t }
  }

  /** An existing Review for the same source, so reopening resumes it. */
  async findReview(q: {
    repoId: string
    sourceKind: SourceKind
    baseRef: string | null
    headRef: string | null
    prUrl: string | null
  }) {
    let query = this.db
      .selectFrom("reviews")
      .selectAll()
      .where("repo_id", "=", q.repoId)
      .where("source_kind", "=", q.sourceKind)
    if (q.prUrl !== null) {
      // A Pull Request is identified by its URL; its branches can change.
      const row = await query.where("pr_url", "=", q.prUrl).executeTakeFirst()
      return row ? toReview(row) : null
    }
    query =
      q.baseRef === null
        ? query.where("base_ref", "is", null)
        : query.where("base_ref", "=", q.baseRef)
    query =
      q.headRef === null
        ? query.where("head_ref", "is", null)
        : query.where("head_ref", "=", q.headRef)
    query =
      q.prUrl === null
        ? query.where("pr_url", "is", null)
        : query.where("pr_url", "=", q.prUrl)
    const row = await query.executeTakeFirst()
    return row ? toReview(row) : null
  }

  async updateReview(
    id: string,
    patch: Partial<Pick<Review, "title" | "mode">> & {
      intentText?: string | null
    },
  ) {
    await this.db
      .updateTable("reviews")
      .set({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.mode !== undefined ? { mode: patch.mode } : {}),
        ...(patch.intentText !== undefined
          ? { intent_text: patch.intentText }
          : {}),
        updated_at: now(),
      })
      .where("id", "=", id)
      .execute()
  }

  async touchReview(id: string) {
    await this.db
      .updateTable("reviews")
      .set({ updated_at: now() })
      .where("id", "=", id)
      .execute()
  }

  async getReview(id: string): Promise<ReviewSummary | null> {
    const list = await this.listReviews(id)
    return list[0] ?? null
  }

  async listReviews(onlyId?: string): Promise<ReviewSummary[]> {
    let q = this.db
      .selectFrom("reviews")
      .innerJoin("repos", "repos.id", "reviews.repo_id")
      .selectAll("reviews")
      .select([
        "repos.display_name as r_display_name",
        "repos.git_dir as r_git_dir",
        "repos.work_tree as r_work_tree",
        "repos.remote_url as r_remote_url",
        "repos.host as r_host",
      ])
      .orderBy("reviews.updated_at", "desc")
    if (onlyId) q = q.where("reviews.id", "=", onlyId)
    const rows = await q.execute()
    const out: ReviewSummary[] = []
    for (const row of rows) {
      const latest = await this.latestIteration(row.id)
      out.push({
        ...toReview(row),
        intentText: row.intent_text,
        repo: {
          id: row.repo_id,
          displayName: row.r_display_name,
          gitDir: row.r_git_dir,
          workTree: row.r_work_tree,
          remoteUrl: row.r_remote_url,
          host: row.r_host,
        },
        latestIteration: latest,
      })
    }
    return out
  }

  async deleteReview(id: string) {
    await this.db.deleteFrom("reviews").where("id", "=", id).execute()
  }

  // ---- Iterations ---------------------------------------------------------------

  async addIteration(
    i: Omit<Iteration, "id" | "seq" | "createdAt">,
  ): Promise<Iteration> {
    const id = randomUUID()
    const createdAt = now()
    // Seq is assigned inside the INSERT, so two concurrent adds can't both read the same latest seq.
    const row = this.sqlite.raw
      .prepare(
        `INSERT INTO iterations (id, review_id, seq, kind, base_sha, head_sha, head_tree, created_at)
         VALUES (?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM iterations WHERE review_id = ?), ?, ?, ?, ?, ?)
         RETURNING seq`,
      )
      .get(
        id,
        i.reviewId,
        i.reviewId,
        i.kind,
        i.baseSha,
        i.headSha,
        i.headTree,
        createdAt,
      ) as { seq: number }
    await this.touchReview(i.reviewId)
    return { ...i, id, seq: row.seq, createdAt }
  }

  async latestIteration(reviewId: string): Promise<Iteration | null> {
    const row = await this.db
      .selectFrom("iterations")
      .selectAll()
      .where("review_id", "=", reviewId)
      .orderBy("seq", "desc")
      .executeTakeFirst()
    return row ? toIteration(row) : null
  }

  async getIteration(id: string): Promise<Iteration | null> {
    const row = await this.db
      .selectFrom("iterations")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst()
    return row ? toIteration(row) : null
  }

  async listIterations(reviewId: string): Promise<Iteration[]> {
    const rows = await this.db
      .selectFrom("iterations")
      .selectAll()
      .where("review_id", "=", reviewId)
      .orderBy("seq", "asc")
      .execute()
    return rows.map(toIteration)
  }

  // ---- Viewed state -------------------------------------------------------------

  async viewedFiles(reviewId: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom("viewed_files")
      .select("file_key")
      .where("review_id", "=", reviewId)
      .execute()
    return rows.map((r) => r.file_key)
  }

  async setViewed(reviewId: string, fileKeys: string[], viewed: boolean) {
    if (fileKeys.length === 0) return
    if (viewed) {
      await this.db
        .insertInto("viewed_files")
        .values(
          fileKeys.map((k) => ({
            review_id: reviewId,
            file_key: k,
            viewed_at: now(),
          })),
        )
        .onConflict((oc) => oc.doNothing())
        .execute()
    } else {
      await this.db
        .deleteFrom("viewed_files")
        .where("review_id", "=", reviewId)
        .where("file_key", "in", fileKeys)
        .execute()
    }
  }

  // ---- Per-Review UI state ------------------------------------------------------

  async getReviewState<T>(reviewId: string): Promise<T | null> {
    const row = await this.db
      .selectFrom("review_state")
      .select("state_json")
      .where("review_id", "=", reviewId)
      .executeTakeFirst()
    return row ? (JSON.parse(row.state_json) as T) : null
  }

  async setReviewState(reviewId: string, state: unknown) {
    const json = JSON.stringify(state)
    await this.db
      .insertInto("review_state")
      .values({ review_id: reviewId, state_json: json })
      .onConflict((oc) =>
        oc.column("review_id").doUpdateSet({ state_json: json }),
      )
      .execute()
  }

  // ---- Explanations -------------------------------------------------------------

  async getExplanation(cacheKey: string): Promise<Explanation | null> {
    const row = await this.db
      .selectFrom("explanations")
      .selectAll()
      .where("cache_key", "=", cacheKey)
      .executeTakeFirst()
    return row ? toExplanation(row, true) : null
  }

  async saveExplanation(e: Explanation, reviewId: string | null) {
    await this.db
      .insertInto("explanations")
      .values({
        cache_key: e.cacheKey,
        id: e.id,
        review_id: reviewId,
        target_json: JSON.stringify(e.target),
        label: e.label,
        body_json: JSON.stringify(e.body),
        provider: e.provider,
        model: e.model,
        tier: e.tier,
        prompt_version: e.promptVersion,
        cost_usd: e.costUsd,
        duration_ms: e.durationMs,
        created_at: e.createdAt,
      })
      .onConflict((oc) => oc.column("cache_key").doNothing())
      .execute()
  }

  async listExplanations(reviewId: string, limit = 50): Promise<Explanation[]> {
    const rows = await this.db
      .selectFrom("explanations")
      .selectAll()
      .where("review_id", "=", reviewId)
      .orderBy("created_at", "desc")
      .limit(limit)
      .execute()
    return rows.map((r) => toExplanation(r, true))
  }

  // ---- Intent -----------------------------------------------------------------

  async getIntent(reviewId: string): Promise<Intent | null> {
    const row = await this.db
      .selectFrom("intents")
      .select("body_json")
      .where("review_id", "=", reviewId)
      .executeTakeFirst()
    return row ? (JSON.parse(row.body_json) as Intent) : null
  }

  async saveIntent(intent: Intent) {
    const values = {
      review_id: intent.reviewId,
      body_json: JSON.stringify(intent),
      updated_at: intent.updatedAt,
    }
    await this.db
      .insertInto("intents")
      .values(values)
      .onConflict((oc) => oc.column("review_id").doUpdateSet(values))
      .execute()
  }

  async deleteIntent(reviewId: string) {
    await this.db
      .deleteFrom("intents")
      .where("review_id", "=", reviewId)
      .execute()
  }

  /** The user's include/exclude choices for Agent Transcripts, by transcript id. */
  async transcriptChoices(reviewId: string): Promise<Map<string, boolean>> {
    const rows = await this.db
      .selectFrom("transcript_choices")
      .select(["transcript_id", "selected"])
      .where("review_id", "=", reviewId)
      .execute()
    return new Map(rows.map((r) => [r.transcript_id, r.selected === 1]))
  }

  async setTranscriptChoice(
    reviewId: string,
    transcriptId: string,
    selected: boolean,
  ) {
    const values = {
      review_id: reviewId,
      transcript_id: transcriptId,
      selected: selected ? 1 : 0,
    }
    await this.db
      .insertInto("transcript_choices")
      .values(values)
      .onConflict((oc) =>
        oc.columns(["review_id", "transcript_id"]).doUpdateSet(values),
      )
      .execute()
  }

  // ---- Walkthroughs and Change Briefs ------------------------------------------

  async getWalkthrough(
    reviewId: string,
    iterationId: string,
  ): Promise<Walkthrough | null> {
    const row = await this.db
      .selectFrom("walkthroughs")
      .select("body_json")
      .where("review_id", "=", reviewId)
      .where("iteration_id", "=", iterationId)
      .executeTakeFirst()
    return row ? (JSON.parse(row.body_json) as Walkthrough) : null
  }

  /** The newest Walkthrough of an Iteration before this one, to keep unchanged Steps stable. */
  async previousWalkthrough(
    reviewId: string,
    beforeSeq: number,
  ): Promise<Walkthrough | null> {
    const row = await this.db
      .selectFrom("walkthroughs")
      .innerJoin("iterations", "iterations.id", "walkthroughs.iteration_id")
      .select("walkthroughs.body_json")
      .where("walkthroughs.review_id", "=", reviewId)
      .where("iterations.seq", "<", beforeSeq)
      .orderBy("iterations.seq", "desc")
      .executeTakeFirst()
    return row ? (JSON.parse(row.body_json) as Walkthrough) : null
  }

  async saveWalkthrough(w: Walkthrough) {
    const values = {
      review_id: w.reviewId,
      iteration_id: w.iterationId,
      body_json: JSON.stringify(w),
      created_at: w.createdAt,
    }
    await this.db
      .insertInto("walkthroughs")
      .values(values)
      .onConflict((oc) =>
        oc.columns(["review_id", "iteration_id"]).doUpdateSet(values),
      )
      .execute()
  }

  async getBrief(
    reviewId: string,
    iterationId: string,
  ): Promise<ChangeBrief | null> {
    const row = await this.db
      .selectFrom("briefs")
      .select("body_json")
      .where("review_id", "=", reviewId)
      .where("iteration_id", "=", iterationId)
      .executeTakeFirst()
    return row ? (JSON.parse(row.body_json) as ChangeBrief) : null
  }

  async saveBrief(b: ChangeBrief) {
    const values = {
      review_id: b.reviewId,
      iteration_id: b.iterationId,
      body_json: JSON.stringify(b),
      created_at: b.createdAt,
    }
    await this.db
      .insertInto("briefs")
      .values(values)
      .onConflict((oc) =>
        oc.columns(["review_id", "iteration_id"]).doUpdateSet(values),
      )
      .execute()
  }

  /** Forgets an Iteration's Walkthrough and Brief, so they're rebuilt. */
  async clearUnderstanding(reviewId: string, iterationId: string) {
    await this.db
      .deleteFrom("briefs")
      .where("review_id", "=", reviewId)
      .where("iteration_id", "=", iterationId)
      .execute()
    await this.db
      .deleteFrom("walkthroughs")
      .where("review_id", "=", reviewId)
      .where("iteration_id", "=", iterationId)
      .execute()
  }

  async viewedSteps(reviewId: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom("viewed_steps")
      .select("step_id")
      .where("review_id", "=", reviewId)
      .execute()
    return rows.map((r) => r.step_id)
  }

  async setStepsViewed(reviewId: string, stepIds: string[], viewed: boolean) {
    if (stepIds.length === 0) return
    if (viewed) {
      await this.db
        .insertInto("viewed_steps")
        .values(
          stepIds.map((id) => ({
            review_id: reviewId,
            step_id: id,
            viewed_at: now(),
          })),
        )
        .onConflict((oc) => oc.doNothing())
        .execute()
    } else {
      await this.db
        .deleteFrom("viewed_steps")
        .where("review_id", "=", reviewId)
        .where("step_id", "in", stepIds)
        .execute()
    }
  }

  // ---- Judgments ----------------------------------------------------------------

  async getJudgment(
    cacheKey: string,
  ): Promise<{ backend: string; model: string; answers: unknown } | null> {
    const row = await this.db
      .selectFrom("judgments")
      .selectAll()
      .where("cache_key", "=", cacheKey)
      .executeTakeFirst()
    return row
      ? {
          backend: row.backend,
          model: row.model,
          answers: JSON.parse(row.answers_json) as unknown,
        }
      : null
  }

  async saveJudgment(
    cacheKey: string,
    backend: string,
    model: string,
    answers: unknown,
  ) {
    await this.db
      .insertInto("judgments")
      .values({
        cache_key: cacheKey,
        backend,
        model,
        answers_json: JSON.stringify(answers),
        created_at: now(),
      })
      .onConflict((oc) => oc.column("cache_key").doNothing())
      .execute()
  }

  // ---- Agent runs and spend -----------------------------------------------------

  async recordRun(r: AgentRunRecord) {
    const values = {
      id: r.id,
      review_id: r.reviewId,
      task_kind: r.taskKind,
      provider: r.provider,
      model: r.model,
      tier: r.tier,
      started_at: r.startedAt,
      ended_at: r.endedAt,
      cost_usd: r.costUsd,
      input_tokens: r.inputTokens,
      output_tokens: r.outputTokens,
      status: r.status,
      error: r.error,
    }
    await this.db
      .insertInto("agent_runs")
      .values(values)
      .onConflict((oc) => oc.column("id").doUpdateSet(values))
      .execute()
  }

  async spend(reviewId: string | null, since: Date) {
    const month = await this.db
      .selectFrom("agent_runs")
      .select([
        "provider",
        sql<number>`coalesce(sum(cost_usd), 0)`.as("total"),
        sql<number>`count(*)`.as("runs"),
      ])
      .where("started_at", ">=", since.toISOString())
      .groupBy("provider")
      .execute()
    let review: number | null = null
    if (reviewId) {
      const row = await this.db
        .selectFrom("agent_runs")
        .select(sql<number>`coalesce(sum(cost_usd), 0)`.as("total"))
        .where("review_id", "=", reviewId)
        .executeTakeFirst()
      review = row?.total ?? 0
    }
    const byProvider: Record<Provider, number> = { anthropic: 0, openai: 0 }
    let runs = 0
    for (const m of month) {
      byProvider[m.provider as Provider] = m.total
      runs += m.runs
    }
    return {
      reviewUsd: review,
      monthUsd: byProvider.anthropic + byProvider.openai,
      monthByProvider: byProvider,
      runsThisMonth: runs,
    }
  }
}

function toRepo(row: DB["repos"]): Repo {
  return {
    id: row.id,
    displayName: row.display_name,
    gitDir: row.git_dir,
    workTree: row.work_tree,
    remoteUrl: row.remote_url,
    host: row.host,
  }
}

function toReview(row: DB["reviews"]): Review {
  return {
    id: row.id,
    repoId: row.repo_id,
    title: row.title,
    sourceKind: row.source_kind,
    baseRef: row.base_ref,
    headRef: row.head_ref,
    prUrl: row.pr_url,
    prNumber: row.pr_number,
    mode: row.mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toIteration(row: DB["iterations"]): Iteration {
  return {
    id: row.id,
    reviewId: row.review_id,
    seq: row.seq,
    kind: row.kind,
    baseSha: row.base_sha,
    headSha: row.head_sha,
    headTree: row.head_tree,
    createdAt: row.created_at,
  }
}

function toExplanation(row: DB["explanations"], cached: boolean): Explanation {
  return {
    id: row.id,
    cacheKey: row.cache_key,
    target: JSON.parse(row.target_json) as ExplanationTarget,
    label: row.label,
    body: JSON.parse(row.body_json) as ExplanationBody,
    provider: row.provider as Provider,
    model: row.model,
    tier: row.tier as ModelTier,
    promptVersion: row.prompt_version,
    costUsd: row.cost_usd,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
    cached,
  }
}

function deepMerge<T>(base: T, over: unknown): T {
  if (Array.isArray(base) || typeof base !== "object" || base === null)
    return (over === undefined ? base : over) as T
  if (typeof over !== "object" || over === null || Array.isArray(over))
    return base
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    out[k] = k in out ? deepMerge(out[k], v) : v
  }
  return out as T
}
