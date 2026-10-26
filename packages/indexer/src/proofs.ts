// AST-backed Structural proofs. A change chunk is Structural only if applying
// it alone to Base yields the same syntax tree as Base: the same node types in
// the same shape, with the same leaf text. Whitespace between tokens is all
// that may differ. String, template and regex contents are leaf text, so
// whitespace inside them still counts. Comments are compared with each line
// trimmed. Anything unproven stays Behavioral.

import type { DiffChunk, StructuralProof } from "@legible/domain"
import {
  Edit,
  type Node,
  type Point,
  type Tree,
  type TreeCursor,
} from "web-tree-sitter"

import type { Parsing } from "./parse"

/**
 * Languages whose grammar sees every token whose surrounding whitespace can
 * change meaning (ASI, Python's indentation, C's preprocessor all show up in
 * the tree). Left out: HTML, CSS, YAML, shell, Markdown and templating
 * languages, where whitespace between tokens is content or a combinator, and
 * PHP, whose inline HTML is output.
 */
export const AST_PROOF_LANGUAGES = new Set([
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "java",
  "c",
  "cpp",
  "csharp",
  "rust",
  "go",
  "json",
  "python",
])

/** Above this many candidate chunks in one file, stop proving: each costs a parse. */
const MAX_CANDIDATES = 200

const squash = (lines: string[]) => lines.join("").replace(/\s+/g, "")

/** One node of a preorder walk: type plus, for leaves, normalized text. */
function* events(root: Node): Generator<string> {
  const c: TreeCursor = root.walk()
  try {
    for (;;) {
      const type = c.nodeType
      if (c.gotoFirstChild()) {
        yield `(${type}`
        continue
      }
      yield /comment/.test(type)
        ? `${type}:${c.nodeText
            .split("\n")
            .map((l) => l.trim())
            .join("\n")}`
        : `${type}:${c.nodeText}`
      while (!c.gotoNextSibling()) {
        if (!c.gotoParent()) return
        yield ")"
      }
    }
  } finally {
    c.delete()
  }
}

function sameSubtree(a: Node, b: Node): boolean {
  const x = events(a)
  const y = events(b)
  for (;;) {
    const p = x.next()
    const q = y.next()
    if (p.done || q.done) return Boolean(p.done && q.done)
    if (p.value !== q.value) return false
  }
}

/**
 * Whether `next` (Base with one chunk applied, parsed incrementally from
 * `previous`, Base's tree with the edit applied) has Base's syntax tree. Only
 * the smallest subtree covering the edit and every range tree-sitter reports
 * as structurally changed is compared; outside it the structure is unchanged
 * and the text is Base's own.
 */
function sameAround(base: Tree, next: Tree, previous: Tree, e: Edit): boolean {
  if (next.rootNode.hasError) return false
  let lo = e.startIndex
  let hi = e.newEndIndex
  for (const r of next.getChangedRanges(previous)) {
    lo = Math.min(lo, r.startIndex)
    hi = Math.max(hi, r.endIndex)
  }
  const delta = e.newEndIndex - e.oldEndIndex
  let b: Node | null = next.rootNode.descendantForIndex(
    lo,
    Math.max(lo, hi - 1),
  )
  // The same span in Base: offsets before the edit are unchanged, after it they shift by delta.
  for (; b; b = b.parent) {
    if (b.startIndex > e.startIndex || b.endIndex < e.newEndIndex) continue
    const end = b.endIndex - delta
    let a: Node | null = base.rootNode.descendantForIndex(
      b.startIndex,
      Math.max(b.startIndex, end - 1),
    )
    while (a && (a.startIndex > b.startIndex || a.endIndex < end)) a = a.parent
    if (a && a.startIndex === b.startIndex && a.endIndex === end)
      return sameSubtree(a, b)
  }
  return sameSubtree(base.rootNode, next.rootNode)
}

/** Row and column (UTF-16 units, as web-tree-sitter counts) of an offset. */
function pointAt(text: string, index: number): Point {
  let row = 0
  let lineStart = 0
  for (
    let i = text.indexOf("\n");
    i >= 0 && i < index;
    i = text.indexOf("\n", i + 1)
  ) {
    row++
    lineStart = i + 1
  }
  return { row, column: index - lineStart }
}

