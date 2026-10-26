// Builds a Change Set from two commits: pairs files (renames, copies), reads
// blobs, diffs, classifies, detects moves, parses both sides (highlighting,
// Symbols), splits Fragments at Symbol boundaries, and proves Structural
// Fragments from the AST. The main process caches results per (Iteration,
// whitespace mode).

import {
  buildFileDiff,
  collapseReason,
  detectMoves,
  diffLines,
  hash,
  LARGE_FILE_BYTES,
  languageForPath,
  looksBinary,
  splitLines,
} from "@legible/diff"
import type {
  ChangeSetSummary,
  CodeSymbol,
  DiffChunk,
  FileChange,
  FileDiff,
  MoveBlock,
} from "@legible/domain"
import type { GitRepo, RawChange } from "@legible/git"

import { splitAtSymbols } from "./fragments"
import type { Outline } from "./outline"
import type { Parsing } from "./parse"
import { proveChunks } from "./proofs"
import { matchSymbols, toCodeSymbols } from "./symbols"

const SUBMODULE = "160000"

export interface BuiltChangeSet {
  summary: ChangeSetSummary
  diffs: Map<string, FileDiff>
}

/** What the Connections index needs about each changed file; stays in the indexer. */
export interface IndexedFile {
  fileId: string
  path: string
  oldPath: string | null
  language: string | null
  baseOid: string | null
  headOid: string | null
  base: { lines: string[]; outline: Outline | null; symbols: CodeSymbol[] }
  head: { lines: string[]; outline: Outline | null; symbols: CodeSymbol[] }
}

interface Loaded {
  raw: RawChange
  id: string
  path: string
  language: string | null
  base: string[]
  head: string[]
  binary: boolean
  size: number
  notes: string[]
}

interface Text {
  lines: string[]
  binary: boolean
  size: number
  /** Null when there is no content on this side. */
  finalNewline: boolean | null
  crlf: boolean
}

async function readText(
  repo: GitRepo,
  oid: string | null,
  mode: string,
): Promise<Text> {
  const empty = {
    lines: [],
    binary: false,
    size: 0,
    finalNewline: null,
    crlf: false,
  }
  if (!oid || mode === SUBMODULE)
    return { ...empty, binary: mode === SUBMODULE }
  const buf = await repo.blobs().read(oid)
  // A missing object would otherwise show the file as fully added or deleted.
  if (!buf)
    throw new Error(
      `Object ${oid.slice(0, 10)} is missing from the repository.`,
    )
  if (looksBinary(buf)) return { ...empty, binary: true, size: buf.length }
  const text = buf.toString("utf8")
  return {
    lines: splitLines(text),
    binary: false,
    size: buf.length,
    finalNewline: text.length === 0 || text.endsWith("\n"),
    crlf: text.includes("\r\n"),
  }
}

function textNotes(b: Text, h: Text): string[] {
  const notes: string[] = []
  if (
    b.finalNewline !== null &&
    h.finalNewline !== null &&
    b.finalNewline !== h.finalNewline
  ) {
    notes.push(
      h.finalNewline
        ? "Newline added at end of file"
        : "No newline at end of file",
    )
  }
  if (b.finalNewline !== null && h.finalNewline !== null && b.crlf !== h.crlf)
    notes.push(h.crlf ? "Line endings LF → CRLF" : "Line endings CRLF → LF")
  return notes
}

/**
 * Returns a function that yields to the event loop once a slice of synchronous
 * work has run for `budgetMs`, so IPC and window events get through a long build.
 */
function yielder(budgetMs = 12): () => Promise<void> {
  let since = performance.now()
  return async () => {
    if (performance.now() - since < budgetMs) return
    await new Promise((r) => setImmediate(r))
    since = performance.now()
  }
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (t: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i] as T)
      }
    }),
  )
  return out
}

