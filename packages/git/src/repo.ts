// Repository operations Legible needs: resolving refs, merge-bases, pairing
// changed files, Snapshots, and read-only queries agents use as tools.

import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import type { FileStatus } from '@legible/domain';

import { BlobReader } from './catFile';
import { git, runGit } from './run';

export interface RawChange {
  status: FileStatus;
  /** Similarity score for renames/copies, 0–100. */
  score: number | null;
  oldMode: string;
  newMode: string;
  oldOid: string | null;
  newOid: string | null;
  oldPath: string | null;
  path: string;
}

const ZERO = /^0+$/;

/** Identity for Snapshot commits so they work in repos without user.email set. */
const SNAPSHOT_IDENT = {
  GIT_AUTHOR_NAME: 'Legible',
  GIT_AUTHOR_EMAIL: 'snapshot@legible.invalid',
  GIT_COMMITTER_NAME: 'Legible',
  GIT_COMMITTER_EMAIL: 'snapshot@legible.invalid',
};

export class GitRepo {
  private reader: BlobReader | null = null;

  private constructor(
    /** Absolute git dir. */
    readonly gitDir: string,
    /** Working tree, or null for bare cache clones. */
    readonly workTree: string | null,
    /** Extra env (auth headers) for commands that may hit the network. */
    readonly env?: NodeJS.ProcessEnv,
  ) {}

  /** Opens the repository containing `path`. */
  static async open(path: string): Promise<GitRepo> {
    const abs = resolve(path);
    const out = await git(['rev-parse', '--absolute-git-dir', '--is-bare-repository'], { cwd: abs });
    const [gitDir, bare] = out.trim().split('\n');
    if (!gitDir) throw new Error(`Not a git repository: ${path}`);
    if (bare === 'true') return new GitRepo(gitDir, null);
    const top = (await git(['rev-parse', '--show-toplevel'], { cwd: abs })).trim();
    return new GitRepo(gitDir, top);
  }

  /** Wraps an existing bare repo (cache clone) without probing. */
  static bare(gitDir: string, env?: NodeJS.ProcessEnv): GitRepo {
    return new GitRepo(gitDir, null, env);
  }

  static at(gitDir: string, workTree: string | null, env?: NodeJS.ProcessEnv): GitRepo {
    return new GitRepo(gitDir, workTree, env);
  }

  /** Runs git against this repo. */
  git(args: string[], opts: { input?: string; env?: NodeJS.ProcessEnv; allowFailure?: boolean } = {}) {
    const prefix = ['--git-dir', this.gitDir];
    if (this.workTree) prefix.push('--work-tree', this.workTree);
    return runGit([...prefix, ...args], {
      cwd: this.workTree ?? this.gitDir,
      env: { ...this.env, ...opts.env },
      input: opts.input,
      allowFailure: opts.allowFailure,
    });
  }

  async text(args: string[], opts: { input?: string; env?: NodeJS.ProcessEnv } = {}): Promise<string> {
    return (await this.git(args, opts)).stdout.toString('utf8');
  }

  blobs(): BlobReader {
    this.reader ??= new BlobReader(this.gitDir, this.env);
    return this.reader;
  }

  close() {
    this.reader?.close();
    this.reader = null;
  }

