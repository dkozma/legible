// Turns two versions of a file into a FileDiff: edit script, Fragments and
// intra-line word ranges. Structural proofs come from the indexer's AST
// checks (packages/indexer/src/proofs.ts) and are passed in per chunk.

import { createHash } from "node:crypto"

import type {
  DiffChunk,
  FileDiff,
  Fragment,
  LineTokens,
  StructuralProof,
} from "@legible/domain"

import { diffLines } from "./lineDiff"
import { pairLines, wordDiff } from "./wordDiff"

export interface FileDiffInput {
  fileId: string
  path: string
  language: string | null
  baseLines: string[]
  headLines: string[]
  baseTokens: LineTokens[] | null
  headTokens: LineTokens[] | null
  ignoreWhitespace?: boolean
  /** diffLines() of these lines with the same options, if the caller already has it. */
  chunks?: DiffChunk[]
  /** A Structural proof per chunk, aligned with `chunks`; anything absent is Behavioral. */
  proofs?: (StructuralProof | null)[]
}

export function buildFileDiff(input: FileDiffInput): FileDiff {
  const chunks =
    input.chunks ??
    diffLines(input.baseLines, input.headLines, {
      ignoreWhitespace: input.ignoreWhitespace,
    })
  const baseWords: Record<number, number[]> = {}
  const headWords: Record<number, number[]> = {}
  const fragments: Fragment[] = []
  const seen = new Map<string, number>()

  chunks.forEach((chunk, chunkIndex) => {
    if (chunk.kind !== "change") return
    const del = input.baseLines.slice(chunk.baseStart, chunk.baseEnd)
    const add = input.headLines.slice(chunk.headStart, chunk.headEnd)

    for (const [i, j] of pairLines(del, add)) {
      const w = wordDiff(del[i] as string, add[j] as string)
      if (!w) continue
      if (w.base.length) baseWords[chunk.baseStart + i] = w.base
      if (w.head.length) headWords[chunk.headStart + j] = w.head
    }

    const proof = input.proofs?.[chunkIndex] ?? null
    const contentKey = fragmentKey(input.path, del, add)
    const n = seen.get(contentKey) ?? 0
    seen.set(contentKey, n + 1)
    fragments.push({
      id: hash(`${contentKey}\0${n}`),
      chunkIndex,
      kind: proof ? "structural" : "behavioral",
      proof,
    })
  })

  return {
    fileId: input.fileId,
    baseLines: input.baseLines,
    headLines: input.headLines,
    chunks,
    fragments,
    baseTokens: input.baseTokens,
    headTokens: input.headTokens,
    baseWords,
    headWords,
    ignoreWhitespace: Boolean(input.ignoreWhitespace),
  }
}

export function hash(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 16)
}

function fragmentKey(path: string, del: string[], add: string[]): string {
  const norm = (ls: string[]) => ls.map((l) => l.trim()).join("\n")
  return `${path}\0${norm(del)}\0${norm(add)}`
}

export function isTrivialLine(line: string): boolean {
  const t = line.trim()
  return t.length === 0 || /^[\s{}()[\];,]*$/.test(t)
}