export async function buildChangeSet(
  repo: GitRepo,
  parsing: Parsing,
  ids: { reviewId: string; iterationId: string },
  baseSha: string,
  headSha: string,
  opts: { ignoreWhitespace: boolean; prefetch: boolean },
): Promise<BuiltChangeSet & { indexed: IndexedFile[] }> {
  if (opts.prefetch) {
    // In blobless cache clones this fetches every needed blob in one batch
    // instead of one request per blob.
    await repo.git(["diff", "--numstat", "-M", baseSha, headSha, "--"], {
      allowFailure: true,
    })
  }
  const raws = await repo.diffRaw(baseSha, headSha)
  const attrs = await repo.generatedAttributes(
    headSha,
    raws.map((r) => r.path),
  )

  const loaded: Loaded[] = await mapLimit(raws, 8, async (raw) => {
    const [b, h] = await Promise.all([
      readText(repo, raw.oldOid, raw.oldMode),
      readText(repo, raw.newOid, raw.newMode),
    ])
    return {
      raw,
      id: hash(
        `${raw.oldPath ?? raw.path}\0${raw.path}\0${raw.oldOid ?? ""}\0${raw.newOid ?? ""}`,
      ),
      path: raw.path,
      language: languageForPath(raw.path),
      base: b.lines,
      head: h.lines,
      binary: b.binary || h.binary,
      size: Math.max(b.size, h.size),
      notes: textNotes(b, h),
    }
  })

  const breathe = yielder()
  const chunksById = new Map<string, DiffChunk[]>()
  for (const f of loaded) {
    chunksById.set(
      f.id,
      f.binary
        ? []
        : diffLines(f.base, f.head, {
            ignoreWhitespace: opts.ignoreWhitespace,
          }),
    )
    await breathe()
  }

  const collapse = new Map(
    loaded.map((f) => [
      f.id,
      f.binary
        ? ("binary" as const)
        : collapseReason({
            path: f.path,
            headText: (f.head.length ? f.head : f.base).slice(0, 6).join("\n"),
            attributes: attrs.get(f.path),
            sizeBytes: f.size > LARGE_FILE_BYTES ? f.size : undefined,
          }),
    ]),
  )

  const moves: MoveBlock[] = detectMoves(
    loaded
      .filter((f) => !collapse.get(f.id))
      .map((f) => ({
        fileId: f.id,
        path: f.path,
        language: f.language,
        baseLines: f.base,
        headLines: f.head,
        chunks: chunksById.get(f.id) ?? [],
      })),
  )

  const diffs = new Map<string, FileDiff>()
  const files: FileChange[] = []
  const indexed: IndexedFile[] = []
  for (const f of loaded) {
    const reason = collapse.get(f.id) ?? null
    const highlight = !reason || reason === "generated" || reason === "vendored"
    const parse = !f.binary && reason !== "lockfile" && reason !== "large"
    const [baseParsed, headParsed] = parse
      ? await Promise.all([
          parsing.parse({
            oid: f.raw.oldOid,
            language: f.language,
            lines: f.base,
            tokens: highlight,
          }),
          parsing.parse({
            oid: f.raw.newOid,
            language: f.language,
            lines: f.head,
            tokens: highlight,
          }),
        ])
      : [null, null]
    const lang = f.language ?? "text"
    const baseSymbols = baseParsed?.outline
      ? toCodeSymbols(
          "base",
          f.raw.oldPath ?? f.path,
          lang,
          baseParsed.outline.symbols,
        )
      : []
    const headSymbols = headParsed?.outline
      ? toCodeSymbols("head", f.path, lang, headParsed.outline.symbols)
      : []
    matchSymbols(baseSymbols, headSymbols, f.base, f.head)
    const chunks = splitAtSymbols(
      chunksById.get(f.id) ?? [],
      baseSymbols,
      headSymbols,
      f.base,
      f.head,
    )
    const proofs =
      parse && !reason
        ? await proveChunks(parsing, {
            language: f.language,
            baseLines: f.base,
            headLines: f.head,
            chunks,
          })
        : undefined
    const diff = buildFileDiff({
      fileId: f.id,
      path: f.path,
      language: f.language,
      baseLines: f.base,
      headLines: f.head,
      baseTokens: baseParsed?.tokens ?? null,
      headTokens: headParsed?.tokens ?? null,
      ignoreWhitespace: opts.ignoreWhitespace,
      chunks,
      proofs,
    })
    diffs.set(f.id, diff)
    let additions = 0
    let deletions = 0
    for (const c of diff.chunks) {
      if (c.kind !== "change") continue
      additions += c.headEnd - c.headStart
      deletions += c.baseEnd - c.baseStart
    }
    const proofKinds = new Set(diff.fragments.map((fr) => fr.proof))
    const allStructural =
      diff.fragments.length > 0 &&
      diff.fragments.every((fr) => fr.kind === "structural")
    files.push({
      id: f.id,
      path: f.path,
      oldPath: f.raw.oldPath,
      status: f.raw.status,
      baseOid: f.raw.oldOid,
      headOid: f.raw.newOid,
      language: f.language,
      tier: (headParsed ?? baseParsed)?.tier ?? "text",
      additions,
      deletions,
      binary: f.binary,
      collapse: reason,
      structural: allStructural
        ? proofKinds.size === 1
          ? ([...proofKinds][0] ?? null)
          : "formatting"
        : null,
      chunks: diff.chunks,
      fragments: diff.fragments,
      baseLineCount: f.base.length,
      headLineCount: f.head.length,
      notes: f.notes,
    })
    if (parse)
      indexed.push({
        fileId: f.id,
        path: f.path,
        oldPath: f.raw.oldPath,
        language: f.language,
        baseOid: f.raw.oldOid,
        headOid: f.raw.newOid,
        base: {
          lines: f.base,
          outline: baseParsed?.outline ?? null,
          symbols: baseSymbols,
        },
        head: {
          lines: f.head,
          outline: headParsed?.outline ?? null,
          symbols: headSymbols,
        },
      })
    await breathe()
  }

  files.sort(compareFiles)
  const summary: ChangeSetSummary = {
    reviewId: ids.reviewId,
    iterationId: ids.iterationId,
    baseSha,
    headSha,
    files,
    moves,
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
  }
  return { summary, diffs, indexed }
}

/** Directory-tree order, so the file list and the diff read in the same order. */
export function compareFiles(a: FileChange, b: FileChange): number {
  const pa = a.path.split("/")
  const pb = b.path.split("/")
  const n = Math.min(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const x = pa[i] as string
    const y = pb[i] as string
    if (x === y) continue
    const xDir = i < pa.length - 1
    const yDir = i < pb.length - 1
    if (xDir !== yDir) return xDir ? -1 : 1
    return x.localeCompare(y)
  }
  return pa.length - pb.length
}
