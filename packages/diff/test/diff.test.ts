import type { DiffChunk } from '@legible/domain';
import { describe, expect, it } from 'vitest';
import { buildFileDiff, collapseReason, detectMoves, diffLines, highlightLines, languageForPath, splitLines, wordDiff } from '../src/index';

function check(base: string[], head: string[], chunks: DiffChunk[]) {
  // Chunks tile both sides exactly, in order, and equal chunks really are equal.
  let b = 0;
  let h = 0;
  for (const c of chunks) {
    expect(c.baseStart).toBe(b);
    expect(c.headStart).toBe(h);
    if (c.kind === 'equal') {
      expect(c.baseEnd - c.baseStart).toBe(c.headEnd - c.headStart);
      for (let i = 0; i < c.baseEnd - c.baseStart; i++) expect(base[c.baseStart + i]).toBe(head[c.headStart + i]);
    }
    b = c.baseEnd;
    h = c.headEnd;
  }
  expect(b).toBe(base.length);
  expect(h).toBe(head.length);
}

function changedLines(chunks: DiffChunk[]) {
  return chunks.filter((c) => c.kind === 'change').reduce((n, c) => n + (c.baseEnd - c.baseStart) + (c.headEnd - c.headStart), 0);
}

// Small deterministic PRNG so property tests are reproducible.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('diffLines', () => {
  it('handles identical, empty, and fully different inputs', () => {
    expect(diffLines([], [])).toEqual([]);
    expect(diffLines(['a'], ['a'])).toEqual([{ kind: 'equal', baseStart: 0, baseEnd: 1, headStart: 0, headEnd: 1 }]);
    expect(diffLines([], ['a', 'b'])).toEqual([{ kind: 'change', baseStart: 0, baseEnd: 0, headStart: 0, headEnd: 2 }]);
    expect(diffLines(['x'], ['y'])).toEqual([{ kind: 'change', baseStart: 0, baseEnd: 1, headStart: 0, headEnd: 1 }]);
  });

  it('finds a minimal-looking diff for a simple insertion', () => {
    const base = ['a', 'b', 'c', 'd'];
    const head = ['a', 'b', 'x', 'c', 'd'];
    const chunks = diffLines(base, head);
    check(base, head, chunks);
    expect(changedLines(chunks)).toBe(1);
  });

  it('prefers unique lines as anchors over repeated braces', () => {
    const base = ['function a() {', '  return 1;', '}', '', 'function b() {', '  return 2;', '}'];
    const head = ['function b() {', '  return 2;', '}', '', 'function a() {', '  return 1;', '}'];
    const chunks = diffLines(base, head);
    check(base, head, chunks);
  });

  it('tiles both sides for random edits (property)', () => {
    const r = rng(42);
    const vocab = ['{', '}', 'return x;', 'let a = 1;', 'b++', '', 'if (a) {', 'foo()', 'bar()', 'baz()'];
    for (let iter = 0; iter < 300; iter++) {
      const base = Array.from({ length: Math.floor(r() * 60) }, () => vocab[Math.floor(r() * vocab.length)] as string);
      const head = base.slice();
      const edits = Math.floor(r() * 10);
      for (let e = 0; e < edits; e++) {
        const at = Math.floor(r() * (head.length + 1));
        const op = r();
        if (op < 0.4) head.splice(at, 0, vocab[Math.floor(r() * vocab.length)] as string);
        else if (op < 0.8) head.splice(at, 1);
        else head[at] = `changed ${e}`;
      }
      const chunks = diffLines(base, head);
      check(base, head, chunks);
      // Never worse than "delete everything, add everything".
      expect(changedLines(chunks)).toBeLessThanOrEqual(base.length + head.length);
    }
  });

  it('ignores whitespace when asked', () => {
    const base = ['if (a) {', 'return 1;', '}'];
    const head = ['if (a) {', '    return 1;', '}'];
    expect(changedLines(diffLines(base, head))).toBe(2);
    expect(changedLines(diffLines(base, head, { ignoreWhitespace: true }))).toBe(0);
  });

  it('diffs a 20k-line file quickly', () => {
    const base = Array.from({ length: 20_000 }, (_, i) => `line ${i % 500} ${i}`);
    const head = base.slice();
    for (let i = 0; i < 200; i++) head.splice(i * 97, 1, `edited ${i}`);
    const t = performance.now();
    const chunks = diffLines(base, head);
    expect(performance.now() - t).toBeLessThan(1500);
    check(base, head, chunks);
    expect(changedLines(chunks)).toBe(400);
  });

  it('splits lines without inventing a trailing empty line', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('a\r\nb')).toEqual(['a\r', 'b']);
    expect(splitLines('')).toEqual([]);
  });
});

