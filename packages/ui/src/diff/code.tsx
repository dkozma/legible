import { type LineTokens, TOKEN_SCOPES, type TokenScope, type WordRanges } from '@legible/domain';
import type { ReactNode } from 'react';

const SCOPE_CLASS: Record<TokenScope, string> = {
  keyword: 'k',
  function: 'f',
  string: 's',
  number: 'n',
  type: 't',
  comment: 'c',
  punctuation: 'p',
  property: 'pr',
  variable: '',
  operator: 'p',
  constant: 'n',
  tag: 'tg',
  attribute: 'at',
  meta: 'c',
  heading: 'hd',
  link: 's',
  inserted: 'add-t',
  deleted: 'del-t',
};
const CLASS_BY_ID = TOKEN_SCOPES.map((s) => SCOPE_CLASS[s]);

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
  text: string;
  tokens: LineTokens | undefined;
  words: WordRanges | undefined;
  wordClass: 'wa' | 'wd';
}): ReactNode {
  if (!tokens?.length && !words?.length) return text;
  const cuts = new Set<number>([0, text.length]);
  const scopeAt = new Int16Array(text.length).fill(-1);
  if (tokens) {
    for (let i = 0; i < tokens.length; i += 3) {
      const s = tokens[i] as number;
      const e = Math.min(text.length, s + (tokens[i + 1] as number));
      cuts.add(s);
      cuts.add(e);
      for (let c = s; c < e; c++) scopeAt[c] = tokens[i + 2] as number;
    }
  }
  const inWord = new Uint8Array(text.length);
  if (words) {
    for (let i = 0; i < words.length; i += 2) {
      const s = words[i] as number;
      const e = Math.min(text.length, words[i + 1] as number);
      cuts.add(s);
      cuts.add(e);
      for (let c = s; c < e; c++) inWord[c] = 1;
    }
  }
  const points = [...cuts].filter((p) => p >= 0 && p <= text.length).sort((a, b) => a - b);
  const out: ReactNode[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const s = points[i] as number;
    const e = points[i + 1] as number;
    if (e <= s) continue;
    const scope = scopeAt[s] as number;
    const cls = [scope >= 0 ? CLASS_BY_ID[scope] : '', inWord[s] ? wordClass : ''].filter(Boolean).join(' ');
    const piece = text.slice(s, e);
    out.push(
      cls ? (
        <span key={s} className={cls}>
          {piece}
        </span>
      ) : (
        piece
      ),
    );
  }
  return out;
}
