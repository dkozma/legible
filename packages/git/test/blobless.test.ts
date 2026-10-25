import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ensureCacheClone, type GitRepo, pathspecMatcher, runGit } from '../src/index';

let dir: string;
let clone: GitRepo;

const sh = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' });

async function missingCount() {
  const r = await runGit(['--git-dir', clone.gitDir, 'rev-list', '--objects', '--missing=print', 'HEAD^{tree}']);
  return r.stdout
    .toString('utf8')
    .split('\n')
    .filter((l) => l.startsWith('?')).length;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'legible-blobless-'));
  const src = join(dir, 'src');
  mkdirSync(join(src, 'a'), { recursive: true });
  mkdirSync(join(src, 'b'), { recursive: true });
  sh(dir, 'init', '-q', src);
  sh(src, 'config', 'uploadpack.allowFilter', 'true');
  sh(src, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  for (let i = 0; i < 3; i++) {
    writeFileSync(join(src, 'a', `f${i}.ts`), `export const needle${i} = ${i};\n`);
    writeFileSync(join(src, 'b', `g${i}.ts`), `export const hay${i} = ${i};\n`);
  }
  sh(src, 'add', '-A');
  sh(src, 'commit', '-qm', 'one');
  writeFileSync(join(src, 'a', 'f0.ts'), 'export const needle0 = 10;\n');
  sh(src, 'commit', '-qam', 'two');
  clone = await ensureCacheClone({ cacheRoot: join(dir, 'cache'), hostname: 'local', project: 'src', cloneUrl: `file://${src}` });
});

afterAll(() => {
  clone?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('blobless cache clones', () => {
  it('fetches only the blobs a scoped search reads, in one go', async () => {
    expect(await clone.isPartialClone()).toBe(true);
    expect(await missingCount()).toBe(6);
    const hits = await clone.grep('HEAD', 'needle', { pathspec: 'a' });
    expect(hits).toHaveLength(3);
    // b/ was never read.
    expect(await missingCount()).toBe(3);
  });

  it('prefetches a file’s history for blame', async () => {
    const lines = await clone.blame('HEAD', 'a/f0.ts', 1, 1);
    expect(lines[0]?.text).toBe('export const needle0 = 10;');
  });
});

describe('pathspecMatcher', () => {
  it('matches literal paths, directories and wildcards like git', () => {
    expect(pathspecMatcher('a')('a/f0.ts')).toBe(true);
    expect(pathspecMatcher('a/')('a/f0.ts')).toBe(true);
    expect(pathspecMatcher('a')('ab/f0.ts')).toBe(false);
    expect(pathspecMatcher('*.ts')('a/f0.ts')).toBe(true);
    expect(pathspecMatcher('a/f[01].ts')('a/f1.ts')).toBe(true);
    expect(pathspecMatcher('a/f[!01].ts')('a/f1.ts')).toBe(false);
    expect(pathspecMatcher('a/f?.ts')('a/f2.ts')).toBe(true);
    expect(pathspecMatcher('a.b')('axb')).toBe(false);
  });
});
