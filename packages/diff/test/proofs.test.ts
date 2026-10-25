// Regressions from review: a Structural proof must never hide a behavioral change.
import { describe, expect, it } from 'vitest';

import { buildFileDiff, detectMoves, diffLines, highlightLines, languageForPath } from '../src/index';

function proofs(path: string, base: string[], head: string[]) {
  const language = languageForPath(path);
  const chunks = diffLines(base, head);
  const d = buildFileDiff({
    fileId: 'f',
    path,
    language,
    baseLines: base,
    headLines: head,
    baseTokens: highlightLines(language, base),
    headTokens: highlightLines(language, head),
    chunks,
  });
  return d.fragments.map((f) => f.proof);
}

const none = (p: (string | null)[]) => expect(p.every((x) => x === null)).toBe(true);

describe('no false Structural proofs', () => {
  it('blank lines inside template literals', () => {
    none(proofs('a.ts', ['const s = `${a}', '${b}`;'], ['const s = `${a}', '', '${b}`;']));
    none(proofs('a.ts', ['const q = sql`', '  FROM ${t}', '  WHERE x`;'], ['const q = sql`', '  FROM ${t}', '', '  WHERE x`;']));
    none(proofs('a.ts', ['const s = `x\\n', '', 'y`;'], ['const s = `x\\n', 'y`;']));
  });

  it('a lone brace that changes nesting while other code moves', () => {
    const base = ['function f() {', '  one();', '  two();', '  three();', '}', 'if (x) {', '  a();', '}', 'b();'];
    const head = ['function g() {}', 'if (x) {', '  a();', '  b();', '}', 'function f() {', '  one();', '  two();', '  three();', '}'];
    none(proofs('a.ts', base, head));
  });

  it('whitespace in languages whose grammar can’t see multi-line strings', () => {
    // Kotlin raw string: the blank line is part of the value.
    none(proofs('a.kt', ['val s = """', 'a', 'b"""'], ['val s = """', 'a', '', 'b"""']));
    none(proofs('a.cs', ['var s = @"', 'a', 'b";'], ['var s = @"', 'a', '', 'b";']));
  });

  it('top-level code moved within a file, which reorders what runs', () => {
    const steps = ['rm -rf /tmp/build', 'mkdir /tmp/build', 'cp a /tmp/build'];
    const base = ['set -e', ...steps, 'echo one', 'echo two', 'echo three', 'echo four', 'exit 0'];
    const head = ['set -e', 'echo one', 'echo two', 'echo three', 'echo four', 'exit 0', ...steps];
    none(proofs('build.sh', base, head));
    const rules = ['.a {', '  color: red;', '}'];
    none(proofs('x.css', [...rules, '.b {', '  color: blue;', '}'], ['.b {', '  color: blue;', '}', ...rules]));
    const init = ['const config = load();', 'register(config);', 'start();'];
    none(
      proofs(
        'a.ts',
        [...init, 'export const ready = true;', 'log("a");', 'log("b");'],
        ['export const ready = true;', 'log("a");', 'log("b");', ...init],
      ),
    );
  });

  it('code moved out of a conditional', () => {
    none(proofs('a.ts', ['if (cond) {', '  a();', '  b();', '  c();', '}'], ['if (cond) {', '}', 'a();', 'b();', 'c();']));
  });

  it('indentation in indentation-sensitive or prose formats', () => {
    none(
      proofs(
        'x.sass',
        ['.a', '  .b', '    color: red', '    margin: 0', '    padding: 0'],
        ['.a', '  .b', '  color: red', '  margin: 0', '  padding: 0'],
      ),
    );
    none(proofs('a.md', ['line one', 'line two'], ['line one', '', 'line two']));
    none(proofs('a.md', ['line one  ', 'line two'], ['line one', 'line two']));
    none(proofs('a.html', ['<pre>', '    code', '</pre>'], ['<pre>', 'code', '</pre>']));
    none(proofs('a.rb', ['x = <<EOS', '  text', 'EOS'], ['x = <<EOS', 'text', 'EOS']));
    none(proofs('a.yaml', ['a: |', '  one', '  two'], ['a: |', '  one', '', '  two']));
  });

  it('preprocessor spacing in C', () => {
    none(proofs('a.c', ['#define X(a) a', '#define Y (a) a'], ['#define X(a) a', '#define Y(a) a']));
  });

  it('whitespace after a line-continuation backslash', () => {
    none(proofs('a.c', ['#define X 1 \\', '  + 2'], ['#define X 1 \\ ', '  + 2']));
  });
});

describe('real Structural proofs still hold', () => {
  it('re-indented TypeScript', () => {
    expect(proofs('a.ts', ['function f() {', 'return 1;', '}'], ['function f() {', '  return 1;', '}'])).toEqual(['whitespace']);
  });

  it('a top-level function moved verbatim between files is detected, not proven', () => {
    const fn = ['export function total(items) {', '  let sum = 0;', '  for (const i of items) sum += i.price;', '  return sum;', '}'];
    const aBase = ['import x from "y";', '', ...fn];
    const aHead = ['import x from "y";'];
    const bBase = ['// math'];
    const bHead = ['// math', ...fn];
    const files = [
      { fileId: 'a', path: 'a.ts', language: 'typescript', baseLines: aBase, headLines: aHead, chunks: diffLines(aBase, aHead) },
      { fileId: 'b', path: 'b.ts', language: 'typescript', baseLines: bBase, headLines: bHead, chunks: diffLines(bBase, bHead) },
    ];
    const moves = detectMoves(files);
    expect(moves[0]?.exact).toBe(true);
  });
});
