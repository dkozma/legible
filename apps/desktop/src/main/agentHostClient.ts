// Main-process side of the agent host: spawns the utility process, restarts it
// if it dies, and turns its messages back into promises and events.

import { randomUUID } from 'node:crypto';

import type { AgentEvent } from '@legible/agent-runtime';
import type { RuntimeStatus } from '@legible/domain';

import {
  createAgentHost,
  type ExplanationRunInput,
  type FromHost,
  type HostConfig,
  type RunResultMessage,
  type ToHost,
} from './agentHostCore';

export class AgentRunError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly costUsd: number,
  ) {
    super(message);
  }
}

interface Pending {
  resolve: (r: RunResultMessage) => void;
  reject: (e: Error) => void;
  onEvent: (e: AgentEvent) => void;
}

export interface Transport {
  post(m: ToHost): void;
  onMessage(cb: (m: FromHost) => void): void;
  onExit(cb: () => void): void;
  kill(): void;
}

export class AgentHostClient {
  private transport: Transport | null = null;
  private config: HostConfig | null = null;
  private runs = new Map<string, Pending>();
  private statusWaiters = new Map<string, (s: RuntimeStatus) => void>();

  constructor(private readonly spawn: () => Transport) {}

  private ensure(): Transport {
    if (this.transport) return this.transport;
    const t = this.spawn();
    t.onMessage((m) => this.onMessage(m));
    t.onExit(() => {
      this.transport = null;
      for (const [id, p] of this.runs) {
        p.reject(new AgentRunError('The agent host stopped unexpectedly. Try again.', 'execution', 0));
        this.runs.delete(id);
      }
      for (const [id, resolve] of this.statusWaiters) {
        resolve(unavailable('The agent host stopped unexpectedly.'));
        this.statusWaiters.delete(id);
      }
    });
    this.transport = t;
    if (this.config) t.post({ type: 'configure', config: this.config });
    return t;
  }

  configure(config: HostConfig) {
    this.config = config;
    this.ensure().post({ type: 'configure', config });
  }

  status(): Promise<RuntimeStatus> {
    const reqId = randomUUID();
    return new Promise((resolve) => {
      this.statusWaiters.set(reqId, resolve);
      this.ensure().post({ type: 'status', reqId });
      // `claude --version` and `auth status` each have their own timeout; this is a backstop.
      setTimeout(() => {
        if (!this.statusWaiters.delete(reqId)) return;
        resolve(unavailable('Checking Claude took too long.'));
      }, 30_000);
    });
  }

  runExplanation(
    input: ExplanationRunInput,
    budgetUsd: number,
    onEvent: (e: AgentEvent) => void,
  ): { runId: string; done: Promise<RunResultMessage> } {
    const runId = randomUUID();
    const done = new Promise<RunResultMessage>((resolve, reject) => {
      this.runs.set(runId, { resolve, reject, onEvent });
    });
    this.ensure().post({ type: 'run', runId, pipeline: 'explanation', input, budgetUsd });
    return { runId, done };
  }

  cancel(runId: string) {
    this.transport?.post({ type: 'cancel', runId });
  }

  dispose() {
    this.transport?.kill();
    this.transport = null;
  }

  private onMessage(m: FromHost) {
    if (m.type === 'status') {
      this.statusWaiters.get(m.reqId)?.(m.status);
      this.statusWaiters.delete(m.reqId);
      return;
    }
    const p = this.runs.get(m.runId);
    if (!p) return;
    if (m.type === 'event') p.onEvent(m.event);
    else if (m.type === 'result') {
      this.runs.delete(m.runId);
      p.resolve(m.result);
    } else {
      this.runs.delete(m.runId);
      p.reject(new AgentRunError(m.message, m.code, m.costUsd));
    }
  }
}

function unavailable(detail: string): RuntimeStatus {
  return { provider: 'anthropic', auth: 'claude-code', ready: false, detail, executablePath: null, version: null };
}

/** Runs the host in this process; for tests and environments without utilityProcess. */
export function inProcessTransport(): Transport {
  let listener: ((m: FromHost) => void) | null = null;
  const host = createAgentHost((m) => queueMicrotask(() => listener?.(m)));
  return {
    post: (m) => host.handle(m),
    onMessage: (cb) => {
      listener = cb;
    },
    onExit: () => undefined,
    kill: () => host.dispose(),
  };
}
