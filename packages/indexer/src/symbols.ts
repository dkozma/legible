// Symbols for one file of a Change Set, and Base ↔ Head matching: by
// qualified name first, then by signature and body similarity for renames.
// Unmatched Symbols are added (Head only) or removed (Base only).

import { createHash } from "node:crypto"

import type { CodeSymbol, Side, SymbolChange } from "@legible/domain"

import type { RawSymbol } from "./outline"

export function symbolId(
  side: Side,
  path: string,
  s: Pick<RawSymbol, "kind" | "qualifiedName">,
  ordinal: number,
): string {
  return createHash("sha1")
    .update(`${side}\0${path}\0${s.kind}\0${s.qualifiedName}\0${ordinal}`)
    .digest("hex")
    .slice(0, 16)
}

/** CodeSymbols for one side of a file, ids assigned, change and counterpart still unset. */
export function toCodeSymbols(
  side: Side,
  path: string,
  language: string,
  raw: RawSymbol[],
): CodeSymbol[] {
  const seen = new Map<string, number>()
  const out: CodeSymbol[] = []
  for (const s of raw) {
    const key = `${s.kind}\0${s.qualifiedName}`
    const n = seen.get(key) ?? 0
    seen.set(key, n + 1)
    out.push({
      id: symbolId(side, path, s, n),
      side,
      path,
      language,
      kind: s.kind,
      name: s.name,
      qualifiedName: s.qualifiedName,
      startLine: s.startLine + 1,
      endLine: s.endLine + 1,
      nameLine: s.nameLine + 1,
      nameCol: s.nameCol,
      nameEndCol: s.nameEndCol,
      signature: s.signature,
      parentId: null,
      change: "unchanged",
      counterpartId: null,
    })
  }
  raw.forEach((s, i) => {
    if (s.parent >= 0)
      (out[i] as CodeSymbol).parentId = (out[s.parent] as CodeSymbol).id
  })
  return out
}

function body(lines: string[], s: CodeSymbol): string[] {
  return lines
    .slice(s.startLine - 1, s.endLine)
    .map((l) => l.trim())
    .filter(Boolean)
}

/** Dice coefficient over trimmed lines. */
function lineSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1
  const counts = new Map<string, number>()
  for (const l of a) counts.set(l, (counts.get(l) ?? 0) + 1)
  let common = 0
  for (const l of b) {
    const n = counts.get(l) ?? 0
    if (n > 0) {
      common++
      counts.set(l, n - 1)
    }
  }
  return (2 * common) / (a.length + b.length)
}

/** The signature without the name, so a rename alone doesn't lower similarity. */
function shape(s: CodeSymbol): string {
  return s.signature.replace(s.name, "\u0000").replace(/\s+/g, "")
}

function charSimilarity(a: string, b: string): number {
  if (a === b) return 1
  const grams = (s: string) => {
    const m = new Map<string, number>()
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2)
      m.set(g, (m.get(g) ?? 0) + 1)
    }
    return m
  }
  const ga = grams(a)
  const gb = grams(b)
  let common = 0
  let total = 0
  for (const n of ga.values()) total += n
  for (const [g, n] of gb) {
    total += n
    common += Math.min(n, ga.get(g) ?? 0)
  }
  return total === 0 ? 0 : (2 * common) / total
}

const RENAME_THRESHOLD = 0.7
/** Lines a body needs, past the declaration's own, before a rename can be told from a coincidence. */
const MIN_RENAME_BODY = 2

/**
 * Matches a file's Base Symbols to its Head Symbols and sets each one's
 * change and counterpart. Base and Head are the same file (git's rename
 * pairing already applied).
 */
export function matchSymbols(
  base: CodeSymbol[],
  head: CodeSymbol[],
  baseLines: string[],
  headLines: string[],
): void {
  const pair = (b: CodeSymbol, h: CodeSymbol) => {
    b.counterpartId = h.id
    h.counterpartId = b.id
  }

  // 1. Same kind and qualified name, in order (overloads keep their order).
  const byKey = new Map<string, CodeSymbol[]>()
  for (const h of head) {
    const k = `${h.kind}\0${h.qualifiedName}`
    const list = byKey.get(k)
    if (list) list.push(h)
    else byKey.set(k, [h])
  }
  for (const b of base) {
    const list = byKey.get(`${b.kind}\0${b.qualifiedName}`)
    const h = list?.shift()
    if (h) pair(b, h)
  }

  // 2. Renames: same kind, same matched parent, similar signature shape and body.
  const baseById = new Map(base.map((s) => [s.id, s]))
  const parentOf = (s: CodeSymbol, side: Map<string, CodeSymbol>) =>
    s.parentId ? (side.get(s.parentId)?.counterpartId ?? null) : null
  // Each unmatched Symbol's body (past its declaration line) and signature shape, once.
  // A body is the evidence: two empty functions aren't a rename of each other.
  const evidence = (lines: string[], list: CodeSymbol[]) =>
    list
      .filter((s) => !s.counterpartId)
      .map((s) => ({ s, body: body(lines, s).slice(1), shape: shape(s) }))
      .filter((x) => x.body.length >= MIN_RENAME_BODY)
  const unmatchedHead = evidence(headLines, head)
  const candidates: { b: CodeSymbol; h: CodeSymbol; score: number }[] = []
  for (const b of evidence(baseLines, base)) {
    const bParent = parentOf(b.s, baseById)
    for (const h of unmatchedHead) {
      if (h.s.kind !== b.s.kind || h.s.parentId !== bParent) continue
      const score =
        0.4 * charSimilarity(b.shape, h.shape) +
        0.6 * lineSimilarity(b.body, h.body)
      if (score >= RENAME_THRESHOLD) candidates.push({ b: b.s, h: h.s, score })
    }
  }
  candidates.sort((x, y) => y.score - x.score)
  for (const c of candidates) {
    if (c.b.counterpartId || c.h.counterpartId) continue
    pair(c.b, c.h)
  }

  // 3. Change status.
  for (const b of base) if (!b.counterpartId) b.change = "removed"
  for (const h of head) {
    if (!h.counterpartId) {
      h.change = "added"
      continue
    }
    const b = baseById.get(h.counterpartId) as CodeSymbol
    let change: SymbolChange
    if (b.name !== h.name) change = "renamed"
    else {
      const bl = baseLines.slice(b.startLine - 1, b.endLine)
      const hl = headLines.slice(h.startLine - 1, h.endLine)
      change =
        bl.length === hl.length && bl.every((l, i) => l === hl[i])
          ? "unchanged"
          : "modified"
    }
    h.change = change
    b.change = change
  }
}
