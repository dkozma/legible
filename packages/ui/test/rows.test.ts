import type { FileChange } from '@legible/domain';
import { describe, expect, it } from 'vitest';

import { buildRows, chunkRanges, type RowOptions, rangesForRows, rowAt } from '../src/diff/rows';

const opts = (o: Partial<RowOptions> = {}): RowOptions => ({
  layout: 'unified',
  context: 3,
  viewed: new Set(),
  expandedFiles: new Set(),
  collapsedFiles: new Set(),
  expandedFrags: new Set(),
  gapReveal: new Map(),
  ...o,
});

function file(over: Partial<FileChange> = {}): FileChange {
  return {
    id: 'f1',
    path: 'a.ts',
    oldPath: null,
    status: 'modified',
    baseOid: 'a',
    headOid: 'b',
    language: 'typescript',
    additions: 1,
    deletions: 1,
    binary: false,
    collapse: null,
    structural: null,
    // 20 equal, 1 changed, 20 equal
    chunks: [
      { kind: 'equal', baseStart: 0, baseEnd: 20, headStart: 0, headEnd: 20 },
      { kind: 'change', baseStart: 20, baseEnd: 21, headStart: 20, headEnd: 21 },
      { kind: 'equal', baseStart: 21, baseEnd: 41, headStart: 21, headEnd: 41 },
    ],
    fragments: [{ id: 'fr1', chunkIndex: 1, kind: 'behavioral', proof: null }],
    baseLineCount: 41,
    notes: [],
    headLineCount: 41,
    ...over,
  };
}

describe('buildRows', () => {
  it('shows context around a change and hides the rest behind gaps', () => {
    const m = buildRows({ files: [file()], moves: [] }, opts());
    const kinds = m.rows.map((r) => r.k);
    expect(kinds[0]).toBe('file');
    expect(kinds[1]).toBe('gap');
    expect(kinds[2]).toBe('hunk');
    const lines = m.rows.filter((r) => r.k === 'line');
    expect(lines).toHaveLength(3 + 2 + 3);
    expect(m.rows.filter((r) => r.k === 'gap').map((r) => (r as { count: number }).count)).toEqual([17, 17]);
    expect(m.hunks).toEqual([{ fileId: 'f1', chunk: 1, row: m.rows.findIndex((r) => r.k === 'line' && r.t === '-') }]);
    expect(m.totalHeight).toBe(m.offsets[m.offsets.length - 1]! + 64);
  });

  it('reveals hidden lines from the edges of a gap', () => {
    const m = buildRows({ files: [file()], moves: [] }, opts({ gapReveal: new Map([['f1:0', 5]]) }));
    expect((m.rows[1] as { count: number }).count).toBe(12);
    const all = buildRows({ files: [file()], moves: [] }, opts({ gapReveal: new Map([['f1:0', 100]]) }));
    expect(all.rows[1]?.k).toBe('hunk');
  });

  it('collapses viewed, generated and structural files', () => {
    expect(buildRows({ files: [file()], moves: [] }, opts({ viewed: new Set(['f1']) })).rows[1]).toMatchObject({
      k: 'collapsed',
      reason: 'viewed',
    });
    expect(buildRows({ files: [file({ collapse: 'lockfile' })], moves: [] }, opts()).rows[1]).toMatchObject({ reason: 'lockfile' });
    expect(buildRows({ files: [file({ structural: 'whitespace' })], moves: [] }, opts()).rows[1]).toMatchObject({ reason: 'structural' });
    expect(buildRows({ files: [file({ collapse: 'lockfile' })], moves: [] }, opts({ expandedFiles: new Set(['f1']) })).rows[1]?.k).toBe(
      'gap',
    );
  });

  it('collapses Structural fragments until expanded', () => {
    const f = file({ fragments: [{ id: 'fr1', chunkIndex: 1, kind: 'structural', proof: 'whitespace' }] });
    const m = buildRows({ files: [f], moves: [] }, opts({ expandedFiles: new Set(['f1']) }));
    expect(m.rows.some((r) => r.k === 'frag')).toBe(true);
    expect(m.rows.filter((r) => r.k === 'line' && r.t !== ' ')).toHaveLength(0);
    const open = buildRows({ files: [f], moves: [] }, opts({ expandedFiles: new Set(['f1']), expandedFrags: new Set(['fr1']) }));
    expect(open.rows.filter((r) => r.k === 'line' && r.t !== ' ')).toHaveLength(2);
  });

  it('pairs lines side by side in split layout', () => {
    const f = file({
      chunks: [{ kind: 'change', baseStart: 0, baseEnd: 1, headStart: 0, headEnd: 3 }],
      fragments: [{ id: 'x', chunkIndex: 0, kind: 'behavioral', proof: null }],
    });
    const m = buildRows({ files: [f], moves: [] }, opts({ layout: 'split' }));
    const pairs = m.rows.filter((r) => r.k === 'pair');
    expect(pairs.map((p) => (p.k === 'pair' ? [p.l, p.r] : null))).toEqual([
      [0, 0],
      [-1, 1],
      [-1, 2],
    ]);
  });

  it('maps rows back to line ranges and offsets back to rows', () => {
    const m = buildRows({ files: [file()], moves: [] }, opts());
    const del = m.rows.findIndex((r) => r.k === 'line' && r.t === '-');
    expect(rangesForRows(m.rows, del, del + 1)).toEqual({ baseRange: [21, 21], headRange: [21, 21] });
    expect(rowAt(m, m.offsets[del]! + 5)).toBe(del);
    expect(rowAt(m, 0)).toBe(0);
  });
});

describe('hunks with several edits', () => {
  it('span every change chunk shown under one header', () => {
    const chunks: FileChange['chunks'] = [
      { kind: 'equal', baseStart: 0, baseEnd: 10, headStart: 0, headEnd: 10 },
      { kind: 'change', baseStart: 10, baseEnd: 11, headStart: 10, headEnd: 11 },
      { kind: 'equal', baseStart: 11, baseEnd: 15, headStart: 11, headEnd: 15 },
      { kind: 'change', baseStart: 15, baseEnd: 15, headStart: 15, headEnd: 17 },
      { kind: 'equal', baseStart: 15, baseEnd: 30, headStart: 17, headEnd: 32 },
    ];
    const f = file({
      chunks,
      fragments: [
        { id: 'a', chunkIndex: 1, kind: 'behavioral', proof: null },
        { id: 'b', chunkIndex: 3, kind: 'behavioral', proof: null },
      ],
    });
    const m = buildRows({ files: [f], moves: [] }, opts());
    const hunks = m.rows.filter((r) => r.k === 'hunk');
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({ chunk: 1, lastChunk: 3 });
    expect(chunkRanges(chunks, 1, 3)).toEqual({ baseRange: [11, 11], headRange: [11, 17] });
  });
});
