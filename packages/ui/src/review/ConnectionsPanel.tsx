// The Connections panel: the focused Symbol, its Connection changes, what it
// uses and what uses it, with Ambiguous Connections showing every candidate.
// Likely and possible Connections (found by name) are marked as such; possible
// ones are greyed out, and in Used by they wait in a collapsed group.

import {
  type CodeSymbol,
  type Connection,
  CONNECTION_VERB,
  CONNECTION_VERB_IN,
  type ConnectionSite,
  type FileChange,
  type SymbolConnections,
} from "@legible/domain"
import { useQuery } from "@tanstack/react-query"
import { BookOpen, ChevronRight, CircleHelp, Loader2 } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import { formatKey } from "../commands"
import {
  Badge,
  Button,
  Callout,
  cn,
  Eyebrow,
  Kbd,
  Skeleton,
} from "../components/ui"
import { useClient } from "../context"
import { Code } from "../diff/code"
import type { Location } from "../state"

const LANGUAGE_NAMES: Record<string, string> = {
  typescript: "TypeScript",
  tsx: "TSX",
  javascript: "JavaScript",
  jsx: "JSX",
  python: "Python",
  go: "Go",
  rust: "Rust",
  java: "Java",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  ruby: "Ruby",
  php: "PHP",
  scala: "Scala",
  lua: "Lua",
  elixir: "Elixir",
  ocaml: "OCaml",
  json: "JSON",
  shell: "Shell",
  css: "CSS",
  html: "HTML",
  yaml: "YAML",
  toml: "TOML",
  hcl: "HCL",
  zig: "Zig",
}
const TIER_NAMES = { full: "Full", structural: "Structural", text: "Text" }

interface Props {
  reviewId: string
  iterationId: string | null
  files: FileChange[]
  topFileId: string | null
  focus: { symbolId: string; label: string } | null
  /** Earlier Trail entries, for breadcrumbs. */
  trail: Location[]
  onGoSymbol(symbol: CodeSymbol): void
  onGoSite(site: ConnectionSite, from: CodeSymbol | null): void
  onExplainSymbol(all: SymbolConnections): void
  onExplainConnection(c: Connection, all: SymbolConnections): void
}

/** Short name for a Symbol: its own name, or the file's for a module. */
export function symbolLabel(s: CodeSymbol): string {
  return s.kind === "module" ? s.name : s.qualifiedName
}

function where(s: CodeSymbol): string {
  return `${s.path.split("/").pop()}:${s.nameLine}`
}

