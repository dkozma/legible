// Live smoke test against a real Claude. Not part of `pnpm test`; run with:
//   npx vitest run --config vitest.live.config.ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ClaudeSdkRuntime, DEFAULT_TIERS, Router, runTask, Scheduler } from '@legible/agent-runtime';
import { diffLines, splitLines } from '@legible/diff';
import { GitRepo } from '@legible/git';
import { expect, it } from 'vitest';
import { explanationTask, toExplanationBody } from '../src/index';

it('explains a real range with Claude Code', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'legible-live-'));
  execFileSync('node', [resolve(__dirname, '../../../fixtures/make-refund-repo.mjs'), dir]);
  const repo = await GitRepo.open(dir);
  const headSha = (await repo.resolveCommit('HEAD')) as string;
  const baseSha = await repo.mergeBase('main', headSha);
  const path = 'src/refunds/RefundService.ts';
  const base = splitLines((await repo.blobs().readPath(baseSha, path))?.toString() ?? '');
  const head = splitLines((await repo.blobs().readPath(headSha, path))?.toString() ?? '');
  const runtime = new ClaudeSdkRuntime({
    auth: 'claude-code',
    executablePath: null,
    env: {},
    bedrock: { region: '', profile: '' },
    vertex: { projectId: '', region: '' },
    foundry: { resource: '' },
    clientApp: 'legible-test/0.1.0',
    scratchDir: mkdtempSync(join(tmpdir(), 'legible-scratch-')),
    bundledExecutable: null,
  });
  console.log(await runtime.status());
  const events: string[] = [];
  const t0 = Date.now();
  const result = await runTask(
    new Router({ anthropic: runtime }, DEFAULT_TIERS),
    new Scheduler(2),
    explanationTask({
      target: { kind: 'range', fileId: 'f', path, oldPath: null, baseRange: null, headRange: [52, 68] },
      file: { path, oldPath: null, status: 'modified', language: 'typescript' },
      baseLines: base,
      headLines: head,
      chunks: diffLines(base, head),
      intent: { title: 'Partial refunds', body: 'Allow partial refunds and extend the refund window to 60 days.' },
      context: { repo, baseSha, headSha, changedFiles: [] },
    }),
    { signal: new AbortController().signal, budgetUsd: 0.1, onEvent: (e) => events.push(JSON.stringify(e)) },
  );
  console.log(`${Date.now() - t0}ms`, result.costUsd, result.numTurns, events);
  console.log(JSON.stringify(toExplanationBody(result.output!), null, 2));
  expect(result.output?.after).toBeTruthy();
  repo.close();
}, 120_000);
