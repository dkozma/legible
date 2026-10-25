// Builds a Change Set from two commits: pairs files (renames, copies), reads
// blobs, diffs, classifies, detects moves, highlights, and proves Structural
// Fragments. Results are cached per (Iteration, whitespace mode).

import {
  buildFileDiff,
  collapseReason,
  detectMoves,
  diffLines,
  hash,
  highlightLines,
  LARGE_FILE_BYTES,
  languageForPath,
  looksBinary,
  splitLines,
} from '@legible/diff';
import type { ChangeSetSummary, DiffChunk, FileChange, FileDiff, LineTokens, MoveBlock } from '@legible/domain';
import type { GitRepo, RawChange } from '@legible/git';

const SUBMODULE = '160000';
/** Files longer than this are diffed but not highlighted. */
const MAX_HIGHLIGHT_LINES = 20_000;

export interface BuiltChangeSet {
  summary: ChangeSetSummary;
  diffs: Map<string, FileDiff>;
}

interface Loaded {
  raw: RawChange;
  id: string;
  path: string;
  language: string | null;
  base: string[];
  head: string[];
  binary: boolean;
  size: number;
  notes: string[];
}

interface Text {
  lines: string[];
  binary: boolean;
  size: number;
  /** Null when there is no content on this side. */
  finalNewline: boolean | null;
  crlf: boolean;
}

async function readText(repo: GitRepo, oid: string | null, mode: string): Promise<Text> {
  const empty = { lines: [], binary: false, size: 0, finalNewline: null, crlf: false };
  if (!oid || mode === SUBMODULE) return { ...empty, binary: mode === SUBMODULE };
  const buf = await repo.blobs().read(oid);
  // A missing object would otherwise show the file as fully added or deleted.
  if (!buf) throw new Error(`Object ${oid.slice(0, 10)} is missing from the repository.`);
  if (looksBinary(buf)) return { ...empty, binary: true, size: buf.length };
  const text = buf.toString('utf8');
  return {
    lines: splitLines(text),
    binary: false,
    size: buf.length,
    finalNewline: text.length === 0 || text.endsWith('\n'),
    crlf: text.includes('\r\n'),
  };
}

function textNotes(b: Text, h: Text): string[] {
  const notes: string[] = [];
  if (b.finalNewline !== null && h.finalNewline !== null && b.finalNewline !== h.finalNewline) {
    notes.push(h.finalNewline ? 'Newline added at end of file' : 'No newline at end of file');
  }
  if (b.finalNewline !== null && h.finalNewline !== null && b.crlf !== h.crlf)
    notes.push(h.crlf ? 'Line endings LF → CRLF' : 'Line endings CRLF → LF');
  return notes;
}

/**
 * Returns a function that yields to the event loop once a slice of synchronous
 * work has run for `budgetMs`, so IPC and window events get through a long build.
 */
function yielder(budgetMs = 12): () => Promise<void> {
  let since = performance.now();
  return async () => {
    if (performance.now() - since < budgetMs) return;
    await new Promise((r) => setImmediate(r));
    since = performance.now();
  };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i] as T);
      }
    }),
  );
  return out;
}

const tokenCache = new Map<string, LineTokens[] | null>();
function tokensFor(oid: string | null, language: string | null, lines: string[]): LineTokens[] | null {
  if (!oid || lines.length === 0 || lines.length > MAX_HIGHLIGHT_LINES) return null;
  const key = `${oid}:${language}`;
  if (tokenCache.has(key)) return tokenCache.get(key) ?? null;
  const t = highlightLines(language, lines);
  tokenCache.set(key, t);
  if (tokenCache.size > 2000) tokenCache.delete(tokenCache.keys().next().value as string);
  return t;
}

