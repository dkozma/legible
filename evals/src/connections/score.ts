// Scores one Change Set's Connections against SCIP, which records what the
// type checker says each name refers to. At each use in a changed file SCIP
// says one of: a local or parameter (no Connection should be made, unless it's
// a local function we index as a Symbol), a definition in the repository (the
// correct target is the Symbol whose name SCIP says is that symbol, or one
// related to it by implementation), external (no definition in the index), or
// nothing (unknown, not scored). Statuses are counted generically, so a new
// ConnectionStatus shows up without changes here.

import type { CodeSymbol, Connection, Side } from "@legible/domain"
import type { CodeIndex, IndexedFile, RawReference } from "@legible/indexer"
import { familyOf, symbolId } from "@legible/indexer"

import {
  constructorClass,
  DEFINITION,
  isLocalSymbol,
  type ScipIndex,
} from "./scip"

export type ScipCategory =
  | "local"
  | "declaration"
  | "repo"
  | "external"
  | "unknown"

/** What CodeIndex said at a use: "none", or a ConnectionStatus. */
export type Ours = string

export interface SiteScore {
  side: Side
  path: string
  /** 1-based line, 0-based column. */
  line: number
  col: number
  name: string
  /** The reference's kind in the outline: calls, references, implements or read. */
  kind: RawReference["kind"]
  scip: ScipCategory
  /** `path:line` of SCIP's definition, when it has one. */
  scipTarget: string | null
  ours: Ours
  /** Our target, `path:line qualifiedName`, or the first candidate. */
  target: string | null
  candidates: number
  /** For a Connection with one target: it's SCIP's. For ambiguous: SCIP's is among the candidates. */
  correct: boolean
}

export interface Count {
  sites: number
  correct: number
}

export interface Recall {
  /** SCIP references to a definition we have a Symbol for. */
  sites: number
  /** …where we made a Connection to that Symbol, by status. */
  found: Record<string, number>
  /** …where our outline has no reference at that position. */
  notExtracted: number
}

export interface ChangeSetScore {
  /** Scored uses (SCIP has an occurrence there), by our status and by the outline's reference kind. */
  byStatus: Record<string, Count>
  byKind: Record<string, Record<string, Count>>
  /** Connections made where SCIP says local, to something other than the local's own definition, by status (pattern A). */
  localsConnected: Record<string, number>
  /** Connections made on a name SCIP says is being declared, by status. */
  declarationsConnected: Record<string, number>
  /** Uses SCIP resolves in the repository that we marked external. */
  wronglyExternal: number
  /** Ambiguous Connections where SCIP has a definition, and how often it's a candidate. */
  ambiguous: Count
  /** Over files we indexed (how good the resolver is), and over every file (what the neighbor limit costs). */
  recallIndexed: Recall
  recallAll: Recall
  /** Used by of changed Symbols: our sites by status, how many SCIP confirms; SCIP's references, how many we list. `unmatched`: SCIP defines nothing there. */
  usedBy: {
    precision: Record<string, Count>
    recall: { sites: number; found: number }
    symbols: number
    /** Changed Symbols SCIP defines nothing at, in their file. */
    unmatched: number
  }
  /** Uses with no SCIP occurrence at them. */
  unknown: number
  /** Changed files SCIP didn't index. */
  filesWithoutScip: number
}

export interface UsedBySite {
  side: Side
  path: string
  line: number
  symbol: string
  status: string
  correct: boolean
  /** What SCIP says is at the site. */
  scip: string
}

export interface ScoreInput {
  index: CodeIndex
  files: IndexedFile[]
  scip: Record<Side, ScipIndex>
  /** 0-based name positions of every Symbol in a file at one side, parsed the way CodeIndex parses; null when the file isn't there. */
  symbolsIn: (
    side: Side,
    path: string,
  ) => Promise<{ line: number; col: number }[] | null>
}

const inc = (r: Record<string, number>, k: string, n = 1) => {
  r[k] = (r[k] ?? 0) + n
}
const count = (r: Record<string, Count>, k: string, correct: boolean) => {
  const c = (r[k] ??= { sites: 0, correct: 0 })
  c.sites++
  if (correct) c.correct++
}

