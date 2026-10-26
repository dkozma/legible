// Parsing one file: highlight tokens and its outline, cached by blob OID.
// Text-tier languages fall back to the Lezer highlighter (ADR 0014).

import { createHash } from "node:crypto"

import { highlightLines, MAX_HIGHLIGHT_CHARS } from "@legible/diff"
import type { LanguageTier, LineTokens } from "@legible/domain"
import type { Tree } from "web-tree-sitter"

import { ParseCache, type ParseCacheOptions } from "./cache"
import { Grammars, type LoadedGrammar } from "./grammars"
import { highlightTree } from "./highlight"
import { languageTier } from "./manifest"
import { extractOutline, type Outline } from "./outline"

/** Bumped when what extractOutline or highlightTree produce changes. */
const EXTRACT_VERSION = 2

/** Files longer than this are diffed but not highlighted or indexed. */
export const MAX_PARSE_LINES = 20_000

export interface ParsedFile {
  language: string | null
  tier: LanguageTier
  tokens: LineTokens[] | null
  outline: Outline | null
  /** The parse has error nodes: treat structure as unreliable (no proofs). */
  hasErrors: boolean
}

export interface ParseRequest {
  /** Blob OID: the cache key. Null for text that isn't a blob. */
  oid: string | null
  language: string | null
  lines: string[]
  /** Skip highlighting (files only indexed for Connections). */
  tokens?: boolean
}

const EMPTY_OUTLINE: Outline = { symbols: [], references: [], imports: [] }

export class Parsing {
  readonly grammars: Grammars
  private cache: ParseCache<ParsedFile>

  constructor(opts: { grammars?: Grammars; cache?: ParseCacheOptions } = {}) {
    this.grammars = opts.grammars ?? new Grammars()
    this.cache = new ParseCache(opts.cache)
  }

  async parse(req: ParseRequest): Promise<ParsedFile> {
    const tier = languageTier(req.language)
    const wantTokens = req.tokens !== false
    if (req.lines.length === 0 || req.lines.length > MAX_PARSE_LINES)
      return {
        language: req.language,
        tier,
        tokens: null,
        outline: null,
        hasErrors: false,
      }

    const grammar = await this.grammars.get(req.language)
    if (!grammar) {
      // Text tier: no Symbols; Lezer highlighting where it has a grammar.
      return {
        language: req.language,
        tier,
        tokens: wantTokens ? highlightLines(req.language, req.lines) : null,
        outline: null,
        hasErrors: false,
      }
    }
    const key = cacheKey(req, grammar)
    const hit = await this.cache.get(key)
    if (hit && (hit.tokens || !wantTokens)) return hit

    const tree = this.tree(grammar, req.lines)
    if (!tree)
      return {
        language: req.language,
        tier,
        tokens: null,
        outline: null,
        hasErrors: true,
      }
    try {
      const parsed: ParsedFile = {
        language: req.language,
        tier,
        tokens:
          wantTokens && grammar.highlights
            ? highlightTree(
                tree,
                grammar.highlights,
                req.lines,
                grammar.highlightRank,
              )
            : wantTokens
              ? highlightLines(req.language, req.lines)
              : null,
        outline: grammar.tags
          ? extractOutline(grammar.language, tree, grammar.tags)
          : EMPTY_OUTLINE,
        hasErrors: tree.rootNode.hasError,
      }
      await this.cache.set(key, parsed)
      return parsed
    } finally {
      tree.delete()
    }
  }

  /** A tree for callers that need the AST itself (proofs). The caller deletes it. */
  async parseTree(
    language: string | null,
    lines: string[],
  ): Promise<Tree | null> {
    const grammar = await this.grammars.get(language)
    if (!grammar) return null
    return this.tree(grammar, lines)
  }

  private tree(grammar: LoadedGrammar, lines: string[]): Tree | null {
    const text = lines.join("\n")
    if (text.length > MAX_HIGHLIGHT_CHARS) return null
    try {
      return this.grammars.parser(grammar).parse(text)
    } catch {
      return null
    }
  }
}

function cacheKey(req: ParseRequest, grammar: LoadedGrammar): string {
  const content =
    req.oid ?? createHash("sha1").update(req.lines.join("\n")).digest("hex")
  return createHash("sha1")
    .update(
      `${content}\0${req.language}\0${grammar.version}\0${EXTRACT_VERSION}`,
    )
    .digest("hex")
}
