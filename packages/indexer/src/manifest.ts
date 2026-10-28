// The grammar manifest (grammars/manifest.json): which tree-sitter grammar and
// queries each language uses, and the Language Tier that follows from them.
// WASM grammars and their upstream queries come from the grammar packages on
// npm, pinned in package.json to one web-tree-sitter ABI; Legible's own
// queries (more definitions and references) live in grammars/queries/.

import type { LanguageTier } from "@legible/domain"

import manifest from "../grammars/manifest.json"

/** A file inside a grammar package. `via` resolves `pkg` from inside another package (a nested dependency). */
export interface GrammarFile {
  pkg: string
  file: string
  via?: string
}

export interface GrammarSpec {
  wasm: GrammarFile
  /** Concatenated in order. Later patterns win when two capture the same node. */
  highlights: GrammarFile[]
  /** Upstream tags queries: @definition.* and @reference.* captures. */
  tags: GrammarFile[]
  /** Legible's own tags queries, paths under grammars/queries/, appended after the upstream ones. */
  legible: string[]
  /** Legible's queries for names bound inside functions and blocks (@local.scope, @local.definition). */
  locals: string[]
}

interface ManifestEntry {
  wasm: string
  highlights: string[]
  tags: string[]
  legible: string[]
  locals?: string[]
}

/** "pkg/file" or "via>pkg/file"; scoped packages take two segments. Same as grammars/bundle.mjs. */
export function parseFileSpec(spec: string): GrammarFile {
  const [via, rest] = spec.includes(">")
    ? (spec.split(">") as [string, string])
    : [undefined, spec]
  const parts = rest.split("/")
  const n = rest.startsWith("@") ? 2 : 1
  const f: GrammarFile = {
    pkg: parts.slice(0, n).join("/"),
    file: parts.slice(n).join("/"),
  }
  if (via) f.via = via
  return f
}

function load(): Record<string, GrammarSpec> {
  const languages = manifest.languages as Record<string, ManifestEntry | string>
  const specs: Record<string, GrammarSpec> = {}
  for (const [id, entry] of Object.entries(languages)) {
    if (typeof entry === "string") continue
    specs[id] = {
      wasm: parseFileSpec(entry.wasm),
      highlights: entry.highlights.map(parseFileSpec),
      tags: entry.tags.map(parseFileSpec),
      legible: entry.legible,
      locals: entry.locals ?? [],
    }
  }
  for (const [id, entry] of Object.entries(languages))
    if (typeof entry === "string" && specs[entry]) specs[id] = specs[entry]
  return specs
}

export const GRAMMARS: Record<string, GrammarSpec> = load()

/** Full when the language has a tags query, Structural with a grammar alone, Text otherwise. */
export function languageTier(language: string | null): LanguageTier {
  const g = language ? GRAMMARS[language] : undefined
  if (!g) return "text"
  return g.tags.length > 0 ? "full" : "structural"
}

/** Where a package file lives in a bundled grammars directory. Same as grammars/bundle.mjs. */
export function grammarFileKey(file: GrammarFile): string {
  return file.via
    ? `${file.via}/node_modules/${file.pkg}/${file.file}`
    : `${file.pkg}/${file.file}`
}
