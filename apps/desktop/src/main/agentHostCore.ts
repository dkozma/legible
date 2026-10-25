// The agent host: runs agent tasks away from the main process so a crashed or
// busy agent never blocks IPC, the database or windows. This module is the
// transport-independent core; agentHost.ts wires it to a utilityProcess.

import {
  type AgentEvent,
  type AgentRuntime,
  type ClaudeRuntimeConfig,
  ClaudeSdkRuntime,
  FakeRuntime,
  Router,
  runTask,
  Scheduler,
} from '@legible/agent-runtime';
import type { DiffChunk, ExplanationTarget, FileChange, ModelTier, RuntimeStatus, TierAssignment } from '@legible/domain';
import { GitRepo } from '@legible/git';
import { type ExplanationOutput, explanationTask } from '@legible/pipelines';

export interface HostConfig {
  claude: ClaudeRuntimeConfig;
  tiers: Record<ModelTier, TierAssignment>;
  concurrency: number;
  /** Use canned answers instead of a real model (tests, demos). */
  fake: boolean;
}

export interface ExplanationRunInput {
  target: ExplanationTarget;
  file: Pick<FileChange, 'path' | 'oldPath' | 'status' | 'language'>;
  baseLines: string[];
  headLines: string[];
  chunks: DiffChunk[];
  intent: { title: string; body: string } | null;
  repo: { gitDir: string; workTree: string | null; env: Record<string, string> | null };
  baseSha: string;
  headSha: string;
  changedFiles: { path: string; oldPath: string | null; status: string; additions: number; deletions: number }[];
}

export type ToHost =
  | { type: 'configure'; config: HostConfig }
  | { type: 'run'; runId: string; pipeline: 'explanation'; input: ExplanationRunInput; budgetUsd: number }
  | { type: 'cancel'; runId: string }
  | { type: 'status'; reqId: string };

export interface RunResultMessage {
  output: ExplanationOutput;
  provider: string;
  model: string;
  costUsd: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  fallbackReason: string | null;
}

export type FromHost =
  | { type: 'event'; runId: string; event: AgentEvent }
  | { type: 'result'; runId: string; result: RunResultMessage }
  | { type: 'error'; runId: string; message: string; code: string; costUsd: number }
  | { type: 'status'; reqId: string; status: RuntimeStatus };

const fakeAnswer = (): ExplanationOutput => ({
  before: 'Refunded the whole order total in one gateway call, then wrote an audit entry naming the operator.',
  after:
    'Refunds `amountCents`, defaulting to the remaining balance, and rejects anything larger. Shipping is included only on the final refund.',
  whatChanged: [
    { kind: 'behavior', text: 'Partial refunds are now possible, capped at the remaining balance.' },
    { kind: 'connection', text: 'No longer calls `auditLog()`; emits `refund.issued` instead, without the operator.' },
  ],
  watchOut: ['Two concurrent partial refunds can read the same `balance.count` and send the same idempotency key.'],
});

export function createAgentHost(post: (m: FromHost) => void) {
  let config: HostConfig | null = null;
  let runtime: AgentRuntime | null = null;
  let router: Router | null = null;
  const scheduler = new Scheduler(6);
  const runs = new Map<string, AbortController>();
  const repos = new Map<string, GitRepo>();

  const repoFor = (r: ExplanationRunInput['repo']) => {
    const key = `${r.gitDir}\0${JSON.stringify(r.env ?? {})}`;
    let repo = repos.get(key);
    if (!repo) {
      repo = GitRepo.at(r.gitDir, r.workTree, r.env ?? undefined);
      repos.set(key, repo);
    }
    return repo;
  };

  async function handle(m: ToHost) {
    switch (m.type) {
      case 'configure': {
        config = m.config;
        runtime = m.config.fake ? new FakeRuntime(fakeAnswer, { delayMs: 600 }) : new ClaudeSdkRuntime(m.config.claude);
        router = new Router({ anthropic: runtime }, m.config.tiers);
        scheduler.setConcurrency(m.config.concurrency);
        return;
      }
      case 'status': {
        if (!runtime) {
          post({
            type: 'status',
            reqId: m.reqId,
            status: {
              provider: 'anthropic',
              auth: 'claude-code',
              ready: false,
              detail: 'Not configured',
              executablePath: null,
              version: null,
            },
          });
          return;
        }
        post({ type: 'status', reqId: m.reqId, status: await runtime.status() });
        return;
      }
      case 'cancel':
        runs.get(m.runId)?.abort();
        return;
      case 'run': {
        if (!router || !config) {
          post({ type: 'error', runId: m.runId, message: 'Agent host is not configured', code: 'execution', costUsd: 0 });
          return;
        }
        const abort = new AbortController();
        runs.set(m.runId, abort);
        const i = m.input;
        try {
          const task = explanationTask({
            target: i.target,
            file: i.file,
            baseLines: i.baseLines,
            headLines: i.headLines,
            chunks: i.chunks,
            intent: i.intent,
            context: { repo: repoFor(i.repo), baseSha: i.baseSha, headSha: i.headSha, changedFiles: i.changedFiles },
          });
          const r = await runTask(router, scheduler, task, {
            signal: abort.signal,
            budgetUsd: m.budgetUsd,
            onEvent: (event) => post({ type: 'event', runId: m.runId, event }),
          });
          post({
            type: 'result',
            runId: m.runId,
            result: {
              output: r.output as ExplanationOutput,
              provider: r.provider,
              model: r.model,
              costUsd: r.costUsd,
              durationMs: r.durationMs,
              inputTokens: r.inputTokens,
              outputTokens: r.outputTokens,
              fallbackReason: r.fallbackReason,
            },
          });
        } catch (e) {
          const err = e as Error & { code?: string; costUsd?: number };
          post({
            type: 'error',
            runId: m.runId,
            message: abort.signal.aborted ? 'Cancelled' : err.message,
            code: abort.signal.aborted ? 'aborted' : (err.code ?? 'execution'),
            costUsd: err.costUsd ?? 0,
          });
        } finally {
          runs.delete(m.runId);
        }
        return;
      }
    }
  }

  return {
    handle: (m: ToHost) => {
      handle(m).catch((e) => {
        if (m.type === 'run') post({ type: 'error', runId: m.runId, message: (e as Error).message, code: 'execution', costUsd: 0 });
      });
    },
    dispose() {
      for (const a of runs.values()) a.abort();
      for (const r of repos.values()) r.close();
    },
  };
}
