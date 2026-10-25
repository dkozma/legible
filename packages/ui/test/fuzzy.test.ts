import { describe, expect, it } from 'vitest';

import { fuzzy } from '../src/commands';

const marked = (text: string, indices: number[]) => indices.map((i) => text.slice(i, i + 1)).join('');

describe('fuzzy', () => {
  it('returns offsets into the original text', () => {
    const r = fuzzy('rp', 'src/refunds/RefundPolicy.ts');
    expect(r && marked('src/refunds/RefundPolicy.ts', r.indices).toLowerCase()).toBe('rp');
  });

  it('keeps offsets aligned after characters whose lowercase is longer', () => {
    // 'İ'.toLowerCase() is two UTF-16 units; offsets must still point at 'S' and 't'.
    const text = 'İstanbul.ts';
    const r = fuzzy('st', text);
    expect(r?.indices).toEqual([1, 2]);
    expect(marked(text, r?.indices ?? [])).toBe('st');
  });

  it('counts emoji as one character but reports UTF-16 offsets', () => {
    const text = '🎉notes.md';
    const r = fuzzy('n', text);
    expect(r?.indices).toEqual([2]);
  });

  it('rejects non-matches', () => {
    expect(fuzzy('xyz', 'src/a.ts')).toBeNull();
  });
});
