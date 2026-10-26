// Loads web-tree-sitter, WASM grammars and their queries, from node_modules
// (tests, scripts) or from a bundled grammars directory (the app).

import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { Language, Parser, Query } from "web-tree-sitter"

import {
  type GrammarFile,
  grammarFileKey,
  GRAMMARS,
  type GrammarSpec,
} from "./manifest"

/** Where grammar files come from. */
export interface GrammarSource {
  /** A file from a grammar package. */
  read(file: GrammarFile): Promise<Uint8Array>
  /** One of Legible's own query files, e.g. "typescript/tags.scm"; null when absent. */
  readQuery(path: string): Promise<string | null>
  /** The web-tree-sitter runtime's WASM. */
  runtime(): Promise<Uint8Array>
  /** A package's version, for cache keys; `via` as in GrammarFile. */
  version(pkg: string, via?: string): Promise<string>
}

const here = dirname(fileURLToPath(import.meta.url))
/** Legible's own queries, in the source tree. */
export const QUERIES_DIR = join(here, "../grammars/queries")

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8")
  } catch {
    return null
  }
}

/** Resolves grammar packages from node_modules, as installed for this package. */
export function nodeModulesSource(): GrammarSource {
  const req = createRequire(join(here, "../package.json"))
  const dirOf = (pkg: string, via?: string): string => {
    const from = via ? createRequire(dirOf(via) + "/package.json") : req
    return dirname(from.resolve(`${pkg}/package.json`))
  }
  return {
    read: (file) => readFile(join(dirOf(file.pkg, file.via), file.file)),
    readQuery: (path) => readOptional(join(QUERIES_DIR, path)),
    runtime: () =>
      readFile(req.resolve("web-tree-sitter/web-tree-sitter.wasm")),
    version: async (pkg, via) =>
      (
        JSON.parse(
          await readFile(join(dirOf(pkg, via), "package.json"), "utf8"),
        ) as {
          version: string
        }
      ).version,
  }
}

/**
 * Reads a directory laid out by the app build: grammars/<pkg>/<file> (see
 * grammarFileKey), grammars/queries/<language>/*.scm, grammars/versions.json
 * and grammars/web-tree-sitter.wasm.
 */
export function directorySource(dir: string): GrammarSource {
  let versions: Promise<Record<string, string>> | null = null
  return {
    read: (file) => readFile(join(dir, grammarFileKey(file))),
    readQuery: (path) => readOptional(join(dir, "queries", path)),
    runtime: () => readFile(join(dir, "web-tree-sitter.wasm")),
    version: async (pkg, via) => {
      versions ??= readFile(join(dir, "versions.json"), "utf8").then(
        (t) => JSON.parse(t) as Record<string, string>,
      )
      return (await versions)[via ? `${via}>${pkg}` : pkg] ?? "0"
    },
  }
}

/** The bundled directory next to a built entry point if there is one, else node_modules. */
export function defaultSource(bundledDir?: string): GrammarSource {
  return bundledDir && existsSync(join(bundledDir, "web-tree-sitter.wasm"))
    ? directorySource(bundledDir)
    : nodeModulesSource()
}

export interface LoadedGrammar {
  language: string
  tsLanguage: Language
  highlights: Query | null
  /** Per highlights pattern: how specific it is (see patternSpecificity). */
  highlightRank: number[]
  /** Upstream tags plus Legible's own definitions and references. */
  tags: Query | null
  /**
   * Changes whenever parse results for this language could: the grammar
   * package's version and a hash of every query's text (upstream, nested
   * packages' and Legible's own).
   */
  version: string
}

/**
 * How constrained each pattern is: nodes, fields and predicates in its source.
 * Highlight queries disagree on order (JavaScript and Python refine generic
 * captures later, Go lists specific ones first), so the more specific
 * pattern wins, and order only breaks ties.
 */
export function patternSpecificity(q: Query, source: string): number[] {
  const out: number[] = []
  const bytes = new TextEncoder().encode(source)
  const decoder = new TextDecoder()
  for (let i = 0; i < q.patternCount(); i++) {
    const text = decoder.decode(
      bytes.subarray(q.startIndexForPattern(i), q.endIndexForPattern(i)),
    )
    const code = text.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/;.*$/gm, "")
    out.push(
      (code.match(/\(/g)?.length ?? 0) + (code.match(/[a-z_]+:/g)?.length ?? 0),
    )
  }
  return out
}

let runtime: Promise<void> | null = null

/** Loads grammars once each and keeps them for the life of the process. */
export class Grammars {
  private loaded = new Map<string, Promise<LoadedGrammar | null>>()
  private parsers = new Map<string, Parser>()

  constructor(private readonly source: GrammarSource = nodeModulesSource()) {}

  has(language: string | null): boolean {
    return language !== null && language in GRAMMARS
  }

  /** The grammar for a language id from languageForPath, or null when there's none. */
  get(language: string | null): Promise<LoadedGrammar | null> {
    if (!language || !GRAMMARS[language]) return Promise.resolve(null)
    let p = this.loaded.get(language)
    if (!p) {
      p = this.load(language, GRAMMARS[language])
      this.loaded.set(language, p)
    }
    return p
  }

  /** A parser set to the language. Parsers are reused; parse calls are synchronous. */
  parser(g: LoadedGrammar): Parser {
    let p = this.parsers.get(g.language)
    if (!p) {
      p = new Parser()
      p.setLanguage(g.tsLanguage)
      this.parsers.set(g.language, p)
    }
    return p
  }

  private async load(
    language: string,
    spec: GrammarSpec,
  ): Promise<LoadedGrammar | null> {
    const src = this.source
    runtime ??= src.runtime().then((wasmBinary) => Parser.init({ wasmBinary }))
    await runtime
    const tsLanguage = await Language.load(await src.read(spec.wasm))
    const text = async (files: GrammarFile[]) =>
      (
        await Promise.all(
          files.map(async (f) => new TextDecoder().decode(await src.read(f))),
        )
      ).join("\n")
    const query = (source: string, what: string): Query | null => {
      if (!source.trim()) return null
      try {
        return new Query(tsLanguage, source)
      } catch (e) {
        throw new Error(
          `The ${what} query for ${language} doesn't compile: ${(e as Error).message}`,
          { cause: e },
        )
      }
    }
    const extraTags = (
      await Promise.all(
        spec.legible.map(async (path) => {
          const q = await src.readQuery(path)
          if (q === null) throw new Error(`Missing query ${path}`)
          return q
        }),
      )
    ).join("\n")
    const highlightSource = await text(spec.highlights)
    const tagsSource = `${await text(spec.tags)}\n${extraTags}`
    const highlights = query(highlightSource, "highlights")
    const queries = createHash("sha1")
      .update(highlightSource)
      .update("\0")
      .update(tagsSource)
      .digest("hex")
      .slice(0, 12)
    return {
      language,
      tsLanguage,
      highlights,
      highlightRank: highlights
        ? patternSpecificity(highlights, highlightSource)
        : [],
      tags: query(tagsSource, "tags"),
      version: `${spec.wasm.pkg}@${await src.version(spec.wasm.pkg, spec.wasm.via)}+q${queries}`,
    }
  }
}
