// A long-lived `git cat-file --batch` process for fast blob reads.

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { baseEnv, GitError, gitBinary } from './run';

interface Pending {
  oid: string;
  resolve: (b: Buffer | null) => void;
  reject: (e: Error) => void;
}

export class BlobReader {
  private child: ChildProcessWithoutNullStreams | null = null;
  private queue: Pending[] = [];
  private buf: Buffer = Buffer.alloc(0);
  private expecting: { size: number } | null = null;
  private stderr = '';

  constructor(
    private readonly gitDir: string,
    private readonly env?: NodeJS.ProcessEnv,
  ) {}

  /** Reads an object's content, or null if it doesn't exist. */
  read(oid: string): Promise<Buffer | null> {
    if (!/^[0-9a-f]{40,64}$/.test(oid)) return Promise.reject(new Error(`Not an object id: ${oid}`));
    return new Promise((resolve, reject) => {
      const child = this.ensure();
      this.queue.push({ oid, resolve, reject });
      child.stdin.write(`${oid}\n`);
    });
  }

  /** Reads `<rev>:<path>`, resolving through the tree. */
  readPath(rev: string, path: string): Promise<Buffer | null> {
    return new Promise((resolve, reject) => {
      const child = this.ensure();
      const spec = `${rev}:${path}`;
      if (spec.includes('\n')) return reject(new Error('Invalid path'));
      this.queue.push({ oid: spec, resolve, reject });
      child.stdin.write(`${spec}\n`);
    });
  }

  close() {
    const child = this.child;
    this.child = null;
    this.reset(new Error('Blob reader closed'));
    child?.stdin.end();
    child?.kill();
  }

  /** Fails pending reads and clears parser state, so a new process starts clean. */
  private reset(e: Error) {
    const pending = this.queue;
    this.queue = [];
    this.buf = Buffer.alloc(0);
    this.expecting = null;
    for (const p of pending) p.reject(e);
  }

  private ensure(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;
    const child = spawn(gitBinary, ['--git-dir', this.gitDir, 'cat-file', '--batch'], { env: baseEnv(this.env) });
    // Every handler checks it still belongs to the current process: a closed
    // process's late events must never touch a newer one's queue.
    const current = () => this.child === child;
    child.stdout.on('data', (d: Buffer) => {
      if (current()) this.onData(d);
    });
    child.stderr.on('data', (d: Buffer) => {
      if (current()) this.stderr += d.toString('utf8');
    });
    const fail = (e: Error) => {
      if (!current()) return;
      this.child = null;
      this.reset(e);
    };
    child.on('error', (e) => fail(new GitError(`cat-file: ${e.message}`, ['cat-file'], null, this.stderr)));
    child.on('close', (code) => fail(new GitError(`cat-file exited (${code}): ${this.stderr.trim()}`, ['cat-file'], code, this.stderr)));
    this.child = child;
    return child;
  }

  private onData(d: Buffer) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    for (;;) {
      if (!this.expecting) {
        const nl = this.buf.indexOf(10);
        if (nl < 0) return;
        const header = this.buf.subarray(0, nl).toString('utf8');
        this.buf = this.buf.subarray(nl + 1);
        if (header.endsWith(' missing') || header.endsWith(' ambiguous')) {
          this.queue.shift()?.resolve(null);
          continue;
        }
        const size = Number(header.split(' ')[2]);
        if (!Number.isFinite(size)) {
          this.queue.shift()?.reject(new Error(`Unexpected cat-file header: ${header}`));
          continue;
        }
        this.expecting = { size };
      }
      if (this.buf.length < this.expecting.size + 1) return;
      const content = Buffer.from(this.buf.subarray(0, this.expecting.size));
      this.buf = this.buf.subarray(this.expecting.size + 1);
      this.expecting = null;
      this.queue.shift()?.resolve(content);
    }
  }
}
