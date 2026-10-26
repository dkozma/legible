// Splits change chunks at Symbol boundaries, so one hunk spanning two
// functions becomes two Fragments. The pieces stay contiguous and in order on
// both sides, so together they still cover every changed line exactly once.

import type { CodeSymbol, DiffChunk } from "@legible/domain"

const CONTAINER = new Set(["class", "interface", "type", "enum", "module"])

/**
 * The Symbol a line belongs to for splitting: the top-level Symbol, or the
 * member when that's a container (a method inside a class). Never deeper, so
 * a function's own nested callbacks don't split it.
 */
function lineKeys(symbols: CodeSymbol[], lineCount: number): (string | null)[] {
  const keys: (string | null)[] = new Array(lineCount).fill(null)
  const byId = new Map(symbols.map((s) => [s.id, s]))
  const depthOk = (s: CodeSymbol) => {
    for (
      let p = s.parentId ? byId.get(s.parentId) : undefined;
      p;
      p = p.parentId ? byId.get(p.parentId) : undefined
    )
      if (!CONTAINER.has(p.kind)) return false
    return true
  }
  // Outer Symbols first, so members overwrite their container's lines.
  const eligible = symbols
    .filter(depthOk)
    .toSorted((a, b) => b.endLine - b.startLine - (a.endLine - a.startLine))
  for (const s of eligible)
    for (let l = s.startLine - 1; l < s.endLine && l < lineCount; l++)
      keys[l] = s.id
  return keys
}

interface Run {
  key: string | null
  start: number
  end: number
}

/** Runs of lines with the same key; unkeyed lines join the next keyed run (doc comments, blank lines), else the previous. */
function runs(keys: (string | null)[], start: number, end: number): Run[] {
  const out: Run[] = []
  let pending = start
  for (let l = start; l < end; l++) {
    const k = keys[l] ?? null
    if (k === null) continue
    const last = out[out.length - 1]
    if (last && last.key === k) last.end = l + 1
    else {
      if (last) last.end = Math.max(last.end, pending)
      out.push({
        key: k,
        start: out.length === 0 ? start : pending,
        end: l + 1,
      })
    }
    pending = l + 1
  }
  const last = out[out.length - 1]
  if (last) last.end = end
  return out.length ? out : end > start ? [{ key: null, start, end }] : []
}

/** Longest common subsequence of runs whose Symbols are matched. */
function pairRuns(
  base: Run[],
  head: Run[],
  counterpart: (baseKey: string) => string | null,
): [number, number][] {
  const n = base.length
  const m = head.length
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  )
  const same = (i: number, j: number) => {
    const b = base[i]?.key
    const h = head[j]?.key
    return b != null && h != null && counterpart(b) === h
  }
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      (dp[i] as number[])[j] = same(i, j)
        ? ((dp[i + 1] as number[])[j + 1] as number) + 1
        : Math.max(
            (dp[i + 1] as number[])[j] as number,
            (dp[i] as number[])[j + 1] as number,
          )
  const out: [number, number][] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (same(i, j)) {
      out.push([i, j])
      i++
      j++
    } else if (
      ((dp[i + 1] as number[])[j] as number) >=
      ((dp[i] as number[])[j + 1] as number)
    )
      i++
    else j++
  }
  return out
}

/**
 * Returns the file's chunks with each change chunk split at Symbol
 * boundaries. Chunks with no Symbols on either side are left whole.
 */
export function splitAtSymbols(
  chunks: DiffChunk[],
  base: CodeSymbol[],
  head: CodeSymbol[],
  baseLineCount: number,
  headLineCount: number,
): DiffChunk[] {
  if (base.length === 0 && head.length === 0) return chunks
  const baseKeys = lineKeys(base, baseLineCount)
  const headKeys = lineKeys(head, headLineCount)
  const counterpart = new Map(base.map((s) => [s.id, s.counterpartId]))
  const out: DiffChunk[] = []
  for (const c of chunks) {
    if (c.kind !== "change") {
      out.push(c)
      continue
    }
    const b = runs(baseKeys, c.baseStart, c.baseEnd)
    const h = runs(headKeys, c.headStart, c.headEnd)
    if (b.length + h.length <= 1) {
      out.push(c)
      continue
    }
    const pairs = pairRuns(b, h, (k) => counterpart.get(k) ?? null)
    let bi = 0
    let hi = 0
    let bPos = c.baseStart
    let hPos = c.headStart
    const emit = (bEnd: number, hEnd: number) => {
      if (bEnd === bPos && hEnd === hPos) return
      out.push({
        kind: "change",
        baseStart: bPos,
        baseEnd: bEnd,
        headStart: hPos,
        headEnd: hEnd,
      })
      bPos = bEnd
      hPos = hEnd
    }
    for (const [pb, ph] of [
      ...pairs,
      [b.length, h.length] as [number, number],
    ]) {
      // Unmatched runs before the pair: removed pieces, then added ones, one Fragment per Symbol.
      for (; bi < pb; bi++) emit((b[bi] as Run).end, hPos)
      for (; hi < ph; hi++) emit(bPos, (h[hi] as Run).end)
      if (pb < b.length && ph < h.length) {
        emit((b[pb] as Run).end, (h[ph] as Run).end)
        bi++
        hi++
      }
    }
    emit(c.baseEnd, c.headEnd)
  }
  return out
}
