// The diff document as a flat list of fixed-height rows, derived from the
// Change Set summary and view state. Pure, so it's cheap to test and memoize.

import type { ChangeSetSummary, DiffChunk, FileChange, MoveBlock, StructuralProof } from '@legible/domain';

export type LineKind = ' ' | '-' | '+';

export type Row =
  | { k: 'file'; fileId: string; first: boolean }
  | { k: 'collapsed'; fileId: string; reason: CollapsedReason }
  | { k: 'hunk'; fileId: string; base: number; baseLen: number; head: number; headLen: number; chunk: number; lastChunk: number }
  | { k: 'gap'; fileId: string; gapKey: string; count: number }
  | {
      k: 'frag';
      fileId: string;
      chunk: number;
      fragmentId: string;
      proof: StructuralProof;
      lines: number;
      expanded: boolean;
      label: string;
    }
  | { k: 'line'; fileId: string; t: LineKind; base: number; head: number; chunk: number; moved: boolean }
  | {
      k: 'pair';
      fileId: string;
      chunk: number;
      l: number;
      r: number;
      lt: LineKind | null;
      rt: LineKind | null;
      lmoved: boolean;
      rmoved: boolean;
    }
  | { k: 'end' };

export type CollapsedReason = 'viewed' | 'generated' | 'lockfile' | 'binary' | 'large' | 'vendored' | 'structural' | 'unchanged' | 'user';

export const ROW_HEIGHT: Record<Row['k'], number> = {
  file: 40,
  collapsed: 34,
  hunk: 24,
  gap: 24,
  frag: 28,
  line: 20,
  pair: 20,
  end: 64,
};

export interface RowOptions {
  layout: 'unified' | 'split';
  context: number;
  viewed: ReadonlySet<string>;
  /** Files the user expanded despite being viewed or collapsed by default. */
  expandedFiles: ReadonlySet<string>;
  /** Files the user collapsed. */
  collapsedFiles: ReadonlySet<string>;
  expandedFrags: ReadonlySet<string>;
  /** Lines revealed from each edge of a hidden unchanged region. */
  gapReveal: ReadonlyMap<string, number>;
}

export interface NavPoint {
  fileId: string;
  chunk: number;
  row: number;
}

export interface RowModel {
  rows: Row[];
  offsets: number[];
  totalHeight: number;
  /** First row of every change, in document order (j/k). */
  hunks: NavPoint[];
  /** Header row of every file (n/p). */
  files: { fileId: string; row: number }[];
}

export function collapsedReason(file: FileChange, opts: RowOptions): CollapsedReason | null {
  if (opts.collapsedFiles.has(file.id)) return 'user';
  if (opts.expandedFiles.has(file.id)) return null;
  if (opts.viewed.has(file.id)) return 'viewed';
  if (file.binary) return 'binary';
  if (file.collapse) return file.collapse;
  if (!file.chunks.some((c) => c.kind === 'change')) return 'unchanged';
  if (file.structural) return 'structural';
  return null;
}

function moveIndex(moves: MoveBlock[], fileId: string) {
  const from: [number, number, MoveBlock][] = [];
  const to: [number, number, MoveBlock][] = [];
  for (const m of moves) {
    if (m.fromFileId === fileId) from.push([m.fromStart - 1, m.fromEnd - 1, m]);
    if (m.toFileId === fileId) to.push([m.toStart - 1, m.toEnd - 1, m]);
  }
  const find = (list: [number, number, MoveBlock][], line: number) => list.find(([s, e]) => line >= s && line <= e)?.[2] ?? null;
  return { fromBlock: (l: number) => find(from, l), toBlock: (l: number) => find(to, l) };
}

const PROOF_LABEL: Record<StructuralProof, string> = {
  whitespace: 'Structural · whitespace only',
  formatting: 'Structural · formatting only',
};

