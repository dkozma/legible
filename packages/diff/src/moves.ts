// Move detection across a whole Change Set: blocks of deleted lines that
// reappear as added lines (in the same or another file) become MoveBlocks.

import type { DiffChunk, MoveBlock } from '@legible/domain';
import { hash, isTrivialLine } from './analyze';
import { INDENTATION_SENSITIVE } from './classify';

export interface MoveInputFile {
  fileId: string;
  path: string;
  language: string | null;
  baseLines: string[];
  headLines: string[];
  chunks: DiffChunk[];
}

/** A block needs at least this many non-trivial lines to count as a move. */
export const MIN_MOVE_LINES = 3;
const MAX_CANDIDATES = 32;

export function detectMoves(files: MoveInputFile[]): MoveBlock[] {
  type AddedLine = { file: number; line: number; key: string };
  // Unknown languages keep indentation: it may be meaningful.
  const keyFor = (f: MoveInputFile, text: string) => (!f.language || INDENTATION_SENSITIVE.has(f.language) ? text.trimEnd() : text.trim());

  // Index every added line by normalized content.
  const added = new Map<string, AddedLine[]>();
  const addedKeys: Map<number, string>[] = files.map(() => new Map());
  files.forEach((f, fi) => {
    for (const c of f.chunks) {
      if (c.kind !== 'change') continue;
      for (let l = c.headStart; l < c.headEnd; l++) {
        const k = keyFor(f, f.headLines[l] as string);
        (addedKeys[fi] as Map<number, string>).set(l, k);
        if (isTrivialLine(k)) continue;
        const list = added.get(k);
        if (list) {
          if (list.length < MAX_CANDIDATES) list.push({ file: fi, line: l, key: k });
        } else added.set(k, [{ file: fi, line: l, key: k }]);
      }
    }
  });
  if (added.size === 0) return [];

  const usedAdded = files.map(() => new Set<number>());
  const moves: MoveBlock[] = [];

  files.forEach((f, _fi) => {
    for (const c of f.chunks) {
      if (c.kind !== 'change') continue;
      let l = c.baseStart;
      while (l < c.baseEnd) {
        const k = keyFor(f, f.baseLines[l] as string);
        const candidates = isTrivialLine(k) ? undefined : added.get(k);
        let best: { file: number; start: number; len: number; nonTrivial: number } | null = null;
        for (const cand of candidates ?? []) {
          if ((usedAdded[cand.file] as Set<number>).has(cand.line)) continue;
          const tKeys = addedKeys[cand.file] as Map<number, string>;
          let len = 0;
          let nonTrivial = 0;
          while (l + len < c.baseEnd) {
            const tl = cand.line + len;
            const tk = tKeys.get(tl);
            if (tk === undefined || (usedAdded[cand.file] as Set<number>).has(tl)) break;
            if (tk !== keyFor(f, f.baseLines[l + len] as string)) break;
            if (!isTrivialLine(tk)) nonTrivial++;
            len++;
          }
          if (len > 0 && (!best || nonTrivial > best.nonTrivial)) best = { file: cand.file, start: cand.line, len, nonTrivial };
        }
        if (best && best.nonTrivial >= MIN_MOVE_LINES) {
          const to = files[best.file] as MoveInputFile;
          for (let i = 0; i < best.len; i++) (usedAdded[best.file] as Set<number>).add(best.start + i);
          const fromLines = f.baseLines.slice(l, l + best.len);
          const toLines = to.headLines.slice(best.start, best.start + best.len);
          const exact = fromLines.every((line, i) => line === toLines[i]) && /^\S/.test(fromLines[0] ?? '');
          moves.push({
            id: hash(`${f.path}:${l}:${to.path}:${best.start}:${best.len}`),
            fromFileId: f.fileId,
            fromPath: f.path,
            fromStart: l + 1,
            fromEnd: l + best.len,
            toFileId: to.fileId,
            toPath: to.path,
            toStart: best.start + 1,
            toEnd: best.start + best.len,
            exact,
          });
          l += best.len;
        } else {
          l++;
        }
      }
    }
  });
  return moves;
}
