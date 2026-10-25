import { spawn } from 'node:child_process';

export class GitError extends Error {
  constructor(
    message: string,
    readonly args: string[],
    readonly code: number | null,
    readonly stderr: string,
  ) {
    super(message);
    this.name = 'GitError';
  }
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string | Buffer;
  /** Resolve with the result instead of throwing on a non-zero exit. */
  allowFailure?: boolean;
  signal?: AbortSignal;
}

export interface RunResult {
  stdout: Buffer;
  stderr: string;
  code: number | null;
}

/** Path of the git binary; overridable for tests and unusual installs. */
export let gitBinary = 'git';
export function setGitBinary(path: string) {
  gitBinary = path;
}

/**
 * Environment every git call gets: no prompts, no pagers, no user-specific
 * diff drivers, and a stable locale so we can parse output.
 */
export function baseEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_PAGER: 'cat',
    PAGER: 'cat',
    LC_ALL: 'C',
    GIT_OPTIONAL_LOCKS: '0',
    ...extra,
  };
}

export function runGit(args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(gitBinary, args, {
      cwd: opts.cwd,
      env: baseEnv(opts.env),
      stdio: ['pipe', 'pipe', 'pipe'],
      signal: opts.signal,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => err.push(d));
    child.on('error', (e) => reject(new GitError(`git ${args[0]}: ${e.message}`, args, null, '')));
    child.on('close', (code) => {
      const stderr = Buffer.concat(err).toString('utf8');
      const result = { stdout: Buffer.concat(out), stderr, code };
      if (code !== 0 && !opts.allowFailure) {
        reject(new GitError(`git ${args.join(' ')} failed (${code}): ${stderr.trim()}`, args, code, stderr));
      } else {
        resolve(result);
      }
    });
    // Git may exit before reading all of stdin (e.g. it rejects an option); the
    // resulting EPIPE is not the error, the exit code is, and 'close' reports it.
    child.stdin.on('error', () => undefined);
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

export async function git(args: string[], opts: RunOptions = {}): Promise<string> {
  const r = await runGit(args, opts);
  return r.stdout.toString('utf8');
}

export async function gitVersion(): Promise<{ version: string; ok: boolean }> {
  const out = await git(['--version']);
  const m = out.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  const major = Number(m?.[1] ?? 0);
  const minor = Number(m?.[2] ?? 0);
  return { version: m?.[0] ?? out.trim(), ok: major > 2 || (major === 2 && minor >= 40) };
}
