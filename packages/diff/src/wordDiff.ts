// Intra-line (word and character) highlighting for paired changed lines.

import { internLines, myersMatches, toChunks } from './lineDiff';

const TOKEN_RE = /[A-Za-z0-9_$]+|\s+|[^\sA-Za-z0-9_$]/g;

export function tokenize(line: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  for (const m of line.matchAll(TOKEN_RE)) out.push({ text: m[0], start: m.index ?? 0 });
  return out;
}

/** Dice coefficient over word tokens; used to pair deleted and added lines. */
export function lineSimilarity(a: string, b: string): number {
  const ta = a.trim();
  const tb = b.trim();
  if (ta === tb) return 1;
  if (!ta || !tb) return 0;
  const bag = new Map<string, number>();
  const wa = tokenize(ta).filter((t) => !/^\s+$/.test(t.text));
  const wb = tokenize(tb).filter((t) => !/^\s+$/.test(t.text));
  for (const t of wa) bag.set(t.text, (bag.get(t.text) ?? 0) + 1);
  let common = 0;
  for (const t of wb) {
    const c = bag.get(t.text) ?? 0;
    if (c > 0) {
      common++;
      bag.set(t.text, c - 1);
    }
  }
  return (2 * common) / (wa.length + wb.length);
}

/**
 * Pairs deleted with added lines in order. Equal counts pair one-to-one when
 * they look related; otherwise greedily match each deleted line with the most
 * similar remaining added line, never crossing earlier pairs.
 */
export function pairLines(del: string[], add: string[], threshold = 0.45): [number, number][] {
  const pairs: [number, number][] = [];
  let nextAdd = 0;
  for (let i = 0; i < del.length; i++) {
    let best = -1;
    let bestScore = threshold;
    const window = Math.min(add.length, nextAdd + 8);
    for (let j = nextAdd; j < window; j++) {
      const s = lineSimilarity(del[i] as string, add[j] as string);
      if (s > bestScore) {
        bestScore = s;
        best = j;
      }
    }
    if (best >= 0) {
      pairs.push([i, best]);
      nextAdd = best + 1;
    }
  }
  return pairs;
}

/**
 * Returns changed spans as flattened [start, end) column pairs for each side.
 * Returns null when the lines differ so much that highlighting words would be
 * noise rather than signal.
 */
export function wordDiff(a: string, b: string): { base: number[]; head: number[] } | null {
  const ta = tokenize(a);
  const tb = tokenize(b);
  const { a: ia, b: ib } = internLines(
    ta.map((t) => t.text),
    tb.map((t) => t.text),
  );
  const chunks = toChunks(myersMatches(ia, ib, 0, ia.length, 0, ib.length), ia.length, ib.length);
  const base: number[] = [];
  const head: number[] = [];
  let changedChars = 0;
  for (const c of chunks) {
    if (c.kind !== 'change') continue;
    if (c.baseEnd > c.baseStart) {
      const s = (ta[c.baseStart] as { start: number }).start;
      const last = ta[c.baseEnd - 1] as { text: string; start: number };
      const e = last.start + last.text.length;
      push(base, s, e);
      changedChars += e - s;
    }
    if (c.headEnd > c.headStart) {
      const s = (tb[c.headStart] as { start: number }).start;
      const last = tb[c.headEnd - 1] as { text: string; start: number };
      const e = last.start + last.text.length;
      push(head, s, e);
      changedChars += e - s;
    }
  }
  const total = a.trim().length + b.trim().length;
  if (total > 0 && changedChars / total > 0.75) return null;
  return { base, head };
}

function push(out: number[], s: number, e: number) {
  // Merge with the previous span when only whitespace separates them is not
  // known here; merge only touching spans.
  if (out.length >= 2 && out[out.length - 1] === s) {
    out[out.length - 1] = e;
  } else {
    out.push(s, e);
  }
}
