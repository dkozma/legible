// Turns two versions of a file into a FileDiff: edit script, Fragments,
// intra-line word ranges, and Structural proofs.

import { createHash } from "node:crypto"

import type {
  DiffChunk,
  FileDiff,
  Fragment,
  LineTokens,
  StructuralProof,
} from "@legible/domain"

import { INDENTATION_SENSITIVE, WHITESPACE_PROOF_LANGUAGES } from "./classify"
import { linesInsideStrings, STRING_SCOPE } from "./highlight"
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
}

/**
 * Languages where whitespace inside a line never changes meaning (outside
 * strings), given we keep a space between two word characters and between two
 * operator characters. Shell, YAML, CSS, Swift, Ruby and others are excluded on
 * purpose: `a = b` and `a=b` differ in shell, `0 -1px` and `0-1px` in CSS.
 */
const INTRA_LINE_SAFE = new Set([
  "typescript",
  "javascript",
  "java",
  "c",
  "cpp",
  "rust",
  "go",
  "php",
  "json",
  "python",
])

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
  // Parsed lazily: only chunks that look whitespace-only need it.
  let strings: { base: Uint8Array | null; head: Uint8Array | null } | null =
    null
  const stringLines = () => {
    strings ??= {
      base: linesInsideStrings(input.language, input.baseLines),
      head: linesInsideStrings(input.language, input.headLines),
    }
    return strings
  }

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

    const proof = proveStructural(input, chunk, stringLines)
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

/** Which Structural proof, if any, holds for a change chunk. Anything unproven stays Behavioral. */
export function proveStructural(
  input: FileDiffInput,
  chunk: DiffChunk,
  stringLines: () => {
    base: Uint8Array | null
    head: Uint8Array | null
  } = () => ({
    base: linesInsideStrings(input.language, input.baseLines),
    head: linesInsideStrings(input.language, input.headLines),
  }),
): StructuralProof | null {
  const lang = input.language
  // Without a parse we can't tell code from string contents, so prove nothing.
  if (
    !lang ||
    !input.baseTokens ||
    !input.headTokens ||
    !WHITESPACE_PROOF_LANGUAGES.has(lang)
  )
    return null
  const indentSensitive = INDENTATION_SENSITIVE.has(lang)

  const baseSeq = normalizedSequence(
    input.baseLines,
    input.baseTokens,
    chunk.baseStart,
    chunk.baseEnd,
    indentSensitive ? "trimEnd" : "trim",
  )
  const headSeq = normalizedSequence(
    input.headLines,
    input.headTokens,
    chunk.headStart,
    chunk.headEnd,
    indentSensitive ? "trimEnd" : "trim",
  )
  const insideString = () => {
    const s = stringLines()
    if (!s.base || !s.head) return true
    // A line starting inside a multi-line string, or the line just after the change (a removed
    // line may have been the string's interior), means the whitespace is content.
    for (
      let i = chunk.baseStart;
      i <= Math.min(chunk.baseEnd, input.baseLines.length - 1);
      i++
    )
      if (s.base[i]) return true
    for (
      let i = chunk.headStart;
      i <= Math.min(chunk.headEnd, input.headLines.length - 1);
      i++
    )
      if (s.head[i]) return true
    return false
  }
  if (arraysEqual(baseSeq, headSeq)) return insideString() ? null : "whitespace"

  // In C-family preprocessor lines spacing is meaningful: `#define F (a)` isn't `#define F(a)`.
  const preprocessor = (lines: string[], s: number, e: number) =>
    lines.slice(s, e).some((l) => l.trimStart().startsWith("#"))
  const cFamily = lang === "c" || lang === "cpp"
  if (
    cFamily &&
    (preprocessor(input.baseLines, chunk.baseStart, chunk.baseEnd) ||
      preprocessor(input.headLines, chunk.headStart, chunk.headEnd))
  ) {
    return null
  }

  if (INTRA_LINE_SAFE.has(lang)) {
    const mode = indentSensitive ? "collapseKeepLead" : "collapse"
    const b = normalizedSequence(
      input.baseLines,
      input.baseTokens,
      chunk.baseStart,
      chunk.baseEnd,
      mode,
    )
    const h = normalizedSequence(
      input.headLines,
      input.headTokens,
      chunk.headStart,
      chunk.headEnd,
      mode,
    )
    if (arraysEqual(b, h)) return insideString() ? null : "formatting"
  }
  return null
}

