// Deterministic runtime for tests and the browser prototype: answers each task
// with a canned output, and can exercise tools to prove they work end to end.

import type { ModelInfo, RuntimeStatus } from '@legible/domain';
import { MODEL_CATALOG } from './catalog';
import { grantedTools } from './tools';
import type { AgentResult, AgentRuntime, AgentTask, RunOptions } from './types';

export type FakeResponder = (task: AgentTask<unknown>) => unknown | Promise<unknown>;

export class FakeRuntime implements AgentRuntime {
  readonly provider = 'anthropic' as const;
  readonly calls: { task: AgentTask<unknown>; model: string }[] = [];

  constructor(
    private readonly respond: FakeResponder,
    private readonly opts: { delayMs?: number; costUsd?: number; callTools?: { name: string; input: Record<string, unknown> }[] } = {},
  ) {}

  async run<T>(task: AgentTask<T>, model: string, opts: RunOptions): Promise<AgentResult<T>> {
    this.calls.push({ task: task as AgentTask<unknown>, model });
    const started = Date.now();
    for (const call of this.opts.callTools ?? []) {
      const t = grantedTools(task.tools).find((x) => x.name === call.name);
      if (!t) throw new Error(`Tool ${call.name} not granted`);
      opts.onEvent?.({ type: 'tool', name: t.name, summary: t.name });
      await t.handler(call.input as never, task.context);
    }
    if (this.opts.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.opts.delayMs);
        opts.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('Cancelled'));
        });
      });
    }
    const raw = await this.respond(task as AgentTask<unknown>);
    const output = task.output ? task.output.parse(raw) : null;
    return {
      output,
      text: typeof raw === 'string' ? raw : '',
      provider: 'anthropic',
      model,
      costUsd: this.opts.costUsd ?? 0.001,
      durationMs: Date.now() - started,
      inputTokens: 1000,
      outputTokens: 200,
      numTurns: 1,
    };
  }

  async status(): Promise<RuntimeStatus> {
    return { provider: 'anthropic', auth: 'claude-code', ready: true, detail: 'Fake runtime', executablePath: null, version: null };
  }

  async models(): Promise<ModelInfo[]> {
    return MODEL_CATALOG;
  }
}