export function ConnectionsPanel({
  reviewId,
  iterationId,
  files,
  topFileId,
  focus,
  trail,
  onGoSymbol,
  onGoSite,
  onExplainSymbol,
  onExplainConnection,
}: Props) {
  const client = useClient()
  const status = useQuery({
    queryKey: ["connections.status", reviewId, iterationId],
    queryFn: () =>
      client.call("connections.status", {
        reviewId,
        iterationId: iterationId as string,
      }),
    enabled: Boolean(iterationId),
    refetchInterval: (q) => (q.state.data?.state === "indexing" ? 400 : false),
  })
  const symbol = useQuery({
    queryKey: ["connections.symbol", reviewId, iterationId, focus?.symbolId],
    queryFn: () =>
      client.call("connections.symbol", {
        reviewId,
        iterationId: iterationId as string,
        symbolId: focus?.symbolId as string,
      }),
    enabled: Boolean(iterationId && focus),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const fileSymbols = useQuery({
    queryKey: ["connections.fileSymbols", reviewId, iterationId, topFileId],
    queryFn: () =>
      client.call("connections.fileSymbols", {
        reviewId,
        iterationId: iterationId as string,
        fileId: topFileId as string,
      }),
    enabled: Boolean(iterationId && topFileId && !focus),
    staleTime: Number.POSITIVE_INFINITY,
  })

  const { hover, startHover, endHover } = useHoverPreview()

  const all = symbol.data
  const crumbs = trail.filter((t) => t.label).slice(-3)
  const inChangeSet = (s: CodeSymbol) =>
    files.some((f) => f.path === s.path || f.oldPath === s.path)

  return (
    <div
      className="flex min-h-0 flex-auto flex-col"
      data-testid="connections-panel"
    >
      <nav
        aria-label="Trail"
        className="flex min-h-9 items-center gap-1 border-b px-3 py-1.5 text-xs text-muted-foreground"
      >
        {crumbs.length === 0 && !focus ? (
          <span>
            ⌘-click a name to follow it; the Trail keeps your way back.
          </span>
        ) : (
          <>
            {crumbs.map((c, i) => (
              <span key={i} className="flex min-w-0 items-center gap-1">
                <span className="truncate font-mono">{c.label}</span>
                <ChevronRight className="size-3 shrink-0" />
              </span>
            ))}
            {focus && (
              <b className="truncate font-mono font-medium text-foreground">
                {focus.label}
              </b>
            )}
          </>
        )}
        <span className="grow" />
        <Kbd keys={[formatKey("mod+[").join("")]} />
        <Kbd keys={[formatKey("mod+]").join("")]} />
      </nav>
      <div className="flex min-w-0 flex-auto flex-col gap-4 overflow-x-hidden overflow-y-auto p-4">
        {status.data?.state === "indexing" && !symbol.data && (
          <div
            className="flex items-center gap-2 text-xs text-muted-foreground"
            role="status"
          >
            <Loader2 className="size-3 animate-spin" />
            Indexing Symbols and Connections…
          </div>
        )}
        {status.data?.state === "error" && (
          <Callout tone="critical" className="px-3 py-2 text-sm" role="alert">
            Couldn't index this Change Set: {status.data.error}
          </Callout>
        )}

        {!focus && (
          <FileOutline
            symbols={
              fileSymbols.data?.head.length
                ? fileSymbols.data.head
                : (fileSymbols.data?.base ?? [])
            }
            file={files.find((f) => f.id === topFileId) ?? null}
            loading={fileSymbols.isLoading}
            onGo={onGoSymbol}
          />
        )}

        {focus && symbol.isLoading && (
          <div className="flex flex-col gap-2">
            <Skeleton className="w-3/5" />
            <Skeleton />
            <Skeleton className="w-4/5" />
          </div>
        )}
        {focus && symbol.data === null && (
          <p className="text-sm text-muted-foreground">
            This Symbol isn't in the index any more.
          </p>
        )}

        {all && (
          <>
            <SymbolHeader
              all={all}
              files={files}
              onExplain={() => onExplainSymbol(all)}
            />
            {!inChangeSet(all.symbol) && (
              <SourcePreview
                reviewId={reviewId}
                iterationId={iterationId}
                symbolId={all.symbol.id}
              />
            )}
            <ChangesSection
              all={all}
              onGoSymbol={onGoSymbol}
              onGoSite={onGoSite}
            />
            <ConnectionList
              title="Uses →"
              list={all.uses}
              all={all}
              direction="uses"
              onGoSymbol={onGoSymbol}
              onGoSite={onGoSite}
              onExplain={(c) => onExplainConnection(c, all)}
              onHover={startHover}
              onLeave={endHover}
            />
            <ConnectionList
              title="← Used by"
              list={all.usedBy}
              all={all}
              direction="usedBy"
              onGoSymbol={onGoSymbol}
              onGoSite={onGoSite}
              onExplain={(c) => onExplainConnection(c, all)}
              onHover={startHover}
              onLeave={endHover}
            />
            {!all.scope.complete && all.scope.detail && (
              <p className="text-xs text-dim">{all.scope.detail}</p>
            )}
          </>
        )}
      </div>
      {hover && (
        <HoverPreview
          reviewId={reviewId}
          iterationId={iterationId}
          symbolId={hover.symbolId}
          top={hover.top}
        />
      )}
    </div>
  )
}

function SymbolHeader({
  all,
  files,
  onExplain,
}: {
  all: SymbolConnections
  files: FileChange[]
  onExplain(): void
}) {
  const s = all.symbol
  const file = files.find((f) => f.path === s.path || f.oldPath === s.path)
  const dot = s.qualifiedName.lastIndexOf(".")
  return (
    <header className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <h2
          className="min-w-0 truncate font-mono text-base"
          title={s.qualifiedName}
        >
          {s.kind !== "module" && dot > 0 && (
            <span className="text-muted-foreground">
              {s.qualifiedName.slice(0, dot + 1)}
            </span>
          )}
          <b className="font-semibold">{s.name}</b>
        </h2>
        <Badge tone="muted">{s.kind}</Badge>
        {s.change !== "unchanged" && (
          <Badge
            tone={
              s.change === "added"
                ? "ok"
                : s.change === "removed"
                  ? "critical"
                  : "outline"
            }
          >
            {s.change}
          </Badge>
        )}
        <span className="grow" />
        <Badge tone="outline" title="Language Tier">
          {LANGUAGE_NAMES[s.language] ?? s.language} ·{" "}
          {TIER_NAMES[file?.tier ?? "full"]}
        </Badge>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="truncate font-mono" title={s.path}>
          {s.path}:{s.nameLine}
        </span>
        {all.counterpart && all.counterpart.name !== s.name && (
          <span className="shrink-0">
            was <span className="font-mono">{all.counterpart.name}</span>
          </span>
        )}
        {!file && <span className="shrink-0">· unchanged file</span>}
      </div>
      {s.signature && s.kind !== "module" && (
        <code
          className="truncate rounded-sm bg-inset px-2 py-1 font-mono text-xs text-muted-foreground"
          title={s.signature}
        >
          {s.signature}
        </code>
      )}
      <div>
        <Button
          variant="muted"
          size="xs"
          onClick={onExplain}
          title="Explain this Symbol (e)"
        >
          <BookOpen />
          Explain {s.kind === "module" ? "file" : s.kind}
        </Button>
      </div>
    </header>
  )
}

function targetOf(
  c: Connection,
  all: SymbolConnections,
  direction: "uses" | "usedBy",
) {
  const id = direction === "uses" ? c.toId : c.fromId
  return id ? (all.symbols[id] ?? null) : null
}

/** The other end's own name, and its container (class, or the file for a module) dimmed beside it. */
function Name({
  c,
  all,
  direction,
  className,
}: {
  c: Connection
  all: SymbolConnections
  direction: "uses" | "usedBy"
  className?: string
}) {
  const t = targetOf(c, all, direction)
  const container = t
    ? t.kind === "module"
      ? ""
      : t.qualifiedName.slice(
          0,
          Math.max(0, t.qualifiedName.length - t.name.length - 1),
        )
    : ""
  return (
    <span className={cn("flex min-w-0 grow items-baseline gap-1.5", className)}>
      <span className="min-w-0 truncate font-mono text-sm">
        {t ? t.name : c.name}
      </span>
      {container && (
        // Gives way first, so the name stays readable.
        <span className="max-w-[40%] min-w-0 shrink-[8] truncate font-mono text-xs text-dim">
          {container}
        </span>
      )}
    </span>
  )
}

/** How sure a Connection found by name is: "likely" or "possible", as a badge. */
function GuessMark({ c }: { c: Connection }) {
  if (c.status === "likely")
    return (
      <Badge
        tone="secondary"
        title="Found by name; the file imports it or the receiver's type names it"
      >
        likely
      </Badge>
    )
  if (c.status === "possible")
    return (
      <Badge
        tone="muted"
        title="Only the name matches: nothing else points at this definition"
      >
        possible
      </Badge>
    )
  return null
}

function ChangesSection({
  all,
  onGoSymbol,
  onGoSite,
}: {
  all: SymbolConnections
  onGoSymbol(s: CodeSymbol): void
  onGoSite(site: ConnectionSite, from: CodeSymbol | null): void
}) {
  // A new or deleted Symbol's own uses are all new or gone; only who uses it is news.
  const whole = all.symbol.change === "added" || all.symbol.change === "removed"
  const out = whole ? [] : all.uses.filter((c) => c.change)
  const inc = all.usedBy.filter((c) => c.change)
  if (out.length + inc.length === 0) return null
  const row = (c: Connection, direction: "uses" | "usedBy") => {
    const verb =
      direction === "uses"
        ? CONNECTION_VERB[c.kind]
        : CONNECTION_VERB_IN[c.kind]
    const removed = c.change === "removed"
    const target = targetOf(c, all, direction)
    return (
      <li key={`${direction}:${c.id}`}>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left hover:bg-hover"
          onClick={() =>
            target
              ? onGoSymbol(target)
              : c.sites[0] &&
                onGoSite(c.sites[0], all.symbols[c.fromId] ?? null)
          }
          data-testid="connection-change"
        >
          <span
            className={cn(
              "inline-block size-2 shrink-0 rounded-[2px] border-[1.5px]",
              removed ? "border-critical" : "border-ok bg-ok/40",
            )}
          />
          <span className="shrink-0 text-sm text-muted-foreground">
            {removed ? `No longer ${verb}` : `Now ${verb}`}
          </span>
          <Name
            c={c}
            all={all}
            direction={direction}
            className={cn(
              removed && "line-through decoration-critical/70",
              c.status === "possible" && "text-muted-foreground",
            )}
          />
          {c.status === "ambiguous" && <Badge tone="outline">?</Badge>}
          <GuessMark c={c} />
        </button>
      </li>
    )
  }
  return (
    <section className="flex flex-col gap-1 rounded-lg border bg-inset p-2">
      <div className="flex items-center px-1.5 pb-1">
        <Eyebrow className="grow">Connection changes</Eyebrow>
        <span className="text-xs text-muted-foreground">
          {out.length + inc.length}
        </span>
      </div>
      <ul className="flex flex-col">
        {out.map((c) => row(c, "uses"))}
        {inc.map((c) => row(c, "usedBy"))}
      </ul>
    </section>
  )
}

function ConnectionList({
  title,
  list,
  all,
  direction,
  onGoSymbol,
  onGoSite,
  onExplain,
  onHover,
  onLeave,
}: {
  title: string
  list: Connection[]
  all: SymbolConnections
  direction: "uses" | "usedBy"
  onGoSymbol(s: CodeSymbol): void
  onGoSite(site: ConnectionSite, from: CodeSymbol | null): void
  onExplain(c: Connection): void
  onHover(symbolId: string | null, el: HTMLElement): void
  onLeave(): void
}) {
  const [open, setOpen] = useState<string | null>(null)
  const [showPossible, setShowPossible] = useState(false)
  const quiet = all.symbol.change === "added" || all.symbol.change === "removed"
  // Users found only by name wait in their own group.
  const possible =
    direction === "usedBy" ? list.filter((c) => c.status === "possible") : []
  const sure = possible.length
    ? list.filter((c) => c.status !== "possible")
    : list
  const row = (c: Connection) => {
    const target = targetOf(c, all, direction)
    const from = all.symbols[c.fromId] ?? null
    const ambiguous = c.status === "ambiguous" && direction === "uses"
    // This Symbol is one of several candidates for the use.
    const oneOf = c.status === "ambiguous" && direction === "usedBy"
    const label =
      direction === "uses"
        ? CONNECTION_VERB[c.kind]
        : CONNECTION_VERB_IN[c.kind]
    return (
      <div key={c.id} data-testid="connection" className="group/conn relative">
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-sm py-1 pr-8 pl-1.5 text-left hover:bg-hover"
          onMouseEnter={(e) => onHover(target?.id ?? null, e.currentTarget)}
          onMouseLeave={onLeave}
          onClick={() => {
            onLeave()
            if (ambiguous) setOpen(open === c.id ? null : c.id)
            else if (direction === "uses" && target) onGoSymbol(target)
            else if (c.sites[0]) onGoSite(c.sites[0], from)
          }}
          title={
            target
              ? `${target.qualifiedName} · ${target.path}:${target.nameLine}`
              : (c.module ?? undefined)
          }
        >
          <span className="w-[54px] shrink-0 text-xs text-muted-foreground">
            {label}
            {(ambiguous || oneOf) && "?"}
          </span>
          <Name
            c={c}
            all={all}
            direction={direction}
            className={cn(
              c.change === "removed" && "text-muted-foreground line-through",
              (c.status === "external" || c.status === "possible") &&
                "text-muted-foreground",
            )}
          />
          {c.change && !(quiet && direction === "uses") && (
            <Badge tone={c.change === "added" ? "ok" : "critical"}>
              {c.change}
            </Badge>
          )}
          <GuessMark c={c} />
          {oneOf && (
            <Badge
              tone="outline"
              title={`One of ${c.candidates.length} candidates for this use`}
            >
              ?
            </Badge>
          )}
          {ambiguous && (
            <Badge
              tone="outline"
              title="Several definitions could be the target"
            >
              <CircleHelp />
              Ambiguous
            </Badge>
          )}
          {c.status === "external" && (
            <span className="max-w-24 shrink-0 truncate text-xs text-dim">
              {c.module ?? "external"}
            </span>
          )}
        </button>
        <Button
          variant="muted"
          size="icon-xs"
          className="absolute top-0.5 right-1 opacity-0 group-hover/conn:opacity-100 focus-visible:opacity-100"
          aria-label={`Explain how ${all.symbol.name} ${direction === "uses" ? CONNECTION_VERB[c.kind] : CONNECTION_VERB_IN[c.kind]} ${c.name}`}
          title="Explain this Connection"
          onClick={() => onExplain(c)}
        >
          <BookOpen />
        </Button>
        {ambiguous && open === c.id && (
          <div
            className="mx-1.5 mb-1 flex flex-col gap-0.5 rounded-md bg-inset p-2"
            data-testid="candidates"
          >
            <div className="pb-1 text-xs text-muted-foreground">
              Which <span className="font-mono">{c.name}</span> is this? Every
              candidate:
            </div>
            {c.candidates.map((id, i) => {
              const s = all.symbols[id]
              if (!s) return null
              return (
                <button
                  type="button"
                  key={id}
                  className="flex items-center gap-2 rounded-sm px-1.5 py-0.5 text-left hover:bg-hover"
                  onMouseEnter={(e) => onHover(id, e.currentTarget)}
                  onMouseLeave={onLeave}
                  onClick={() => {
                    onLeave()
                    onGoSymbol(s)
                  }}
                >
                  <span className="min-w-0 grow truncate font-mono text-xs">
                    {s.qualifiedName}
                  </span>
                  <span className="text-xs text-dim">
                    {i === 0 ? "closest" : "candidate"}
                  </span>
                  <span className="font-mono text-xs text-dim">{where(s)}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }
  return (
    <section className="flex flex-col gap-0.5" aria-label={title}>
      <div className="flex items-center px-1.5 pb-1">
        <Eyebrow className="grow">{title}</Eyebrow>
        <span className="text-xs text-muted-foreground">{list.length}</span>
      </div>
      {quiet && list.length > 0 && direction === "uses" && (
        <p className="px-1.5 pb-1 text-xs text-dim">
          All new with this {all.symbol.kind}.
        </p>
      )}
      {list.length === 0 && (
        <p className="px-1.5 text-xs text-dim">None found.</p>
      )}
      {sure.map(row)}
      {possible.length > 0 && (
        <>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-sm px-1.5 py-1 text-left text-xs text-muted-foreground hover:bg-hover"
            aria-expanded={showPossible}
            onClick={() => setShowPossible((v) => !v)}
            title="Found by name only: nothing else says these use it"
            data-testid="possible-users"
          >
            <ChevronRight
              className={cn(
                "size-3 transition-transform",
                showPossible && "rotate-90",
              )}
            />
            Possible
            <span className="text-dim">{possible.length}</span>
          </button>
          {showPossible && possible.map(row)}
        </>
      )}
    </section>
  )
}

function FileOutline({
  symbols,
  file,
  loading,
  onGo,
}: {
  symbols: CodeSymbol[]
  file: FileChange | null
  loading: boolean
  onGo(s: CodeSymbol): void
}) {
  if (!file) return null
  if (file.tier === "text")
    return (
      <p className="text-sm text-muted-foreground">
        {file.path.split("/").pop()} is Text tier: Legible has no grammar for
        it, so there are no Symbols or Connections.
      </p>
    )
  const changed = symbols.filter((s) => s.change !== "unchanged")
  return (
    <section className="flex flex-col gap-0.5">
      <div className="flex items-center px-1.5 pb-1">
        <Eyebrow className="grow">
          Changed Symbols · {file.path.split("/").pop()}
        </Eyebrow>
        <span className="text-xs text-muted-foreground">{changed.length}</span>
      </div>
      {loading && <Skeleton className="w-3/5" />}
      {!loading && changed.length === 0 && (
        <p className="px-1.5 text-xs text-dim">
          {symbols.length
            ? "No Symbols changed in this file."
            : "No Symbols in this file."}
        </p>
      )}
      {changed.map((s) => (
        <button
          type="button"
          key={s.id}
          className="flex items-center gap-2 rounded-sm px-1.5 py-1 text-left hover:bg-hover"
          onClick={() => onGo(s)}
          data-testid="outline-symbol"
        >
          <span className="w-[60px] shrink-0 text-xs text-muted-foreground">
            {s.kind}
          </span>
          <span className="min-w-0 grow truncate font-mono text-sm">
            {s.qualifiedName}
          </span>
          <Badge
            tone={
              s.change === "added"
                ? "ok"
                : s.change === "removed"
                  ? "critical"
                  : "muted"
            }
          >
            {s.change}
          </Badge>
        </button>
      ))}
      <p className="px-1.5 pt-2 text-xs text-dim">
        Click a line to see its Symbol's Connections, or ⌘-click a name to go to
        its definition.
      </p>
    </section>
  )
}

function useSource(
  reviewId: string,
  iterationId: string | null,
  symbolId: string,
) {
  const client = useClient()
  return useQuery({
    queryKey: ["symbol.source", reviewId, iterationId, symbolId],
    queryFn: () =>
      client.call("symbol.source", {
        reviewId,
        iterationId: iterationId as string,
        symbolId,
      }),
    enabled: Boolean(iterationId),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

function SourceLines({
  src,
  max,
}: {
  src: NonNullable<ReturnType<typeof useSource>["data"]>
  max: number
}) {
  const lines = src.lines.slice(0, max)
  return (
    <div className="overflow-hidden font-mono text-xs leading-[18px] whitespace-pre">
      {lines.map((l, i) => (
        <div key={i} className="flex">
          <span className="w-9 shrink-0 pr-2 text-right text-dim">
            {src.firstLine + i}
          </span>
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-pre">
            <Code
              text={l}
              tokens={src.tokens?.[i]}
              words={undefined}
              wordClass="add"
            />
          </span>
        </div>
      ))}
      {src.lines.length > max && (
        <div className="pl-9 text-dim">
          … {src.lines.length - max} more lines
        </div>
      )}
    </div>
  )
}

function SourcePreview({
  reviewId,
  iterationId,
  symbolId,
}: {
  reviewId: string
  iterationId: string | null
  symbolId: string
}) {
  const src = useSource(reviewId, iterationId, symbolId)
  if (!src.data) return null
  return (
    <section
      className="flex flex-col gap-1 rounded-lg border bg-background p-2"
      data-testid="symbol-source"
    >
      <Eyebrow className="px-1 pb-1">Definition · unchanged code</Eyebrow>
      <SourceLines src={src.data} max={40} />
    </section>
  )
}

/** A code preview after hovering something that names a Symbol for a moment. */
export function useHoverPreview() {
  const [hover, setHover] = useState<{ symbolId: string; top: number } | null>(
    null,
  )
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startHover = useCallback((symbolId: string | null, el: HTMLElement) => {
    if (timer.current) clearTimeout(timer.current)
    if (!symbolId) return
    timer.current = setTimeout(
      () => setHover({ symbolId, top: el.getBoundingClientRect().top }),
      350,
    )
  }, [])
  const endHover = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    setHover(null)
  }, [])
  useEffect(() => endHover, [endHover])
  return { hover, startHover, endHover }
}

/** The Symbol's code in a popover to the left of the right-hand panel. */
export function HoverPreview({
  reviewId,
  iterationId,
  symbolId,
  top,
}: {
  reviewId: string
  iterationId: string | null
  symbolId: string
  top: number
}) {
  const src = useSource(reviewId, iterationId, symbolId)
  if (!src.data) return null
  const s = src.data.symbol
  return (
    <div
      className="pointer-events-none fixed right-[372px] z-20 w-[460px] rounded-lg border bg-popover p-2.5 shadow-lg"
      style={{ top: Math.min(top, window.innerHeight - 260) }}
      role="tooltip"
    >
      <div className="flex items-center gap-2 pb-1.5">
        <span className="grow truncate font-mono text-xs font-semibold">
          {s.qualifiedName}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {where(s)}
        </span>
      </div>
      <SourceLines src={src.data} max={12} />
      <div className="pt-1.5 text-xs text-muted-foreground">
        Click to open · joins the Trail
      </div>
    </div>
  )
}