type NormMode = "trim" | "trimEnd" | "collapse" | "collapseKeepLead"

function normalizedSequence(
  lines: string[],
  tokens: LineTokens[],
  start: number,
  end: number,
  mode: NormMode,
): string[] {
  const out: string[] = []
  for (let i = start; i < end; i++) {
    const line = lines[i] as string
    if (line.trim() === "") {
      // A blank line inside a multi-line string is content; elsewhere it isn't.
      if (blankInsideString(lines, tokens, i)) out.push("\u0000blank-in-string")
      continue
    }
    out.push(normalizeLine(line, tokens[i] ?? [], mode))
  }
  return out
}

function blankInsideString(
  lines: string[],
  tokens: LineTokens[],
  i: number,
): boolean {
  let p = i - 1
  while (p >= 0 && (lines[p] as string).trim() === "") p--
  let n = i + 1
  while (n < lines.length && (lines[n] as string).trim() === "") n++
  if (p < 0 || n >= lines.length) return false
  const prev = tokens[p] ?? []
  const next = tokens[n] ?? []
  const prevLine = lines[p] as string
  const endsInString =
    prev.length >= 3 &&
    prev[prev.length - 1] === STRING_SCOPE &&
    (prev[prev.length - 3] as number) + (prev[prev.length - 2] as number) >=
      prevLine.length
  const startsInString =
    next.length >= 3 && next[0] === 0 && next[2] === STRING_SCOPE
  // Either edge is enough: a template line can end in `${x}`, or a string can start mid-line.
  return endsInString || startsInString
}

const WORD = /[A-Za-z0-9_$]/
const OPER = /[+\-*/%=<>!&|^~?:.]/

/** Normalizes whitespace outside string tokens; string characters are kept verbatim. */
export function normalizeLine(
  line: string,
  tokens: LineTokens,
  mode: NormMode,
): string {
  const inString = new Uint8Array(line.length)
  for (let i = 0; i < tokens.length; i += 3) {
    if (tokens[i + 2] !== STRING_SCOPE) continue
    const s = tokens[i] as number
    const e = s + (tokens[i + 1] as number)
    for (let c = s; c < e && c < line.length; c++) inString[c] = 1
  }
  // Leading and trailing whitespace: verbatim when inside a string.
  let lead = 0
  while (
    lead < line.length &&
    /\s/.test(line[lead] as string) &&
    !inString[lead]
  )
    lead++
  let tail = line.length
  while (
    tail > lead &&
    /\s/.test(line[tail - 1] as string) &&
    !inString[tail - 1]
  )
    tail--

  // A trailing backslash continues the line; whitespace after it changes meaning.
  if (line.slice(0, tail).endsWith("\\")) tail = line.length
  const keepLead = mode === "trimEnd" || mode === "collapseKeepLead"
  let out = keepLead ? line.slice(0, lead) : ""
  if (mode === "trim" || mode === "trimEnd") return out + line.slice(lead, tail)

  let pendingSpace = false
  let prev = ""
  for (let c = lead; c < tail; c++) {
    const ch = line[c] as string
    if (inString[c]) {
      if (pendingSpace && prev && needsSpace(prev, ch)) out += " "
      pendingSpace = false
      out += ch
      prev = ch
      continue
    }
    if (/\s/.test(ch)) {
      pendingSpace = true
      continue
    }
    if (pendingSpace && prev && needsSpace(prev, ch)) out += " "
    pendingSpace = false
    out += ch
    prev = ch
  }
  return out
}

function needsSpace(a: string, b: string): boolean {
  return (
    (WORD.test(a) && WORD.test(b)) ||
    (OPER.test(a) && OPER.test(b)) ||
    a === '"' ||
    a === "'" ||
    b === '"' ||
    b === "'"
  )
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export function isTrivialLine(line: string): boolean {
  const t = line.trim()
  return t.length === 0 || /^[\s{}()[\];,]*$/.test(t)
}