export function buildRows(summary: Pick<ChangeSetSummary, 'files' | 'moves'>, opts: RowOptions): RowModel {
  const rows: Row[] = [];
  const hunks: NavPoint[] = [];
  const files: { fileId: string; row: number }[] = [];

  summary.files.forEach((file, fi) => {
    files.push({ fileId: file.id, row: rows.length });
    rows.push({ k: 'file', fileId: file.id, first: fi === 0 });
    const reason = collapsedReason(file, opts);
    if (reason) {
      rows.push({ k: 'collapsed', fileId: file.id, reason });
      return;
    }
    const mv = moveIndex(summary.moves, file.id);
    const fragByChunk = new Map(file.fragments.map((f) => [f.chunkIndex, f]));
    const changeIdx = file.chunks.map((c, i) => (c.kind === 'change' ? i : -1)).filter((i) => i >= 0);
    const firstChange = changeIdx[0] ?? -1;
    const lastChange = changeIdx[changeIdx.length - 1] ?? -1;

    let block: Row[] = [];
    let blockBase = -1;
    let blockHead = -1;
    let blockBaseEnd = -1;
    let blockHeadEnd = -1;
    let blockChunk = -1;
    let blockLastChunk = -1;
    const flush = () => {
      if (block.length === 0) return;
      rows.push({
        k: 'hunk',
        fileId: file.id,
        base: blockBase,
        baseLen: blockBaseEnd - blockBase,
        head: blockHead,
        headLen: blockHeadEnd - blockHead,
        chunk: blockChunk,
        lastChunk: blockLastChunk,
      });
      for (const r of block) {
        if ((r.k === 'line' && r.t !== ' ') || r.k === 'frag' || (r.k === 'pair' && (r.lt === '-' || r.rt === '+'))) {
          const c = (r as { chunk: number }).chunk;
          if (!hunks.length || hunks[hunks.length - 1]?.chunk !== c || hunks[hunks.length - 1]?.fileId !== file.id) {
            hunks.push({ fileId: file.id, chunk: c, row: rows.length });
          }
        }
        rows.push(r);
      }
      block = [];
      blockBase = blockHead = blockBaseEnd = blockHeadEnd = blockChunk = blockLastChunk = -1;
    };
    const extend = (b0: number, b1: number, h0: number, h1: number) => {
      if (blockBase < 0) {
        blockBase = b0;
        blockHead = h0;
      }
      blockBaseEnd = b1;
      blockHeadEnd = h1;
    };
    const pushEqual = (c: DiffChunk, from: number, to: number) => {
      for (let i = from; i < to; i++) {
        const b = c.baseStart + i;
        const h = c.headStart + i;
        extend(b, b + 1, h, h + 1);
        if (opts.layout === 'unified') block.push({ k: 'line', fileId: file.id, t: ' ', base: b, head: h, chunk: -1, moved: false });
        else block.push({ k: 'pair', fileId: file.id, chunk: -1, l: b, r: h, lt: ' ', rt: ' ', lmoved: false, rmoved: false });
      }
    };

    file.chunks.forEach((c, ci) => {
      if (c.kind === 'equal') {
        const len = c.baseEnd - c.baseStart;
        const isLead = firstChange < 0 || ci < firstChange;
        const isTrail = ci > lastChange;
        const gapKey = `${file.id}:${ci}`;
        const reveal = opts.gapReveal.get(gapKey) ?? 0;
        const ctx = opts.context;
        // Visible head and tail of this unchanged run.
        let showTop = isLead ? 0 : ctx;
        let showBottom = isTrail ? 0 : ctx;
        if (isLead) showBottom += reveal;
        else if (isTrail) showTop += reveal;
        else {
          showTop += reveal;
          showBottom += reveal;
        }
        if (showTop + showBottom >= len) {
          pushEqual(c, 0, len);
          return;
        }
        pushEqual(c, 0, showTop);
        flush();
        rows.push({ k: 'gap', fileId: file.id, gapKey, count: len - showTop - showBottom });
        pushEqual(c, len - showBottom, len);
        return;
      }

      const frag = fragByChunk.get(ci);
      if (blockChunk < 0) blockChunk = ci;
      blockLastChunk = ci;
      extend(c.baseStart, c.baseEnd, c.headStart, c.headEnd);
      if (frag && frag.kind === 'structural' && frag.proof) {
        const expanded = opts.expandedFrags.has(frag.id);
        block.push({
          k: 'frag',
          fileId: file.id,
          chunk: ci,
          fragmentId: frag.id,
          proof: frag.proof,
          lines: c.baseEnd - c.baseStart + (c.headEnd - c.headStart),
          expanded,
          label: PROOF_LABEL[frag.proof],
        });
        if (!expanded) return;
      }
      if (opts.layout === 'unified') {
        for (let b = c.baseStart; b < c.baseEnd; b++)
          block.push({ k: 'line', fileId: file.id, t: '-', base: b, head: -1, chunk: ci, moved: mv.fromBlock(b) !== null });
        for (let h = c.headStart; h < c.headEnd; h++)
          block.push({ k: 'line', fileId: file.id, t: '+', base: -1, head: h, chunk: ci, moved: mv.toBlock(h) !== null });
      } else {
        const d = c.baseEnd - c.baseStart;
        const a = c.headEnd - c.headStart;
        for (let i = 0; i < Math.max(d, a); i++) {
          const l = i < d ? c.baseStart + i : -1;
          const r = i < a ? c.headStart + i : -1;
          block.push({
            k: 'pair',
            fileId: file.id,
            chunk: ci,
            l,
            r,
            lt: l >= 0 ? '-' : null,
            rt: r >= 0 ? '+' : null,
            lmoved: l >= 0 && mv.fromBlock(l) !== null,
            rmoved: r >= 0 && mv.toBlock(r) !== null,
          });
        }
      }
    });
    flush();
  });
  rows.push({ k: 'end' });

  const offsets = new Array<number>(rows.length);
  let y = 0;
  for (let i = 0; i < rows.length; i++) {
    offsets[i] = y;
    y += ROW_HEIGHT[(rows[i] as Row).k];
  }
  return { rows, offsets, totalHeight: y, hunks, files };
}

