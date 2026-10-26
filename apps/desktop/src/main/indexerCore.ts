// The indexer: builds Change Sets (diffs, tree-sitter highlighting, Symbols,
// AST proofs) and answers Connections queries, away from the main process so
// parsing never blocks IPC, the database or windows. This module is the
// transport-independent core; indexer.ts wires it to a utilityProcess.

import type {
  CodeSymbol,
  IndexStatus,
  PositionInfo,
  Side,
  SymbolConnections,
  SymbolSource,
} from "@legible/domain"
import { GitRepo } from "@legible/git"
import {
  type BuiltChangeSet,
  buildChangeSet,
  CodeIndex,
  defaultSource,
  Grammars,
  Parsing,
} from "@legible/indexer"

export interface RepoRef {
  gitDir: string
  workTree: string | null
  env: Record<string, string> | null
}

/** Identifies one Change Set's code index: the repository and both commits. */
export interface IndexKey {
  repo: RepoRef
  baseSha: string
  headSha: string
}

export interface IndexerConfig {
  /** On-disk parse cache. */
  cacheDir: string | null
  /** Bundled grammars (packaged app); node_modules otherwise. */
  grammarsDir: string | null
}

/** Everything the indexer answers. Both the utility process client and the in-process core implement it. */
export interface Indexer {
  buildChangeSet(
    key: IndexKey,
    ids: { reviewId: string; iterationId: string },
    opts: { ignoreWhitespace: boolean; prefetch: boolean },
  ): Promise<BuiltChangeSet>
  status(key: IndexKey): Promise<IndexStatus>
  fileSymbols(
    key: IndexKey,
    fileId: string,
  ): Promise<{ base: CodeSymbol[]; head: CodeSymbol[] }>
  connections(
    key: IndexKey,
    symbolId: string,
  ): Promise<SymbolConnections | null>
  at(
    key: IndexKey,
    side: Side,
    path: string,
    line: number,
    col: number,
  ): Promise<PositionInfo>
  source(key: IndexKey, symbolId: string): Promise<SymbolSource | null>
  dispose(): void
}

export type IndexerMethod = Exclude<keyof Indexer, "dispose">

export type ToIndexer =
  | { type: "configure"; config: IndexerConfig }
  | { type: "call"; id: string; method: IndexerMethod; args: unknown[] }

export type FromIndexer =
  | { type: "reply"; id: string; ok: true; value: unknown }
  | { type: "reply"; id: string; ok: false; message: string }

/** Code indexes kept per process: one per recently opened Change Set. */
const MAX_INDEXES = 4

export function createIndexer(config: IndexerConfig): Indexer {
  const parsing = new Parsing({
    grammars: new Grammars(defaultSource(config.grammarsDir ?? undefined)),
    cache: config.cacheDir ? { dir: config.cacheDir } : undefined,
  })
  const repos = new Map<string, GitRepo>()
  const indexes = new Map<string, CodeIndex>()
  const pending = new Map<string, Promise<CodeIndex>>()

  const repoFor = (r: RepoRef) => {
    let repo = repos.get(r.gitDir)
    if (!repo) {
      repo = GitRepo.at(r.gitDir, r.workTree, r.env ?? undefined)
      repos.set(r.gitDir, repo)
    }
    return repo
  }
  const keyOf = (k: IndexKey) => `${k.repo.gitDir}\0${k.baseSha}..${k.headSha}`

  const remember = (key: string, index: CodeIndex) => {
    indexes.delete(key)
    indexes.set(key, index)
    while (indexes.size > MAX_INDEXES)
      indexes.delete(indexes.keys().next().value as string)
  }

  /** The code index for a Change Set, building it (and the Change Set) when this process has none. */
  const indexFor = (k: IndexKey): Promise<CodeIndex> => {
    const key = keyOf(k)
    const hit = indexes.get(key)
    if (hit) return Promise.resolve(hit)
    let p = pending.get(key)
    if (!p) {
      p = buildChangeSet(
        repoFor(k.repo),
        parsing,
        { reviewId: "", iterationId: "" },
        k.baseSha,
        k.headSha,
        { ignoreWhitespace: false, prefetch: false },
      ).then((built) => {
        const index = new CodeIndex({
          repo: repoFor(k.repo),
          parsing,
          baseSha: k.baseSha,
          headSha: k.headSha,
          files: built.indexed,
        })
        remember(key, index)
        return index
      })
      pending.set(key, p)
      void p.finally(() => pending.delete(key)).catch(() => undefined)
    }
    return p
  }

  const ready = async (k: IndexKey) => {
    const index = await indexFor(k)
    await index.ready
    return index
  }

  return {
    async buildChangeSet(k, ids, opts) {
      const built = await buildChangeSet(
        repoFor(k.repo),
        parsing,
        ids,
        k.baseSha,
        k.headSha,
        opts,
      )
      // Connections are indexed in the background, from the whitespace-sensitive build.
      const key = keyOf(k)
      if (!opts.ignoreWhitespace && !indexes.has(key) && !pending.has(key))
        remember(
          key,
          new CodeIndex({
            repo: repoFor(k.repo),
            parsing,
            baseSha: k.baseSha,
            headSha: k.headSha,
            files: built.indexed,
          }),
        )
      return { summary: built.summary, diffs: built.diffs }
    },
    async status(k) {
      return (await indexFor(k)).status
    },
    async fileSymbols(k, fileId) {
      return (await indexFor(k)).fileSymbols(fileId)
    },
    async connections(k, symbolId) {
      return (await ready(k)).forSymbol(symbolId)
    },
    async at(k, side, path, line, col) {
      return (await ready(k)).at(side, path, line, col)
    },
    async source(k, symbolId) {
      return (await ready(k)).source(symbolId)
    },
    dispose() {
      for (const r of repos.values()) r.close()
      repos.clear()
      indexes.clear()
    },
  }
}

/** Serves an Indexer over a message transport (the utility process side). */
export function serveIndexer(post: (m: FromIndexer) => void) {
  let indexer: Indexer | null = null
  let config: IndexerConfig = { cacheDir: null, grammarsDir: null }
  const get = () => (indexer ??= createIndexer(config))
  return {
    handle(m: ToIndexer) {
      if (m.type === "configure") {
        config = m.config
        indexer?.dispose()
        indexer = null
        return
      }
      const target = get()
      const fn = target[m.method] as (...a: unknown[]) => Promise<unknown>
      fn.apply(target, m.args).then(
        (value) => post({ type: "reply", id: m.id, ok: true, value }),
        (e: unknown) =>
          post({
            type: "reply",
            id: m.id,
            ok: false,
            message: e instanceof Error ? e.message : String(e),
          }),
      )
    },
    dispose() {
      indexer?.dispose()
    },
  }
}
