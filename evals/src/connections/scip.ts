// Reads a SCIP index (https://github.com/sourcegraph/scip) into the lookups
// the Connections eval scores against: occurrences by path and position,
// definitions by symbol, and symbols related by implementation. The schema is
// vendored as evals/scip/scip.proto and loaded at run time; no generated code.

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { Root, type Type } from "protobufjs"

/** One symbol at one range. Line 0-based; columns in UTF-16 code units, like CodeIndex sites. */
export interface ScipOccurrence {
  line: number
  col: number
  endLine: number
  endCol: number
  symbol: string
  roles: number
}

export interface ScipLocation {
  path: string
  line: number
  col: number
}

/** SymbolRole.Definition. */
export const DEFINITION = 0x1

const CONSTRUCTOR = "`<constructor>`()."

/** Local symbols are numbered per document; this makes them unique in the index: `local 3 in src/a.ts`. */
function scoped(symbol: string, path: string | null): string {
  return path && symbol.startsWith("local ") ? `${symbol} in ${path}` : symbol
}

export interface ScipIndex {
  tool: string | null
  /** Occurrences by document path, sorted by position. */
  occurrences: Map<string, ScipOccurrence[]>
  /** Where each symbol is defined: occurrences with the Definition role. */
  definitions: Map<string, ScipLocation[]>
  /** Symbols related by `is_implementation` or `is_definition`, both directions. */
  related: Map<string, Set<string>>
  /** Occurrences that start at a position. */
  at(path: string, line: number, col: number): ScipOccurrence[]
  /** Symbols defined at a position. */
  definedAt(path: string, line: number, col: number): string[]
  /** Every non-definition occurrence of a symbol, across documents. */
  references(symbol: string): ScipLocation[]
}

/** PositionEncoding. Unspecified is what scip-typescript writes; its offsets are TypeScript's, UTF-16. */
const UTF8 = 1
const UTF32 = 3

let schema: Type | null = null

function indexType(): Type {
  if (!schema) {
    const root = new Root()
    root.loadSync(join(__dirname, "../../scip/scip.proto"), { keepCase: true })
    schema = root.lookupType("scip.Index")
  }
  return schema
}

interface RawRange {
  line?: number
  start_line?: number
  start_character?: number
  end_line?: number
  end_character?: number
}

interface RawOccurrence {
  range?: number[]
  single_line_range?: RawRange
  multi_line_range?: RawRange
  symbol?: string
  symbol_roles?: number
}

interface RawSymbolInformation {
  symbol?: string
  relationships?: {
    symbol?: string
    is_implementation?: boolean
    is_definition?: boolean
  }[]
}

interface RawDocument {
  relative_path?: string
  position_encoding?: number
  occurrences?: RawOccurrence[]
  symbols?: RawSymbolInformation[]
}

interface RawIndex {
  metadata?: { tool_info?: { name?: string; version?: string } }
  documents?: RawDocument[]
  external_symbols?: RawSymbolInformation[]
}

/** [startLine, startCharacter, endLine, endCharacter], from `typed_range` when set, else the old `range`. */
function rangeOf(o: RawOccurrence): [number, number, number, number] | null {
  const s = o.single_line_range
  if (s) {
    const line = s.line ?? 0
    return [line, s.start_character ?? 0, line, s.end_character ?? 0]
  }
  const m = o.multi_line_range
  if (m)
    return [
      m.start_line ?? 0,
      m.start_character ?? 0,
      m.end_line ?? 0,
      m.end_character ?? 0,
    ]
  // Three elements when it's on one line: [line, start, end].
  const [line, start, a, b] = o.range ?? []
  if (line === undefined || start === undefined || a === undefined) return null
  return b === undefined ? [line, start, line, a] : [line, start, a, b]
}

/** A column in `encoding` units on a line, in UTF-16 code units. */
export function toUtf16(
  line: string,
  offset: number,
  encoding: number,
): number {
  if (encoding !== UTF8 && encoding !== UTF32) return offset
  let units = 0
  let i = 0
  for (const ch of line) {
    if (units >= offset) break
    const cp = ch.codePointAt(0) as number
    units +=
      encoding === UTF32
        ? 1
        : cp < 0x80
          ? 1
          : cp < 0x800
            ? 2
            : cp < 0x10000
              ? 3
              : 4
    i += ch.length
  }
  return i
}

/**
 * Decodes a SCIP index. `textOf` supplies a document's text when its
 * positions are UTF-8 or UTF-32 and need converting; otherwise it's unused.
 */
