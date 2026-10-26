import { Fragment, type ReactNode } from "react"

const CODE_SPAN = /(`[^`\n]+`)/g

/** The text inside each `code` span, in order. */
export function codeSpans(text: string): string[] {
  return [...text.matchAll(CODE_SPAN)].map((m) => (m[1] as string).slice(1, -1))
}

/**
 * Renders `code` spans from model text. No HTML, no Markdown beyond
 * backticks. `code` can render a span itself, e.g. as a link to a Symbol.
 */
export function Inline({
  text,
  code,
}: {
  text: string
  code?: (text: string) => ReactNode
}) {
  const parts = text.split(CODE_SPAN)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("`") && p.endsWith("`") && p.length > 2 ? (
          <Fragment key={i}>
            {code?.(p.slice(1, -1)) ?? (
              <code className="rounded-[4px] bg-muted px-[5px] py-px font-mono text-[0.92em]">
                {p.slice(1, -1)}
              </code>
            )}
          </Fragment>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  )
}

export function relativeTime(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`
  return new Date(iso).toLocaleDateString()
}

export function usd(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—"
  if (n === 0) return "$0"
  if (n < 0.01) return "<$0.01"
  return `$${n.toFixed(2)}`
}
