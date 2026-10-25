import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitRepo, parseRaw } from '../src/index';

let dir: string;
let repo: GitRepo;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'legible-git-test-'));
  execFileSync('node', [resolve(__dirname, '../../../fixtures/make-refund-repo.mjs'), dir]);
  repo = await GitRepo.open(join(dir, 'src'));
});

afterAll(() => {
  repo?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('GitRepo', () => {
  it('opens from a subdirectory', () => {
    expect(repo.workTree).toBe(dir);
    expect(repo.gitDir).toBe(join(dir, '.git'));
  });

  it('resolves refs, branches and the default base', async () => {
    expect(await repo.currentBranch()).toBe('feature/partial-refunds');
    expect(await repo.resolveCommit('main')).toMatch(/^[0-9a-f]{40}$/);
    expect(await repo.resolveCommit('does-not-exist')).toBeNull();
    expect(await repo.resolveCommit('--output=/tmp/x')).toBeNull();
    expect(await repo.defaultBaseRef()).toBe('main');
    expect(await repo.listBranches()).toEqual(expect.arrayContaining(['main', 'feature/partial-refunds']));
  });

  it('pairs changes with rename detection', async () => {
    const base = await repo.mergeBase('main', 'HEAD');
    const head = (await repo.resolveCommit('HEAD')) as string;
    const changes = await repo.diffRaw(base, head);
    const byPath = new Map(changes.map((c) => [c.path, c]));
    expect(byPath.get('src/refunds/refund-math.ts')).toMatchObject({ status: 'renamed', oldPath: 'src/refunds/refundUtils.ts' });
    expect(byPath.get('db/migrations/0008_partial_refunds.sql')).toMatchObject({ status: 'added', oldOid: null, oldPath: null });
    expect(byPath.get('src/refunds/RefundService.ts')).toMatchObject({ status: 'modified', oldPath: null });
  });

  it('snapshots the working tree without touching the index', async () => {
    const statusBefore = execFileSync('git', ['status', '--porcelain'], { cwd: dir }).toString();
    const snap = await repo.snapshot('test1');
    expect(snap.clean).toBe(false);
    const statusAfter = execFileSync('git', ['status', '--porcelain'], { cwd: dir }).toString();
    expect(statusAfter).toBe(statusBefore);
    // The untracked test file is in the Snapshot.
    const blob = await repo.blobs().readPath(snap.sha, 'src/refunds/RefundService.test.ts');
    expect(blob?.toString('utf8')).toContain('refunds part of the balance');
    expect(await repo.resolveCommit('refs/legible/snapshots/test1')).toBe(snap.sha);

    // Same tree again: stable.
    expect(await repo.workingTreeTree()).toBe(snap.tree);
    writeFileSync(join(dir, 'README.md'), 'changed\n');
    expect(await repo.workingTreeTree()).not.toBe(snap.tree);
  });

  it('reads blobs in batch, including missing ones', async () => {
    const head = (await repo.resolveCommit('HEAD')) as string;
    const [a, b, missing] = await Promise.all([
      repo.blobs().readPath(head, 'package.json'),
      repo.blobs().readPath(head, 'src/api/refunds.ts'),
      repo.blobs().readPath(head, 'nope.txt'),
    ]);
    expect(a?.toString()).toContain('storefront');
    expect(b?.toString()).toContain('postRefund');
    expect(missing).toBeNull();
  });

  it('supports the read-only queries agents use', async () => {
    const head = (await repo.resolveCommit('HEAD')) as string;
    expect(await repo.listFiles(head, 'src/api')).toEqual(['src/api/refunds.ts']);
    const hits = await repo.grep(head, 'calculateRefundable', { fixed: true });
    expect(hits.some((h) => h.startsWith('src/refunds/RefundService.ts:'))).toBe(true);
    const log = await repo.log(head, { path: 'src/refunds/RefundPolicy.ts' });
    expect(log.map((l) => l.subject)).toEqual(['Partial refunds and a 60-day window', 'Storefront with full refunds']);
    const blame = await repo.blame(head, 'src/refunds/RefundPolicy.ts', 3, 3);
    expect(blame[0]?.text).toContain('REFUND_WINDOW_DAYS = 60');
  });

  it('reads linguist attributes from a commit', async () => {
    const head = (await repo.resolveCommit('HEAD')) as string;
    const attrs = await repo.generatedAttributes(head, ['src/api/refunds.ts']);
    expect(attrs.get('src/api/refunds.ts')).toEqual({ generated: false, vendored: false });
  });
});

describe('parseRaw', () => {
  it('parses copies and type changes', () => {
    const raw = [':100644 100644 aaaa bbbb C75', 'a.ts', 'b.ts', ':100644 120000 aaaa cccc T', 'link', ''].join('\0');
    const changes = parseRaw(raw);
    expect(changes).toEqual([
      expect.objectContaining({ status: 'copied', oldPath: 'a.ts', path: 'b.ts', score: 75 }),
      expect.objectContaining({ status: 'typechange', path: 'link', oldPath: null }),
    ]);
  });
});