  /** Resolves a revision to a full commit sha, or null. */
  async resolveCommit(rev: string): Promise<string | null> {
    if (rev.startsWith('-')) return null;
    const r = await this.git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${rev}^{commit}`], { allowFailure: true });
    if (r.code !== 0) return null;
    return r.stdout.toString('utf8').trim() || null;
  }

  async treeOf(rev: string): Promise<string> {
    return (await this.text(['rev-parse', '--verify', '--end-of-options', `${rev}^{tree}`])).trim();
  }

  async mergeBase(a: string, b: string): Promise<string> {
    const r = await this.git(['merge-base', a, b], { allowFailure: true });
    const sha = r.stdout.toString('utf8').trim();
    if (r.code !== 0 || !sha) throw new Error(`No common ancestor between ${a} and ${b}`);
    return sha;
  }

  async currentBranch(): Promise<string | null> {
    const r = await this.git(['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true });
    return r.code === 0 ? r.stdout.toString('utf8').trim() : null;
  }

  async remoteUrl(name = 'origin'): Promise<string | null> {
    const r = await this.git(['remote', 'get-url', name], { allowFailure: true });
    return r.code === 0 ? r.stdout.toString('utf8').trim() : null;
  }

  /**
   * The branch a feature branch is usually compared against: origin/HEAD's
   * target, else the first of main/master/trunk/develop that exists.
   */
  async defaultBaseRef(): Promise<string | null> {
    const r = await this.git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], { allowFailure: true });
    if (r.code === 0) {
      const ref = r.stdout.toString('utf8').trim();
      if (ref) return ref;
    }
    for (const name of ['main', 'master', 'trunk', 'develop']) {
      if (await this.resolveCommit(`refs/remotes/origin/${name}`)) return `origin/${name}`;
      if (await this.resolveCommit(`refs/heads/${name}`)) return name;
    }
    return null;
  }

  async listBranches(): Promise<string[]> {
    const out = await this.text(['for-each-ref', '--format=%(refname:short)', '--sort=-committerdate', 'refs/heads', 'refs/remotes']);
    return out
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s && !s.endsWith('/HEAD') && s !== 'origin');
  }

  /** Pairs changed files between two commits, with rename and copy detection. */
  async diffRaw(base: string, head: string): Promise<RawChange[]> {
    const out = await this.git([
      'diff',
      '--raw',
      '-z',
      '-M',
      '-C',
      '--no-abbrev',
      '--no-ext-diff',
      '--no-textconv',
      '-l5000',
      base,
      head,
      '--',
    ]);
    return parseRaw(out.stdout.toString('utf8'));
  }

  /**
   * Captures the working tree, including untracked (non-ignored) and
   * uncommitted files, without touching the user's index or stash. Returns
   * the tree, and a commit on top of HEAD when the tree differs from HEAD's.
   */
  async workingTreeTree(): Promise<string> {
    if (!this.workTree) throw new Error('Repository has no working tree');
    const dir = await mkdtemp(join(tmpdir(), 'legible-index-'));
    const indexFile = join(dir, 'index');
    try {
      const realIndex = (await this.text(['rev-parse', '--git-path', 'index'])).trim();
      const abs = isAbsolute(realIndex) ? realIndex : join(this.workTree, realIndex);
      // Starting from a copy of the real index keeps stat info, so `add -A` only hashes changed files.
      await copyFile(abs, indexFile).catch(() => undefined);
      const env = { GIT_INDEX_FILE: indexFile };
      await this.git(['add', '-A', '--', '.'], { env });
      return (await this.text(['write-tree'], { env })).trim();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async snapshot(id: string): Promise<{ sha: string; tree: string; clean: boolean }> {
    const tree = await this.workingTreeTree();
    const head = await this.resolveCommit('HEAD');
    if (head && (await this.treeOf(head)) === tree) return { sha: head, tree, clean: true };
    const args = ['commit-tree', tree, '-m', `Legible Snapshot ${id}`];
    if (head) args.splice(2, 0, '-p', head);
    const sha = (await this.text(args, { env: SNAPSHOT_IDENT })).trim();
    await this.git(['update-ref', `refs/legible/snapshots/${id}`, sha]);
    return { sha, tree, clean: false };
  }

  /** linguist-generated / linguist-vendored attributes as of a commit. */
  async generatedAttributes(rev: string, paths: string[]): Promise<Map<string, { generated: boolean; vendored: boolean }>> {
    const result = new Map<string, { generated: boolean; vendored: boolean }>();
    if (paths.length === 0) return result;
    const r = await this.git(['check-attr', '-z', `--source=${rev}`, '--stdin', 'linguist-generated', 'linguist-vendored'], {
      input: `${paths.join('\0')}\0`,
      allowFailure: true,
    });
    if (r.code !== 0) return result;
    const parts = r.stdout.toString('utf8').split('\0');
    for (let i = 0; i + 2 < parts.length; i += 3) {
      const path = parts[i] as string;
      const attr = parts[i + 1];
      const value = parts[i + 2];
      const entry = result.get(path) ?? { generated: false, vendored: false };
      const on = value === 'set' || value === 'true';
      if (attr === 'linguist-generated') entry.generated = on;
      if (attr === 'linguist-vendored') entry.vendored = on;
      result.set(path, entry);
    }
    return result;
  }

  // ---- Read-only queries used by agent tools --------------------------------

  async listFiles(rev: string, pathPrefix?: string): Promise<string[]> {
    const args = ['ls-tree', '-r', '--name-only', '-z', rev];
    if (pathPrefix) args.push('--', pathPrefix);
    const out = await this.text(args);
    return out.split('\0').filter(Boolean);
  }

  /** `git grep` in a commit's tree. Returns "path:line:text" style matches. */
  async grep(rev: string, pattern: string, opts: { pathspec?: string; maxCount?: number; ignoreCase?: boolean; fixed?: boolean } = {}) {
    const args = ['grep', '-n', '-I', '--no-color', '--full-name'];
    if (opts.ignoreCase) args.push('-i');
    args.push(opts.fixed ? '-F' : '-E');
    if (opts.maxCount) args.push(`--max-count=${opts.maxCount}`);
    args.push('-e', pattern, rev, '--');
    if (opts.pathspec) args.push(opts.pathspec);
    const r = await this.git(args, { allowFailure: true });
    // Exit 1 = no matches.
    if (r.code !== 0 && r.code !== 1) throw new Error(r.stderr.trim() || 'git grep failed');
    const prefix = `${rev}:`;
    return r.stdout
      .toString('utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => (l.startsWith(prefix) ? l.slice(prefix.length) : l));
  }

  async log(rev: string, opts: { path?: string; maxCount?: number } = {}) {
    const args = ['log', `--max-count=${opts.maxCount ?? 20}`, '--format=%H%x00%an%x00%ad%x00%s', '--date=short', rev, '--'];
    if (opts.path) args.push(opts.path);
    const out = await this.text(args);
    return out
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [sha, author, date, subject] = l.split('\0');
        return { sha: sha ?? '', author: author ?? '', date: date ?? '', subject: subject ?? '' };
      });
  }

  async blame(rev: string, path: string, start: number, end: number) {
    const out = await this.text(['blame', '--porcelain', '-L', `${start},${end}`, rev, '--', path]);
    const lines: { line: number; sha: string; author: string; summary: string; text: string }[] = [];
    const commits = new Map<string, { author: string; summary: string }>();
    let current: { sha: string; line: number } | null = null;
    for (const l of out.split('\n')) {
      const header = l.match(/^([0-9a-f]{40,64}) \d+ (\d+)/);
      if (header) {
        current = { sha: header[1] as string, line: Number(header[2]) };
        continue;
      }
      if (!current) continue;
      const info = commits.get(current.sha) ?? { author: '', summary: '' };
      if (l.startsWith('author ')) info.author = l.slice(7);
      else if (l.startsWith('summary ')) info.summary = l.slice(8);
      commits.set(current.sha, info);
      if (l.startsWith('\t')) {
        const c = commits.get(current.sha) as { author: string; summary: string };
        lines.push({ line: current.line, sha: current.sha, author: c.author, summary: c.summary, text: l.slice(1) });
      }
    }
    return lines;
  }
}

export function parseRaw(out: string): RawChange[] {
  const parts = out.split('\0');
  const changes: RawChange[] = [];
  let i = 0;
  while (i < parts.length) {
    const meta = parts[i];
    if (!meta?.startsWith(':')) {
      i++;
      continue;
    }
    // :oldmode newmode oldsha newsha status
    const [oldMode, newMode, oldSha, newSha, statusField] = meta.slice(1).split(' ');
    const letter = (statusField ?? 'M')[0] as string;
    const score = statusField && statusField.length > 1 ? Number(statusField.slice(1)) : null;
    const twoPaths = letter === 'R' || letter === 'C';
    const p1 = parts[i + 1] ?? '';
    const p2 = twoPaths ? (parts[i + 2] ?? '') : null;
    i += twoPaths ? 3 : 2;
    const status: FileStatus =
      letter === 'A'
        ? 'added'
        : letter === 'D'
          ? 'deleted'
          : letter === 'R'
            ? 'renamed'
            : letter === 'C'
              ? 'copied'
              : letter === 'T'
                ? 'typechange'
                : 'modified';
    changes.push({
      status,
      score,
      oldMode: oldMode ?? '',
      newMode: newMode ?? '',
      oldOid: oldSha && !ZERO.test(oldSha) ? oldSha : null,
      newOid: newSha && !ZERO.test(newSha) ? newSha : null,
      oldPath: twoPaths ? p1 : null,
      path: twoPaths ? (p2 as string) : p1,
    });
  }
  return changes;
}
