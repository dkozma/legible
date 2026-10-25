import type {
  Explanation,
  ExplanationTarget,
  FileChange,
  FileDiff,
} from "@legible/domain"
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import {
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { type Command, formatKey, useKeyboard } from "../commands"
import { relativeTime, usd } from "../components/Inline"
import {
  Badge,
  Button,
  Callout,
  Kbd,
  Progress,
  Select,
  Switch,
  Tab,
  Tabs,
  Titlebar,
} from "../components/ui"
import { useClient } from "../context"
import { type DiffActions, DiffLoading, DiffView } from "../diff/DiffView"
import { buildRows, chunkRanges, rangesForRows, rowAt } from "../diff/rows"
import { ExplainPanel } from "../review/ExplainPanel"
import { FileTree } from "../review/FileTree"
import { useUI } from "../state"

const HEAD_ROOM = 64
const NO_FILES: FileChange[] = []
const dataOf = <T,>(results: { data?: T }[]) => results.map((q) => q.data)

export function ReviewView({ reviewId }: { reviewId: string }) {
  const client = useClient()
  const qc = useQueryClient()
  const ui = useUI()
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollTop = useRef(0)
  const [topFile, setTopFile] = useState<string | null>(null)

  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => client.call("settings.get", {}),
  })
  const review = useQuery({
    queryKey: ["review", reviewId],
    queryFn: () => client.call("review.get", { reviewId }),
  })
  const iterations = useQuery({
    queryKey: ["iterations", reviewId],
    queryFn: () => client.call("review.iterations", { reviewId }),
  })
  const latestId = review.data?.latestIteration?.id ?? null
  const iterationId = ui.iterationId ?? latestId
  const cs = useQuery({
    queryKey: ["changeSet", reviewId, iterationId, ui.ignoreWhitespace],
    queryFn: () =>
      client.call("changeSet.get", {
        reviewId,
        iterationId,
        ignoreWhitespace: ui.ignoreWhitespace,
      }),
    enabled: Boolean(iterationId),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const viewedQ = useQuery({
    queryKey: ["viewed", reviewId],
    queryFn: () => client.call("viewed.list", { reviewId }),
  })
  const history = useQuery({
    queryKey: ["history", reviewId],
    queryFn: () => client.call("explain.history", { reviewId }),
  })
  const spend = useQuery({
    queryKey: ["spend", reviewId],
    queryFn: () => client.call("spend.summary", { reviewId }),
  })
  const runtime = useQuery({
    queryKey: ["runtimeStatus"],
    queryFn: () => client.call("runtime.status", {}),
    staleTime: 60_000,
  })

  const files = cs.data?.files ?? NO_FILES

  const viewed = useMemo(() => new Set(viewedQ.data ?? []), [viewedQ.data])
  const model = useMemo(
    () =>
      buildRows(cs.data ?? { files: [], moves: [] }, {
        layout: ui.layout,
        context: settings.data?.diff.contextLines ?? 3,
        viewed,
        expandedFiles: ui.expandedFiles,
        collapsedFiles: ui.collapsedFiles,
        expandedFrags: ui.expandedFrags,
        gapReveal: ui.gapReveal,
      }),
    [
      cs.data,
      ui.layout,
      settings.data?.diff.contextLines,
      viewed,
      ui.expandedFiles,
      ui.collapsedFiles,
      ui.expandedFrags,
      ui.gapReveal,
    ],
  )

  // Load file contents only for files drawn near the viewport. Rows are laid out from the
  // Change Set alone, so nothing moves when contents arrive; loaded files stay cached.
  const [nearKey, setNearKey] = useState("")
  const updateNear = (px: number) => {
    const h = scrollRef.current?.clientHeight || 1000
    const ids = new Set<string>()
    for (
      let i = rowAt(model, Math.max(0, px - h)), end = rowAt(model, px + 3 * h);
      i <= end;
      i++
    ) {
      const r = model.rows[i]
      if (r && r.k !== "end" && r.k !== "file" && r.k !== "collapsed")
        ids.add(r.fileId)
    }
    const key = [...ids].join("\n")
    setNearKey((prev) => (prev === key ? prev : key))
  }
  const near = useMemo(() => new Set(nearKey.split("\n")), [nearKey])
  const diffList = useQueries({
    queries: files.map((f) => ({
      queryKey: ["fileDiff", reviewId, iterationId, f.id, ui.ignoreWhitespace],
      queryFn: () =>
        client.call("fileDiff.get", {
          reviewId,
          iterationId: iterationId as string,
          fileId: f.id,
          ignoreWhitespace: ui.ignoreWhitespace,
        }),
      enabled: Boolean(iterationId) && !f.binary && near.has(f.id),
      staleTime: Number.POSITIVE_INFINITY,
    })),
    combine: dataOf,
  })
  const diffs = useMemo(() => {
    const out: Record<string, FileDiff | undefined> = {}
    files.forEach((f, i) => {
      out[f.id] = diffList[i]
    })
    return out
  }, [files, diffList])

  // A selection is row indices into this model; any re-layout (split, gaps,
  // expanding, viewed) invalidates it, so drop it rather than explain the wrong lines.
  useEffect(() => {
    useUI.getState().set({ selection: null })
  }, [model])

  // ---- Navigation ------------------------------------------------------------------

  const scrollToPx = useCallback(
    (px: number, trail = false) => {
      const s = useUI.getState()
      if (trail)
        s.set({
          trail: {
            back: [...s.trail.back, { reviewId, px: scrollTop.current }].slice(
              -100,
            ),
            forward: [],
          },
        })
      s.scroll(px)
    },
    [reviewId],
  )
  const scrollToRow = useCallback(
    (row: number, trail = false) =>
      scrollToPx((model.offsets[row] ?? 0) - HEAD_ROOM, trail),
    [model.offsets, scrollToPx],
  )

  const openFile = useCallback(
    (fileId: string) => {
      const f = model.files.find((x) => x.fileId === fileId)
      if (f) scrollToRow(f.row, true)
      useUI.getState().set({ activeFileId: fileId })
    },
    [model.files, scrollToRow],
  )

  const moveHunk = (dir: 1 | -1) => {
    const top = scrollTop.current
    const pos = (h: { row: number }) => (model.offsets[h.row] ?? 0) - HEAD_ROOM
    const list = model.hunks
    const idx =
      dir === 1
        ? list.findIndex((h) => pos(h) > top + 1)
        : list.findLastIndex((h) => pos(h) < top - 1)
    if (idx < 0) return
    useUI.getState().set({ cursor: idx, selection: null })
    scrollToPx(pos(list[idx] as { row: number }))
  }
  const moveFile = (dir: 1 | -1) => {
    const top = scrollTop.current
    const pos = (f: { row: number }) => (model.offsets[f.row] ?? 0) - 8
    const list = model.files
    const idx =
      dir === 1
        ? list.findIndex((f) => pos(f) > top + 1)
        : list.findLastIndex((f) => pos(f) < top - 1)
    if (idx < 0) return
    scrollToPx(pos(list[idx] as { row: number }))
  }
  const currentFileId = () => {
    const cur = model.hunks[useUI.getState().cursor]
    const fromScroll =
      model.rows[rowAt(model, scrollTop.current + HEAD_ROOM + 8)]
    if (fromScroll && fromScroll.k !== "end") return fromScroll.fileId
    return cur?.fileId ?? topFile
  }

  // ---- Actions ---------------------------------------------------------------------------

  const explain = useMutation({
    mutationFn: ({
      target,
      force,
    }: {
      target: ExplanationTarget
      force: boolean
    }) =>
      client.call("explain.request", {
        reviewId,
        iterationId: iterationId as string,
        target,
        force,
      }),
    onSuccess: (job) => {
      const s = useUI.getState()
      s.upsertJob(job)
      s.set({ activeJobId: job.jobId, shownExplanation: null })
    },
    onError: (e: Error) => useUI.getState().toast(e.message),
  })

  const fileTarget = (fileId: string): ExplanationTarget | null => {
    const f = files.find((x) => x.id === fileId)
    return f
      ? { kind: "file", fileId: f.id, path: f.path, oldPath: f.oldPath }
      : null
  }
  const chunkTarget = (
    fileId: string,
    chunk: number,
    lastChunk = chunk,
  ): ExplanationTarget | null => {
    const f = files.find((x) => x.id === fileId)
    if (!f?.chunks[chunk]) return null
    return {
      kind: "range",
      fileId: f.id,
      path: f.path,
      oldPath: f.oldPath,
      ...chunkRanges(f.chunks, chunk, lastChunk),
    }
  }

  /** Gutter selection, else a text selection inside the diff, else the current hunk. */
  const selectionTarget = (): ExplanationTarget | null => {
    const s = useUI.getState()
    let fileId: string | null = null
    let from = -1
    let to = -1
    if (s.selection) {
      fileId = s.selection.fileId
      from = s.selection.anchor
      to = s.selection.focus
    } else {
      const sel = window.getSelection()
      const rowOf = (n: Node | null) =>
        (n instanceof Element ? n : n?.parentElement)
          ?.closest("[data-row]")
          ?.getAttribute("data-row")
      if (
        sel &&
        !sel.isCollapsed &&
        scrollRef.current?.contains(sel.anchorNode)
      ) {
        const a = Number(rowOf(sel.anchorNode))
        const b = Number(rowOf(sel.focusNode))
        const ra = model.rows[a]
        const rb = model.rows[b]
        if (
          ra &&
          rb &&
          ra.k !== "end" &&
          rb.k !== "end" &&
          ra.fileId === rb.fileId
        ) {
          fileId = ra.fileId
          from = a
          to = b
        }
      }
    }
    if (fileId) {
      const f = files.find((x) => x.id === fileId)
      const r = rangesForRows(model.rows, from, to, fileId)
      if (f && (r.baseRange || r.headRange))
        return {
          kind: "range",
          fileId: f.id,
          path: f.path,
          oldPath: f.oldPath,
          ...r,
        }
    }
    // The hunk at the top of the viewport.
    const top = scrollTop.current
    const h =
      model.hunks.find(
        (x) => (model.offsets[x.row] ?? 0) >= top + HEAD_ROOM - 4,
      ) ?? model.hunks[s.cursor]
    return h ? chunkTarget(h.fileId, h.chunk) : null
  }

  const runExplain = (t: ExplanationTarget | null, force = false) => {
    if (!t) {
      useUI.getState().toast("Nothing to explain here.", "info")
      return
    }
    if (!iterationId) return
    explain.mutate({ target: t, force })
  }

  const viewedMut = useMutation({
    mutationFn: ({ fileIds, on }: { fileIds: string[]; on: boolean }) =>
      client.call("viewed.set", { reviewId, fileIds, viewed: on }),
    onMutate: ({ fileIds, on }) => {
      qc.setQueryData<string[]>(["viewed", reviewId], (old = []) =>
        on
          ? [...new Set([...old, ...fileIds])]
          : old.filter((x) => !fileIds.includes(x)),
      )
    },
    onError: (e: Error) => {
      useUI.getState().toast(e.message)
      void qc.invalidateQueries({ queryKey: ["viewed", reviewId] })
    },
  })
  const toggleViewed = (fileId: string) => {
    const on = !viewed.has(fileId)
    const s = useUI.getState()
    s.toggleIn("expandedFiles", fileId, false)
    s.toggleIn("collapsedFiles", fileId, false)
    viewedMut.mutate({ fileIds: [fileId], on })
  }

  const openInEditor = (path: string, line: number) => {
    client
      .call("editor.open", { reviewId, path, line })
      .then((r) => {
        if (!r.ok && r.error) useUI.getState().toast(r.error)
      })
      .catch((e: Error) => useUI.getState().toast(e.message))
  }

  const refresh = useMutation({
    mutationFn: () => client.call("review.refresh", { reviewId }),
    onSuccess: async () => {
      const s = useUI.getState()
      const next = { ...s.changesAvailable }
      delete next[reviewId]
      s.set({ changesAvailable: next, iterationId: null, selection: null })
      await qc.invalidateQueries({ queryKey: ["review", reviewId] })
      await qc.invalidateQueries({ queryKey: ["iterations", reviewId] })
    },
    onError: (e: Error) => useUI.getState().toast(e.message),
  })

  const actions: DiffActions = {
    explainChunk: (fileId, chunk, lastChunk) =>
      runExplain(chunkTarget(fileId, chunk, lastChunk)),
    explainFile: (fileId) => runExplain(fileTarget(fileId)),
    openInEditor,
    toggleViewed,
    canOpenInEditor: Boolean(review.data?.repo.workTree),
  }

  const jumpToExplanation = (e: Explanation) => {
    const f = model.files.find((x) => x.fileId === e.target.fileId)
    if (!f) return
    if (e.target.kind === "file") {
      scrollToRow(f.row, true)
      return
    }
    const want = e.target.headRange ?? e.target.baseRange
    const side = e.target.headRange ? "head" : "base"
    const idx = model.rows.findIndex(
      (r, i) =>
        i > f.row &&
        (r.k === "line" || r.k === "pair") &&
        r.fileId === f.fileId &&
        want &&
        (side === "head"
          ? r.k === "line"
            ? r.head
            : r.r
          : r.k === "line"
            ? r.base
            : r.l) +
          1 ===
          want[0],
    )
    scrollToRow(idx >= 0 ? idx : f.row, true)
  }

  const trailMove = (dir: "back" | "forward") => {
    const s = useUI.getState()
    const stack = dir === "back" ? s.trail.back : s.trail.forward
    const loc = stack[stack.length - 1]
    if (!loc) return
    const here = { reviewId, px: scrollTop.current }
    s.set({
      trail:
        dir === "back"
          ? {
              back: s.trail.back.slice(0, -1),
              forward: [...s.trail.forward, here],
            }
          : {
              back: [...s.trail.back, here],
              forward: s.trail.forward.slice(0, -1),
            },
    })
    s.scroll(loc.px)
  }

  const commands: Command[] = [
    {
      id: "next-hunk",
      title: "Next hunk",
      group: "Move",
      keys: ["j"],
      paletteHidden: true,
      run: () => moveHunk(1),
    },
    {
      id: "prev-hunk",
      title: "Previous hunk",
      group: "Move",
      keys: ["k"],
      paletteHidden: true,
      run: () => moveHunk(-1),
    },
    {
      id: "next-file",
      title: "Next file",
      group: "Move",
      keys: ["n"],
      run: () => moveFile(1),
    },
    {
      id: "prev-file",
      title: "Previous file",
      group: "Move",
      keys: ["p"],
      run: () => moveFile(-1),
    },
    {
      id: "trail-back",
      title: "Trail back",
      group: "Move",
      keys: ["mod+["],
      run: () => trailMove("back"),
    },
    {
      id: "trail-forward",
      title: "Trail forward",
      group: "Move",
      keys: ["mod+]"],
      run: () => trailMove("forward"),
    },
    {
      id: "explain",
      title: "Explain selection or current hunk",
      group: "Act",
      keys: ["e"],
      run: () => runExplain(selectionTarget()),
    },
    {
      id: "explain-file",
      title: "Explain current file",
      group: "Act",
      keys: ["shift+e"],
      run: () => {
        const id = currentFileId()
        runExplain(id ? fileTarget(id) : null)
      },
    },
    {
      id: "viewed",
      title: "Mark file viewed",
      group: "Act",
      keys: ["v"],
      run: () => {
        const id = currentFileId()
        if (id) toggleViewed(id)
      },
    },
    {
      id: "clear-selection",
      title: "Clear selection",
      group: "Act",
      keys: ["escape"],
      paletteHidden: true,
      enabled: () =>
        useUI.getState().selection !== null &&
        !useUI.getState().palette &&
        !useUI.getState().shortcuts,
      run: () => useUI.getState().set({ selection: null }),
    },
    {
      id: "split",
      title: "Toggle split view",
      group: "View",
      keys: ["alt+s"],
      run: () =>
        useUI.getState().set({
          layout: useUI.getState().layout === "split" ? "unified" : "split",
        }),
    },
    {
      id: "whitespace",
      title: "Toggle hiding whitespace changes",
      group: "View",
      keys: ["w"],
      run: () =>
        useUI
          .getState()
          .set({ ignoreWhitespace: !useUI.getState().ignoreWhitespace }),
    },
    {
      id: "open-editor",
      title: "Open in editor",
      group: "App",
      keys: ["o"],
      enabled: () => actions.canOpenInEditor,
      run: () => {
        const r = model.rows[rowAt(model, scrollTop.current + HEAD_ROOM + 8)]
        if (!r || r.k === "end") return
        const f = files.find((x) => x.id === r.fileId)
        const line =
          r.k === "line"
            ? Math.max(r.head, r.base) + 1
            : r.k === "pair"
              ? Math.max(r.r, r.l) + 1
              : r.k === "hunk"
                ? r.head + 1
                : 1
        if (f) openInEditor(f.path, line)
      },
    },
    {
      id: "refresh",
      title: "Refresh Snapshot / fetch new commits",
      group: "App",
      keys: ["shift+r"],
      run: () => refresh.mutate(),
    },
    {
      id: "home",
      title: "All Reviews",
      group: "App",
      keys: [],
      run: () => useUI.getState().go({ name: "home" }),
    },
  ]
  useKeyboard(commands, !ui.palette && !ui.shortcuts)

  // Expose commands and files to the palette.
  const commandsRef = useRef(commands)
  commandsRef.current = commands
  useEffect(() => {
    useUI.getState().set({
      paletteSource: {
        get commands() {
          return commandsRef.current
        },
        files: files.map((f) => ({ id: f.id, path: f.path })),
        openFile,
      },
    })
    return () => useUI.getState().set({ paletteSource: null })
  }, [files, openFile])

  // Menu commands from main (File → Refresh).
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent).detail === "refresh") refresh.mutate()
    }
    window.addEventListener("legible-command", on)
    return () => window.removeEventListener("legible-command", on)
  }, [refresh])

  // Check once on open whether the source moved since the last Iteration.
  useEffect(() => {
    client
      .call("review.checkForChanges", { reviewId })
      .then((r) => {
        if (r.available) {
          const s = useUI.getState()
          s.set({
            changesAvailable: {
              ...s.changesAvailable,
              [reviewId]: r.detail ?? "New changes",
            },
          })
        }
      })
      .catch(() => undefined)
  }, [client, reviewId])

  const job = ui.activeJobId ? (ui.jobs[ui.activeJobId] ?? null) : null
  const viewedCount = files.filter((f) => viewed.has(f.id)).length
  const changes = ui.changesAvailable[reviewId]
  const r = review.data
  const it = iterations.data?.find((x) => x.id === iterationId)
  const onLatest = !ui.iterationId || ui.iterationId === latestId

  return (
    <>
      <Titlebar>
        <nav className="flex items-center gap-0.5" aria-label="Trail">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Back"
            title={`Back (${formatKey("mod+[").join("")})`}
            disabled={ui.trail.back.length === 0}
            onClick={() => trailMove("back")}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Forward"
            title={`Forward (${formatKey("mod+]").join("")})`}
            disabled={ui.trail.forward.length === 0}
            onClick={() => trailMove("forward")}
          >
            <ChevronRight />
          </Button>
        </nav>
        <nav
          className="flex min-w-0 grow items-center gap-1.5 text-sm text-muted-foreground"
          aria-label="Location"
        >
          <Button
            variant="plain"
            size="none"
            className="text-sm font-normal"
            onClick={() => ui.go({ name: "home" })}
          >
            Reviews
          </Button>
          <ChevronRight className="size-3 shrink-0" />
          <span className="truncate">{r?.repo.displayName}</span>
          <ChevronRight className="size-3 shrink-0" />
          <b className="truncate font-medium text-foreground">{r?.title}</b>
        </nav>
        {r && (
          <Badge tone="outline">
            {r.mode === "author" ? "Author mode" : "Reviewer mode"}
          </Badge>
        )}
        {iterations.data && iterations.data.length > 1 ? (
          <Select
            className="h-7 text-sm"
            aria-label="Iteration"
            value={iterationId ?? ""}
            onChange={(e) =>
              ui.set({
                iterationId:
                  e.target.value === latestId ? null : e.target.value,
                selection: null,
              })
            }
          >
            {iterations.data.toReversed().map((x) => (
              <option key={x.id} value={x.id}>
                Iteration {x.seq} of {iterations.data.length} ·{" "}
                {relativeTime(x.createdAt)}
              </option>
            ))}
          </Select>
        ) : (
          it && (
            <span className="text-xs text-muted-foreground">
              Iteration {it.seq}
            </span>
          )
        )}
        <span
          className="px-1 font-mono text-xs text-muted-foreground"
          title="Spent on this Review"
        >
          {usd(spend.data?.reviewUsd ?? 0)}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="w-[180px] justify-between text-muted-foreground"
          onClick={() => ui.set({ palette: true })}
        >
          <span className="flex items-center gap-1.5">
            <Search />
            Search or run…
          </span>
          <Kbd keys={formatKey("mod+k")} />
        </Button>
      </Titlebar>

      {changes && onLatest && (
        <div
          role="status"
          className="flex shrink-0 items-center gap-3 border-b border-ask-border bg-ask-bg px-[18px] py-[9px]"
        >
          <RefreshCw className="size-3.5 text-ask" />
          <span className="grow text-sm">
            <b className="font-semibold">{changes}</b>
            <span className="text-muted-foreground">
              {" "}
              ·{" "}
              {r?.sourceKind === "working_tree"
                ? "Refresh to take a new Snapshot."
                : "Refresh to review the new Iteration."}
            </span>
          </span>
          <Button
            size="sm"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
          >
            {refresh.isPending && <Loader2 className="animate-spin" />}
            Refresh
          </Button>
        </div>
      )}
      {!onLatest && it && (
        <div
          role="status"
          className="flex shrink-0 items-center gap-3 border-b bg-sidebar px-[18px] py-[9px]"
        >
          <span className="grow text-sm">
            <b className="font-semibold">Iteration {it.seq}</b>{" "}
            <span className="text-muted-foreground">
              · an earlier state of this Review
            </span>
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => ui.set({ iterationId: null })}
          >
            Go to latest
          </Button>
        </div>
      )}

      <div className="flex min-h-0 flex-auto">
        <aside
          aria-label="Files"
          className="flex min-h-0 w-[296px] shrink-0 flex-col border-r bg-sidebar"
        >
          <div className="flex items-center gap-2 px-3.5 pt-3 pb-2">
            <span className="grow text-sm font-semibold">Files</span>
            <span className="text-xs text-muted-foreground">
              {files.length} changed ·{" "}
              <span className="text-ok">+{cs.data?.additions ?? 0}</span>{" "}
              <span className="text-critical">−{cs.data?.deletions ?? 0}</span>
            </span>
          </div>
          <div className="flex-auto overflow-auto px-1.5 pb-2">
            <FileTree
              files={files}
              viewed={viewed}
              activeFileId={topFile}
              onOpen={openFile}
            />
          </div>
          <div className="flex flex-col gap-1.5 border-t px-4 py-3">
            <div className="flex items-center text-xs">
              <span className="grow text-muted-foreground">Change Set</span>
              <span>
                {viewedCount} of {files.length} files viewed
              </span>
            </div>
            <Progress
              value={files.length ? (viewedCount / files.length) * 100 : 0}
            />
          </div>
        </aside>

        <section aria-label="Diff" className="flex min-w-0 flex-auto flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-b px-3.5 py-2">
            {r?.intentText && (
              <span
                className="max-w-[420px] truncate text-sm"
                title={r.intentText}
              >
                {r.intentText.split("\n")[0]}
              </span>
            )}
            {cs.data && cs.data.moves.length > 0 && (
              <Badge tone="ask">
                {cs.data.moves.length} moved{" "}
                {cs.data.moves.length === 1 ? "block" : "blocks"}
              </Badge>
            )}
            <span className="grow" />
            <Button
              variant="muted"
              size="sm"
              onClick={() => runExplain(selectionTarget())}
              title="Explain (e)"
            >
              <BookOpen />
              Explain
              <Kbd keys={["e"]} />
            </Button>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Switch
                checked={ui.ignoreWhitespace}
                label="Hide whitespace changes"
                onChange={(v) => ui.set({ ignoreWhitespace: v })}
              />
              Hide whitespace
            </span>
            <Tabs label="Diff layout" className="h-7 p-0.5">
              <Tab
                selected={ui.layout === "unified"}
                className="px-2"
                onClick={() => ui.set({ layout: "unified" })}
              >
                Unified
              </Tab>
              <Tab
                selected={ui.layout === "split"}
                className="px-2"
                onClick={() => ui.set({ layout: "split" })}
              >
                Split
              </Tab>
            </Tabs>
          </div>
          {cs.isError ? (
            <div className="flex flex-auto flex-col items-center justify-center gap-2.5 p-6 text-center text-muted-foreground">
              <span className="text-sm">{cs.error.message}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => ui.go({ name: "home" })}
              >
                <ArrowLeft />
                All Reviews
              </Button>
            </div>
          ) : !cs.data ? (
            <DiffLoading />
          ) : files.length === 0 ? (
            <div className="flex flex-auto flex-col items-center justify-center gap-2.5 p-6 text-center text-muted-foreground">
              <span className="text-base font-semibold text-foreground">
                No changes
              </span>
              <span className="text-sm">
                Base and Head are identical
                {r?.sourceKind === "working_tree"
                  ? ". Changes you or an agent make here will show up as a refresh."
                  : "."}
              </span>
            </div>
          ) : (
            <DiffView
              summary={cs.data}
              model={model}
              diffs={diffs}
              viewed={viewed}
              actions={actions}
              scrollRef={scrollRef}
              onScrollTop={(px, fileId) => {
                scrollTop.current = px
                setTopFile((prev) => (prev === fileId ? prev : fileId))
                updateNear(px)
              }}
            />
          )}
        </section>

        <aside
          aria-label="Context"
          className="flex min-h-0 w-[360px] shrink-0 flex-col border-l bg-panel"
          data-testid="context-panel"
        >
          {runtime.data && !runtime.data.ready && (
            <Callout tone="elevated" className="mx-3 mt-3 px-2.5 py-2 text-sm">
              {runtime.data.detail}.{" "}
              <Button
                variant="link"
                size="none"
                className="text-sm"
                onClick={() =>
                  ui.go({ name: "settings", section: "providers" })
                }
              >
                Settings
              </Button>
            </Callout>
          )}
          <ExplainPanel
            job={job}
            explanation={ui.shownExplanation}
            history={(history.data ?? []).filter(
              (h) => h.id !== (ui.shownExplanation?.id ?? job?.explanation?.id),
            )}
            onShow={(e) => ui.set({ shownExplanation: e, activeJobId: null })}
            onJump={jumpToExplanation}
            onRetry={(force) => {
              const t = job?.target ?? ui.shownExplanation?.target ?? null
              runExplain(t, force)
            }}
            onCancel={() => {
              if (job)
                client
                  .call("explain.cancel", { jobId: job.jobId })
                  .catch((e: Error) => useUI.getState().toast(e.message))
            }}
          />
        </aside>
      </div>
    </>
  )
}
