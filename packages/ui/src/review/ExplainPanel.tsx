import type {
  CodeSymbol,
  Explanation,
  ExplanationJob,
  ExplanationTarget,
} from "@legible/domain"
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, BookOpen, Loader2, RefreshCw, X } from "lucide-react"
import { useMemo } from "react"

import { formatKey } from "../commands"
import { codeSpans, Inline, usd } from "../components/Inline"
import { Button, Callout, cn, Eyebrow, Kbd, Skeleton } from "../components/ui"
import { useClient } from "../context"
import { HoverPreview, useHoverPreview } from "./ConnectionsPanel"

const MODEL_NAMES: Record<string, string> = {
  "claude-haiku-5-5": "Claude Haiku 5.5",
  "claude-sonnet-5-5": "Claude Sonnet 5.5",
  "claude-opus-5-5": "Claude Opus 5.5",
}

interface Props {
  reviewId: string
  iterationId: string | null
  /** Goes to a Symbol a code span names; joins the Trail. */
  onGoSymbol(symbol: CodeSymbol): void
  job: ExplanationJob | null
  explanation: Explanation | null
  history: Explanation[]
  onShow(e: Explanation): void
  onJump(e: Explanation): void
  onRetry(force: boolean): void
  onCancel(): void
}

export function ExplainPanel({
  reviewId,
  iterationId,
  onGoSymbol,
  job,
  explanation,
  history,
  onShow,
  onJump,
  onRetry,
  onCancel,
}: Props) {
  const running = job && (job.status === "queued" || job.status === "running")
  const shown = explanation ?? (job?.status === "done" ? job.explanation : null)
  return (
    <div className="flex min-h-0 flex-auto flex-col">
      <div className="flex min-w-0 flex-auto flex-col gap-4 overflow-x-hidden overflow-y-auto p-4">
        {running && job && (
          <div
            className="flex flex-col gap-3"
            aria-live="polite"
            data-testid="explain-running"
          >
            <div className="flex items-center">
              <Eyebrow className="grow">Explaining</Eyebrow>
              <Button variant="muted" size="xs" onClick={onCancel}>
                <X />
                Cancel
              </Button>
            </div>
            <div className="truncate font-mono text-sm" title={job.label}>
              {job.label}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              {job.progress ?? "Working"}
            </div>
            <div className="flex flex-col gap-2">
              <Skeleton className="w-2/5" />
              <Skeleton />
              <Skeleton className="w-[85%]" />
              <Skeleton className="w-3/5" />
            </div>
          </div>
        )}
        {!running && job?.status === "error" && (
          <Callout
            tone="critical"
            className="flex flex-col gap-2 px-3 py-2.5"
            role="alert"
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-critical">
              <AlertTriangle className="size-3.5" />
              Couldn't explain {job.label}
            </div>
            <p className="text-sm select-text">{job.error}</p>
            <div>
              <Button variant="outline" size="xs" onClick={() => onRetry(true)}>
                Try again
              </Button>
            </div>
          </Callout>
        )}
        {!running && shown && (
          <ExplanationCard
            e={shown}
            reviewId={reviewId}
            iterationId={iterationId}
            onGoSymbol={onGoSymbol}
            onJump={() => onJump(shown)}
            onRefresh={() => onRetry(true)}
          />
        )}
        {!running && !shown && job?.status !== "error" && <EmptyExplain />}

        {history.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            <Eyebrow className="px-1 pb-1">Earlier in this Review</Eyebrow>
            {history.map((h) => (
              <button
                type="button"
                key={h.id}
                className={cn(
                  "flex items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-hover",
                  shown?.id === h.id && "bg-accent",
                )}
                onClick={() => onShow(h)}
              >
                <BookOpen className="size-3 shrink-0 text-muted-foreground" />
                <span className="truncate font-mono text-xs" title={h.label}>
                  {h.label}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyExplain() {
  return (
    <div className="flex flex-col gap-2.5">
      <Eyebrow>Explanation</Eyebrow>
      <p className="text-sm text-muted-foreground">
        Select lines by clicking or dragging their line numbers, then press{" "}
        <Kbd keys={["e"]} />. Without a selection, <Kbd keys={["e"]} /> explains
        the current hunk and <Kbd keys={formatKey("shift+e")} /> the current
        file.
      </p>
      <p className="text-xs text-dim">
        Each Explanation says what the code did before, what it does now, and
        what changed, with up to two things to watch out for.
      </p>
    </div>
  )
}

const GLYPH = {
  behavior: "rounded-full bg-scope-requested",
  connection: "rounded-[2px] border-[1.5px] border-ask",
  intent: "rounded-full border-[1.5px] border-scope-supporting",
} as const

function Section({
  label,
  children,
  first,
}: {
  label: string
  children: React.ReactNode
  first?: boolean
}) {
  return (
    <>
      <div
        className={cn(
          "py-[11px] text-xs font-semibold text-muted-foreground",
          !first && "border-t",
        )}
      >
        {label}
      </div>
      <div className={cn("py-[11px]", !first && "border-t")}>{children}</div>
    </>
  )
}

/** What an Explanation's target says about where its code spans most likely point. */
function nearOf(t: ExplanationTarget) {
  const ids =
    t.kind === "symbol"
      ? [t.symbolId]
      : t.kind === "connection"
        ? [t.fromSymbolId, t.toSymbolId]
        : []
  return {
    path: t.path,
    symbolIds: ids.filter((x): x is string => x !== null),
  }
}

function ExplanationCard({
  e,
  reviewId,
  iterationId,
  onGoSymbol,
  onJump,
  onRefresh,
}: {
  e: Explanation
  reviewId: string
  iterationId: string | null
  onGoSymbol(symbol: CodeSymbol): void
  onJump(): void
  onRefresh(): void
}) {
  const b = e.body
  const client = useClient()
  const spans = useMemo(
    () => [
      ...new Set(
        [
          b.before ?? "",
          b.after,
          ...b.whatChanged.map((w) => w.text),
          ...b.watchOut,
        ].flatMap(codeSpans),
      ),
    ],
    [b],
  )
  const links = useQuery({
    queryKey: ["connections.lookup", reviewId, iterationId, e.id],
    queryFn: () =>
      client.call("connections.lookup", {
        reviewId,
        iterationId: iterationId as string,
        names: spans.slice(0, 50),
        near: nearOf(e.target),
      }),
    enabled: Boolean(iterationId) && spans.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const { hover, startHover, endHover } = useHoverPreview()
  const code = (text: string) => {
    const [s, ...others] = links.data?.[text] ?? []
    if (!s) return null
    return (
      <button
        type="button"
        data-testid="code-link"
        className="cursor-pointer rounded-[4px] bg-muted px-[5px] py-px font-mono text-[0.92em] text-foreground underline decoration-muted-foreground/50 decoration-dotted underline-offset-2 hover:decoration-foreground hover:decoration-solid"
        title={`${s.qualifiedName} · ${s.path}:${s.nameLine}${others.length ? ` (+${others.length} other ${others.length === 1 ? "match" : "matches"})` : ""}`}
        onMouseEnter={(ev) => startHover(s.id, ev.currentTarget)}
        onMouseLeave={endHover}
        onClick={() => {
          endHover()
          onGoSymbol(s)
        }}
      >
        {text}
      </button>
    )
  }
  return (
    <article className="flex flex-col gap-3" data-testid="explanation">
      <header className="flex flex-col gap-1">
        <div className="flex items-center">
          <Eyebrow className="grow">Explanation</Eyebrow>
          <span className="text-xs text-muted-foreground">
            Fast tier · {MODEL_NAMES[e.model] ?? e.model}
            {e.cached ? " · cached" : ""}
          </span>
        </div>
        <Button
          variant="plain"
          size="none"
          className="block max-w-full justify-start truncate text-left font-mono text-sm text-foreground"
          onClick={onJump}
          title={e.label}
        >
          {e.label}
        </Button>
      </header>
      <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-3.5 select-text">
        <Section label="Before" first>
          {b.before ? (
            <p className="text-sm">
              <Inline text={b.before} code={code} />
            </p>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              Omitted. This code is new.
            </p>
          )}
        </Section>
        <Section label="After">
          <p className="text-sm">
            <Inline text={b.after} code={code} />
          </p>
        </Section>
        {b.whatChanged.length > 0 && (
          <Section label="What changed">
            <ul className="flex flex-col gap-1.5 text-sm">
              {b.whatChanged.map((w, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span
                    className={cn(
                      "mt-1.5 inline-block size-2 shrink-0",
                      GLYPH[w.kind],
                    )}
                    title={w.kind}
                  />
                  <span>
                    <Inline text={w.text} code={code} />
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
      {b.watchOut.length > 0 && (
        <Callout tone="elevated" className="flex flex-col gap-1.5 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-elevated">
            <AlertTriangle className="size-3.5" />
            Watch out
          </div>
          <ol className="flex flex-col gap-2 text-sm select-text">
            {b.watchOut.map((w, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-px font-mono text-xs text-elevated">
                  {i + 1}
                </span>
                <span>
                  <Inline text={w} code={code} />
                </span>
              </li>
            ))}
          </ol>
        </Callout>
      )}
      <footer className="flex items-center gap-2 text-xs text-muted-foreground">
        <Button
          variant="muted"
          size="xs"
          onClick={onRefresh}
          title="Ask again, ignoring the cache"
        >
          <RefreshCw />
          Re-explain
        </Button>
        <span className="grow" />
        {!e.cached && e.durationMs !== null && (
          <span>{(e.durationMs / 1000).toFixed(1)}s</span>
        )}
        {!e.cached && <span>{usd(e.costUsd)}</span>}
        {e.cached && <span>Cached for this Head</span>}
      </footer>
      {hover && (
        <HoverPreview
          reviewId={reviewId}
          iterationId={iterationId}
          symbolId={hover.symbolId}
          top={hover.top}
        />
      )}
    </article>
  )
}
