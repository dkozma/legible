// Cached blobless clones of remote repositories (ADR 0003), used for Pull
// Requests. They are bare, so nothing in them is ever checked out or run.

import { mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { GitRepo } from './repo';
import { runGit } from './run';

/**
 * Env that authenticates git's HTTPS requests to one host with a token, via
 * config env vars so the token never appears in process arguments.
 */
export function tokenAuthEnv(hostname: string, token: string, scheme: 'basic' | 'bearer' = 'basic'): NodeJS.ProcessEnv {
  const value =
    scheme === 'basic'
      ? `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`
      : `Authorization: Bearer ${token}`;
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `http.https://${hostname}/.extraheader`,
    GIT_CONFIG_VALUE_0: value,
  };
}

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export interface CloneTarget {
  cacheRoot: string;
  hostname: string;
  project: string;
  cloneUrl: string;
  env?: NodeJS.ProcessEnv;
}

/** Returns the cache clone for a remote, creating it on first use. */
export async function ensureCacheClone(t: CloneTarget): Promise<GitRepo> {
  const safeProject = t.project.replace(/[^A-Za-z0-9._/-]/g, '_').replace(/\.\.+/g, '_');
  const dir = join(t.cacheRoot, t.hostname, `${safeProject}.git`);
  if (!(await exists(join(dir, 'HEAD')))) {
    await mkdir(dirname(dir), { recursive: true });
    await runGit(['clone', '--bare', '--filter=blob:none', '--no-tags', '--', t.cloneUrl, dir], { env: t.env });
  }
  const repo = GitRepo.bare(dir, t.env);
  // Foreign-repo safety: no hooks, no fsmonitor, never anything that runs repo code.
  const emptyHooks = join(t.cacheRoot, '.empty-hooks');
  await mkdir(emptyHooks, { recursive: true });
  await repo.git(['config', 'core.hooksPath', emptyHooks]);
  await repo.git(['config', 'core.fsmonitor', 'false']);
  return repo;
}

/** Fetches refspecs into a cache clone. */
export async function fetchRefs(repo: GitRepo, refspecs: string[]) {
  await repo.git(['fetch', '--no-tags', '--force', '--filter=blob:none', 'origin', ...refspecs]);
}
