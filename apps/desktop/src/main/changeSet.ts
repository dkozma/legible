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
}

async function readText(repo: GitRepo, oid: string | null, mode: string): Promise<{ lines: string[]; binary: boolean; size: number }> {
  if (!oid || mode === SUBMODULE) return { lines: [], binary: mode === SUBMODULE, size: 0 };
  const buf = await repo.blobs().read(oid);
  if (!buf) return { lines: [], binary: false, size: 0 };
  if (looksBinary(buf)) return { lines: [], binary: true, size: buf.length };
  return { lines: splitLines(buf.toString('utf8')), binary: false, size: buf.length };
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
    };
  });

  const chunksById = new Map<string, DiffChunk[]>();
  for (const f of loaded) chunksById.set(f.id, f.binary ? [] : diffLines(f.base, f.head, { ignoreWhitespace: opts.ignoreWhitespace }));

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
  const files: FileChange[] = loaded.map((f) => {
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
      moves: moves.filter((m) => m.fromFileId === f.id || m.toFileId === f.id),
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
    return {
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
    };
  });

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