/** Index of the row at a vertical offset (binary search). */
export function rowAt(model: Pick<RowModel, 'offsets'>, y: number): number {
  const o = model.offsets;
  let lo = 0;
  let hi = o.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((o[mid] as number) <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The base/head line ranges (1-based, inclusive) covered by a span of rows. */
export function rangesForRows(
  rows: Row[],
  from: number,
  to: number,
  /** Only rows of this file count. */
  fileId: string | null = null,
): { baseRange: [number, number] | null; headRange: [number, number] | null } {
  let b0 = Number.POSITIVE_INFINITY;
  let b1 = -1;
  let h0 = Number.POSITIVE_INFINITY;
  let h1 = -1;
  for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
    const r = rows[i];
    if (!r || (fileId !== null && r.k !== 'end' && r.fileId !== fileId)) continue;
    let base = -1;
    let head = -1;
    if (r.k === 'line') {
      base = r.base;
      head = r.head;
    } else if (r.k === 'pair') {
      base = r.l;
      head = r.r;
    } else continue;
    if (base >= 0) {
      b0 = Math.min(b0, base + 1);
      b1 = Math.max(b1, base + 1);
    }
    if (head >= 0) {
      h0 = Math.min(h0, head + 1);
      h1 = Math.max(h1, head + 1);
    }
  }
  return { baseRange: b1 >= 0 ? [b0, b1] : null, headRange: h1 >= 0 ? [h0, h1] : null };
}

/** 1-based line ranges spanning the change chunks `first..last` (a whole hunk), including the context between them. */
export function chunkRanges(
  chunks: DiffChunk[],
  first: number,
  last = first,
): { baseRange: [number, number] | null; headRange: [number, number] | null } {
  let base: [number, number] | null = null;
  let head: [number, number] | null = null;
  for (const c of chunks.slice(first, last + 1)) {
    if (c.kind !== 'change') continue;
    if (c.baseEnd > c.baseStart) base = [base?.[0] ?? c.baseStart + 1, c.baseEnd];
    if (c.headEnd > c.headStart) head = [head?.[0] ?? c.headStart + 1, c.headEnd];
  }
  return { baseRange: base, headRange: head };
}