export async function loadScip(
  data: Uint8Array | string,
  textOf: (path: string) => Promise<string | null> = async () => null,
): Promise<ScipIndex> {
  const bytes = typeof data === "string" ? readFileSync(data) : data
  const Index = indexType()
  const raw = Index.toObject(Index.decode(bytes), {
    enums: Number,
    longs: Number,
    defaults: false,
    oneofs: false,
  }) as RawIndex

  const occurrences = new Map<string, ScipOccurrence[]>()
  const definitions = new Map<string, ScipLocation[]>()
  const related = new Map<string, Set<string>>()
  const relate = (a: string, b: string) => {
    for (const [x, y] of [
      [a, b],
      [b, a],
    ] as const) {
      const set = related.get(x)
      if (set) set.add(y)
      else related.set(x, new Set([y]))
    }
  }
  const noteRelationships = (
    infos: RawSymbolInformation[] | undefined,
    path: string | null,
  ) => {
    for (const info of infos ?? [])
      for (const r of info.relationships ?? [])
        if (info.symbol && r.symbol && (r.is_implementation || r.is_definition))
          relate(scoped(info.symbol, path), scoped(r.symbol, path))
  }
  // `new Order()` refers to the constructor; the class is the same target.
  const constructors = new Set<string>()

  for (const doc of raw.documents ?? []) {
    const path = doc.relative_path
    if (!path) continue
    const encoding = doc.position_encoding ?? 0
    const lines =
      encoding === UTF8 || encoding === UTF32
        ? ((await textOf(path))?.split("\n") ?? null)
        : null
    const col = (line: number, c: number) =>
      lines ? toUtf16(lines[line] ?? "", c, encoding) : c
    const list: ScipOccurrence[] = []
    for (const o of doc.occurrences ?? []) {
      const r = rangeOf(o)
      if (!r || !o.symbol) continue
      const occ: ScipOccurrence = {
        line: r[0],
        col: col(r[0], r[1]),
        endLine: r[2],
        endCol: col(r[2], r[3]),
        symbol: scoped(o.symbol, path),
        roles: o.symbol_roles ?? 0,
      }
      list.push(occ)
      if (occ.symbol.endsWith(CONSTRUCTOR)) constructors.add(occ.symbol)
      if (occ.roles & DEFINITION) {
        const loc = { path, line: occ.line, col: occ.col }
        const defs = definitions.get(occ.symbol)
        if (defs) defs.push(loc)
        else definitions.set(occ.symbol, [loc])
      }
    }
    list.sort((a, b) => a.line - b.line || a.col - b.col)
    occurrences.set(path, list)
    noteRelationships(doc.symbols, path)
  }
  noteRelationships(raw.external_symbols, null)
  for (const c of constructors) relate(c, constructorClass(c) as string)

  const key = (path: string, line: number, col: number) =>
    `${path}\0${line}\0${col}`
  const byPosition = new Map<string, ScipOccurrence[]>()
  for (const [path, list] of occurrences)
    for (const o of list) {
      const k = key(path, o.line, o.col)
      const hit = byPosition.get(k)
      if (hit) hit.push(o)
      else byPosition.set(k, [o])
    }
  let refs: Map<string, ScipLocation[]> | null = null

  const tool = raw.metadata?.tool_info
  return {
    tool: tool?.name ? `${tool.name}@${tool.version ?? "?"}` : null,
    occurrences,
    definitions,
    related,
    at: (path, line, col) => byPosition.get(key(path, line, col)) ?? [],
    definedAt: (path, line, col) =>
      (byPosition.get(key(path, line, col)) ?? [])
        .filter((o) => o.roles & DEFINITION)
        .map((o) => o.symbol),
    references(symbol) {
      if (!refs) {
        refs = new Map()
        for (const [path, list] of occurrences)
          for (const o of list) {
            if (o.roles & DEFINITION) continue
            const loc = { path, line: o.line, col: o.col }
            const hit = refs.get(o.symbol)
            if (hit) hit.push(loc)
            else refs.set(o.symbol, [loc])
          }
      }
      return refs.get(symbol) ?? []
    },
  }
}

/** The class a constructor symbol belongs to, or null: `a/Order#\`<constructor>\`().` → `a/Order#`. */
export function constructorClass(symbol: string): string | null {
  return symbol.endsWith(CONSTRUCTOR)
    ? symbol.slice(0, -CONSTRUCTOR.length)
    : null
}

/**
 * A local variable, parameter or type parameter: `local 3 in src/a.ts`, or a global
 * symbol whose last descriptor is a parameter `(x)` or type parameter `[T]`.
 * scip-typescript writes parameters as globals, `isTestPath().(path)`.
 */
export function isLocalSymbol(symbol: string): boolean {
  return (
    symbol.startsWith("local ") || symbol.endsWith(")") || symbol.endsWith("]")
  )
}
