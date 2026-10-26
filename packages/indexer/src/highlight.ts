// Tree-sitter highlighting: highlights.scm captures become per-line
// [startCol, len, scopeId] triples, the format the renderer already draws.

import { type LineTokens, TOKEN_SCOPES, type TokenScope } from "@legible/domain"
import type { Query, Tree } from "web-tree-sitter"

const id = (s: TokenScope) => TOKEN_SCOPES.indexOf(s)

/** Explicit names first; anything else falls back to its first dotted segment. */
const EXACT = new Map<string, TokenScope>(
  Object.entries({
    "variable.builtin": "keyword",
    "variable.member": "property",
    "variable.parameter": "variable",
    "constant.builtin": "constant",
    "function.macro": "meta",
    "string.special.key": "property",
    "punctuation.special": "punctuation",
    "keyword.directive": "meta",
    "markup.heading": "heading",
    "markup.link": "link",
    "text.title": "heading",
    "text.uri": "link",
    "text.reference": "link",
    "markup.inserted": "inserted",
    "markup.deleted": "deleted",
    "diff.plus": "inserted",
    "diff.minus": "deleted",
  }) as [string, TokenScope][],
)

/** Keyed by a capture name's first dotted segment. A Map, so "constructor" isn't Object's. */
const PREFIX = new Map<string, TokenScope | null>([
  ["keyword", "keyword"],
  ["conditional", "keyword"],
  ["repeat", "keyword"],
  ["include", "keyword"],
  ["exception", "keyword"],
  ["storageclass", "keyword"],
  ["import", "keyword"],
  ["function", "function"],
  ["method", "function"],
  ["constructor", "type"],
  ["string", "string"],
  ["character", "string"],
  ["escape", "string"],
  ["number", "number"],
  ["float", "number"],
  ["type", "type"],
  ["module", "type"],
  ["namespace", "type"],
  ["comment", "comment"],
  ["punctuation", "punctuation"],
  ["delimiter", "punctuation"],
  ["property", "property"],
  ["field", "property"],
  ["variable", "variable"],
  ["parameter", "variable"],
  ["label", "variable"],
  ["operator", "operator"],
  ["constant", "constant"],
  ["boolean", "constant"],
  ["tag", "tag"],
  ["attribute", "attribute"],
  ["preproc", "meta"],
  ["define", "meta"],
  ["annotation", "meta"],
  ["decorator", "meta"],
  ["embedded", null],
  ["spell", null],
])

/** Scope id for a capture name: a TOKEN_SCOPES index, -1 to clear ("@none"), or null to ignore. */
export function scopeForCapture(name: string): number | null {
  if (name === "none") return -1
  const exact = EXACT.get(name)
  if (exact) return id(exact)
  const s = PREFIX.get(name.split(".")[0] as string)
  return s ? id(s) : null
}

const scopeCache = new Map<string, number | null>()
function cachedScope(name: string): number | null {
  let s = scopeCache.get(name)
  if (s === undefined) {
    s = scopeForCapture(name)
    scopeCache.set(name, s)
  }
  return s
}

/**
 * One token array per line of `lines` (the text the tree was parsed from,
 * joined with "\n"). When captures overlap, the innermost node wins; for the
 * same node, the more specific pattern, then the later one.
 */
export function highlightTree(
  tree: Tree,
  query: Query,
  lines: string[],
  /** Pattern specificity (grammars.ts); more specific patterns win over generic ones. */
  rank: number[] = [],
): LineTokens[] {
  const total = lines.reduce((n, l) => n + l.length + 1, 0)
  const scopes = new Int16Array(total).fill(-1)
  const paints: {
    start: number
    end: number
    size: number
    rank: number
    pattern: number
    scope: number
  }[] = []
  for (const c of query.captures(tree.rootNode)) {
    const scope = cachedScope(c.name)
    if (scope === null) continue
    const start = c.node.startIndex
    const end = c.node.endIndex
    if (end <= start) continue
    paints.push({
      start,
      end,
      size: end - start,
      rank: rank[c.patternIndex] ?? 0,
      pattern: c.patternIndex,
      scope,
    })
  }
  // Winners paint last: inner nodes over outer ones, then more specific patterns, then later ones.
  paints.sort(
    (a, b) => b.size - a.size || a.rank - b.rank || a.pattern - b.pattern,
  )
  for (const p of paints) scopes.fill(p.scope, p.start, Math.min(p.end, total))

  const out: LineTokens[] = new Array(lines.length)
  let pos = 0
  for (let l = 0; l < lines.length; l++) {
    const len = (lines[l] as string).length
    const tokens: number[] = []
    let c = 0
    while (c < len) {
      const s = scopes[pos + c] as number
      let e = c + 1
      while (e < len && scopes[pos + e] === s) e++
      if (s >= 0) tokens.push(c, e - c, s)
      c = e
    }
    out[l] = tokens
    pos += len + 1
  }
  return out
}
