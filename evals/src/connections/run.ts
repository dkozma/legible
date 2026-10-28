// Scores every prepared commit of a corpus entry: the Change Set and
// CodeIndex built the way evals/src/run.ts builds them, then each side
// against SCIP from the parent (Base) and the commit (Head).

import { languageForPath, splitLines } from "@legible/diff"
import type { Side } from "@legible/domain"
import { GitRepo } from "@legible/git"
import { buildChangeSet, CodeIndex, Parsing } from "@legible/indexer"

import type { PreparedEntry } from "./corpus"
import { loadScip, type ScipIndex } from "./scip"
import {
  type ChangeSetScore,
  scoreChangeSet,
  type SiteScore,
  type UsedBySite,
} from "./score"

export interface ChangeSetResult {
  entry: string
  sha: string
  parent: string
  subject: string
  /** Changed files, and Connections made on Head. */
  files: number
  connections: number
  durationMs: number
  score: ChangeSetScore | null
  skipped: string | null
}

export interface EntryRun {
  results: ChangeSetResult[]
  sites: (SiteScore & { sha: string })[]
  usedBy: (UsedBySite & { sha: string })[]
}

/** Name positions (0-based) of every Symbol in a file at a commit, parsed as CodeIndex parses it. */
export function symbolPositions(repo: GitRepo, parsing: Parsing) {
  const trees = new Map<string, Promise<Map<string, string>>>()
  const treeOf = (sha: string) => {
    let t = trees.get(sha)
    if (!t) {
      t = repo.treeBlobs(sha)
      trees.set(sha, t)
      if (trees.size > 4) trees.delete(trees.keys().next().value as string)
    }
    return t
  }
  return async (sha: string, path: string) => {
    const oid = (await treeOf(sha)).get(path)
    const language = languageForPath(path)
    if (!oid || !language) return null
    const buf = await repo.blobs().read(oid)
    if (!buf) return null
    const parsed = await parsing.parse({
      oid,
      language,
      lines: splitLines(buf.toString("utf8")),
      tokens: false,
    })
    return (parsed.outline?.symbols ?? []).map((s) => ({
      line: s.nameLine,
      col: s.nameCol,
    }))
  }
}

export async function runEntry(
  prepared: PreparedEntry,
  log: (line: string) => void = () => {},
): Promise<EntryRun> {
  const out: EntryRun = { results: [], sites: [], usedBy: [] }
  const repo = await GitRepo.open(prepared.repoDir)
  const parsing = new Parsing()
  // Consecutive commits share an index: one's Head is the next one's Base.
  const loaded = new Map<string, Promise<ScipIndex>>()
  const scipFor = (file: string, sha: string) => {
    let p = loaded.get(file)
    if (!p) {
      p = loadScip(
        file,
        async (path) =>
          (await repo.blobs().readPath(sha, path))?.toString("utf8") ?? null,
      )
      loaded.set(file, p)
      if (loaded.size > 4) loaded.delete(loaded.keys().next().value as string)
    }
    return p
  }
  const symbolsAt = symbolPositions(repo, parsing)

  try {
    for (const c of prepared.commits) {
      const base = {
        entry: prepared.entry.name,
        sha: c.sha,
        parent: c.parent,
        subject: c.subject,
        files: 0,
        connections: 0,
        durationMs: 0,
        score: null,
      }
      if (c.skipped || !c.base || !c.head) {
        out.results.push({ ...base, skipped: c.skipped ?? "not indexed" })
        continue
      }
      const started = Date.now()
      try {
        const built = await buildChangeSet(
          repo,
          parsing,
          { reviewId: prepared.entry.name, iterationId: c.sha },
          c.parent,
          c.sha,
          { ignoreWhitespace: false, prefetch: false },
        )
        const index = new CodeIndex({
          repo,
          parsing,
          baseSha: c.parent,
          headSha: c.sha,
          files: built.indexed,
        })
        await index.ready
        if (index.status.state === "error")
          throw new Error(`CodeIndex failed: ${index.status.error}`)
        const shaOf: Record<Side, string> = { base: c.parent, head: c.sha }
        const [baseScip, headScip] = await Promise.all([
          scipFor(c.base, c.parent),
          scipFor(c.head, c.sha),
        ])
        const scored = await scoreChangeSet({
          index,
          files: built.indexed,
          scip: { base: baseScip, head: headScip },
          symbolsIn: (side, path) => symbolsAt(shaOf[side], path),
        })
        out.results.push({
          ...base,
          files: built.summary.files.length,
          connections: index.connectionsOn("head").length,
          durationMs: Date.now() - started,
          score: scored.score,
          skipped: null,
        })
        for (const s of scored.sites) out.sites.push({ ...s, sha: c.sha })
        for (const u of scored.usedBy) out.usedBy.push({ ...u, sha: c.sha })
        log(
          `  scored ${prepared.entry.name} ${c.sha.slice(0, 8)} in ${((Date.now() - started) / 1000).toFixed(1)}s`,
        )
      } catch (e) {
        out.results.push({
          ...base,
          durationMs: Date.now() - started,
          skipped: (e as Error).message,
        })
      }
    }
  } finally {
    repo.close()
  }
  return out
}
