import {
  type LineTokens,
  TOKEN_SCOPES,
  type TokenScope,
  type WordRanges,
} from "@legible/domain"
import type { ReactNode } from "react"

const SCOPE_CLASS: Record<TokenScope, string> = {
  keyword: "text-syn-keyword",
  function: "text-syn-function",
  string: "text-syn-string",
  number: "text-syn-number",
  type: "text-syn-type",
  comment: "text-dim italic",
  punctuation: "text-muted-foreground",
  property: "text-syn-property",
  variable: "",
  operator: "text-muted-foreground",
  constant: "text-syn-number",
  tag: "text-syn-keyword",
  attribute: "text-syn-number",
  meta: "text-dim italic",
  heading: "font-semibold text-foreground",
  link: "text-syn-string",
  inserted: "text-ok",
  deleted: "text-critical",
}
const WORD_CLASS = {
  add: "rounded-[2px] bg-add-word",
  del: "rounded-[2px] bg-del-word",
} as const
const CLASS_BY_ID = TOKEN_SCOPES.map((s) => SCOPE_CLASS[s])

/**
 * Splits a line at token and word-diff boundaries and renders spans. Text is
 * rendered as text nodes only, never HTML.
 */
export function Code({
  text,
  tokens,
  words,
  wordClass,
}: {
  text: string
  tokens: LineTokens | undefined
  words: WordRanges | undefined
  wordClass: "add" | "del"
}): ReactNode {
  // A CR left by CRLF line endings isn't shown; the file header notes the line endings.
  if (text.endsWith("\r")) text = text.slice(0, -1)
  if (!tokens?.length && !words?.length) return text
  const cuts = new Set<number>([0, text.length])
  const scopeAt = new Int16Array(text.length).fill(-1)
  if (tokens) {
    for (let i = 0; i < tokens.length; i += 3) {
      const s = tokens[i] as number
      const e = Math.min(text.length, s + (tokens[i + 1] as number))
      cuts.add(s)
      cuts.add(e)
      for (let c = s; c < e; c++) scopeAt[c] = tokens[i + 2] as number
    }
  }
  const inWord = new Uint8Array(text.length)
  if (words) {
    for (let i = 0; i < words.length; i += 2) {
      const s = words[i] as number
      const e = Math.min(text.length, words[i + 1] as number)
      cuts.add(s)
      cuts.add(e)
      for (let c = s; c < e; c++) inWord[c] = 1
    }
  }
  const points = [...cuts]
    .filter((p) => p >= 0 && p <= text.length)
    .toSorted((a, b) => a - b)
  const out: ReactNode[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const s = points[i] as number
    const e = points[i + 1] as number
    if (e <= s) continue
    const scope = scopeAt[s] as number
    const cls = [
      scope >= 0 ? CLASS_BY_ID[scope] : "",
      inWord[s] ? WORD_CLASS[wordClass] : "",
    ]
      .filter(Boolean)
      .join(" ")
    const piece = text.slice(s, e)
    out.push(
      cls ? (
        <span key={s} className={cls}>
          {piece}
        </span>
      ) : (
        piece
      ),
    )
  }
  return out
}
