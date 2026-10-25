// Explanation jobs: cache lookup, agent runs, progress events, persistence,
// and cost records.

import { randomUUID } from 'node:crypto';
import type { Explanation, ExplanationJob, ExplanationTarget, Settings } from '@legible/domain';
import { targetLabel } from '@legible/domain';
import { EXPLANATION_PROMPT_VERSION, explanationCacheKey, toExplanationBody } from '@legible/pipelines';
import type { Store } from '@legible/store';
import { type AgentHostClient, AgentRunError } from './agentHostClient';
import type { ExplanationRunInput } from './agentHostCore';
import { type ReviewService, UserError } from './reviews';

export class ExplanationService {
  private jobs = new Map<string, ExplanationJob & { cacheKey: string; runId: string | null }>();

  constructor(
    private readonly store: Store,
    private readonly reviews: ReviewService,
    private readonly host: AgentHostClient,
    private readonly getSettings: () => Promise<Settings>,
    private readonly emit: (job: ExplanationJob) => void,
  ) {}

  async request(reviewId: string, iterationId: string, target: ExplanationTarget, force: boolean): Promise<ExplanationJob> {
    const review = await this.reviews.summary(reviewId);
    const built = await this.reviews.built(reviewId, iterationId, false);
    const file = built.summary.files.find((f) => f.id === target.fileId);
    const diff = built.diffs.get(target.fileId);
    if (!file || !diff) throw new UserError('That file is not part of this Change Set.');
    if (file.binary) throw new UserError("Binary files can't be explained.");

    const settings = await this.getSettings();
    const tier = settings.tiers.fast;
    const intent = review.intentText ? splitIntent(review.intentText) : null;
    const base = {
      target,
      file: { path: file.path, oldPath: file.oldPath, status: file.status, language: file.language },
      baseLines: diff.baseLines,
      headLines: diff.headLines,
      chunks: diff.chunks,
      intent,
    };
    const cacheKey = explanationCacheKey(base, tier.provider, tier.model);
    const label = targetLabel(target);

    if (!force) {
      const cached = await this.store.getExplanation(cacheKey);
      if (cached) {
        const job: ExplanationJob = {
          jobId: randomUUID(),
          reviewId,
          target,
          label,
          status: 'done',
          progress: null,
          error: null,
          explanation: cached,
          startedAt: new Date().toISOString(),
        };
        return job;
      }
      for (const j of this.jobs.values()) {
        if (j.cacheKey === cacheKey && (j.status === 'queued' || j.status === 'running')) return strip(j);
      }
    }

    const { repo } = await this.reviews.repoFor(review);
    const input: ExplanationRunInput = {
      ...base,
      repo: { gitDir: repo.gitDir, workTree: repo.workTree, env: (repo.env as Record<string, string> | undefined) ?? null },
      baseSha: built.summary.baseSha,
      headSha: built.summary.headSha,
      changedFiles: built.summary.files.map((f) => ({
        path: f.path,
        oldPath: f.oldPath,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
      })),
    };

    const job: ExplanationJob & { cacheKey: string; runId: string | null } = {
      jobId: randomUUID(),
      reviewId,
      target,
      label,
      status: 'queued',
      progress: 'Waiting for Claude',
      error: null,
      explanation: null,
      startedAt: new Date().toISOString(),
      cacheKey,
      runId: null,
    };
    this.jobs.set(job.jobId, job);
    this.prune();
    this.emit(strip(job));

    const started = new Date().toISOString();
    const { runId, done } = this.host.runExplanation(input, settings.spend.explanationCapUsd, (e) => {
      const progress = e.type === 'tool' ? e.summary : e.type === 'status' ? e.message : null;
      if (!progress && job.status === 'running') return;
      job.status = 'running';
      if (progress) job.progress = progress;
      this.emit(strip(job));
    });
    job.runId = runId;

    done.then(
      async (r) => {
        const explanation: Explanation = {
          id: randomUUID(),
          cacheKey,
          target,
          label,
          body: toExplanationBody(r.output),
          provider: r.provider as Explanation['provider'],
          model: r.model,
          tier: 'fast',
          promptVersion: EXPLANATION_PROMPT_VERSION,
          costUsd: r.costUsd,
          durationMs: r.durationMs,
          createdAt: new Date().toISOString(),
          cached: false,
        };
        await this.store.saveExplanation(explanation, reviewId);
        await this.store.recordRun({
          id: runId,
          reviewId,
          taskKind: 'explanation',
          provider: explanation.provider,
          model: r.model,
          tier: 'fast',
          startedAt: started,
          endedAt: new Date().toISOString(),
          costUsd: r.costUsd,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          status: 'done',
          error: null,
        });
        Object.assign(job, { status: 'done', progress: r.fallbackReason, explanation });
        this.emit(strip(job));
      },
      async (e: Error) => {
        const cancelled = e instanceof AgentRunError && e.code === 'aborted';
        await this.store.recordRun({
          id: runId,
          reviewId,
          taskKind: 'explanation',
          provider: tier.provider,
          model: tier.model,
          tier: 'fast',
          startedAt: started,
          endedAt: new Date().toISOString(),
          costUsd: e instanceof AgentRunError ? e.costUsd : 0,
          inputTokens: null,
          outputTokens: null,
          status: cancelled ? 'cancelled' : 'error',
          error: e.message,
        });
        Object.assign(job, { status: cancelled ? 'cancelled' : 'error', error: cancelled ? null : e.message, progress: null });
        this.emit(strip(job));
      },
    );
    return strip(job);
  }

  cancel(jobId: string) {
    const job = this.jobs.get(jobId);
    if (job?.runId) this.host.cancel(job.runId);
  }

  /** Keeps the most recent finished jobs; Explanations themselves live in the store. */
  private prune() {
    const finished = [...this.jobs.values()].filter((j) => j.status !== 'queued' && j.status !== 'running');
    for (const j of finished.slice(0, Math.max(0, finished.length - 50))) this.jobs.delete(j.jobId);
  }

  list(reviewId: string): ExplanationJob[] {
    return [...this.jobs.values()].filter((j) => j.reviewId === reviewId).map(strip);
  }
}

function strip(j: ExplanationJob & { cacheKey: string; runId: string | null }): ExplanationJob {
  const { cacheKey: _k, runId: _r, ...rest } = j;
  return { ...rest };
}

function splitIntent(text: string): { title: string; body: string } {
  const [title, ...rest] = text.split('\n');
  return { title: title ?? '', body: rest.join('\n').trim() };
}
