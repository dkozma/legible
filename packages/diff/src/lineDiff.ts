// Line diff: histogram diff (as in git/jgit) with a bounded Myers fallback.
//
// We compute diffs in-process rather than parsing `git diff` output so the
// result is consistent across git versions and settings, and so the same code
// can diff any two texts (Revisions, Interdiffs) later.

import type { DiffChunk } from '@legible/domain';

/** Lines that occur more often than this in a region are not used as anchors. */
const MAX_CHAIN = 64;
/** Myers gives up past this edit distance and reports the region as one change. */
const MAX_MYERS_D = 1000;

/** Interns lines so comparisons are integer comparisons. */
export function internLines(base: string[], head: string[], key: (line: string) => string = (l) => l) {
  const ids = new Map<string, number>();
  const map = (lines: string[]) => {
    const out = new Int32Array(lines.length);
    for (let i = 0; i < lines.length; i++) {
      const k = key(lines[i] as string);
      let id = ids.get(k);
      if (id === undefined) {
        id = ids.size;
        ids.set(k, id);
      }
      out[i] = id;
    }
    return out;
  };
  return { a: map(base), b: map(head) };
}

type Region = { aLo: number; aHi: number; bLo: number; bHi: number };
export type Run = { aStart: number; bStart: number; len: number };
type Work = { region: Region } | { equal: Run };

/**
 * Returns matched (equal) line pairs as runs, in order. Everything not matched
 * is a change.
 */
export function histogramMatches(a: Int32Array, b: Int32Array): Run[] {
  const out: Run[] = [];
  const stack: Work[] = [{ region: { aLo: 0, aHi: a.length, bLo: 0, bHi: b.length } }];

  while (stack.length > 0) {
    const w = stack.pop() as Work;
    if ('equal' in w) {
      pushRun(out, w.equal.aStart, w.equal.bStart, w.equal.len);
      continue;
    }
    let { aLo, aHi, bLo, bHi } = w.region;

    // Common prefix and suffix.
    const pre: number[] = [aLo, bLo];
    while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) {
      aLo++;
      bLo++;
    }
    const prefixLen = aLo - (pre[0] as number);
    let sufLen = 0;
    while (aHi > aLo && bHi > bLo && a[aHi - 1] === b[bHi - 1]) {
      aHi--;
      bHi--;
      sufLen++;
    }
    // Push in reverse order: suffix, middle, prefix.
    if (sufLen > 0) stack.push({ equal: { aStart: aHi, bStart: bHi, len: sufLen } });
    if (aLo < aHi && bLo < bHi) {
      const anchor = findAnchor(a, b, aLo, aHi, bLo, bHi);
      if (anchor) {
        stack.push({ region: { aLo: anchor.aStart + anchor.len, aHi, bLo: anchor.bStart + anchor.len, bHi } });
        stack.push({ equal: anchor });
        stack.push({ region: { aLo, aHi: anchor.aStart, bLo, bHi: anchor.bStart } });
      } else {
        // No usable anchor: fall back to Myers. Push its runs reversed.
        const runs = myersMatches(a, b, aLo, aHi, bLo, bHi);
        for (let i = runs.length - 1; i >= 0; i--) stack.push({ equal: runs[i] as Run });
      }
    }
    if (prefixLen > 0) stack.push({ equal: { aStart: pre[0] as number, bStart: pre[1] as number, len: prefixLen } });
  }
  return out;
}

function pushRun(out: Run[], aStart: number, bStart: number, len: number) {
  const last = out[out.length - 1];
  if (last && last.aStart + last.len === aStart && last.bStart + last.len === bStart) {
    last.len += len;
  } else {
    out.push({ aStart, bStart, len });
  }
}

/**
 * The jgit heuristic: among lines common to both regions, pick the run whose
 * rarest line occurs least often in A, preferring longer runs on ties.
 */