/** The edit that turns `before` into `after`: what lies between their common prefix and suffix. */
export function textEdit(before: string, after: string): Edit {
  let start = 0
  const max = Math.min(before.length, after.length)
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start))
    start++
  let suffix = 0
  while (
    suffix < max - start &&
    before.charCodeAt(before.length - 1 - suffix) ===
      after.charCodeAt(after.length - 1 - suffix)
  )
    suffix++
  const oldEnd = before.length - suffix
  const newEnd = after.length - suffix
  return new Edit({
    startIndex: start,
    oldEndIndex: oldEnd,
    newEndIndex: newEnd,
    startPosition: pointAt(before, start),
    oldEndPosition: pointAt(before, oldEnd),
    newEndPosition: pointAt(after, newEnd),
  })
}

function offsetOfLine(lines: string[], line: number): number {
  let n = 0
  for (let i = 0; i < line && i < lines.length; i++)
    n += (lines[i] as string).length + 1
  return n
}

/** JSX text between elements is rendered, so its whitespace is content. */
function insideJsx(tree: Tree, start: number, end: number): boolean {
  for (
    let n = tree.rootNode.descendantForIndex(start, Math.max(start, end - 1));
    n;
    n = n.parent
  )
    if (n.type.startsWith("jsx")) return true
  return false
}

export interface ProofInput {
  language: string | null
  baseLines: string[]
  headLines: string[]
  chunks: DiffChunk[]
}

/**
 * Proofs for each chunk (null for equal chunks and unproven changes), in
 * chunk order. Parses Base once, then the Base-with-this-chunk text for each
 * chunk whose non-whitespace characters are unchanged.
 */
export async function proveChunks(
  parsing: Parsing,
  input: ProofInput,
): Promise<(StructuralProof | null)[]> {
  const out: (StructuralProof | null)[] = input.chunks.map(() => null)
  const lang = input.language
  if (!lang || !AST_PROOF_LANGUAGES.has(lang)) return out
  const candidates: number[] = []
  input.chunks.forEach((c, i) => {
    if (c.kind !== "change") return
    const del = input.baseLines.slice(c.baseStart, c.baseEnd)
    const add = input.headLines.slice(c.headStart, c.headEnd)
    if (squash(del) === squash(add)) candidates.push(i)
  })
  if (candidates.length === 0 || candidates.length > MAX_CANDIDATES) return out

  const baseText = input.baseLines.join("\n")
  const base = await parsing.parseTree(lang, input.baseLines)
  if (!base) return out
  try {
    if (base.rootNode.hasError) return out
    for (const i of candidates) {
      const c = input.chunks[i] as DiffChunk
      const start = offsetOfLine(input.baseLines, c.baseStart)
      const end = offsetOfLine(input.baseLines, c.baseEnd)
      if (insideJsx(base, start, end)) continue
      const hybrid = [
        ...input.baseLines.slice(0, c.baseStart),
        ...input.headLines.slice(c.headStart, c.headEnd),
        ...input.baseLines.slice(c.baseEnd),
      ]
      // Incrementally: only the edited region is reparsed.
      const e = textEdit(baseText, hybrid.join("\n"))
      const previous = base.copy()
      previous.edit(e)
      const tree = await parsing.parseTree(lang, hybrid, previous)
      if (!tree) {
        previous.delete()
        continue
      }
      try {
        if (!sameAround(base, tree, previous, e)) continue
      } finally {
        tree.delete()
        previous.delete()
      }
      const lines = (ls: string[]) => ls.map((l) => l.trim()).filter(Boolean)
      const del = lines(input.baseLines.slice(c.baseStart, c.baseEnd))
      const add = lines(input.headLines.slice(c.headStart, c.headEnd))
      out[i] =
        del.length === add.length && del.every((l, k) => l === add[k])
          ? "whitespace"
          : "formatting"
    }
  } finally {
    base.delete()
  }
  return out
}
