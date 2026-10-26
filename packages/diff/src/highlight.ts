// Syntax highlighting with Lezer grammars, producing compact per-line token
// arrays ([startCol, len, scopeId] triples). Since M2 the indexer highlights
// with tree-sitter; this is the fallback for languages it has no grammar for
// (ADR 0014).

import { StreamLanguage, type StreamParser } from "@codemirror/language"
import {
  csharp,
  dart,
  kotlin,
  objectiveC,
  scala,
} from "@codemirror/legacy-modes/mode/clike"
import { clojure } from "@codemirror/legacy-modes/mode/clojure"
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile"
import { erlang } from "@codemirror/legacy-modes/mode/erlang"
import { haskell } from "@codemirror/legacy-modes/mode/haskell"
import { lua } from "@codemirror/legacy-modes/mode/lua"
import { protobuf } from "@codemirror/legacy-modes/mode/protobuf"
import { r } from "@codemirror/legacy-modes/mode/r"
import { ruby } from "@codemirror/legacy-modes/mode/ruby"
import { shell } from "@codemirror/legacy-modes/mode/shell"
import { standardSQL } from "@codemirror/legacy-modes/mode/sql"
import { swift } from "@codemirror/legacy-modes/mode/swift"
import { toml } from "@codemirror/legacy-modes/mode/toml"
import { type LineTokens, TOKEN_SCOPES, type TokenScope } from "@legible/domain"
import type { Parser } from "@lezer/common"
import { parser as cppParser } from "@lezer/cpp"
import { parser as cssParser } from "@lezer/css"
import { parser as goParser } from "@lezer/go"
import { highlightTree, tags as t, tagHighlighter } from "@lezer/highlight"
import { parser as htmlParser } from "@lezer/html"
import { parser as javaParser } from "@lezer/java"
import { parser as jsParser } from "@lezer/javascript"
import { parser as jsonParser } from "@lezer/json"
import { parser as mdParser } from "@lezer/markdown"
import { parser as phpParser } from "@lezer/php"
import { parser as pythonParser } from "@lezer/python"
import { parser as rustParser } from "@lezer/rust"
import { parser as xmlParser } from "@lezer/xml"
import { parser as yamlParser } from "@lezer/yaml"

const scope = (s: TokenScope) => String(TOKEN_SCOPES.indexOf(s))

const highlighter = tagHighlighter([
  {
    tag: [
      t.keyword,
      t.controlKeyword,
      t.definitionKeyword,
      t.moduleKeyword,
      t.operatorKeyword,
      t.self,
      t.modifier,
    ],
    class: scope("keyword"),
  },
  {
    tag: [
      t.function(t.variableName),
      t.function(t.propertyName),
      t.function(t.definition(t.variableName)),
      t.macroName,
    ],
    class: scope("function"),
  },
  {
    tag: [t.string, t.special(t.string), t.regexp, t.character, t.docString],
    class: scope("string"),
  },
  { tag: [t.number, t.integer, t.float], class: scope("number") },
  {
    tag: [t.typeName, t.className, t.namespace, t.definition(t.typeName)],
    class: scope("type"),
  },
  {
    tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
    class: scope("comment"),
  },
  {
    tag: [
      t.punctuation,
      t.bracket,
      t.separator,
      t.paren,
      t.squareBracket,
      t.brace,
      t.angleBracket,
    ],
    class: scope("punctuation"),
  },
  {
    tag: [t.propertyName, t.definition(t.propertyName)],
    class: scope("property"),
  },
  {
    tag: [t.variableName, t.definition(t.variableName), t.labelName],
    class: scope("variable"),
  },
  {
    tag: [
      t.operator,
      t.arithmeticOperator,
      t.logicOperator,
      t.compareOperator,
      t.definitionOperator,
    ],
    class: scope("operator"),
  },
  {
    tag: [t.bool, t.null, t.atom, t.constant(t.variableName), t.unit],
    class: scope("constant"),
  },
  { tag: [t.tagName], class: scope("tag") },
  { tag: [t.attributeName], class: scope("attribute") },
  {
    tag: [t.meta, t.processingInstruction, t.annotation],
    class: scope("meta"),
  },
  { tag: [t.heading], class: scope("heading") },
  { tag: [t.link, t.url], class: scope("link") },
  { tag: [t.inserted], class: scope("inserted") },
  { tag: [t.deleted], class: scope("deleted") },
])