const posKey = (path: string, line: number, col: number) =>
  `${path}\0${line}\0${col}`

/** The module Symbol id CodeIndex gives a file: on its own side when changed, on Head for neighbors. */
const moduleId = (side: Side, path: string) =>
  symbolId(side, path, { kind: "module", qualifiedName: `\0${path}` }, 0)

export function emptyScore(): ChangeSetScore {
  return {
    byStatus: {},
    byKind: {},
    localsConnected: {},
    declarationsConnected: {},
    wronglyExternal: 0,
    ambiguous: { sites: 0, correct: 0 },
    recallIndexed: { sites: 0, found: {}, notExtracted: 0 },
    recallAll: { sites: 0, found: {}, notExtracted: 0 },
    usedBy: {
      precision: {},
      recall: { sites: 0, found: 0 },
      symbols: 0,
      unmatched: 0,
    },
    unknown: 0,
    filesWithoutScip: 0,
  }
}

export async function scoreChangeSet(input: ScoreInput): Promise<{
  score: ChangeSetScore
  sites: SiteScore[]
  usedBy: UsedBySite[]
}> {
  const { index } = input
  const score = emptyScore()
  const sites: SiteScore[] = []
  const usedBySites: UsedBySite[] = []

  for (const side of ["base", "head"] as const) {
    const scip = input.scip[side]
    /** Where a symbol, or one related to it by implementation, is defined. */
    const targetsOf = (symbols: string[]) => {
      const out = new Set<string>()
      for (const s of symbols)
        for (const t of [s, ...(scip.related.get(s) ?? [])])
          for (const d of scip.definitions.get(t) ?? [])
            out.add(posKey(d.path, d.line, d.col))
      return out
    }
    // Only symbols defined in the index count: scip-typescript also writes
    // `local N` for names it reaches inside a .d.ts (zod's `z.enum`), and a
    // constructor without its own definition is its class.
    const defined = (s: string) => {
      const owner = constructorClass(s)
      return (
        scip.definitions.has(s) ||
        (owner !== null && scip.definitions.has(owner))
      )
    }
    const at = (s: CodeSymbol) => posKey(s.path, s.nameLine - 1, s.nameCol)
    /**
     * Our Symbol is SCIP's answer: its name is at one of the definitions, or
     * SCIP says the name there is the same symbol (`let match` declared
     * above, the Symbol where `match = () => …` is assigned).
     */
    const names = (t: CodeSymbol, symbols: string[], defs: Set<string>) =>
      defs.has(at(t)) ||
      scip
        .at(t.path, t.nameLine - 1, t.nameCol)
        .some((o) => symbols.includes(o.symbol))
    const describe = (s: CodeSymbol | undefined) =>
      s ? `${s.path}:${s.nameLine} ${s.qualifiedName}` : null
    const indexed = (path: string) => {
      if (index.symbol(moduleId(side, path))) return true
      const neighbor = index.symbol(moduleId("head", path))
      return neighbor !== null && neighbor.change === "unchanged"
    }
    const symbolPositions = new Map<string, Promise<Set<string> | null>>()
    const representable = (path: string, line: number, col: number) => {
      let p = symbolPositions.get(path)
      if (!p) {
        p = input
          .symbolsIn(side, path)
          .then((list) =>
            list ? new Set(list.map((s) => `${s.line}\0${s.col}`)) : null,
          )
        symbolPositions.set(path, p)
      }
      return p.then((set) => set?.has(`${line}\0${col}`) ?? false)
    }

    for (const f of input.files) {
      if (!f.language || familyOf(f.language) !== "js") continue
      const content = side === "base" ? f.base : f.head
      const path = side === "base" ? (f.oldPath ?? f.path) : f.path
      if (!content.outline || (side === "base" ? !f.baseOid : !f.headOid))
        continue
      if (!scip.occurrences.has(path)) {
        score.filesWithoutScip++
        continue
      }

      // What we said at each use, against SCIP.
      const ours = new Map<string, SiteScore>()
      for (const r of content.outline.references) {
        const occs = scip.at(path, r.line, r.col)
        const refs = occs.filter((o) => !(o.roles & DEFINITION))
        const symbols = [...new Set(refs.map((o) => o.symbol))].filter(defined)
        const repo = symbols.filter((x) => !isLocalSymbol(x))
        // `this.fetchImpl` for a constructor's `private fetchImpl` parameter: SCIP names the
        // parameter, but the use is a member, and we have no Symbol for parameter properties.
        const parameterProperty =
          r.receiver !== null &&
          !repo.length &&
          symbols.length > 0 &&
          symbols.every((x) => x.endsWith(")"))
        const category: ScipCategory =
          !occs.length || parameterProperty
            ? "unknown"
            : !refs.length
              ? "declaration"
              : repo.length
                ? "repo"
                : symbols.length
                  ? "local"
                  : "external"
        // A local function is a Symbol to us (`materialize.git`): resolving to it is right.
        const resolvable = repo.length ? repo : symbols
        const expected = targetsOf(resolvable)
        const firstDef = resolvable.length
          ? scip.definitions.get(resolvable[0] as string)?.[0]
          : undefined
        const info = index.at(side, path, r.line + 1, r.col)
        const c: Connection | null = info.connection
        const status = c ? c.status : "none"
        // One target: it's SCIP's. Ambiguous: SCIP's is among the candidates.
        const correct = !c
          ? false
          : c.status === "external"
            ? category === "external"
            : info.targets.some((t) => names(t, resolvable, expected))
        const site: SiteScore = {
          side,
          path,
          line: r.line + 1,
          col: r.col,
          name: r.name,
          kind: r.kind,
          scip: category,
          scipTarget: firstDef ? `${firstDef.path}:${firstDef.line + 1}` : null,
          ours: status,
          target: describe(info.targets[0]),
          candidates: c && !c.toId ? info.targets.length : 0,
          correct,
        }
        sites.push(site)
        ours.set(`${r.line}\0${r.col}`, site)
        if (category === "unknown") {
          score.unknown++
          continue
        }
        if (status !== "none") {
          count(score.byStatus, status, correct)
          count((score.byKind[r.kind] ??= {}), status, correct)
        }
        if (category === "local" && status !== "none" && !correct)
          inc(score.localsConnected, status)
        if (category === "declaration" && status !== "none")
          inc(score.declarationsConnected, status)
        if (category === "repo" && status === "external")
          score.wronglyExternal++
        if (expected.size && c && !c.toId && c.status !== "external") {
          score.ambiguous.sites++
          if (correct) score.ambiguous.correct++
        }
      }

      // Recall: SCIP's uses of definitions we'd have a Symbol for.
      const seen = new Set<string>()
      for (const o of scip.occurrences.get(path) ?? []) {
        if (o.roles & DEFINITION || !defined(o.symbol)) continue
        const k = `${o.line}\0${o.col}`
        if (seen.has(k)) continue
        // Its definitions, or a related one's: `new Order()` uses the constructor; our Symbol is the class.
        const reachable: { path: string; indexed: boolean }[] = []
        for (const t of [o.symbol, ...(scip.related.get(o.symbol) ?? [])])
          for (const d of scip.definitions.get(t) ?? [])
            if (await representable(d.path, d.line, d.col))
              reachable.push({ path: d.path, indexed: indexed(d.path) })
        if (!reachable.length) continue
        seen.add(k)
        const site = ours.get(k)
        const found = site && site.correct && site.target !== null
        const buckets = [score.recallAll]
        if (reachable.some((d) => d.indexed)) buckets.push(score.recallIndexed)
        for (const b of buckets) {
          b.sites++
          if (!site) b.notExtracted++
          else if (found) inc(b.found, site.ours)
        }
      }

      // Used by, for the changed Symbols in this file.
      for (const s of index.symbolsAt(side, path)) {
        if (s.change === "unchanged" || s.kind === "module") continue
        score.usedBy.symbols++
        // What SCIP defines at its name; else a later overload or an assignment
        // of a symbol defined in the same file. Not an object property typed by
        // an interface: every use of the interface member would count.
        const own = scip.definedAt(s.path, s.nameLine - 1, s.nameCol)
        const scipSymbols = own.length
          ? own
          : [
              ...new Set(
                scip
                  .at(s.path, s.nameLine - 1, s.nameCol)
                  .map((o) => o.symbol)
                  .filter((x) =>
                    scip.definitions.get(x)?.some((d) => d.path === s.path),
                  ),
              ),
            ]
        if (!scipSymbols.length) {
          score.usedBy.unmatched++
          continue
        }
        const family = new Set<string>()
        for (const x of scipSymbols)
          for (const t of [x, ...(scip.related.get(x) ?? [])]) family.add(t)
        const listed = new Set<string>()
        for (const c of index.incomingOn(side, s.id)) {
          if (c.kind === "imports") continue
          for (const site of c.sites) {
            const occs = scip.at(site.path, site.line - 1, site.col)
            const correct = occs.some(
              (o) => !(o.roles & DEFINITION) && family.has(o.symbol),
            )
            count(score.usedBy.precision, c.status, correct)
            listed.add(posKey(site.path, site.line - 1, site.col))
            usedBySites.push({
              side,
              path: site.path,
              line: site.line,
              symbol: s.qualifiedName,
              status: c.status,
              correct,
              scip: occs.length
                ? occs.map((o) => shortSymbol(o.symbol)).join(", ")
                : "nothing",
            })
          }
        }
        const refs = new Set<string>()
        for (const x of family)
          for (const r of scip.references(x))
            refs.add(posKey(r.path, r.line, r.col))
        score.usedBy.recall.sites += refs.size
        for (const r of refs) if (listed.has(r)) score.usedBy.recall.found++
      }
    }
  }
  return { score, sites, usedBy: usedBySites }
}