export async function buildChangeSet(
  repo: GitRepo,
  ids: { reviewId: string; iterationId: string },
  baseSha: string,
  headSha: string,
  opts: { ignoreWhitespace: boolean; prefetch: boolean },
): Promise<BuiltChangeSet> {
  if (opts.prefetch) {
    // In blobless cache clones this fetches every needed blob in one batch
    // instead of one request per blob.
    await repo.git(['diff', '--numstat', '-M', baseSha, headSha, '--'], { allowFailure: true });
  }
  const raws = await repo.diffRaw(baseSha, headSha);
  const attrs = await repo.generatedAttributes(
    headSha,
    raws.map((r) => r.path),
  );

  const loaded: Loaded[] = await mapLimit(raws, 8, async (raw) => {
    const [b, h] = await Promise.all([readText(repo, raw.oldOid, raw.oldMode), readText(repo, raw.newOid, raw.newMode)]);
    return {
      raw,
      id: hash(`${raw.oldPath ?? raw.path}\0${raw.path}\0${raw.oldOid ?? ''}\0${raw.newOid ?? ''}`),
      path: raw.path,
      language: languageForPath(raw.path),
      base: b.lines,
      head: h.lines,
      binary: b.binary || h.binary,
      size: Math.max(b.size, h.size),
      notes: textNotes(b, h),
    };
  });

  const breathe = yielder();
  const chunksById = new Map<string, DiffChunk[]>();
  for (const f of loaded) {
    chunksById.set(f.id, f.binary ? [] : diffLines(f.base, f.head, { ignoreWhitespace: opts.ignoreWhitespace }));
    await breathe();
  }

  const collapse = new Map(
    loaded.map((f) => [
      f.id,
      f.binary
        ? ('binary' as const)
        : collapseReason({
            path: f.path,
            headText: (f.head.length ? f.head : f.base).slice(0, 6).join('\n'),
            attributes: attrs.get(f.path),
            sizeBytes: f.size > LARGE_FILE_BYTES ? f.size : undefined,
          }),
    ]),
  );

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
  );

  const diffs = new Map<string, FileDiff>();
  const files: FileChange[] = [];
  for (const f of loaded) {
    const reason = collapse.get(f.id) ?? null;
    const highlight = !reason || reason === 'generated' || reason === 'vendored';
    const baseTokens = highlight ? tokensFor(f.raw.oldOid, f.language, f.base) : null;
    const headTokens = highlight ? tokensFor(f.raw.newOid, f.language, f.head) : null;
    const diff = buildFileDiff({
      fileId: f.id,
      path: f.path,
      language: f.language,
      baseLines: f.base,
      headLines: f.head,
      baseTokens,
      headTokens,
      ignoreWhitespace: opts.ignoreWhitespace,
      chunks: chunksById.get(f.id),
    });
    diffs.set(f.id, diff);
    let additions = 0;
    let deletions = 0;
    for (const c of diff.chunks) {
      if (c.kind !== 'change') continue;
      additions += c.headEnd - c.headStart;
      deletions += c.baseEnd - c.baseStart;
    }
    const proofs = new Set(diff.fragments.map((fr) => fr.proof));
    const allStructural = diff.fragments.length > 0 && diff.fragments.every((fr) => fr.kind === 'structural');
    files.push({
      id: f.id,
      path: f.path,
      oldPath: f.raw.oldPath,
      status: f.raw.status,
      baseOid: f.raw.oldOid,
      headOid: f.raw.newOid,
      language: f.language,
      additions,
      deletions,
      binary: f.binary,
      collapse: reason,
      structural: allStructural ? (proofs.size === 1 ? ([...proofs][0] ?? null) : 'formatting') : null,
      chunks: diff.chunks,
      fragments: diff.fragments,
      baseLineCount: f.base.length,
      headLineCount: f.head.length,
      notes: f.notes,
    });
    await breathe();
  }

  files.sort(compareFiles);
  const summary: ChangeSetSummary = {
    reviewId: ids.reviewId,
    iterationId: ids.iterationId,
    baseSha,
    headSha,
    files,
    moves,
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
  };
  return { summary, diffs };
}

/** Directory-tree order, so the file list and the diff read in the same order. */
export function compareFiles(a: FileChange, b: FileChange): number {
  const pa = a.path.split('/');
  const pb = b.path.split('/');
  const n = Math.min(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] as string;
    const y = pb[i] as string;
    if (x === y) continue;
    const xDir = i < pa.length - 1;
    const yDir = i < pb.length - 1;
    if (xDir !== yDir) return xDir ? -1 : 1;
    return x.localeCompare(y);
  }
  return pa.length - pb.length;
}
