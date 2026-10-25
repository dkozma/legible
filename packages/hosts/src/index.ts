// Read-only Pull Request access for GitHub (github.com and Enterprise Server)
// and GitLab (gitlab.com and self-managed). M1 only reads; writes arrive in M4.

import { spawn } from 'node:child_process';
import type { HostKind, PullRequestRef } from '@legible/domain';

export interface PullRequestInfo {
  ref: PullRequestRef;
  title: string;
  body: string;
  author: string | null;
  state: string;
  baseRef: string;
  /** The PR's target branch tip; the Base is the merge-base with Head. */
  baseSha: string;
  headRef: string;
  headSha: string;
  /** HTTPS clone URL of the base repository. */
  cloneUrl: string;
  /** Refspec that fetches the PR head into the cache clone. */
  headRefspec: string;
  /** True when the signed-in user can push to the PR's branch. */
  canPush: boolean;
}

export class HostError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly needsAuth = false,
  ) {
    super(message);
    this.name = 'HostError';
  }
}

/** Parses GitHub `/pull/N` and GitLab `/-/merge_requests/N` URLs. */
export function parsePullRequestUrl(input: string): PullRequestRef | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const hostname = url.host.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);

  const mr = parts.indexOf('-');
  if (mr > 0 && parts[mr + 1] === 'merge_requests' && /^\d+$/.test(parts[mr + 2] ?? '')) {
    const project = parts.slice(0, mr).join('/');
    const number = Number(parts[mr + 2]);
    return { host: 'gitlab', hostname, project, number, url: `https://${hostname}/${project}/-/merge_requests/${number}` };
  }
  if (parts.length >= 4 && parts[2] === 'pull' && /^\d+$/.test(parts[3] ?? '')) {
    const project = `${parts[0]}/${parts[1]}`;
    const number = Number(parts[3]);
    return { host: 'github', hostname, project, number, url: `https://${hostname}/${project}/pull/${number}` };
  }
  return null;
}

export function guessHostKind(hostname: string): HostKind {
  return hostname.includes('gitlab') ? 'gitlab' : 'github';
}

// ---------------------------------------------------------------------------
// Token reuse from the gh / glab CLIs. Only called after the user chose that
// source for a host in Settings.

function runCli(cmd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string | null> {
  return new Promise((resolve) => {
    let out = '';
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, {
        env: { ...process.env, ...env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => child.kill(), 10_000);
    child.stdout?.on('data', (d: Buffer) => {
      out += d.toString('utf8');
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? out.trim() || null : null);
    });
  });
}

/** Reads the token `gh` is signed in with for a host. */
export function ghToken(hostname: string, env?: NodeJS.ProcessEnv): Promise<string | null> {
  return runCli('gh', ['auth', 'token', '--hostname', hostname], env);
}

/** Reads the token `glab` is signed in with for a host. */
export function glabToken(hostname: string, env?: NodeJS.ProcessEnv): Promise<string | null> {
  return runCli('glab', ['config', 'get', 'token', '--host', hostname], env);
}

// ---------------------------------------------------------------------------
// REST

export function apiBase(ref: Pick<PullRequestRef, 'host' | 'hostname'>): string {
  if (ref.host === 'github') return ref.hostname === 'github.com' ? 'https://api.github.com' : `https://${ref.hostname}/api/v3`;
  return `https://${ref.hostname}/api/v4`;
}

type Fetch = typeof fetch;

async function getJson<T>(url: string, headers: Record<string, string>, fetchImpl: Fetch): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(url, { headers });
  } catch (e) {
    throw new HostError(`Couldn't reach ${new URL(url).host}: ${(e as Error).message}`, null);
  }
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    const authed = Boolean(headers.Authorization || headers['PRIVATE-TOKEN']);
    const what = res.status === 404 ? 'not found' : 'not allowed';
    throw new HostError(
      authed
        ? `${new URL(url).host}: ${what} (${res.status}). Check that the token can read this repository.`
        : `${new URL(url).host}: ${what} (${res.status}). Connect an account in Settings → Hosts.`,
      res.status,
      !authed,
    );
  }
  if (!res.ok) throw new HostError(`${new URL(url).host} returned ${res.status}`, res.status);
  return (await res.json()) as T;
}

