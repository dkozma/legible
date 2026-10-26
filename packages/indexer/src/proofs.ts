// AST-backed Structural proofs. A change chunk is Structural only if applying
// it alone to Base yields the same syntax tree as Base: the same node types in
// the same shape, with the same leaf text. Whitespace between tokens is all
// that may differ. String, template and regex contents are leaf text, so
// whitespace inside them still counts. Comments are compared with each line
// trimmed. Anything unproven stays Behavioral.

import type { DiffChunk, StructuralProof } from "@legible/domain"
import type { Tree, TreeCursor } from "web-tree-sitter"

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
function* events(tree: Tree): Generator<string> {
  const c: TreeCursor = tree.walk()
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

function sameTree(a: Tree, b: Tree): boolean {
  if (a.rootNode.hasError || b.rootNode.hasError) return false
  const x = events(a)
  const y = events(b)
  for (;;) {
    const p = x.next()
    const q = y.next()
    if (p.done || q.done) return Boolean(p.done && q.done)
    if (p.value !== q.value) return false
  }
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
      const tree = await parsing.parseTree(lang, hybrid)
      if (!tree) continue
      try {
        if (!sameTree(base, tree)) continue
      } finally {
        tree.delete()
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