function findAnchor(a: Int32Array, b: Int32Array, aLo: number, aHi: number, bLo: number, bHi: number) {
  const occ = new Map<number, number[]>();
  for (let i = aLo; i < aHi; i++) {
    const k = a[i] as number;
    const list = occ.get(k);
    if (list) {
      if (list.length <= MAX_CHAIN) list.push(i);
    } else occ.set(k, [i]);
  }

  let best: { aStart: number; bStart: number; len: number } | null = null;
  let bestCount = MAX_CHAIN + 1;
  let bi = bLo;
  while (bi < bHi) {
    const list = occ.get(b[bi] as number);
    if (!list || list.length > bestCount || list.length > MAX_CHAIN) {
      bi++;
      continue;
    }
    let nextB = bi + 1;
    for (const ai of list) {
      // Extend the match backwards and forwards.
      let as = ai;
      let bs = bi;
      while (as > aLo && bs > bLo && a[as - 1] === b[bs - 1]) {
        as--;
        bs--;
      }
      let ae = ai + 1;
      let be = bi + 1;
      while (ae < aHi && be < bHi && a[ae] === b[be]) {
        ae++;
        be++;
      }
      // The run's rarity is the minimum occurrence count among its lines.
      let count = MAX_CHAIN + 1;
      for (let k = as; k < ae; k++) {
        const c = occ.get(a[k] as number)?.length ?? MAX_CHAIN + 1;
        if (c < count) count = c;
      }
      const len = ae - as;
      if (count < bestCount || (count === bestCount && best && len > best.len)) {
        best = { aStart: as, bStart: bs, len };
        bestCount = count;
      }
      if (be > nextB) nextB = be;
    }
    bi = nextB;
  }
  return best;
}

/** Myers O(ND) on a region; returns matched runs in order. */
export function myersMatches(a: Int32Array, b: Int32Array, aLo: number, aHi: number, bLo: number, bHi: number): Run[] {
  const n = aHi - aLo;
  const m = bHi - bLo;
  const max = n + m;
  const limit = Math.min(max, MAX_MYERS_D);
  const offset = limit + 1;
  const v = new Int32Array(2 * limit + 3);
  const trace: Int32Array[] = [];
  let found = -1;

  for (let d = 0; d <= limit; d++) {
    // Keep only the diagonals round d reads: k in [-d-1, d+1].
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && (v[offset + k - 1] as number) < (v[offset + k + 1] as number))) {
        x = v[offset + k + 1] as number;
      } else {
        x = (v[offset + k - 1] as number) + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[aLo + x] === b[bLo + y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    if (found >= 0) break;
  }
  if (found < 0) return []; // too different: treat the region as one change

  // Backtrack to collect diagonal (equal) moves.
  const runs: Run[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const vd = trace[d] as Int32Array;
    const at = (kk: number) => vd[kk + d + 1] as number;
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && at(k - 1) < at(k + 1))) prevK = k + 1;
    else prevK = k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    const startX = prevK === k + 1 ? prevX : prevX + 1;
    const startY = startX - k;
    if (x > startX) runs.push({ aStart: aLo + startX, bStart: bLo + startY, len: x - startX });
    x = prevX;
    y = prevY;
  }
  if (x > 0 && y > 0) runs.push({ aStart: aLo, bStart: bLo, len: Math.min(x, y) });
  runs.reverse();
  return runs;
}

/** Converts matched runs into a full edit script of equal/change chunks. */
export function toChunks(matches: Run[], aLen: number, bLen: number): DiffChunk[] {
  const chunks: DiffChunk[] = [];
  let ai = 0;
  let bi = 0;
  for (const m of matches) {
    if (m.aStart > ai || m.bStart > bi) {
      chunks.push({ kind: 'change', baseStart: ai, baseEnd: m.aStart, headStart: bi, headEnd: m.bStart });
    }
    if (m.len > 0) {
      chunks.push({ kind: 'equal', baseStart: m.aStart, baseEnd: m.aStart + m.len, headStart: m.bStart, headEnd: m.bStart + m.len });
    }
    ai = m.aStart + m.len;
    bi = m.bStart + m.len;
  }
  if (ai < aLen || bi < bLen) {
    chunks.push({ kind: 'change', baseStart: ai, baseEnd: aLen, headStart: bi, headEnd: bLen });
  }
  return chunks;
}

export interface LineDiffOptions {
  ignoreWhitespace?: boolean;
}

export function diffLines(base: string[], head: string[], opts: LineDiffOptions = {}): DiffChunk[] {
  const key = opts.ignoreWhitespace ? (l: string) => l.replace(/\s+/g, '') : undefined;
  const { a, b } = internLines(base, head, key);
  return toChunks(histogramMatches(a, b), base.length, head.length);
}

/**
 * Splits file text into lines. A trailing newline does not produce an empty
 * last line. `\r` stays in the line, so a CRLF → LF change is a visible change.
 */
export function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}
