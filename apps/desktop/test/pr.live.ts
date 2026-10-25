// Live: opens a public GitLab merge request through ReviewService (network).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Store } from '@legible/store';
import { expect, it } from 'vitest';

import { ReviewService } from '../src/main/reviews';

it('opens a GitLab merge request into a blobless cache clone', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'legible-pr-'));
  const store = new Store(join(dir, 'db.sqlite'));
  const hosts = { token: async () => null } as never;
  const reviews = new ReviewService(store, hosts, join(dir, 'repos'), () => undefined);
  const t0 = Date.now();
  const r = await reviews.open({ kind: 'pull_request', url: 'https://gitlab.com/gitlab-org/gitlab-test/-/merge_requests/68' });
  console.log(
    'opened in',
    Date.now() - t0,
    'ms',
    r.title,
    r.mode,
    r.latestIteration?.baseSha.slice(0, 8),
    r.latestIteration?.headSha.slice(0, 8),
  );
  const cs = await reviews.changeSet(r.id, null, false);
  console.log(
    'files',
    cs.files.map((f) => `${f.status} ${f.path} +${f.additions} -${f.deletions}`),
  );
  expect(cs.files.length).toBeGreaterThan(0);
  const again = await reviews.open({ kind: 'pull_request', url: 'https://gitlab.com/gitlab-org/gitlab-test/-/merge_requests/68' });
  expect(again.id).toBe(r.id);
  expect((await store.listIterations(r.id)).length).toBe(1);
  reviews.dispose();
}, 180_000);
