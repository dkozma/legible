import type {
  CodeSymbol,
  Connection,
  ConnectionSite,
  Explanation,
  ExplanationTarget,
  FileChange,
  FileDiff,
  StepEdit,
  SymbolConnections,
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
  ListChecks,
  Network,
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
  LineTab,
  Progress,
  Select,
  Switch,
  Tab,
  Tabs,
  Titlebar,
} from "../components/ui"
import { useClient } from "../context"
import { type DiffActions, DiffLoading, DiffView } from "../diff/DiffView"
import {
  buildRows,
  chunkRanges,
  rangesForRows,
  rowAt,
  rowForLine,
} from "../diff/rows"
import { BriefPage } from "../review/BriefPage"
import { ConnectionsPanel, symbolLabel } from "../review/ConnectionsPanel"
import { ExplainPanel } from "../review/ExplainPanel"
import { FileTree } from "../review/FileTree"
import { StepHeader } from "../review/StepHeader"
import { stepAt, stepFocus } from "../review/steps"
import { WalkthroughList, WalkthroughProgress } from "../review/WalkthroughList"
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
  const iterIds = { reviewId, iterationId: iterationId ?? "" }
  const understanding = useQuery({
    queryKey: ["understanding", reviewId, iterationId],
    queryFn: () => client.call("understanding.status", iterIds),
    enabled: Boolean(iterationId),
  })
  const intent = useQuery({
    queryKey: ["intent", reviewId],
    queryFn: () => client.call("intent.get", { reviewId }),
  })
  const walkthrough = useQuery({
    queryKey: ["walkthrough", reviewId, iterationId],
    queryFn: () => client.call("walkthrough.get", iterIds),
    enabled: Boolean(iterationId),
  })
  const brief = useQuery({
    queryKey: ["brief", reviewId, iterationId],
    queryFn: () => client.call("brief.get", iterIds),
    enabled: Boolean(iterationId),
  })
  const transcripts = useQuery({
    queryKey: ["transcripts", reviewId],
    queryFn: () => client.call("transcripts.list", { reviewId }),
    staleTime: 60_000,
  })
  const stepsViewedQ = useQuery({
    queryKey: ["stepsViewed", reviewId],
    queryFn: () => client.call("steps.viewed", { reviewId }),
  })
  const w = walkthrough.data ?? null
  const stepsViewed = useMemo(
    () => new Set(stepsViewedQ.data ?? []),
    [stepsViewedQ.data],
  )
  const activeStep =
    ui.page === "diff" && ui.stepId
      ? (w?.steps.find((x) => x.id === ui.stepId) ?? null)
      : null
  const stepView = useMemo(
    () => (w && activeStep ? stepFocus(w, activeStep.id) : null),
    [w, activeStep],
  )

  // Build the Intent, Walkthrough and Brief when the Review opens, once per Iteration.
  const started = useRef<string | null>(null)
  useEffect(() => {
    if (!iterationId || !settings.data || !understanding.data) return
    if (started.current === iterationId) return
    started.current = iterationId
    if (settings.data.understanding.auto && understanding.data.state === "idle")
      client
        .call("understanding.run", { ...iterIds, rebuild: "none" })
        .then((st) =>
          qc.setQueryData(["understanding", reviewId, iterationId], st),
        )
        .catch((e: Error) => useUI.getState().toast(e.message))
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
        step: stepView,
      }),
    [
      stepView,
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

  /** Records where the diff is and which Symbol the panel shows, so ⌘[ comes back here. */
  const pushTrail = useCallback(() => {
    const s = useUI.getState()
    s.set({
      trail: {
        back: [
          ...s.trail.back,
          {
            reviewId,
            px: scrollTop.current,
            stepId: s.page === "diff" ? s.stepId : null,
            symbolId: s.focusSymbol?.symbolId ?? null,
            label: s.focusSymbol?.label ?? null,
          },
        ].slice(-100),
        forward: [],
      },
    })
  }, [reviewId])
  const scrollToPx = useCallback(
    (px: number, trail = false) => {
      if (trail) pushTrail()
      useUI.getState().scroll(px)
    },
    [pushTrail],
  )
  const scrollToRow = useCallback(
    (row: number, trail = false) =>
      scrollToPx((model.offsets[row] ?? 0) - HEAD_ROOM, trail),
    [model.offsets, scrollToPx],
  )

  /** A line to scroll to once the model shows it: after switching Steps, the rows change first. */
  const pending = useRef<{
    fileId: string
    side: "base" | "head"
    line: number
  } | null>(null)
  useEffect(() => {
    const p = pending.current
    if (!p) return
    pending.current = null
    const f = model.files.find((x) => x.fileId === p.fileId)
    const row =
      p.line < 0 ? (f?.row ?? -1) : rowForLine(model, p.fileId, p.side, p.line)
    if (row >= 0) useUI.getState().scroll((model.offsets[row] ?? 0) - HEAD_ROOM)
  }, [model])

  /** Shows a file's line (0-based; -1 for the file) in the diff, switching Steps when another holds it. */
  const reveal = useCallback(
    (fileId: string, side: "base" | "head", line: number): boolean => {
      const s = useUI.getState()
      const row =
        line < 0
          ? (model.files.find((x) => x.fileId === fileId)?.row ?? -1)
          : rowForLine(model, fileId, side, line)
      if (row >= 0 && s.page === "diff") {
        s.scroll((model.offsets[row] ?? 0) - HEAD_ROOM)
        return true
      }
      const file = files.find((x) => x.id === fileId)
      if (!file) return false
      const holder = w && line >= 0 ? stepAt(w, file, side, line + 1) : null
      pending.current = { fileId, side, line }
      s.set({ page: "diff", stepId: holder?.id ?? null })
      return true
    },
    [model, files, w],
  )

  const openFile = useCallback(
    (fileId: string) => {
      pushTrail()
      const s = useUI.getState()
      s.set({ activeFileId: fileId })
      const f = model.files.find((x) => x.fileId === fileId)
      if (f && s.page === "diff" && !s.stepId) {
        scrollToRow(f.row)
        return
      }
      // From the Brief or a Step: the whole Change Set, at that file.
      pending.current = { fileId, side: "head", line: -1 }
      s.set({ page: "diff", stepId: null, sidebar: "files" })
    },
    [model.files, scrollToRow, pushTrail],
  )

  const openStep = useCallback(
    (stepId: string) => {
      pushTrail()
      const s = useUI.getState()
      s.set({ page: "diff", stepId, sidebar: "walkthrough", selection: null })
      s.scroll(0)
    },
    [pushTrail],
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
      s.set({
        activeJobId: job.jobId,
        shownExplanation: null,
        panel: "explain",
      })
    },
    onError: (e: Error) => useUI.getState().toast(e.message),
  })

  // ---- Symbols and Connections ------------------------------------------------------

  const fileOf = (side: "base" | "head", path: string) =>
    files.find((f) =>
      side === "base" ? (f.oldPath ?? f.path) === path : f.path === path,
    ) ?? files.find((f) => f.path === path || f.oldPath === path)

  /** Shows a Symbol in the panel and scrolls to it when the diff draws its line. Joins the Trail. */
  const goToSymbol = (sym: CodeSymbol, opts: { keepPanel?: boolean } = {}) => {
    const f = fileOf(sym.side, sym.path)
    pushTrail()
    const shown = f ? reveal(f.id, sym.side, sym.nameLine - 1) : false
    useUI.getState().set({
      focusSymbol: { symbolId: sym.id, label: symbolLabel(sym) },
      // From an Explanation, stay on it when the diff shows the code; otherwise the
      // Connections panel shows the code instead.
      ...(opts.keepPanel && shown ? {} : { panel: "connections" as const }),
    })
  }

  /** Goes to where a Connection is made: the using line, with its Symbol in the panel. */
  const goToSite = (site: ConnectionSite, from: CodeSymbol | null) => {
    const f = fileOf(site.side, site.path)
    pushTrail()
    if (from)
      useUI.getState().set({
        focusSymbol: { symbolId: from.id, label: symbolLabel(from) },
        panel: "connections",
      })
    if (f) reveal(f.id, site.side, site.line - 1)
  }

  const inspect = (
    fileId: string,
    side: "base" | "head",
    line: number,
    col: number,
    follow: boolean,
  ) => {
    const f = files.find((x) => x.id === fileId)
    if (!f || !iterationId) return
    if (f.tier === "text") {
      if (follow)
        useUI
          .getState()
          .toast(
            `No Symbols in ${f.path.split("/").pop()}: Legible has no grammar for it.`,
            "info",
          )
      return
    }
    client
      .call("connections.at", {
        reviewId,
        iterationId,
        side,
        path: side === "base" ? (f.oldPath ?? f.path) : f.path,
        line: line + 1,
        col,
      })
      .then((at) => {
        const s = useUI.getState()
        if (!follow) {
          if (at.symbol)
            s.set({
              focusSymbol: {
                symbolId: at.symbol.id,
                label: symbolLabel(at.symbol),
              },
            })
          return
        }
        const [only] = at.targets
        if (only && at.targets.length === 1) goToSymbol(only)
        else if (at.targets.length > 1 && at.symbol) {
          s.set({
            focusSymbol: {
              symbolId: at.symbol.id,
              label: symbolLabel(at.symbol),
            },
            panel: "connections",
          })
          s.toast(
            `${at.connection?.name ?? "This name"} is ambiguous: ${at.targets.length} candidates, listed under Uses.`,
            "info",
          )
        } else if (at.connection?.status === "external")
          s.toast(
            `${at.connection.name} is defined outside the indexed code${at.connection.module ? ` (${at.connection.module})` : ""}.`,
            "info",
          )
        else if (at.symbol)
          s.set({
            focusSymbol: {
              symbolId: at.symbol.id,
              label: symbolLabel(at.symbol),
            },
            panel: "connections",
          })
      })
      .catch((e: Error) => useUI.getState().toast(e.message))
  }

  const lines = (s: CodeSymbol | null): [number, number] | null =>
    s ? [s.startLine, s.endLine] : null

  /** A Symbol with its Connection changes. Base and Head ranges come from it and its counterpart. */
  const symbolTarget = (all: SymbolConnections): ExplanationTarget | null => {
    const s = all.symbol
    const f = fileOf(s.side, s.path)
    // A file's own Symbol is the file.
    if (s.kind === "module" && f) return fileTarget(f.id)
    const head = s.side === "head" ? s : all.counterpart
    const base = s.side === "base" ? s : all.counterpart
    return {
      kind: "symbol",
      symbolId: s.id,
      fileId: f?.id ?? null,
      path: f?.path ?? s.path,
      oldPath: f?.oldPath ?? null,
      qualifiedName: s.qualifiedName,
      symbolKind: s.kind,
      // Outside the Change Set the file is the same on both sides.
      baseRange: f ? lines(base) : lines(s),
      headRange: lines(head),
    }
  }

  /** "How does A use B?": A's code, B's code, and what changed between them. */
  const connectionTarget = (
    c: Connection,
    all: SymbolConnections,
  ): ExplanationTarget | null => {
    const from = all.symbols[c.fromId]
    if (!from) return null
    const to = c.toId ? (all.symbols[c.toId] ?? null) : null
    const f = fileOf(from.side, from.path)
    const other = from.counterpartId
      ? (all.symbols[from.counterpartId] ?? null)
      : null
    const head = from.side === "head" ? from : other
    const base = from.side === "base" ? from : other
    return {
      kind: "connection",
      connectionId: c.id,
      connectionKind: c.kind,
      fromSymbolId: from.id,
      toSymbolId: to?.id ?? null,
      fromName: from.kind === "module" ? from.path : from.qualifiedName,
      toName: to ? (to.kind === "module" ? to.path : to.qualifiedName) : c.name,
      fileId: f?.id ?? null,
      path: f?.path ?? from.path,
      oldPath: f?.oldPath ?? null,
      baseRange: f ? lines(base) : lines(from),
      headRange: lines(head),
    }
  }

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

  const stepViewedMut = useMutation({
    mutationFn: ({ stepIds, on }: { stepIds: string[]; on: boolean }) =>
      client.call("steps.setViewed", { reviewId, stepIds, viewed: on }),
    onMutate: ({ stepIds, on }) => {
      qc.setQueryData<string[]>(["stepsViewed", reviewId], (old = []) =>
        on
          ? [...new Set([...old, ...stepIds])]
          : old.filter((x) => !stepIds.includes(x)),
      )
    },
    onError: (e: Error) => {
      useUI.getState().toast(e.message)
      void qc.invalidateQueries({ queryKey: ["stepsViewed", reviewId] })
    },
  })
  const toggleStepViewed = (stepId: string) =>
    stepViewedMut.mutate({ stepIds: [stepId], on: !stepsViewed.has(stepId) })

  const editStep = useMutation({
    mutationFn: (edit: StepEdit) =>
      client.call("walkthrough.edit", { ...iterIds, edit }),
    onSuccess: (next, edit) => {
      qc.setQueryData(["walkthrough", reviewId, iterationId], next)
      void qc.invalidateQueries({ queryKey: ["brief", reviewId] })
      // Follow the edited Step: a merge or split gives it a new id.
      const s = useUI.getState()
      if (
        edit.kind !== "rename" &&
        s.stepId &&
        !next.steps.some((x) => x.id === s.stepId)
      ) {
        const at = next.steps.find((x) =>
          x.fragments.some(
            (f) => activeStep?.fragments[0]?.fragmentId === f.fragmentId,
          ),
        )
        s.set({ stepId: at?.id ?? null })
      }
    },
    onError: (e: Error) => useUI.getState().toast(e.message),
  })

  const runUnderstanding = (
    rebuild: "none" | "all" | "intent" | "walkthrough" | "brief",
  ) => {
    if (!iterationId) return
    client
      .call("understanding.run", { ...iterIds, rebuild })
      .then((st) =>
        qc.setQueryData(["understanding", reviewId, iterationId], st),
      )
      .catch((e: Error) => useUI.getState().toast(e.message))
  }
  const afterIntent = async () => {
    await qc.invalidateQueries({ queryKey: ["intent", reviewId] })
    // Scope and the Brief follow the Intent.
    runUnderstanding("brief")
  }
  const briefActions = {
    openStep,
    openFile,
    startSitting: (index: number) => {
      const st = w?.sittings.find((x) => x.index === index)
      const first =
        st?.stepIds.find((id) => !stepsViewed.has(id)) ?? st?.stepIds[0]
      if (first) openStep(first)
    },
    rebuild: runUnderstanding,
    cancel: () => {
      if (iterationId)
        client
          .call("understanding.cancel", iterIds)
          .catch((e: Error) => useUI.getState().toast(e.message))
    },
    saveIntent: (goal: string, requirements: string[]) =>
      client
        .call("intent.save", {
          reviewId,
          goal,
          requirements: requirements
            .map((r) => r.trim())
            .filter(Boolean)
            .map((statement, i) => ({ id: `R${i + 1}`, statement })),
        })
        .then(afterIntent)
        .catch((e: Error) => useUI.getState().toast(e.message)),
    confirmIntent: () =>
      client
        .call("intent.confirm", { reviewId })
        .then(afterIntent)
        .catch((e: Error) => useUI.getState().toast(e.message)),
    resetIntent: () =>
      client
        .call("intent.reset", { reviewId })
        .then(async () => {
          await qc.invalidateQueries({ queryKey: ["intent", reviewId] })
          runUnderstanding("intent")
        })
        .catch((e: Error) => useUI.getState().toast(e.message)),
    setTranscript: (id: string, selected: boolean) =>
      client
        .call("transcripts.set", { reviewId, transcriptId: id, selected })
        .then(async () => {
          await qc.invalidateQueries({ queryKey: ["transcripts", reviewId] })
          runUnderstanding("intent")
        })
        .catch((e: Error) => useUI.getState().toast(e.message)),
  }

  /** Next or previous Step; across Chapters with `chapter`. */
  const moveStep = (dir: 1 | -1, chapter = false) => {
    if (!w?.steps.length) return false
    const i = activeStep ? w.steps.indexOf(activeStep) : -1
    if (chapter) {
      const cur = activeStep?.chapterId ?? null
      const next =
        dir === 1
          ? w.steps.find((x, k) => k > i && x.chapterId !== cur)
          : w.steps.findLast((x, k) => k < i && x.chapterId !== cur)
      if (next) openStep(next.id)
      return true
    }
    const next = w.steps[i < 0 ? 0 : i + dir]
    if (next) openStep(next.id)
    return true
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
    inspect,
    canOpenInEditor: Boolean(review.data?.repo.workTree),
    openStep,
  }

  const jumpToExplanation = (e: Explanation) => {
    const t = e.target
    // Symbols and Connections the diff doesn't show (outside the Change Set) open in the
    // Connections panel, which shows their code.
    const focus =
      t.kind === "symbol"
        ? { symbolId: t.symbolId, label: t.qualifiedName }
        : t.kind === "connection"
          ? { symbolId: t.fromSymbolId, label: t.fromName }
          : null
    const f = t.fileId
      ? model.files.find((x) => x.fileId === t.fileId)
      : undefined
    if (!f) {
      if (focus) {
        pushTrail()
        useUI.getState().set({ focusSymbol: focus, panel: "connections" })
      }
      return
    }
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
    const here = {
      reviewId,
      px: scrollTop.current,
      stepId: s.page === "diff" ? s.stepId : null,
      symbolId: s.focusSymbol?.symbolId ?? null,
      label: s.focusSymbol?.label ?? null,
    }
    if ((loc.stepId ?? null) !== (s.page === "diff" ? s.stepId : null))
      s.set({ page: "diff", stepId: loc.stepId ?? null })
    s.set({
      focusSymbol:
        loc.symbolId && loc.label
          ? { symbolId: loc.symbolId, label: loc.label }
          : null,
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
      id: "next",
      title: "Next Step (or file)",
      group: "Move",
      keys: ["n"],
      run: () => {
        if (!(ui.page === "diff" && ui.stepId && moveStep(1))) moveFile(1)
      },
    },
    {
      id: "prev",
      title: "Previous Step (or file)",
      group: "Move",
      keys: ["p"],
      run: () => {
        if (!(ui.page === "diff" && ui.stepId && moveStep(-1))) moveFile(-1)
      },
    },
    {
      id: "next-chapter",
      title: "Next Chapter",
      group: "Move",
      keys: ["shift+n"],
      enabled: () => Boolean(w?.chapters.length),
      run: () => moveStep(1, true),
    },
    {
      id: "brief",
      title: "Change Brief",
      group: "View",
      keys: ["b"],
      run: () => useUI.getState().set({ page: "brief" }),
    },
    {
      id: "start-sitting",
      title: "Start the next Sitting",
      group: "Move",
      keys: ["enter"],
      paletteHidden: true,
      enabled: () => useUI.getState().page === "brief" && Boolean(w),
      run: () => {
        const st =
          w?.sittings.find((x) =>
            x.stepIds.some((id) => !stepsViewed.has(id)),
          ) ?? w?.sittings[0]
        if (st) briefActions.startSitting(st.index)
      },
    },
    {
      id: "rebuild",
      title: "Rebuild the Walkthrough and Brief",
      group: "Act",
      keys: [],
      run: () => runUnderstanding("all"),
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
      id: "connections",
      title: "Show Connections",
      group: "View",
      keys: [],
      run: () => useUI.getState().set({ panel: "connections" }),
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
      title: "Mark Step (or file) viewed",
      group: "Act",
      keys: ["v"],
      run: () => {
        if (activeStep) {
          const seen = stepsViewed.has(activeStep.id)
          toggleStepViewed(activeStep.id)
          // Marking a Step viewed moves on to the next one.
          if (!seen) moveStep(1)
          return
        }
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

  // The mouse's back and forward buttons walk the Trail, as in a browser.
  const trailMoveRef = useRef(trailMove)
  trailMoveRef.current = trailMove
  useEffect(() => {
    const side = (e: MouseEvent) => e.button === 3 || e.button === 4
    const down = (e: MouseEvent) => {
      if (side(e)) e.preventDefault()
    }
    const up = (e: MouseEvent) => {
      if (!side(e)) return
      e.preventDefault()
      const s = useUI.getState()
      if (s.palette || s.shortcuts) return
      trailMoveRef.current(e.button === 3 ? "back" : "forward")
    }
    window.addEventListener("mousedown", down)
    window.addEventListener("mouseup", up)
    return () => {
      window.removeEventListener("mousedown", down)
      window.removeEventListener("mouseup", up)
    }
  }, [])

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
        <Tabs label="Review page" className="h-7 p-0.5">
          <Tab
            selected={ui.page === "brief"}
            className="px-2"
            onClick={() => ui.set({ page: "brief" })}
          >
            Brief
          </Tab>
          <Tab
            selected={ui.page === "diff"}
            className="px-2"
            onClick={() => {
              if (ui.page === "diff") return
              if (!ui.stepId && w?.steps[0] && ui.sidebar === "walkthrough")
                openStep(w.steps[0].id)
              else ui.set({ page: "diff" })
            }}
          >
            Changes
          </Tab>
        </Tabs>
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
          aria-label="Walkthrough and files"
          className="flex min-h-0 w-[296px] shrink-0 flex-col border-r bg-sidebar"
        >
          <div
            role="tablist"
            className="flex shrink-0 items-stretch gap-0.5 border-b px-2"
          >
            <LineTab
              selected={ui.sidebar === "walkthrough"}
              onClick={() => ui.set({ sidebar: "walkthrough" })}
            >
              <ListChecks />
              Walkthrough
            </LineTab>
            <LineTab
              selected={ui.sidebar === "files"}
              onClick={() => ui.set({ sidebar: "files" })}
            >
              Files
              <span className="text-xs text-muted-foreground">
                {files.length}
              </span>
            </LineTab>
          </div>
          {ui.sidebar === "walkthrough" ? (
            <>
              <div className="flex-auto overflow-auto pt-2">
                <WalkthroughList
                  walkthrough={w}
                  status={understanding.data ?? null}
                  viewed={stepsViewed}
                  activeStepId={activeStep?.id ?? null}
                  onOpen={openStep}
                  onBuild={() => runUnderstanding("walkthrough")}
                />
              </div>
              {w && (
                <WalkthroughProgress walkthrough={w} viewed={stepsViewed} />
              )}
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 px-3.5 pt-3 pb-2">
                <span className="grow text-sm font-semibold">Files</span>
                <span className="text-xs text-muted-foreground">
                  {files.length} changed ·{" "}
                  <span className="text-ok">+{cs.data?.additions ?? 0}</span>{" "}
                  <span className="text-critical">
                    −{cs.data?.deletions ?? 0}
                  </span>
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
            </>
          )}
        </aside>

        {ui.page === "brief" && r ? (
          <section
            aria-label="Change Brief"
            className="flex min-w-0 flex-auto flex-col"
          >
            <BriefPage
              review={r}
              summary={cs.data ?? null}
              intent={intent.data ?? null}
              walkthrough={w}
              brief={brief.data ?? null}
              status={understanding.data ?? null}
              transcripts={transcripts.data ?? []}
              viewedSteps={stepsViewed}
              actions={briefActions}
            />
          </section>
        ) : (
          <section
            aria-label="Diff"
            className="flex min-w-0 flex-auto flex-col"
          >
            {activeStep && w && (
              <StepHeader
                walkthrough={w}
                step={activeStep}
                intent={intent.data ?? null}
                viewed={stepsViewed}
                onToggleViewed={() => toggleStepViewed(activeStep.id)}
                onOpen={openStep}
                onEdit={(edit) => editStep.mutate(edit)}
              />
            )}
            <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-b px-3.5 py-2">
              {!activeStep && (intent.data?.goal ?? r?.intentText) && (
                <span
                  className="max-w-[420px] min-w-0 flex-[1_1_0] truncate text-sm"
                  title={intent.data?.goal ?? r?.intentText ?? ""}
                >
                  {intent.data?.goal ?? r?.intentText?.split("\n")[0]}
                </span>
              )}
              {activeStep && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => ui.set({ stepId: null })}
                  title="Show the whole Change Set"
                >
                  All changes
                </Button>
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
        )}

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
          <div
            role="tablist"
            className="flex shrink-0 items-stretch gap-0.5 border-b px-2"
          >
            <LineTab
              selected={ui.panel === "connections"}
              onClick={() => ui.set({ panel: "connections" })}
            >
              <Network />
              Connections
            </LineTab>
            <LineTab
              selected={ui.panel === "explain"}
              onClick={() => ui.set({ panel: "explain" })}
            >
              <BookOpen />
              Explain
            </LineTab>
          </div>
          {ui.panel === "connections" ? (
            <ConnectionsPanel
              reviewId={reviewId}
              iterationId={iterationId}
              files={files}
              topFileId={topFile}
              focus={ui.focusSymbol}
              trail={ui.trail.back}
              onGoSymbol={goToSymbol}
              onGoSite={goToSite}
              onExplainSymbol={(all) => runExplain(symbolTarget(all))}
              onExplainConnection={(c, all) =>
                runExplain(connectionTarget(c, all))
              }
            />
          ) : (
            <ExplainPanel
              reviewId={reviewId}
              iterationId={iterationId}
              onGoSymbol={(s) => goToSymbol(s, { keepPanel: true })}
              job={job}
              explanation={ui.shownExplanation}
              history={(history.data ?? []).filter(
                (h) =>
                  h.id !== (ui.shownExplanation?.id ?? job?.explanation?.id),
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
          )}
        </aside>
      </div>
    </>
  )
}