const stream = (p: StreamParser<unknown>): Parser =>
  StreamLanguage.define(p).parser

/** Legacy CodeMirror modes, for languages without a Lezer grammar. */
const STREAM_MODES = new Map<string, StreamParser<unknown>>([
  ["shell", shell],
  ["ruby", ruby],
  ["toml", toml],
  ["swift", swift],
  ["kotlin", kotlin],
  ["csharp", csharp],
  ["scala", scala],
  ["objectivec", objectiveC],
  ["dart", dart],
  ["dockerfile", dockerFile],
  ["sql", standardSQL],
  ["lua", lua],
  ["r", r],
  ["protobuf", protobuf],
  ["haskell", haskell],
  ["clojure", clojure],
  ["erlang", erlang],
])

const parsers = new Map<string, () => Parser>([
  ["typescript", () => jsParser.configure({ dialect: "ts" })],
  ["tsx", () => jsParser.configure({ dialect: "ts jsx" })],
  ["javascript", () => jsParser],
  ["jsx", () => jsParser.configure({ dialect: "jsx" })],
  ["python", () => pythonParser],
  ["rust", () => rustParser],
  ["go", () => goParser],
  ["java", () => javaParser],
  ["c", () => cppParser],
  ["cpp", () => cppParser],
  ["css", () => cssParser],
  ["scss", () => cssParser],
  ["less", () => cssParser],
  ["html", () => htmlParser],
  ["xml", () => xmlParser],
  ["json", () => jsonParser],
  ["yaml", () => yamlParser],
  ["markdown", () => mdParser],
  ["php", () => phpParser],
  ...[...STREAM_MODES].map(
    ([name, mode]) => [name, () => stream(mode)] as const,
  ),
])

const cache = new Map<string, Parser>()

function parserFor(language: string): Parser | null {
  const hit = cache.get(language)
  if (hit) return hit
  const make = parsers.get(language)
  if (!make) return null
  const p = make()
  cache.set(language, p)
  return p
}

export function canHighlight(language: string | null): boolean {
  return language !== null && parsers.has(language)
}

/** Files above this size are shown without highlighting. */
export const MAX_HIGHLIGHT_CHARS = 600_000

/**
 * Highlights `lines` (already split) and returns one token array per line.
 * Returns null when the language is unknown or the text is too large.
 */
export function highlightLines(
  language: string | null,
  lines: string[],
): LineTokens[] | null {
  if (!language) return null
  const parser = parserFor(language)
  if (!parser) return null
  const text = lines.join("\n")
  if (text.length > MAX_HIGHLIGHT_CHARS) return null

  const starts = new Array<number>(lines.length)
  let pos = 0
  for (let i = 0; i < lines.length; i++) {
    starts[i] = pos
    pos += (lines[i] as string).length + 1
  }
  const out: LineTokens[] = lines.map(() => [])
  let tree: ReturnType<Parser["parse"]>
  try {
    tree = parser.parse(text)
  } catch {
    return null
  }
  let line = 0
  highlightTree(tree, highlighter, (from, to, classes) => {
    const id = Number(classes.split(" ")[0])
    if (Number.isNaN(id)) return
    // Ranges arrive in document order; advance to the line containing `from`.
    while (line + 1 < lines.length && (starts[line + 1] as number) <= from)
      line++
    let l = line
    let f = from
    while (f < to && l < lines.length) {
      const ls = starts[l] as number
      const le = ls + (lines[l] as string).length
      const segEnd = Math.min(to, le)
      if (segEnd > f) (out[l] as number[]).push(f - ls, segEnd - f, id)
      l++
      f = l < lines.length ? (starts[l] as number) : to
    }
  })
  return out
}

/** Scope id at a column, or -1. */
export function scopeAt(tokens: LineTokens | undefined, col: number): number {
  if (!tokens) return -1
  for (let i = 0; i < tokens.length; i += 3) {
    const s = tokens[i] as number
    if (col >= s && col < s + (tokens[i + 1] as number))
      return tokens[i + 2] as number
  }
  return -1
}
