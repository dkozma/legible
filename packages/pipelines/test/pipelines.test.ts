import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DEFAULT_TIERS, FakeRuntime, lintSchema, Router, runTask, Scheduler, TOOLS } from '@legible/agent-runtime';
import { diffLines, splitLines } from '@legible/diff';
import { GitRepo } from '@legible/git';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ExplanationOutput,
  explanationCacheKey,
  explanationPrompt,
  explanationTask,
  renderTargetDiff,
  toExplanationBody,
} from '../src/index';

let dir: string;
let repo: GitRepo;
let baseSha: string;
let headSha: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'legible-pipe-'));
  execFileSync('node', [resolve(__dirname, '../../../fixtures/make-refund-repo.mjs'), dir]);
  repo = await GitRepo.open(dir);
  headSha = (await repo.resolveCommit('HEAD')) as string;
  baseSha = await repo.mergeBase('main', headSha);
});

afterAll(() => {
  repo?.close();
  rmSync(dir, { recursive: true, force: true });
});

async function inputFor(path: string, target: 'file' | [number, number]) {
  const base = splitLines((await repo.blobs().readPath(baseSha, path))?.toString() ?? '');
  const head = splitLines((await repo.blobs().readPath(headSha, path))?.toString() ?? '');
  return {
    target:
      target === 'file'
        ? ({ kind: 'file', fileId: 'f', path, oldPath: null } as const)
        : ({ kind: 'range', fileId: 'f', path, oldPath: null, baseRange: null, headRange: target } as const),
    file: { path, oldPath: null, status: 'modified' as const, language: 'typescript' },
    baseLines: base,
    headLines: head,
    chunks: diffLines(base, head),
    intent: { title: 'Partial refunds', body: 'Allow partial refunds within 60 days.' },
    context: { repo, baseSha, headSha, changedFiles: [] },
  };
}

describe('schemas', () => {
  it('every structured-output schema and tool input passes the provider lint', () => {
    expect(lintSchema(ExplanationOutput)).toEqual([]);
    for (const t of TOOLS) expect({ tool: t.name, problems: lintSchema(z.object(t.input)) }).toEqual({ tool: t.name, problems: [] });
  });

  it('flags optional fields and loose objects', () => {
    const problems = lintSchema(z.object({ a: z.string().optional(), b: z.looseObject({ c: z.string() }) }));
    expect(problems.map((p) => p.message)).toEqual(
      expect.arrayContaining([expect.stringContaining('Optional property'), expect.stringContaining('additionalProperties')]),
    );
  });
});

describe('Explanation pipeline', () => {
  it('renders the selected range with markers and context', async () => {
    const input = await inputFor('src/refunds/RefundPolicy.ts', [3, 3]);
    const { text } = renderTargetDiff(input);
    expect(text).toContain('» ');
    expect(text).toContain('REFUND_WINDOW_DAYS = 60');
    expect(text).toContain('REFUND_WINDOW_DAYS = 30');
    const prompt = explanationPrompt(input);
    expect(prompt).toContain('<untrusted source="intent">');
    expect(prompt).toContain('Allow partial refunds');
  });

  it('keys the cache by content, model and Intent', async () => {
    const a = await inputFor('src/refunds/RefundPolicy.ts', [3, 3]);
    const k1 = explanationCacheKey(a, 'anthropic', 'claude-haiku-5-5');
    expect(explanationCacheKey(a, 'anthropic', 'claude-haiku-5-5')).toBe(k1);
    expect(explanationCacheKey(a, 'anthropic', 'claude-sonnet-5-5')).not.toBe(k1);
    expect(explanationCacheKey({ ...a, intent: null }, 'anthropic', 'claude-haiku-5-5')).not.toBe(k1);
  });

  it('runs through the router with tools that read git objects', async () => {
    const input = await inputFor('src/refunds/RefundService.ts', 'file');
    const fake = new FakeRuntime(
      () => ({
        before: 'Refunded the whole order.',
        after: 'Refunds any amount up to the remaining balance.',
        whatChanged: [{ kind: 'connection', text: 'No longer calls `auditLog()`.' }],
        watchOut: ['a', 'b', 'c'],
      }),
      { callTools: [{ name: 'read_file', input: { side: 'head', path: 'src/refunds/RefundService.ts', startLine: 1, endLine: 5 } }] },
    );
    const router = new Router({ anthropic: fake }, DEFAULT_TIERS);
    const result = await runTask(router, new Scheduler(2), explanationTask(input), {
      signal: new AbortController().signal,
      budgetUsd: 0.5,
    });
    expect(fake.calls[0]?.model).toBe('claude-haiku-5-5');
    const body = toExplanationBody(result.output as ExplanationOutput);
    expect(body.watchOut).toHaveLength(2);
    expect(body.whatChanged[0]?.kind).toBe('connection');
  });

  it('rejects path traversal in tools', async () => {
    const readFile = TOOLS.find((t) => t.name === 'read_file');
    await expect(
      readFile?.handler({ side: 'head', path: '../../etc/passwd', startLine: null, endLine: null } as never, {
        repo,
        baseSha,
        headSha,
        changedFiles: [],
      }),
    ).rejects.toThrow('Invalid path');
  });
});

describe('Scheduler', () => {
  it('runs interactive work before background work and respects the cap', async () => {
    const s = new Scheduler(1);
    const order: string[] = [];
    const signal = new AbortController().signal;
    const slow = (name: string) => () =>
      new Promise<void>((r) =>
        setTimeout(() => {
          order.push(name);
          r();
        }, 10),
      );
    const p1 = s.schedule('background', 'anthropic', signal, slow('bg1'));
    const p2 = s.schedule('background', 'anthropic', signal, slow('bg2'));
    const p3 = s.schedule('interactive', 'anthropic', signal, slow('explain'));
    await Promise.all([p1, p2, p3]);
    expect(order).toEqual(['bg1', 'explain', 'bg2']);
  });

  it('drops cancelled work from the queue', async () => {
    const s = new Scheduler(1);
    const c = new AbortController();
    const first = s.schedule('interactive', 'anthropic', new AbortController().signal, () => new Promise((r) => setTimeout(r, 20)));
    const second = s.schedule('interactive', 'anthropic', c.signal, async () => 'ran');
    c.abort();
    await expect(second).rejects.toThrow('Cancelled');
    await first;
  });
});