interface GhPull {
  title: string;
  body: string | null;
  state: string;
  user: { login: string } | null;
  base: { ref: string; sha: string; repo: { clone_url: string } };
  head: { ref: string; sha: string; repo: { full_name: string; permissions?: { push?: boolean } } | null };
  maintainer_can_modify?: boolean;
}

interface GlMr {
  title: string;
  description: string | null;
  state: string;
  author: { username: string } | null;
  target_branch: string;
  source_branch: string;
  sha: string;
  diff_refs: { base_sha: string; head_sha: string; start_sha: string } | null;
  source_project_id: number;
  target_project_id: number;
}

interface GlProject {
  http_url_to_repo: string;
  permissions?: { project_access?: { access_level: number } | null; group_access?: { access_level: number } | null };
}

export async function getPullRequest(ref: PullRequestRef, token: string | null, fetchImpl: Fetch = fetch): Promise<PullRequestInfo> {
  const base = apiBase(ref);
  if (ref.host === 'github') {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Legible',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const pr = await getJson<GhPull>(`${base}/repos/${ref.project}/pulls/${ref.number}`, headers, fetchImpl);
    return {
      ref,
      title: pr.title,
      body: pr.body ?? '',
      author: pr.user?.login ?? null,
      state: pr.state,
      baseRef: pr.base.ref,
      baseSha: pr.base.sha,
      headRef: pr.head.ref,
      headSha: pr.head.sha,
      cloneUrl: pr.base.repo.clone_url,
      headRefspec: `+refs/pull/${ref.number}/head:refs/legible/pr/${ref.number}/head`,
      canPush: Boolean(pr.head.repo?.permissions?.push),
    };
  }

  const headers: Record<string, string> = { 'User-Agent': 'Legible' };
  if (token) headers['PRIVATE-TOKEN'] = token;
  const id = encodeURIComponent(ref.project);
  const mr = await getJson<GlMr>(`${base}/projects/${id}/merge_requests/${ref.number}`, headers, fetchImpl);
  const project = await getJson<GlProject>(`${base}/projects/${id}`, headers, fetchImpl);
  const level = Math.max(project.permissions?.project_access?.access_level ?? 0, project.permissions?.group_access?.access_level ?? 0);
  return {
    ref,
    title: mr.title,
    body: mr.description ?? '',
    author: mr.author?.username ?? null,
    state: mr.state,
    baseRef: mr.target_branch,
    baseSha: mr.diff_refs?.base_sha ?? '',
    headRef: mr.source_branch,
    headSha: mr.diff_refs?.head_sha ?? mr.sha,
    cloneUrl: project.http_url_to_repo,
    headRefspec: `+refs/merge-requests/${ref.number}/head:refs/legible/pr/${ref.number}/head`,
    // Developer (30) or above can push to branches in the target project.
    canPush: mr.source_project_id === mr.target_project_id && level >= 30,
  };
}

/** Who a token belongs to, for the Settings account list. */
export async function whoAmI(host: HostKind, hostname: string, token: string, fetchImpl: Fetch = fetch): Promise<string | null> {
  try {
    if (host === 'github') {
      const u = await getJson<{ login: string }>(
        `${apiBase({ host, hostname })}/user`,
        { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'Legible' },
        fetchImpl,
      );
      return u.login;
    }
    const u = await getJson<{ username: string }>(
      `${apiBase({ host, hostname })}/user`,
      { 'PRIVATE-TOKEN': token, 'User-Agent': 'Legible' },
      fetchImpl,
    );
    return u.username;
  } catch {
    return null;
  }
}