describe('wordDiff', () => {
  it('marks only the changed words', () => {
    const w = wordDiff('const refund = gateway.refund(id, order.total);', 'const refund = gateway.refund(id, requested);');
    expect(w).not.toBeNull();
    const base = 'const refund = gateway.refund(id, order.total);';
    const [s, e] = (w as { base: number[] }).base;
    expect(base.slice(s, e)).toBe('order.total');
  });

  it('returns null for unrelated lines', () => {
    expect(wordDiff('import a from "b";', 'export default function main() {}')).toBeNull();
  });
});

function file(language: string, base: string, head: string) {
  const baseLines = splitLines(base);
  const headLines = splitLines(head);
  return buildFileDiff({
    fileId: 'f',
    path: `x.${language}`,
    language,
    baseLines,
    headLines,
    baseTokens: highlightLines(language, baseLines),
    headTokens: highlightLines(language, headLines),
  });
}

describe('Structural proofs', () => {
  it('proves re-indentation in TypeScript is whitespace-only', () => {
    const d = file('typescript', 'function f() {\nreturn 1;\n}\n', 'function f() {\n  return 1;\n}\n');
    expect(d.fragments).toHaveLength(1);
    expect(d.fragments[0]?.kind).toBe('structural');
    expect(d.fragments[0]?.proof).toBe('whitespace');
  });

  it('does not prove re-indentation in Python', () => {
    const d = file('python', 'if a:\n    x()\ny()\n', 'if a:\n    x()\n    y()\n');
    expect(d.fragments[0]?.kind).toBe('behavioral');
  });

  it('does not prove whitespace changes inside a template literal', () => {
    const d = file('typescript', 'const s = `\n  a\n`;\n', 'const s = `\n    a\n`;\n');
    expect(d.fragments[0]?.kind).toBe('behavioral');
  });

  it('does not prove whitespace changes inside a string', () => {
    const d = file('typescript', 'const s = "a  b";\n', 'const s = "a b";\n');
    expect(d.fragments[0]?.kind).toBe('behavioral');
  });

  it('proves operator spacing in TypeScript is formatting', () => {
    const d = file('typescript', 'const x = a+b;\n', 'const x = a + b;\n');
    expect(d.fragments[0]?.proof).toBe('formatting');
  });

  it('keeps operator merges behavioral', () => {
    const d = file('typescript', 'const x = a - -b;\n', 'const x = a--b;\n');
    expect(d.fragments[0]?.kind).toBe('behavioral');
  });

  it('never proves spacing changes in shell', () => {
    const d = file('shell', 'a = b\n', 'a=b\n');
    expect(d.fragments[0]?.kind).toBe('behavioral');
  });

  it('treats real changes as behavioral', () => {
    const d = file('typescript', 'const days = 30;\n', 'const days = 60;\n');
    expect(d.fragments[0]?.kind).toBe('behavioral');
    expect(d.headWords[0]).toBeDefined();
  });

  it('gives identical content the same Fragment id across runs', () => {
    const a = file('typescript', 'a\nb\n', 'a\nc\n');
    const b = file('typescript', 'a\nb\n', 'a\nc\n');
    expect(a.fragments[0]?.id).toBe(b.fragments[0]?.id);
  });
});