/** `local 3 in src/a.ts` → local; `scip-typescript npm pkg 1.0 src/`a.ts`/A#run().` → src/`a.ts`/A#run(). */
export function shortSymbol(symbol: string): string {
  return symbol.startsWith("local ")
    ? "local"
    : (symbol.split(" ").pop() ?? symbol)
}

/** Adds one Change Set's score into a running total. */
export function addScore(into: ChangeSetScore, s: ChangeSetScore) {
  const addCounts = (a: Record<string, Count>, b: Record<string, Count>) => {
    for (const [k, v] of Object.entries(b)) {
      const t = (a[k] ??= { sites: 0, correct: 0 })
      t.sites += v.sites
      t.correct += v.correct
    }
  }
  const addNums = (a: Record<string, number>, b: Record<string, number>) => {
    for (const [k, v] of Object.entries(b)) inc(a, k, v)
  }
  const addRecall = (a: Recall, b: Recall) => {
    a.sites += b.sites
    a.notExtracted += b.notExtracted
    addNums(a.found, b.found)
  }
  addCounts(into.byStatus, s.byStatus)
  for (const [k, v] of Object.entries(s.byKind))
    addCounts((into.byKind[k] ??= {}), v)
  addNums(into.localsConnected, s.localsConnected)
  addNums(into.declarationsConnected, s.declarationsConnected)
  into.wronglyExternal += s.wronglyExternal
  into.ambiguous.sites += s.ambiguous.sites
  into.ambiguous.correct += s.ambiguous.correct
  addRecall(into.recallIndexed, s.recallIndexed)
  addRecall(into.recallAll, s.recallAll)
  addCounts(into.usedBy.precision, s.usedBy.precision)
  into.usedBy.recall.sites += s.usedBy.recall.sites
  into.usedBy.recall.found += s.usedBy.recall.found
  into.usedBy.symbols += s.usedBy.symbols
  into.usedBy.unmatched += s.usedBy.unmatched
  into.unknown += s.unknown
  into.filesWithoutScip += s.filesWithoutScip
}
