import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Store } from '@legible/store';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { compareFiles } from '../src/main/changeSet';
import { ReviewService } from '../src/main/reviews';

let dir: string;
let repo: string;
let store: Store;
let reviews: ReviewService;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'legible-reviews-'));
  repo = join(dir, 'repo');
  execFileSync('node', [resolve(__dirname, '../../../fixtures/make-refund-repo.mjs'), repo]);
  store = new Store(join(dir, 'db.sqlite'));
  reviews = new ReviewService(store, { token: async () => null } as never, join(dir, 'repos'), () => undefined);
});

afterAll(async () => {
  reviews.dispose();
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('ReviewService', () => {
  it('opens a working tree as a Snapshot against the merge-base', async () => {
    const r = await reviews.open({ kind: 'working_tree', repoPath: repo, baseRef: null });
    expect(r).toMatchObject({ title: 'feature/partial-refunds', sourceKind: 'working_tree', baseRef: 'main', mode: 'author' });
    const cs = await reviews.changeSet(r.id, null, false);
    const byPath = new Map(cs.files.map((f) => [f.path, f]));

    expect(byPath.get('src/refunds/RefundService.test.ts')?.status).toBe('added'); // untracked, in the Snapshot
    expect(byPath.get('src/refunds/refund-math.ts')).toMatchObject({
      status: 'renamed',
      oldPath: 'src/refunds/refundUtils.ts',
      additions: 0,
      deletions: 0,
    });
    expect(byPath.get('pnpm-lock.yaml')?.collapse).toBe('lockfile');
    expect(byPath.get('src/config/limits.ts')?.structural).toBe('whitespace');
    expect(byPath.get('src/refunds/RefundService.ts')?.structural).toBeNull();
    // Directories before files, like the tree.
    expect(cs.files.map((f) => f.path)).toEqual(cs.files.toSorted(compareFiles).map((f) => f.path));

    const d = await reviews.fileDiff(r.id, cs.iterationId, byPath.get('src/refunds/RefundPolicy.ts')!.id, false);
    expect(d.headTokens).not.toBeNull();
    expect(d.headLines.join('\n')).toContain('REFUND_WINDOW_DAYS = 60');
  });

  it('reuses the Review and notices working-tree changes without refreshing', async () => {
    const r = await reviews.open({ kind: 'working_tree', repoPath: repo, baseRef: null });
    expect((await store.listIterations(r.id)).length).toBe(1);
    expect(await reviews.checkForChanges(r.id)).toEqual({ available: false, detail: null });

    appendFileSync(join(repo, 'README.md'), 'More.\n');
    expect((await reviews.checkForChanges(r.id)).available).toBe(true);
    expect((await store.listIterations(r.id)).length).toBe(1);

    const it2 = await reviews.refresh(r.id);
    expect(it2.seq).toBe(2);
    expect((await reviews.checkForChanges(r.id)).available).toBe(false);

    // Refreshing an unchanged tree, even twice at once, adds nothing.
    await Promise.all([reviews.refresh(r.id), reviews.refresh(r.id)]);
    expect((await store.listIterations(r.id)).length).toBe(2);

    // Concurrent refreshes after a change add exactly one Iteration.
    appendFileSync(join(repo, 'README.md'), 'Even more.\n');
    const [a, b] = await Promise.all([reviews.refresh(r.id), reviews.refresh(r.id)]);
    expect([a.seq, b.seq]).toEqual([3, 3]);
    expect((await store.listIterations(r.id)).length).toBe(3);
  });

  it('notices a further edit to an already-changed file', async () => {
    const r = await reviews.open({ kind: 'working_tree', repoPath: repo, baseRef: null });
    expect((await reviews.checkForChanges(r.id)).available).toBe(false);
    // Same status line (" M README.md") as before; only the file's size and mtime move.
    appendFileSync(join(repo, 'README.md'), 'And more.\n');
    expect((await reviews.checkForChanges(r.id)).available).toBe(true);
  });

  it('compares refs with three-dot semantics', async () => {
    const r = await reviews.open({ kind: 'refs', repoPath: repo, baseRef: 'main', headRef: 'feature/partial-refunds' });
    const cs = await reviews.changeSet(r.id, null, false);
    // Committed work only: no untracked test file.
    expect(cs.files.some((f) => f.path.endsWith('RefundService.test.ts'))).toBe(false);
    expect(cs.files.some((f) => f.path === 'src/refunds/RefundService.ts')).toBe(true);
  });

  it('keeps one watcher when watch() is called again before the first has started', async () => {
    const a = await reviews.open({ kind: 'working_tree', repoPath: repo, baseRef: null });
    const b = await reviews.open({ kind: 'refs', repoPath: repo, baseRef: 'main', headRef: 'feature/partial-refunds' });
    const set = vi.spyOn(globalThis, 'setInterval');
    const clear = vi.spyOn(globalThis, 'clearInterval');
    try {
      reviews.watch(a.id);
      reviews.watch(b.id);
      reviews.watch(b.id);
      await vi.waitFor(() => expect(set.mock.calls.length).toBeGreaterThanOrEqual(1));
      await new Promise((r) => setTimeout(r, 100));
      const cleared = new Set(clear.mock.calls.map((c) => c[0]));
      const live = set.mock.results.map((r) => r.value as unknown).filter((id) => !cleared.has(id as never));
      expect(live).toHaveLength(1);
    } finally {
      reviews.dispose();
      set.mockRestore();
      clear.mockRestore();
    }
  });

  it('explains user errors plainly', async () => {
    await expect(reviews.open({ kind: 'working_tree', repoPath: dir, baseRef: null })).rejects.toThrow("isn't inside a git repository");
    await expect(reviews.open({ kind: 'refs', repoPath: repo, baseRef: 'main', headRef: 'nope' })).rejects.toThrow("Can't find nope");
    await expect(reviews.open({ kind: 'pull_request', url: 'https://example.com/x' })).rejects.toThrow('pull request');
  });
});