describe('detectMoves', () => {
  it('finds a function moved between files', () => {
    const fn = ['export function total(items) {', '  let sum = 0;', '  for (const i of items) sum += i.price;', '  return sum;', '}'];
    const aBase = ['import x from "y";', '', ...fn, '', 'export const z = 1;'];
    const aHead = ['import x from "y";', '', 'export const z = 1;'];
    const bBase = ['// math'];
    const bHead = ['// math', ...fn];
    const files = [
      { fileId: 'a', path: 'a.ts', language: 'typescript', baseLines: aBase, headLines: aHead, chunks: diffLines(aBase, aHead) },
      { fileId: 'b', path: 'b.ts', language: 'typescript', baseLines: bBase, headLines: bHead, chunks: diffLines(bBase, bHead) },
    ];
    const moves = detectMoves(files);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ fromPath: 'a.ts', toPath: 'b.ts', fromStart: 3, fromEnd: 7, toStart: 2, toEnd: 6 });

    const d = buildFileDiff({
      fileId: 'b',
      path: 'b.ts',
      language: 'typescript',
      baseLines: bBase,
      headLines: bHead,
      baseTokens: null,
      headTokens: null,
      moves,
    });
    expect(d.fragments[0]?.proof).toBe('move');
  });

  it('ignores short coincidental matches', () => {
    const base = ['return null;', '}'];
    const head = ['}', 'return null;'];
    const files = [{ fileId: 'a', path: 'a.ts', language: 'typescript', baseLines: base, headLines: head, chunks: diffLines(base, head) }];
    expect(detectMoves(files)).toHaveLength(0);
  });
});

describe('classification', () => {
  it('detects languages', () => {
    expect(languageForPath('src/a.tsx')).toBe('tsx');
    expect(languageForPath('Dockerfile.dev')).toBe('dockerfile');
    expect(languageForPath('README')).toBeNull();
  });

  it('collapses lockfiles, generated and vendored files', () => {
    expect(collapseReason({ path: 'pnpm-lock.yaml' })).toBe('lockfile');
    expect(collapseReason({ path: 'web/app.min.js' })).toBe('generated');
    expect(collapseReason({ path: 'api/types.ts', headText: '// Code generated by protoc. DO NOT EDIT.\n' })).toBe('generated');
    expect(collapseReason({ path: 'vendor/lib/a.go' })).toBe('vendored');
    expect(collapseReason({ path: 'src/a.ts', attributes: { generated: true } })).toBe('generated');
    expect(collapseReason({ path: 'src/a.ts', headText: 'export const a = 1;' })).toBeNull();
  });
});

describe('highlightLines', () => {
  it('produces per-line tokens, splitting multi-line strings', () => {
    const lines = ['const a = `x', '  y`; // c'];
    const t = highlightLines('typescript', lines);
    expect(t).not.toBeNull();
    expect(t?.[1]?.[0]).toBe(0); // string continues from column 0
  });

  it('returns null for unknown languages', () => {
    expect(highlightLines(null, ['a'])).toBeNull();
    expect(highlightLines('brainfuck', ['a'])).toBeNull();
  });
});

describe('line endings', () => {
  it('shows a CRLF → LF change as a change, proven whitespace-only for code', () => {
    const d = buildFileDiff({
      fileId: 'f',
      path: 'a.ts',
      language: 'typescript',
      baseLines: splitLines('const a = 1;\r\nconst b = 2;\r\n'),
      headLines: splitLines('const a = 1;\nconst b = 2;\n'),
      baseTokens: highlightLines('typescript', splitLines('const a = 1;\r\nconst b = 2;\r\n')),
      headTokens: highlightLines('typescript', splitLines('const a = 1;\nconst b = 2;\n')),
    });
    expect(d.fragments).toHaveLength(1);
    expect(d.fragments[0]?.proof).toBe('whitespace');
  });
});
